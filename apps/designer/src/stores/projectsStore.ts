/**
 * projectsStore — 工程"会话"态:工程列表 / 当前工程 id / 云同步状态。
 *
 * 与 projectStore.ts 的分工:
 *   projectStore  = 当前打开工程的**文档**(节点树 + undo/redo + dirty)。
 *   projectsStore = 工程**列表** / 当前是哪个工程 / 云端同步状态(乐观锁基线、离线/冲突)。
 *
 * 策略(云为主 + 本地离线兜底,IndexedDB 始终是本地真相):
 *   - 打开:优先云端 getProject → loadProject + 缓存进 IndexedDB;
 *     云端失败(离线)→ 读 IndexedDB 缓存 + syncState='offline' + 提示。
 *   - 自动保存:projectStore.dirty → debounce 2s → saveCurrent:
 *       先写 IndexedDB(必成),再 PUT 云端(带 baseVersion)。
 *       成功 → synced + 更新 currentVersion;
 *       网络失败 → offline(缓存标 pendingSync,恢复网络后自动补 PUT);
 *       409 → conflict(提示,用户可"强制保存"覆盖云端)。
 *   - 恢复网络(online 事件)→ 冲刷未同步队列(补 PUT)。
 *
 * undo/redo 归 projectStore,与本 store 正交,互不干扰。
 */
import { create } from 'zustand';
import { createEmptyProject, type LvProject } from '@lvd/schema';
import { useProjectStore } from './projectStore';
import { useEditorStore } from './editorStore';
import {
  cacheCloudProject,
  deleteCloudCache,
  listPendingCloud,
  markCloudSynced,
  readCloudCache,
} from '../services/storage';
import * as cloud from '../services/cloudStorage';
import type { ProjectSummary } from '../services/cloudStorage';
import {
  createStoredProjectDocument,
  loadProjectDocument,
  type StoredProjectDocument,
} from '../services/projectPersistence';
import { syncProjectAssetsToCloud } from '../services/assets';

export type SyncState = 'synced' | 'saving' | 'offline' | 'conflict';

/** 当前打开的云面板(App.tsx 据此渲染容器) */
export type CloudPanel = null | 'projects' | 'history';

const SAVE_DEBOUNCE_MS = 2000;

export interface ProjectsStoreState {
  /** 工程列表(云端;离线时可能是最后一次成功拉取的快照) */
  list: ProjectSummary[];
  /** 当前打开工程的云端 id;新建但未上云 / 纯本地时为 null */
  currentId: string | null;
  /** 当前工程名(列表/标题用;与 projectStore.project.meta.name 同步) */
  currentName: string;
  /** 乐观锁基线:最后一次已知的云端版本号 */
  currentVersion: number;
  /** 同步状态徽章 */
  syncState: SyncState;
  /** 云存储是否启用（启动探测独立工程 API） */
  cloudEnabled: boolean;
  /** 冲突时后端回传的云端版本(用于"强制覆盖"时忽略基线) */
  conflictCurrent: number | null;
  /** 列表加载态(UI) */
  listLoading: boolean;
  /** 列表最近一次错误(UI 提示) */
  listError: string | null;
  /** 当前打开的云面板(工程列表 / 版本历史 / 无) */
  panel: CloudPanel;

  openPanel(p: CloudPanel): void;
  /** 探测云存储并记录 cloudEnabled(启动调一次) */
  init(): Promise<void>;
  refreshList(): Promise<void>;
  /** 打开工程:云优先 → loadProject + 缓存;离线回退缓存 */
  openProject(id: string): Promise<void>;
  /** 新建工程(填名):云上创建成功则设为当前;离线则纯本地占位 */
  newProject(name: string): Promise<void>;
  /** 保存当前工程(debounce 入口用 scheduleSave;force=true 忽略基线覆盖云端) */
  saveCurrent(force?: boolean): Promise<void>;
  /** dirty 变化触发的防抖保存 */
  scheduleSave(): void;
  renameCurrent(name: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
  /** 把一个纯本地工程(doc)上传到云,成为云工程 */
  uploadLocal(name: string, doc: LvProject): Promise<cloud.CloudResult<{ id: string }>>;
  /** 网络恢复:冲刷 pendingSync 队列 */
  flushPending(): Promise<void>;
  setSyncState(s: SyncState): void;
}

/** 把 doc + 名字灌进编辑器(loadProject + 定位首屏)。
 * 云端/缓存来的 doc 是外部输入,先经 loadProjectJson 迁移+校验+补全,
 * 避免结构不完整时下游读 undefined.length 白屏。 */
function loadIntoEditor(rawDoc: StoredProjectDocument): void {
  let doc: LvProject;
  try {
    doc = loadProjectDocument(rawDoc).project;
  } catch {
    // 校验失败(格式过旧/损坏)→ 兜底空工程,别白屏
    doc = createEmptyProject();
    loadProjectDocument(doc);
  }
  useProjectStore.getState().loadProject(doc);
  const home = doc.screens.find((s) => s.isHome) ?? doc.screens[0];
  if (home) useEditorStore.getState().setActiveScreen(home.id);
}

function banner(msg: string | null): void {
  useEditorStore.getState().setBanner(msg);
}

let saveTimer: number | null = null;

export const useProjectsStore = create<ProjectsStoreState>()((set, get) => ({
  list: [],
  currentId: null,
  currentName: '',
  currentVersion: 0,
  syncState: 'synced',
  cloudEnabled: false,
  conflictCurrent: null,
  listLoading: false,
  listError: null,
  panel: null,

  openPanel: (panel) => set({ panel }),

  init: async () => {
    const enabled = await cloud.probeCloudEnabled();
    set({ cloudEnabled: enabled });
    if (enabled) await get().refreshList();
  },

  refreshList: async () => {
    if (!get().cloudEnabled) return;
    set({ listLoading: true, listError: null });
    const r = await cloud.listProjects();
    if (r.ok) {
      set({ list: r.data, listLoading: false });
    } else if (r.kind === 'offline') {
      // 保留上次快照,仅标记(不清空列表)
      set({ listLoading: false, listError: '离线:显示的是最近一次的工程列表' });
    } else if (r.kind === 'disabled') {
      set({ cloudEnabled: false, listLoading: false });
    } else {
      set({ listLoading: false, listError: r.message });
    }
  },

  openProject: async (id) => {
    const r = await cloud.getProject(id);
    if (r.ok) {
      const doc = r.data.doc;
      loadIntoEditor(doc);
      set({
        currentId: id,
        currentName: r.data.name,
        currentVersion: r.data.version,
        syncState: 'synced',
        conflictCurrent: null,
      });
      await cacheCloudProject({
        id,
        name: r.data.name,
        doc,
        version: r.data.version,
        updatedAt: new Date().toISOString(),
        pendingSync: false,
      });
      banner(null);
      return;
    }
    // 云端失败 → 回退本地缓存
    if (r.kind === 'offline' || r.kind === 'error') {
      const cached = await readCloudCache(id);
      if (cached) {
        loadIntoEditor(cached.doc);
        set({
          currentId: id,
          currentName: cached.name,
          currentVersion: cached.version,
          syncState: 'offline',
          conflictCurrent: null,
        });
        banner('当前离线,已从本地缓存打开该工程(改动将在联网后同步)');
        return;
      }
      banner('离线且本地无该工程缓存,无法打开');
      return;
    }
    if (r.kind === 'disabled') set({ cloudEnabled: false });
    banner(`打开工程失败:${r.message}`);
  },

  newProject: async (name) => {
    const doc = createEmptyProject(name);
    doc.meta.name = name;
    if (!get().cloudEnabled) {
      // 纯本地模式:直接进编辑器(靠 storage.ts 的 last 自动保存兜底)
      loadIntoEditor(doc);
      set({ currentId: null, currentName: name, currentVersion: 0, syncState: 'offline' });
      return;
    }
    const stored = createStoredProjectDocument(doc);
    const r = await cloud.createProject(name, stored);
    if (r.ok) {
      loadIntoEditor(doc);
      set({
        currentId: r.data.id,
        currentName: r.data.name,
        currentVersion: r.data.version,
        syncState: 'synced',
        conflictCurrent: null,
      });
      await cacheCloudProject({
        id: r.data.id,
        name: r.data.name,
        doc: stored,
        version: r.data.version,
        updatedAt: new Date().toISOString(),
        pendingSync: false,
      });
      await get().refreshList();
      banner(null);
      return;
    }
    if (r.kind === 'offline') {
      // 离线新建:进编辑器 + 本地占位,联网后由用户"上传到云"(无 id 无法 PUT)
      loadIntoEditor(doc);
      set({ currentId: null, currentName: name, currentVersion: 0, syncState: 'offline' });
      banner('离线新建:已在本地创建,联网后可从工程列表上传到云');
      return;
    }
    if (r.kind === 'disabled') set({ cloudEnabled: false });
    banner(`新建工程失败:${r.message}`);
  },

  scheduleSave: () => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void get().saveCurrent();
    }, SAVE_DEBOUNCE_MS);
  },

  saveCurrent: async (force = false) => {
    const { currentId, currentVersion, currentName, cloudEnabled } = get();
    const doc = useProjectStore.getState().project;
    const stored = createStoredProjectDocument(doc);

    // 1) 本地永远先写(真相);无云 id(纯本地/离线新建)只能本地
    if (currentId) {
      await cacheCloudProject({
        id: currentId,
        name: currentName,
        doc: stored,
        version: currentVersion,
        updatedAt: new Date().toISOString(),
        pendingSync: true,
      });
    }
    useProjectStore.getState().markSaved();

    if (!cloudEnabled || !currentId) return; // 纯本地 / 未上云:到此为止

    // 2) 云端 PUT(乐观锁)。force → 用后端回传的 current 作基线覆盖
    set({ syncState: 'saving' });
    await syncProjectAssetsToCloud(doc);
    const base = force && get().conflictCurrent != null ? (get().conflictCurrent as number) : currentVersion;
    const r = await cloud.saveProject(currentId, stored, base, currentName);
    if (r.ok) {
      set({ currentVersion: r.data.version, syncState: 'synced', conflictCurrent: null });
      await markCloudSynced(currentId, r.data.version);
      return;
    }
    if (r.kind === 'conflict') {
      set({ syncState: 'conflict', conflictCurrent: r.current ?? null });
      banner('版本冲突:云端已被其它会话更新。可"强制保存"覆盖云端,或刷新放弃本地改动。');
      return;
    }
    if (r.kind === 'offline') {
      set({ syncState: 'offline' }); // 缓存已标 pendingSync,联网后补传
      return;
    }
    if (r.kind === 'disabled') {
      set({ cloudEnabled: false, syncState: 'offline' });
      return;
    }
    if (r.kind === 'unauthorized') {
      set({ syncState: 'offline' });
      banner('会话已过期,改动仅存本地。请重新登录后再保存到云。');
      return;
    }
    set({ syncState: 'offline' });
    banner(`保存到云失败:${r.message}(改动已存本地)`);
  },

  renameCurrent: async (name) => {
    const { currentId, cloudEnabled } = get();
    set({ currentName: name });
    useProjectStore.getState().mutateV2('重命名工程', (draft) => {
      draft.meta.name = name;
    });
    if (!cloudEnabled || !currentId) return;
    const r = await cloud.renameProject(currentId, name);
    if (r.ok) {
      set((s) => ({
        list: s.list.map((p) => (p.id === currentId ? { ...p, name } : p)),
      }));
    } else if (r.kind !== 'offline') {
      banner(`重命名失败:${r.message}`);
    }
  },

  deleteProject: async (id) => {
    const { cloudEnabled } = get();
    if (cloudEnabled) {
      const r = await cloud.deleteProject(id);
      if (!r.ok && r.kind !== 'notFound' && r.kind !== 'offline') {
        banner(`删除失败:${r.message}`);
        return;
      }
    }
    await deleteCloudCache(id);
    set((s) => ({ list: s.list.filter((p) => p.id !== id) }));
    // 删的是当前工程 → 清空当前指针(App 层可引导新建/打开其它)
    if (get().currentId === id) {
      set({ currentId: null, currentName: '', currentVersion: 0, syncState: 'synced' });
    }
  },

  uploadLocal: async (name, doc) => {
    if (!get().cloudEnabled) {
      return { ok: false, kind: 'disabled', message: '未启用云存储', status: 503 };
    }
    await syncProjectAssetsToCloud(doc);
    const stored = createStoredProjectDocument(doc);
    const r = await cloud.createProject(name, stored);
    if (r.ok) {
      await cacheCloudProject({
        id: r.data.id,
        name: r.data.name,
        doc: stored,
        version: r.data.version,
        updatedAt: new Date().toISOString(),
        pendingSync: false,
      });
      await get().refreshList();
    }
    return r.ok ? { ok: true, data: { id: r.data.id } } : r;
  },

  flushPending: async () => {
    if (!get().cloudEnabled) return;
    const pending = await listPendingCloud();
    if (pending.length === 0) return;
    for (const e of pending) {
      const r = await cloud.saveProject(e.id, e.doc, e.version, e.name);
      if (r.ok) {
        await markCloudSynced(e.id, r.data.version);
        // 补传的是当前工程 → 更新基线 + 徽章
        if (get().currentId === e.id) {
          set({ currentVersion: r.data.version, syncState: 'synced', conflictCurrent: null });
        }
      } else if (r.kind === 'conflict' && get().currentId === e.id) {
        set({ syncState: 'conflict', conflictCurrent: r.current ?? null });
      } else if (r.kind === 'offline') {
        break; // 还没联网,停止本轮
      }
    }
  },

  setSyncState: (syncState) => set({ syncState }),
}));

/**
 * 订阅 projectStore.dirty → debounce 保存当前云工程。
 * online/offline:恢复网络时冲刷未同步队列。返回退订。
 * 在 App.tsx 启动时调用(与 startAutoSave 并行,两者各写各的库、互不冲突)。
 */
export function startCloudSync(): () => void {
  const unsub = useProjectStore.subscribe((s, prev) => {
    if (!s.dirty || s.revision === prev.revision) return;
    // 有云 id 才排云同步;纯本地由 storage.ts 的 last 自动保存兜底
    if (useProjectsStore.getState().currentId) useProjectsStore.getState().scheduleSave();
  });

  const onOnline = (): void => {
    void useProjectsStore.getState().flushPending();
    void useProjectsStore.getState().refreshList();
  };
  const onOffline = (): void => {
    const st = useProjectsStore.getState();
    if (st.currentId && st.syncState === 'synced') st.setSyncState('offline');
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  return () => {
    unsub();
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  };
}
