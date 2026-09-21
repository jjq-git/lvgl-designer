/**
 * cloudStorage — 云端工程 API 客户端(同源相对路径 + 会话 cookie)。
 *
 * 后端契约(固定):
 *   GET    /api/lvgl/projects                     → {projects:[{id,name,version,updated_at}]}
 *   POST   /api/lvgl/projects {name,doc}          → 201 {id,name,version}
 *   GET    /api/lvgl/projects/:id                 → {id,name,doc,version,updated_at}
 *   PUT    /api/lvgl/projects/:id {doc,name?,baseVersion} → 200 {version};409 {error:'version conflict',current}
 *   DELETE /api/lvgl/projects/:id                 → 200
 *   POST   /api/lvgl/projects/:id/rename {name}   → 200
 *   GET    /api/lvgl/projects/:id/versions        → {versions:[{seq,kind,note,created_at}]}
 *   GET    /api/lvgl/projects/:id/versions/:seq   → {doc}
 *   POST   /api/lvgl/projects/:id/versions {note} → 201 {seq}
 *   POST   /api/lvgl/projects/:id/restore/:seq    → 200 {version}
 *   DELETE /api/lvgl/projects/:id/versions/:seq   → 200
 *
 * 统一错误处理:401/403/404/409/503 各自可判别,不裸抛。
 * 平台工程 API 不可用或离线时，上层回退纯本地。
 *
 * 所有返回值是可判别联合(discriminated union)`CloudResult<T>`:
 *   { ok:true, data } | { ok:false, kind:'unauthorized'|'forbidden'|'notFound'
 *                        |'conflict'|'disabled'|'offline'|'error', ... }
 * 上层用 kind 分流,永不 throw。
 */
import { apiUrl } from '../stores/authStore';
import type { StoredProjectDocument } from './projectPersistence';

/* ---------------- 类型 ---------------- */

export interface ProjectSummary {
  id: string;
  name: string;
  version: number;
  updated_at: string;
}

export interface ProjectDoc {
  id: string;
  name: string;
  doc: StoredProjectDocument;
  version: number;
  updated_at: string;
}

export type VersionKind = 'auto' | 'manual' | 'restore';

export interface VersionMeta {
  seq: number;
  kind: VersionKind;
  note: string;
  created_at: string;
}

/** 失败原因分类(上层据此分流) */
export type CloudErrorKind =
  | 'unauthorized' // 401 会话过期/未登录
  | 'forbidden' //    403 无权限
  | 'notFound' //     404 工程/版本不存在
  | 'conflict' //     409 乐观锁版本冲突(附 current 版本号)
  | 'disabled' //     503 实例未启用云存储
  | 'offline' //      网络异常/无法连接(离线)
  | 'error'; //       其它(4xx/5xx/解析失败)

export interface CloudFail {
  ok: false;
  kind: CloudErrorKind;
  /** 人类可读文案(UI 直接可显示) */
  message: string;
  /** 409 时后端回传的当前云端版本号(用于冲突提示/强制覆盖) */
  current?: number;
  /** 原始 HTTP 状态码(offline 时为 0) */
  status: number;
}

export type CloudOk<T> = { ok: true; data: T };
export type CloudResult<T> = CloudOk<T> | CloudFail;

/* ---------------- 内部工具 ---------------- */

const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json' };
const GET_HEADERS = { accept: 'application/json' };
const PROJECTS_API = 'api/lvgl/projects';

function fail(kind: CloudErrorKind, message: string, status: number, current?: number): CloudFail {
  return { ok: false, kind, message, status, current };
}

/** 兼容旧服务的 {error} 和 FastAPI 的 {detail}。 */
async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.clone().json()) as {
      error?: unknown;
      detail?: unknown | { message?: unknown };
    };
    if (data && typeof data.error === 'string' && data.error.trim() !== '') return data.error;
    if (data && typeof data.detail === 'string' && data.detail.trim() !== '') return data.detail;
    if (data && typeof data.detail === 'object' && data.detail !== null
      && 'message' in data.detail && typeof data.detail.message === 'string'
      && data.detail.message.trim() !== '') return data.detail.message;
  } catch {
    /* 非 JSON */
  }
  return `请求失败(HTTP ${res.status})`;
}

/** 把非 2xx 响应映射到 CloudFail(409 额外解析 current) */
async function failFromResponse(res: Response): Promise<CloudFail> {
  const message = await readError(res);
  switch (res.status) {
    case 401:
      return fail('unauthorized', '会话已过期,请重新登录', 401);
    case 403:
      return fail('forbidden', message || '无权访问该工程', 403);
    case 404:
      return fail('notFound', message || '工程不存在或已被删除', 404);
    case 409: {
      let current: number | undefined;
      try {
        const data = (await res.clone().json()) as { current?: unknown };
        if (typeof data.current === 'number') current = data.current;
      } catch {
        /* ignore */
      }
      return fail('conflict', message || '云端已有更新的版本(版本冲突)', 409, current);
    }
    case 503:
      return fail('disabled', '未启用云存储,当前仅本地', 503);
    default:
      return fail('error', message, res.status);
  }
}

/**
 * 统一请求:成功走 parse 回 CloudOk;失败分类;网络异常 → offline。
 * parse 默认 res.json();传 null 表示不解析(如 DELETE 只需成功与否)。
 */
async function request<T>(
  path: string,
  init: RequestInit,
  parse: ((res: Response) => Promise<T>) | null,
): Promise<CloudResult<T>> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { credentials: 'same-origin', ...init });
  } catch {
    // fetch 抛出 = 网络层失败(离线/连接被拒/DNS)
    return fail('offline', '网络不可用,已切换到离线模式', 0);
  }
  if (!res.ok) return failFromResponse(res);
  try {
    const data = parse ? await parse(res) : (undefined as unknown as T);
    return { ok: true, data };
  } catch (e) {
    return fail('error', `响应解析失败:${(e as Error).message}`, res.status);
  }
}

/** id 段安全编码 */
const enc = (s: string | number): string => encodeURIComponent(String(s));

/* ---------------- 工程 CRUD ---------------- */

export function listProjects(): Promise<CloudResult<ProjectSummary[]>> {
  return request(
    PROJECTS_API,
    { method: 'GET', headers: GET_HEADERS },
    async (res) => {
      const data = (await res.json()) as { projects?: ProjectSummary[] };
      return Array.isArray(data.projects) ? data.projects : [];
    },
  );
}

export function createProject(
  name: string,
  doc: StoredProjectDocument,
): Promise<CloudResult<{ id: string; name: string; version: number }>> {
  return request(
    PROJECTS_API,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name, doc }) },
    async (res) => (await res.json()) as { id: string; name: string; version: number },
  );
}

export function getProject(id: string): Promise<CloudResult<ProjectDoc>> {
  return request(
    `${PROJECTS_API}/${enc(id)}`,
    { method: 'GET', headers: GET_HEADERS },
    async (res) => (await res.json()) as ProjectDoc,
  );
}

/**
 * 保存(乐观锁):PUT 带 baseVersion。
 * 成功 → {version}(新版本号);409 → CloudFail{kind:'conflict', current}。
 */
export function saveProject(
  id: string,
  doc: StoredProjectDocument,
  baseVersion: number,
  name?: string,
): Promise<CloudResult<{ version: number }>> {
  const body: Record<string, unknown> = { doc, baseVersion };
  if (name !== undefined) body.name = name;
  return request(
    `${PROJECTS_API}/${enc(id)}`,
    { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) },
    async (res) => (await res.json()) as { version: number },
  );
}

export function deleteProject(id: string): Promise<CloudResult<void>> {
  return request(`${PROJECTS_API}/${enc(id)}`, { method: 'DELETE', headers: GET_HEADERS }, null);
}

export function renameProject(id: string, name: string): Promise<CloudResult<void>> {
  return request(
    `${PROJECTS_API}/${enc(id)}/rename`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name }) },
    null,
  );
}

/* ---------------- 版本历史 ---------------- */

export function listVersions(id: string): Promise<CloudResult<VersionMeta[]>> {
  return request(
    `${PROJECTS_API}/${enc(id)}/versions`,
    { method: 'GET', headers: GET_HEADERS },
    async (res) => {
      const data = (await res.json()) as { versions?: VersionMeta[] };
      return Array.isArray(data.versions) ? data.versions : [];
    },
  );
}

export function getVersion(id: string, seq: number): Promise<CloudResult<StoredProjectDocument>> {
  return request(
    `${PROJECTS_API}/${enc(id)}/versions/${enc(seq)}`,
    { method: 'GET', headers: GET_HEADERS },
    async (res) => {
      const data = (await res.json()) as { doc: StoredProjectDocument };
      return data.doc;
    },
  );
}

/** 手动标当前为版本 */
export function markVersion(id: string, note: string): Promise<CloudResult<{ seq: number }>> {
  return request(
    `${PROJECTS_API}/${enc(id)}/versions`,
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ note }) },
    async (res) => (await res.json()) as { seq: number },
  );
}

/** 回滚到某版本 → 返回新的当前版本号 */
export function restoreVersion(id: string, seq: number): Promise<CloudResult<{ version: number }>> {
  return request(
    `${PROJECTS_API}/${enc(id)}/restore/${enc(seq)}`,
    { method: 'POST', headers: GET_HEADERS },
    async (res) => (await res.json()) as { version: number },
  );
}

export function deleteVersion(id: string, seq: number): Promise<CloudResult<void>> {
  return request(
    `${PROJECTS_API}/${enc(id)}/versions/${enc(seq)}`,
    { method: 'DELETE', headers: GET_HEADERS },
    null,
  );
}

/** 启动探测:云存储是否启用。网络失败按未启用容错。 */
export async function probeCloudEnabled(): Promise<boolean> {
  const r = await listProjects();
  if (r.ok) return true;
  // disabled(503)= 明确未启用;offline/error 也回退纯本地(不阻断启动)
  // unauthorized 视为"启用但未登录":理论上 SPA 已登录才加载,这里从宽当启用
  return r.kind === 'unauthorized';
}
