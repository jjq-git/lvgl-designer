/**
 * authStore — 应用内鉴权态(服务端会话式)。
 * - 登录页由服务器直出;SPA 能加载即已登录。仍拉一次 GET api/auth/me 拿角色。
 * - 所有服务请求走站点根路径 /api/*，由独立 FastAPI 后端提供。
 * - 401(极端:会话刚好过期)→ me=null,UI 容错(UserMenu 显示 "—",不抛错、不白屏)。
 * - logout():POST 后 location.reload();服务端会把无会话请求挡回登录页。
 * - 不进 projectStore 历史栈、不进工程文件。
 */
import { create } from 'zustand';

export type UserRole = 'admin' | 'normal';

export interface AuthUser {
  id?: number;
  username: string;
  role: UserRole;
  displayName?: string;
  permissions: string[];
}

export function hasPermission(user: AuthUser | null, permission: string): boolean {
  return user?.permissions.includes(permission) === true;
}

/**
 * 统一解析为站点根路径，避免部署在 /pages/tools/lvgl/ 后误请求
 * /pages/tools/lvgl/api/* 的旧独立 Node 服务路径。
 */
export function apiUrl(path: string): string {
  const clean = path.replace(/^\//, '');
  if (typeof document !== 'undefined') {
    return new URL('/' + clean, document.baseURI).toString();
  }
  return '/' + clean;
}

/** 当前打开的应用内鉴权模态(App.tsx 据此渲染容器,UserMenu 负责开合) */
export type AuthModal = null | 'password' | 'admin';

export interface AuthStoreState {
  me: AuthUser | null;
  /** 首次 fetchMe 尚未回来 */
  loading: boolean;
  /** 已发起过一次 fetchMe(避免 StrictMode 双调重复请求语义混乱) */
  fetched: boolean;
  /** 当前打开的模态 */
  modal: AuthModal;

  fetchMe(): Promise<void>;
  logout(): Promise<void>;
  /** 供 AdminPanel 等在用户名/角色变化后同步(例如给自己降级)手动刷新 */
  setMe(me: AuthUser | null): void;
  openModal(m: AuthModal): void;
}

export const useAuthStore = create<AuthStoreState>()((set) => ({
  me: null,
  loading: true,
  fetched: false,
  modal: null,

  fetchMe: async () => {
    set({ loading: true });
    try {
      const res = await fetch(apiUrl('api/auth/me'), {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!res.ok) {
        // 401(未登录/会话过期)或 4xx/5xx:按未知用户处理,不白屏
        set({ me: null, loading: false, fetched: true });
        return;
      }
      const envelope = (await res.json()) as {
        user?: Record<string, unknown>;
        id?: unknown;
        username?: unknown;
        role?: unknown;
        display_name?: unknown;
        permissions?: unknown;
      };
      const data = (envelope.user ?? envelope) as Record<string, unknown>;
      const role: UserRole = data.role === 'admin' ? 'admin' : 'normal';
      const username = typeof data.username === 'string' ? data.username : '';
      const rawPermissions = Array.isArray(data.permissions) ? data.permissions : envelope.permissions;
      const permissions = Array.isArray(rawPermissions)
        ? rawPermissions.filter((item): item is string => typeof item === 'string')
        : [];
      set({
        me: {
          ...(typeof data.id === 'number' ? { id: data.id } : {}),
          username,
          role,
          ...(typeof data.display_name === 'string' ? { displayName: data.display_name } : {}),
          permissions,
        },
        loading: false,
        fetched: true,
      });
    } catch {
      // 网络错误/后端未接:容错为 me=null
      set({ me: null, loading: false, fetched: true });
    }
  },

  logout: async () => {
    try {
      await fetch(apiUrl('api/auth/logout'), {
        method: 'POST',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      });
    } catch {
      /* 失败也照样 reload:服务端无会话会把我们挡回登录页 */
    }
    try {
      location.reload();
    } catch {
      /* 测试环境无 location.reload 时忽略 */
    }
  },

  setMe: (me) => set({ me }),

  openModal: (modal) => set({ modal }),
}));
