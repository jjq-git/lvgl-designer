import { describe, expect, it } from 'vitest';
import { createEmptyProject, createNode, ALL_WIDGETS } from '@lvd/schema';
import {
  buildRegistryDoc, buildSystemPrompt, buildWidgetLines, compactNode, estimateTokens,
} from '../promptBuilder.js';

describe('buildWidgetLines / buildRegistryDoc', () => {
  it('widget 行数 = registry 全量(动态,随控件扩容自动跟),外加 obj 基类段', () => {
    expect(buildWidgetLines()).toHaveLength(ALL_WIDGETS.length);
    expect(ALL_WIDGETS.length).toBeGreaterThanOrEqual(15);
    const doc = buildRegistryDoc();
    expect(doc).toContain('全部 widget 通用属性');
    expect(doc).toContain('- obj(面板)');
  });

  it('枚举值域内联在行里', () => {
    const doc = buildRegistryDoc();
    expect(doc).toContain('mode∈(normal|range|symmetrical)');           // slider
    expect(doc).toContain('long_mode∈(wrap|scroll|scroll_circular|dots|clip)'); // label
    expect(doc).toMatch(/align∈\(/);                                    // obj 基类
    expect(doc).toContain('text_align∈(left|right|center|auto)');       // 样式枚举
  });

  it('registry 文档快照(schema 变了要跟着审)', () => {
    expect(buildRegistryDoc()).toMatchSnapshot();
  });
});

describe('compactNode', () => {
  it('strip id/styles/events/bindings/空字段', () => {
    const node = createNode('button');
    node.name = 'ok_btn';
    node.children.push(createNode('label'));
    const c = compactNode(node);
    expect(c).not.toHaveProperty('id');
    expect(c).not.toHaveProperty('styles');
    expect(c).not.toHaveProperty('events');
    expect(c.type).toBe('button');
    expect(c.name).toBe('ok_btn');
    expect(c.children).toHaveLength(1);
    expect(c.children![0]).not.toHaveProperty('id');
  });
});

describe('buildSystemPrompt', () => {
  it('包含角色/协议/当前屏/圆屏规则', () => {
    const p = createEmptyProject('t');
    const prompt = buildSystemPrompt(p, p.screens[0]!.id);
    expect(prompt).toContain('LVGL 9.5.0');
    expect(prompt).toContain('PreviewProgram/WASM');
    expect(prompt).toContain('不得生成 XML、cPatch 或任意 C');
    expect(prompt).not.toContain('WASM 仍是 9.4');
    expect(prompt).toContain('"op":"replace_screen"');
    expect(prompt).toContain('当前屏幕:240x240 圆形屏');
    expect(prompt).toContain('圆屏:四角被裁掉');
    expect(prompt).toContain('"type":"obj"');   // 当前屏精简 JSON
  });

  it('选中节点提示(有名/无名两种)', () => {
    const p = createEmptyProject('t');
    const sel = createNode('slider');
    sel.name = 'vol';
    expect(buildSystemPrompt(p, p.screens[0]!.id, sel)).toContain('name=vol');
    const anon = createNode('label');
    expect(buildSystemPrompt(p, p.screens[0]!.id, anon)).toContain('未命名');
  });

  it('矩形屏不出圆屏规则', () => {
    const p = createEmptyProject('t');
    p.display.shape = 'rect';
    const prompt = buildSystemPrompt(p, p.screens[0]!.id);
    expect(prompt).not.toContain('圆屏:');
  });

  it('token 预算:空工程 system prompt ≤ 3000 tokens(估算)', () => {
    const p = createEmptyProject('t');
    const prompt = buildSystemPrompt(p, p.screens[0]!.id);
    const tokens = estimateTokens(prompt);
    expect(tokens).toBeGreaterThan(300);
    expect(tokens).toBeLessThanOrEqual(3000);
  });
});

describe('estimateTokens', () => {
  it('中英混合粗估:汉字 0.6/字符,其它 0.3/字符', () => {
    expect(estimateTokens('abcdefghij')).toBe(3);   // 10*0.3
    expect(estimateTokens('你好世界')).toBe(3);      // ceil(4*0.6)
  });
});
