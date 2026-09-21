import { describe, expect, it } from 'vitest';
import { extractJsonText, parseAiReply } from '../opsSchema.js';

const GOOD = '{"reply":"好","ops":[{"op":"add","parent":null,"node":{"type":"label","name":"t","props":{"text":"hi"}}}]}';

describe('extractJsonText', () => {
  it('裸 JSON 原样返回', () => {
    expect(extractJsonText(`  ${GOOD}  `)).toBe(GOOD);
  });

  it('剥 ```json 围栏', () => {
    expect(extractJsonText('```json\n' + GOOD + '\n```')).toBe(GOOD);
  });

  it('剥无语言标注围栏 + 前后闲话', () => {
    const raw = '好的,这是结果:\n```\n' + GOOD + '\n```\n还有什么需要?';
    expect(extractJsonText(raw)).toBe(GOOD);
  });

  it('兜底:取第一个 { 到最后一个 }', () => {
    expect(extractJsonText('answer: ' + GOOD + ' done')).toBe(GOOD);
  });
});

describe('parseAiReply', () => {
  it('合法回复解析成功', () => {
    const r = parseAiReply(GOOD);
    expect(r.errors).toEqual([]);
    expect(r.data!.reply).toBe('好');
    expect(r.data!.ops).toHaveLength(1);
    expect(r.data!.ops[0]).toMatchObject({ op: 'add', parent: null });
  });

  it('围栏包裹也能解析', () => {
    const r = parseAiReply('```json\n' + GOOD + '\n```');
    expect(r.data).toBeDefined();
  });

  it('坏 JSON → errors', () => {
    const r = parseAiReply('{"reply": "未闭合');
    expect(r.data).toBeUndefined();
    expect(r.errors[0]).toMatch(/JSON 解析失败/);
  });

  it('顶层非对象 → errors', () => {
    expect(parseAiReply('[1,2]').errors[0]).toMatch(/顶层/);
  });

  it('缺 ops 视为纯聊天(ops=[])', () => {
    const r = parseAiReply('{"reply":"你好呀"}');
    expect(r.errors).toEqual([]);
    expect(r.data!.ops).toEqual([]);
  });

  it('未知 op 种类 → errors 带下标', () => {
    const r = parseAiReply('{"reply":"","ops":[{"op":"teleport"}]}');
    expect(r.data).toBeUndefined();
    expect(r.errors[0]).toMatch(/ops\[0\]\.op/);
    expect(r.errors[0]).toMatch(/replace_screen\|add\|update\|remove/);
  });

  it('update 缺 target / node 缺 type → errors', () => {
    const r = parseAiReply('{"reply":"","ops":[{"op":"update"},{"op":"add","parent":null,"node":{"name":"x"}}]}');
    expect(r.data).toBeUndefined();
    expect(r.errors.join('\n')).toMatch(/ops\[0\]\.target/);
    expect(r.errors.join('\n')).toMatch(/ops\[1\]\.node\.type/);
  });

  it('add.parent 非 string|null → error;缺省视为 null', () => {
    const bad = parseAiReply('{"ops":[{"op":"add","parent":5,"node":{"type":"label"}}]}');
    expect(bad.errors.join('\n')).toMatch(/parent/);
    const lenient = parseAiReply('{"ops":[{"op":"add","node":{"type":"label"}}]}');
    expect(lenient.errors).toEqual([]);
    expect(lenient.data!.ops[0]).toMatchObject({ op: 'add', parent: null });
  });

  it('嵌套 children / flags / inlineStyles 结构校验', () => {
    const r = parseAiReply(JSON.stringify({
      reply: 'ok',
      ops: [{
        op: 'replace_screen',
        root: {
          type: 'obj',
          children: [
            { type: 'label', flags: { hidden: 'yes' } },                       // 坏 flag 值
            { type: 'button', inlineStyles: [{ props: { bg_color: '#112233' } }] },
          ],
        },
      }],
    }));
    expect(r.data).toBeUndefined();
    expect(r.errors.join('\n')).toMatch(/children\[0\]\.flags\.hidden/);
  });

  it('props 值只接受标量/数组/$const', () => {
    const r = parseAiReply('{"ops":[{"op":"update","target":"a","props":{"width":{"px":10}}}]}');
    expect(r.errors.join('\n')).toMatch(/props\.width/);
  });
});
