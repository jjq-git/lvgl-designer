/**
 * storage — IndexedDB 自动保存(idb;debounce 2s + beforeunload flush)+ 启动恢复。
 * v2 新增 'assets' 表:素材字节内容寻址(key = sha256),services/assets.ts 消费。
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { LvProject } from '@lvd/schema';
import { isProjectInteractionActive, useProjectStore } from '../stores/projectStore';
import {
  cloneStoredProjectDocument,
  createStoredProjectDocument,
  loadProjectDocument,
  type StoredProjectDocument,
} from './projectPersistence';

const DB_NAME = 'lvgl-designer';
const STORE = 'projects';
export const ASSET_STORE = 'assets';
/** v3:云工程本地缓存(离线真相),key = 云端工程 id */
export const CLOUD_STORE = 'cloudProjects';
const KEY = 'last';
const DEBOUNCE_MS = 2000;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 3, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      if (!d.objectStoreNames.contains(ASSET_STORE)) d.createObjectStore(ASSET_STORE);
      if (!d.objectStoreNames.contains(CLOUD_STORE)) d.createObjectStore(CLOUD_STORE);
    },
  });
  return dbPromise;
}

export async function saveNow(project: LvProject, expectedRevision?: number): Promise<void> {
  const d = await db();
  await d.put(STORE, cloneStoredProjectDocument(createStoredProjectDocument(project)), KEY);
  useProjectStore.getState().markSaved(expectedRevision);
}

/** 启动恢复:v2 快照主路径；v1 经兼容迁移读取。 */
export async function loadLastProject(): Promise<LvProject | null> {
  try {
    const d = await db();
    const raw = await d.get(STORE, KEY);
    if (!raw) return null;
    return loadProjectDocument(raw).project;
  } catch (e) {
    console.warn('[storage] 恢复最近工程失败', e);
    return null;
  }
}

/** 订阅 projectStore:dirty → debounce 2s 写库;beforeunload flush。返回退订。 */
export function startAutoSave(): () => void {
  let timer: number | null = null;
  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (isProjectInteractionActive()) {
      timer = window.setTimeout(flush, DEBOUNCE_MS);
      return;
    }
    const s = useProjectStore.getState();
    if (s.dirty) void saveNow(s.project, s.revision);
  };
  const unsub = useProjectStore.subscribe((s, prev) => {
    if (!s.dirty || s.revision === prev.revision) return;
    if (timer !== null) clearTimeout(timer);
    timer = window.setTimeout(flush, DEBOUNCE_MS);
  });
  const onUnload = (): void => flush();
  window.addEventListener('beforeunload', onUnload);
  return () => {
    unsub();
    window.removeEventListener('beforeunload', onUnload);
    if (timer !== null) clearTimeout(timer);
  };
}

/* ============================================================
   云工程本地缓存(CLOUD_STORE)——离线兜底 / 冲突永不丢工程
   本地始终是"真相":先写 IndexedDB(必成),再尝试 PUT 云端。
   pendingSync=true 标记"有未同步到云的本地改动"。
   ============================================================ */

export interface CloudCacheEntry {
  id: string; // 云端工程 id
  name: string;
  doc: StoredProjectDocument;
  /** 已知云端版本(乐观锁基线);未同步过则为 0 */
  version: number;
  updatedAt: string; // 本地最后写入时间 ISO
  /** true = 本地有改动尚未成功同步到云 */
  pendingSync: boolean;
}

/** 写云工程缓存(永远成功——本地真相) */
export async function cacheCloudProject(entry: CloudCacheEntry): Promise<void> {
  const d = await db();
  await d.put(CLOUD_STORE, {
    ...entry,
    doc: cloneStoredProjectDocument(entry.doc),
  }, entry.id);
}

/** 读云工程缓存；打开时由统一持久化边界校验。 */
export async function readCloudCache(id: string): Promise<CloudCacheEntry | null> {
  try {
    const d = await db();
    const raw = (await d.get(CLOUD_STORE, id)) as CloudCacheEntry | undefined;
    if (!raw) return null;
    return raw;
  } catch (e) {
    console.warn('[storage] 读云工程缓存失败', e);
    return null;
  }
}

/** 更新缓存里的同步元数据(同步成功后:pendingSync=false + 新 version) */
export async function markCloudSynced(id: string, version: number): Promise<void> {
  const d = await db();
  const raw = (await d.get(CLOUD_STORE, id)) as CloudCacheEntry | undefined;
  if (!raw) return;
  await d.put(CLOUD_STORE, { ...raw, version, pendingSync: false }, id);
}

export async function deleteCloudCache(id: string): Promise<void> {
  const d = await db();
  await d.delete(CLOUD_STORE, id);
}

/** 全部有未同步改动的缓存工程(网络恢复后补传队列) */
export async function listPendingCloud(): Promise<CloudCacheEntry[]> {
  try {
    const d = await db();
    const all = (await d.getAll(CLOUD_STORE)) as CloudCacheEntry[];
    return all.filter((e) => e && e.pendingSync);
  } catch {
    return [];
  }
}
