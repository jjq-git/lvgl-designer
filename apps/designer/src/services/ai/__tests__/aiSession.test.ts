import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { createEmptyProject, type LvProject } from '@lvd/schema';
import { migrateV1ToV2 } from '@lvd/schema/v2';
import type { AiClient, ChatOpts, DsResponse } from '../deepseekClient.js';
import { runAiTurn } from '../aiSession.js';

function proj(): LvProject {
  return createEmptyProject('t');
}

/** 录制式假客户端:按序吐 content,并记录每次收到的 messages */
function scriptedClient(contents: string[]): AiClient & { calls: ChatOpts[] } {
  let i = 0;
  const calls: ChatOpts[] = [];
  return {
    calls,
    async chatComplete(opts: ChatOpts): Promise<DsResponse> {
      calls.push(structuredClone(opts) as ChatOpts);
      const content = contents[i] ?? contents[contents.length - 1] ?? '';
      i++;
      return { content, raw: {} };
    },
  };
}

const GOOD = JSON.stringify({
  reply: '滑条加好了',
  ops: [{ op: 'add', parent: null, node: { type: 'slider', name: 'vol', props: { value: 40, mode: 'range' } } }],
});
const BAD_ENUM = JSON.stringify({
  reply: '加个滑条',
  ops: [{ op: 'add', parent: null, node: { type: 'slider', name: 'vol', props: { mode: 'fancy' } } }],
});

describe('runAiTurn — 修复回路', () => {
  it('一把过:attempts=1,recipe 可直接 mutate', async () => {
    const p = proj();
    const uiProject = migrateV1ToV2(p).uiProject;
    const client = scriptedClient([GOOD]);
    const r = await runAiTurn({
      project: p, uiProject, activeScreenId: p.screens[0]!.id, userText: '加个滑条', client,
    });
    expect(r.attempts).toBe(1);
    expect(r.errors).toEqual([]);
    expect(r.reply).toBe('滑条加好了');
    expect(r.rawOps).toHaveLength(1);
    const next = produce(uiProject, r.recipe!);
    expect(next.screens[0]!.root.children[0]!.codeName).toBe('vol');

    // system prompt + 本轮 user
    const first = client.calls[0]!;
    expect(first.jsonMode).toBe(true);
    expect(first.messages[0]!.role).toBe('system');
    expect(first.messages[0]!.content).toContain('LVGL 9.5.0');
    expect(first.messages.at(-1)).toEqual({ role: 'user', content: '加个滑条' });
  });

  it('第一轮坏枚举 → 错误喂回 → 第二轮修好:attempts=2', async () => {
    const p = proj();
    const client = scriptedClient([BAD_ENUM, GOOD]);
    const r = await runAiTurn({ project: p, activeScreenId: p.screens[0]!.id, userText: '加个滑条', client });
    expect(r.attempts).toBe(2);
    expect(r.recipe).toBeTypeOf('function');
    expect(r.errors).toEqual([]);

    // 第二次调用应带上:assistant 坏输出 + user 修复指令(含具体错误)
    const second = client.calls[1]!;
    const roles = second.messages.map((m) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
    const repair = second.messages.at(-1)!.content;
    expect(repair).toContain('未通过校验');
    expect(repair).toContain('bad-enum');
    expect(repair).toMatch(/normal\|range\|symmetrical/);
  });

  it('第一轮解析失败(围栏里也是坏 JSON)→ 第二轮修好', async () => {
    const p = proj();
    const client = scriptedClient(['```json\n{oops\n```', GOOD]);
    const r = await runAiTurn({ project: p, activeScreenId: p.screens[0]!.id, userText: 'x', client });
    expect(r.attempts).toBe(2);
    expect(r.recipe).toBeTypeOf('function');
    expect(client.calls[1]!.messages.at(-1)!.content).toContain('未通过解析');
  });

  it('修复轮耗尽(默认 ≤2 轮):attempts=3,无 recipe,errors 留给 UI', async () => {
    const p = proj();
    const client = scriptedClient([BAD_ENUM, BAD_ENUM, BAD_ENUM]);
    const r = await runAiTurn({ project: p, activeScreenId: p.screens[0]!.id, userText: 'x', client });
    expect(r.attempts).toBe(3);
    expect(r.recipe).toBeUndefined();
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]!.code).toBe('bad-enum');
    expect(r.reply).toBe('加个滑条');   // 最后一轮的 reply 仍返回
  });

  it('纯聊天(ops=[]):无 recipe、无错误', async () => {
    const p = proj();
    const client = scriptedClient([JSON.stringify({ reply: '你好!', ops: [] })]);
    const r = await runAiTurn({ project: p, activeScreenId: p.screens[0]!.id, userText: '你好', client });
    expect(r.attempts).toBe(1);
    expect(r.recipe).toBeUndefined();
    expect(r.errors).toEqual([]);
    expect(r.reply).toBe('你好!');
  });

  it('history 注入到 system 与本轮 user 之间;newMessages 供续写', async () => {
    const p = proj();
    const client = scriptedClient([GOOD]);
    const history = [
      { role: 'user' as const, content: '之前的话' },
      { role: 'assistant' as const, content: '{"reply":"嗯","ops":[]}' },
    ];
    const r = await runAiTurn({
      project: p, activeScreenId: p.screens[0]!.id, userText: '继续', client, history,
    });
    const msgs = client.calls[0]!.messages;
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(r.newMessages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('maxRepairRounds=0:失败即返回,attempts=1', async () => {
    const p = proj();
    const client = scriptedClient([BAD_ENUM]);
    const r = await runAiTurn({
      project: p, activeScreenId: p.screens[0]!.id, userText: 'x', client, maxRepairRounds: 0,
    });
    expect(r.attempts).toBe(1);
    expect(r.recipe).toBeUndefined();
    expect(client.calls).toHaveLength(1);
  });
});
