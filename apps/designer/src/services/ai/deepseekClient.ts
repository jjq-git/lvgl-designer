/**
 * DeepSeek API 客户端(走独立后端同源代理 /api/lvgl/deepseek/chat)。
 * - key 取 localStorage['lvd.ds.key'],经自定义头 x-ds-key 交给代理转 Authorization;
 *   key 不落盘、不进代码、不进 git。
 * - chatComplete:非流式;chatStream:SSE(data: 行,[DONE] 结尾)。
 * - 上游错误 → AiHttpError(status + body 摘要);无 key → AiKeyMissingError。
 */

// 独立 FastAPI 提供平台代理；Vite 开发服务器通过 vite.config.ts
// 的 /api proxy 转发到同一个后端。
export const DS_PROXY_URL = '/api/lvgl/deepseek/chat';
export const DS_KEY_STORAGE = 'lvd.ds.key';

export type DsModel = 'deepseek-chat' | 'deepseek-reasoner' | (string & {});

export interface DsMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOpts {
  model: DsModel;
  messages: DsMessage[];
  /** true → response_format {type:'json_object'} */
  jsonMode?: boolean;
  temperature?: number;
  signal?: AbortSignal;
  maxTokens?: number;
}

export interface DsUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface DsResponse {
  /** assistant 正文 */
  content: string;
  /** deepseek-reasoner 的思维链(如有) */
  reasoningContent?: string;
  finishReason?: string;
  usage?: DsUsage;
  /** 上游原始 JSON,调试用 */
  raw: unknown;
}

/** aiSession 依赖的最小客户端接口(便于测试注入 mock) */
export interface AiClient {
  chatComplete(opts: ChatOpts): Promise<DsResponse>;
}

/* ------------------------------------------------------------------ 错误 */

export class AiKeyMissingError extends Error {
  constructor() {
    super('未配置 DeepSeek API Key(localStorage["lvd.ds.key"])');
    this.name = 'AiKeyMissingError';
  }
}

export class AiHttpError extends Error {
  readonly status: number;
  /** 上游 body 前 500 字符 */
  readonly bodySnippet: string;
  constructor(status: number, body: string) {
    const snippet = body.slice(0, 500);
    super(`DeepSeek 请求失败 HTTP ${status}:${snippet}`);
    this.name = 'AiHttpError';
    this.status = status;
    this.bodySnippet = snippet;
  }
}

/* ------------------------------------------------------------------ key */

export function getStoredKey(): string | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) return null;
    const v = ls.getItem(DS_KEY_STORAGE);
    return v && v.trim() !== '' ? v.trim() : null;
  } catch {
    return null; // 隐私模式等取不到 storage 时按无 key 处理
  }
}

/* ------------------------------------------------------------------ 请求 */

function buildBody(opts: ChatOpts, stream: boolean): string {
  return JSON.stringify({
    model: opts.model,
    messages: opts.messages,
    stream,
    ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
  });
}

function getProxyUrls(): string[] {
  return [DS_PROXY_URL];
}

function shouldTryNextProxy(status: number, body: string): boolean {
  return status === 404
    || status === 405
    || status === 501
    || (status === 503 && body.includes('storage not configured'));
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

async function postChat(opts: ChatOpts, stream: boolean): Promise<Response> {
  // 本地没填 key 也照发:代理端可能配了服务端预置 key(DS_KEY);
  // 两边都没有时代理回 401 "missing key",在下面转成 AiKeyMissingError。
  const key = getStoredKey();
  const request: RequestInit = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { 'x-ds-key': key } : {}),
      ...(stream ? { accept: 'text/event-stream' } : {}),
    },
    body: buildBody(opts, stream),
    signal: opts.signal ?? null,
  };
  const urls = getProxyUrls();
  let lastError: unknown = null;
  for (const [i, url] of urls.entries()) {
    let res: Response;
    try {
      res = await fetch(url, request);
    } catch (err) {
      if (isAbortError(err) || i === urls.length - 1) throw err;
      lastError = err;
      continue;
    }
    if (res.ok) return res;

    let body = '';
    try {
      body = await res.text();
    } catch {
      /* body 读不出来就用空串 */
    }
    if (res.status === 401 && body.includes('missing key')) throw new AiKeyMissingError();
    if (i < urls.length - 1 && shouldTryNextProxy(res.status, body)) continue;
    throw new AiHttpError(res.status, body);
  }
  throw lastError instanceof Error ? lastError : new Error('DeepSeek 代理不可用');
}

interface DsChoiceMessage {
  content?: string | null;
  reasoning_content?: string | null;
}
interface DsRawResponse {
  choices?: { message?: DsChoiceMessage; finish_reason?: string }[];
  usage?: DsUsage;
}

/** 非流式补全 */
export async function chatComplete(opts: ChatOpts): Promise<DsResponse> {
  const res = await postChat(opts, false);
  const raw = (await res.json()) as DsRawResponse;
  const choice = raw.choices?.[0];
  return {
    content: choice?.message?.content ?? '',
    reasoningContent: choice?.message?.reasoning_content ?? undefined,
    finishReason: choice?.finish_reason,
    usage: raw.usage,
    raw,
  };
}

/* ------------------------------------------------------------------ SSE */

interface DsStreamDelta {
  content?: string | null;
  reasoning_content?: string | null;
}
interface DsStreamChunk {
  choices?: { delta?: DsStreamDelta; finish_reason?: string | null }[];
}

/**
 * 单条 SSE data 载荷 → 回调。导出供测试。
 * 返回 true 表示流结束([DONE])。
 */
export function feedSseData(
  payload: string,
  onDelta: (delta: string) => void,
  onReasoningDelta?: (delta: string) => void,
): boolean {
  const trimmed = payload.trim();
  if (trimmed === '' ) return false;
  if (trimmed === '[DONE]') return true;
  let chunk: DsStreamChunk;
  try {
    chunk = JSON.parse(trimmed) as DsStreamChunk;
  } catch {
    return false; // 心跳/非 JSON 行,忽略
  }
  const delta = chunk.choices?.[0]?.delta;
  if (delta?.reasoning_content) onReasoningDelta?.(delta.reasoning_content);
  if (delta?.content) onDelta(delta.content);
  return false;
}

/**
 * 流式补全:每个 content 增量回调一次 onDelta;[DONE] 或流关闭时 resolve。
 */
export async function chatStream(
  opts: ChatOpts,
  onDelta: (delta: string) => void,
  onReasoningDelta?: (delta: string) => void,
): Promise<void> {
  const res = await postChat(opts, true);
  const body = res.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE 以空行分事件;逐行找 data: 前缀即可(DeepSeek 每事件单 data 行)
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        if (feedSseData(line.slice(5), onDelta, onReasoningDelta)) return;
      }
    }
    // 流关闭前残留的最后一行(无换行)也处理掉
    const last = buf.replace(/\r$/, '');
    if (last.startsWith('data:')) feedSseData(last.slice(5), onDelta, onReasoningDelta);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* 忽略 */
    }
  }
}

/** 默认客户端实例(生产用;测试注入假 client) */
export const defaultAiClient: AiClient = { chatComplete };
