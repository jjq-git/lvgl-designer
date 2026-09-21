/**
 * aiStore — AI 面板瞬态状态(对话/忙碌/模型/面板开合/Key 管理)。
 * - 绝不进 projectStore 历史栈,不进工程文件。
 * - API Key 只存 localStorage['lvd.ds.key'];store 内存里只保留 hasKey 布尔,
 *   getKey() 每次现读 localStorage,不在内存长存明文副本。
 * - model / temperature 持久化到 localStorage(lvd.ds.model / lvd.ds.temperature)。
 */
import { create } from 'zustand';

export const LS_KEY = 'lvd.ds.key';
const LS_MODEL = 'lvd.ds.model';
const LS_TEMP = 'lvd.ds.temperature';

export type AiModel = 'deepseek-chat' | 'deepseek-reasoner';
export type AiMsgStatus = 'pending' | 'ok' | 'error';

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: AiMsgStatus;
  /** 助手消息:本轮成功应用到画布的操作数(>0 时 UI 提示可 Ctrl+Z 撤销) */
  opsApplied?: number;
  /** status === 'error' 时的错误说明 */
  error?: string;
}

function readModel(): AiModel {
  try {
    const m = localStorage.getItem(LS_MODEL);
    return m === 'deepseek-reasoner' ? 'deepseek-reasoner' : 'deepseek-chat';
  } catch {
    return 'deepseek-chat';
  }
}

function readTemperature(): number {
  try {
    const t = Number(localStorage.getItem(LS_TEMP));
    return Number.isFinite(t) && t >= 0 && t <= 2 ? t : 1.0;
  } catch {
    return 1.0;
  }
}

function readHasKey(): boolean {
  try {
    return (localStorage.getItem(LS_KEY) ?? '') !== '';
  } catch {
    return false;
  }
}

let msgSeq = 0;
function newMsgId(): string {
  msgSeq += 1;
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${msgSeq}`;
}

export interface AiStoreState {
  panelOpen: boolean;
  settingsOpen: boolean;
  busy: boolean;
  model: AiModel;
  temperature: number;
  messages: AiMessage[];
  /** 是否已配置 API Key(明文不进内存) */
  hasKey: boolean;

  setPanelOpen(open: boolean): void;
  togglePanel(): void;
  setSettingsOpen(open: boolean): void;
  setBusy(busy: boolean): void;
  setModel(model: AiModel): void;
  setTemperature(t: number): void;

  /** 追加一条消息,返回其 id(供后续 update/append) */
  addMessage(msg: Omit<AiMessage, 'id'>): string;
  updateMessage(id: string, patch: Partial<Omit<AiMessage, 'id' | 'role'>>): void;
  /** 流式增量:往指定消息 content 末尾追加 */
  appendToMessage(id: string, delta: string): void;
  clearMessages(): void;

  /** 现读 localStorage,不缓存 */
  getKey(): string | null;
  /** 空串等价于 clearKey */
  setKey(key: string): void;
  clearKey(): void;
  refreshHasKey(): void;
}

export const useAiStore = create<AiStoreState>()((set, get) => ({
  panelOpen: false,
  settingsOpen: false,
  busy: false,
  model: readModel(),
  temperature: readTemperature(),
  messages: [],
  hasKey: readHasKey(),

  setPanelOpen: (panelOpen) => set({ panelOpen }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setBusy: (busy) => set({ busy }),

  setModel: (model) => {
    try {
      localStorage.setItem(LS_MODEL, model);
    } catch {
      /* 隐私模式等场景忽略 */
    }
    set({ model });
  },

  setTemperature: (t) => {
    const clamped = Math.min(2, Math.max(0, t));
    try {
      localStorage.setItem(LS_TEMP, String(clamped));
    } catch {
      /* ignore */
    }
    set({ temperature: clamped });
  },

  addMessage: (msg) => {
    const id = newMsgId();
    set((s) => ({ messages: [...s.messages, { ...msg, id }] }));
    return id;
  },

  updateMessage: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),

  appendToMessage: (id, delta) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, content: m.content + delta } : m)),
    })),

  clearMessages: () => set({ messages: [] }),

  getKey: () => {
    try {
      const k = localStorage.getItem(LS_KEY);
      return k === '' ? null : k;
    } catch {
      return null;
    }
  },

  setKey: (key) => {
    const k = key.trim();
    if (k === '') {
      get().clearKey();
      return;
    }
    try {
      localStorage.setItem(LS_KEY, k);
    } catch {
      /* ignore */
    }
    set({ hasKey: true });
  },

  clearKey: () => {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
    set({ hasKey: false });
  },

  refreshHasKey: () => set({ hasKey: readHasKey() }),
}));
