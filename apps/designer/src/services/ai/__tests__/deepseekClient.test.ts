import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AiHttpError, AiKeyMissingError, DS_KEY_STORAGE, chatComplete, chatStream, feedSseData, getStoredKey,
} from '../deepseekClient.js';

function stubLocalStorage(key: string | null): void {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k === DS_KEY_STORAGE ? key : null),
  } as unknown as Storage);
}

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('key 处理', () => {
  it('无本地 key → 不带 x-ds-key 照发(服务端可能有预置 key);代理回 401 missing key → AiKeyMissingError', async () => {
    stubLocalStorage(null);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'missing key' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(chatComplete({ model: 'deepseek-chat', messages: [] })).rejects.toBeInstanceOf(AiKeyMissingError);
    expect(getStoredKey()).toBeNull();
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['x-ds-key']).toBeUndefined();
  });

  it('无本地 key 但服务端有预置 key → 正常拿到回复', async () => {
    stubLocalStorage(null);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await chatComplete({ model: 'deepseek-chat', messages: [] });
    expect(r.content).toBe('ok');
  });

  it('key 经 x-ds-key 头送出,不进 body', async () => {
    stubLocalStorage('sk-test-123');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
      usage: { total_tokens: 5 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const r = await chatComplete({ model: 'deepseek-chat', messages: [{ role: 'user', content: 'x' }] });
    expect(r.content).toBe('hi');
    expect(r.usage?.total_tokens).toBe(5);

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('/api/lvgl/deepseek/chat');
    const headers = call[1].headers as Record<string, string>;
    expect(headers['x-ds-key']).toBe('sk-test-123');
    expect(String(call[1].body)).not.toContain('sk-test-123');
  });

  it('jsonMode → response_format json_object', async () => {
    stubLocalStorage('k');
    const fetchMock = vi.fn(async () => new Response('{"choices":[]}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await chatComplete({ model: 'deepseek-chat', messages: [], jsonMode: true, temperature: 0.3 });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.temperature).toBe(0.3);
    expect(body.stream).toBe(false);
  });
});

describe('错误透传', () => {
  it('非 2xx → AiHttpError(status + body 摘要)', async () => {
    stubLocalStorage('k');
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('{"error":{"message":"Insufficient Balance"}}', { status: 402 })));
    const err = await chatComplete({ model: 'deepseek-chat', messages: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiHttpError);
    expect((err as AiHttpError).status).toBe(402);
    expect((err as AiHttpError).bodySnippet).toContain('Insufficient Balance');
  });
});

describe('chatStream / SSE 解析', () => {
  const chunk = (s: string): string =>
    `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}\n\n`;

  it('多事件 + [DONE] 正常聚合', async () => {
    stubLocalStorage('k');
    vi.stubGlobal('fetch', vi.fn(async () =>
      sseResponse([chunk('你'), chunk('好'), 'data: [DONE]\n\n'])));
    const parts: string[] = [];
    await chatStream({ model: 'deepseek-chat', messages: [] }, (d) => parts.push(d));
    expect(parts.join('')).toBe('你好');
  });

  it('事件被 TCP 分包劈开也能拼回来', async () => {
    stubLocalStorage('k');
    const full = chunk('abc') + chunk('def') + 'data: [DONE]\n\n';
    const cut1 = full.slice(0, 17);          // 劈在 JSON 中间
    const cut2 = full.slice(17, 60);
    const cut3 = full.slice(60);
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([cut1, cut2, cut3])));
    const parts: string[] = [];
    await chatStream({ model: 'deepseek-chat', messages: [] }, (d) => parts.push(d));
    expect(parts.join('')).toBe('abcdef');
  });

  it('reasoning_content 走单独回调', async () => {
    stubLocalStorage('k');
    const r = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '想…' } }] })}\n\n`;
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([r, chunk('答'), 'data: [DONE]\n\n'])));
    const content: string[] = [];
    const reasoning: string[] = [];
    await chatStream({ model: 'deepseek-reasoner', messages: [] },
      (d) => content.push(d), (d) => reasoning.push(d));
    expect(content.join('')).toBe('答');
    expect(reasoning.join('')).toBe('想…');
  });

  it('feedSseData:[DONE]=true、心跳/坏行忽略', () => {
    expect(feedSseData(' [DONE]', () => {})).toBe(true);
    expect(feedSseData('', () => {})).toBe(false);
    expect(feedSseData('not json', () => {})).toBe(false);
  });
});
