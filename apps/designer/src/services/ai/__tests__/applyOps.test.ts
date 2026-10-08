import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { createEmptyProject } from '@lvd/schema';
import {
  migrateV1ToV2,
  validateUiProjectV2,
  type UiProject,
  type WidgetNodeV2,
} from '@lvd/schema/v2';
import { applyAiOps } from '../applyOps.js';
import type { AiOp } from '../opsSchema.js';

function proj(): UiProject {
  return migrateV1ToV2(createEmptyProject('t')).uiProject;
}

function screenId(p: UiProject): string {
  return p.screens[0]!.id;
}

function apply(p: UiProject, ops: AiOp[]): { next: UiProject; result: ReturnType<typeof applyAiOps> } {
  const result = applyAiOps(p, ops, screenId(p));
  const next = result.recipe ? produce(p, result.recipe) : p;
  return { next, result };
}

function byName(root: WidgetNodeV2, name: string): WidgetNodeV2 | null {
  if (root.codeName === name) return root;
  for (const c of root.children) {
    const hit = byName(c, name);
    if (hit) return hit;
  }
  return null;
}

describe('applyAiOps — 错误路径', () => {
  it('未知 widget 类型 → error,无 recipe', () => {
    // 注:M3 全量后 spinner 已是合法控件,这里用确定不存在的类型
    const r = applyAiOps(proj(), [{ op: 'add', parent: null, node: { type: 'holo_display' } }]);
    expect(r.recipe).toBeUndefined();
    expect(r.errors[0]).toMatchObject({ opIndex: 0, code: 'unknown-widget' });
  });

  it('未知 props 键 → 丢弃 + warning(非 fatal)', () => {
    const { next, result } = apply(proj(), [
      { op: 'add', parent: null, node: { type: 'label', name: 'a', props: { text: 'hi', speed: 3 } } },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.code === 'unknown-prop' && w.path.includes('speed'))).toBe(true);
    const node = byName(next.screens[0]!.root, 'a')!;
    expect(node.props['text']).toBe('hi');
    expect(node.props['speed']).toBeUndefined();
  });

  it('枚举值非法 → error', () => {
    const r = applyAiOps(proj(), [
      { op: 'add', parent: null, node: { type: 'slider', props: { mode: 'fancy' } } },
    ]);
    expect(r.recipe).toBeUndefined();
    expect(r.errors[0]!.code).toBe('bad-enum');
    expect(r.errors[0]!.message).toMatch(/normal\|range\|symmetrical/);
  });

  it('props 值类型不符 → error', () => {
    const r = applyAiOps(proj(), [
      { op: 'add', parent: null, node: { type: 'slider', props: { value: 'high' } } },
    ]);
    expect(r.errors[0]!.code).toBe('bad-value');
  });

  it('line 字符串坐标自动规范为 pointList 数组', () => {
    const { next, result } = apply(proj(), [{
      op: 'add', parent: null,
      node: {
        type: 'line', name: 'line_1', props: { points: '0,50 30.5,0 60,40' },
        inlineStyles: [{ props: { line_color: '#1188ff', line_width: 3 } }],
      },
    }]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'point-list-normalized' }));
    const node = byName(next.screens[0]!.root, 'line_1')!;
    expect(node.props['points']).toEqual([0, 50, 30.5, 0, 60, 40]);
    expect(node.styles[0]!.props).toEqual({ line_color: '#1188ff', line_width: 3 });
  });

  it('update/remove 的 target 不存在 → error', () => {
    const r = applyAiOps(proj(), [
      { op: 'update', target: 'ghost', props: { x: 1 } },
      { op: 'remove', target: 'ghost2' },
    ]);
    expect(r.errors).toHaveLength(2);
    expect(r.errors.every((e) => e.code === 'target-not-found')).toBe(true);
  });

  it('remove 屏根 → error', () => {
    const p = proj();
    p.screens[0]!.root.codeName = 'root_panel';
    const r = applyAiOps(p, [{ op: 'remove', target: 'root_panel' }], screenId(p));
    expect(r.errors[0]!.code).toBe('cannot-remove-root');
  });

  it('replace_screen 的 root 非 obj → error', () => {
    const r = applyAiOps(proj(), [{ op: 'replace_screen', root: { type: 'label' } }]);
    expect(r.errors[0]!.code).toBe('root-not-obj');
  });

  it('screen 不存在 → error', () => {
    const r = applyAiOps(proj(), [{ op: 'remove', target: 'x' }], 'no-such-screen');
    expect(r.errors[0]!.code).toBe('screen-not-found');
  });

  it('坏样式键丢弃+warning,坏样式枚举 → error', () => {
    const warnOnly = apply(proj(), [{
      op: 'add', parent: null,
      node: { type: 'obj', name: 'p', inlineStyles: [{ props: { glow: 1, bg_color: '#112233' } }] },
    }]);
    expect(warnOnly.result.errors).toEqual([]);
    expect(warnOnly.result.warnings.some((w) => w.code === 'unknown-style-prop')).toBe(true);
    const node = byName(warnOnly.next.screens[0]!.root, 'p')!;
    expect(node.styles[0]!.props).toEqual({ bg_color: '#112233' });

    const bad = applyAiOps(proj(), [{
      op: 'add', parent: null,
      node: { type: 'obj', inlineStyles: [{ props: { text_align: 'middle' } }] },
    }]);
    expect(bad.errors[0]!.code).toBe('bad-enum');
  });
});

describe('applyAiOps — 名字处理', () => {
  it('name 冲突自动 _2/_3 后缀', () => {
    const { next, result } = apply(proj(), [
      { op: 'add', parent: null, node: { type: 'label', name: 'title', props: { text: '1' } } },
      { op: 'add', parent: null, node: { type: 'label', name: 'title', props: { text: '2' } } },
      { op: 'add', parent: null, node: { type: 'label', name: 'title', props: { text: '3' } } },
    ]);
    expect(result.errors).toEqual([]);
    const root = next.screens[0]!.root;
    expect(root.children.map((c) => c.codeName)).toEqual(['title', 'title_2', 'title_3']);
    expect(result.warnings.filter((w) => w.code === 'name-conflict-renamed')).toHaveLength(2);
  });

  it('非法 name 自动净化 + warning', () => {
    const { next, result } = apply(proj(), [
      { op: 'add', parent: null, node: { type: 'label', name: 'My Label!' } },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.code === 'name-sanitized')).toBe(true);
    expect(byName(next.screens[0]!.root, 'my_label_')).not.toBeNull();
  });

  it('remove 释放 name 供后续复用', () => {
    const p0 = proj();
    const first = apply(p0, [{ op: 'add', parent: null, node: { type: 'label', name: 'tip' } }]);
    const second = apply(first.next, [
      { op: 'remove', target: 'tip' },
      { op: 'add', parent: null, node: { type: 'label', name: 'tip' } },
    ]);
    expect(second.result.errors).toEqual([]);
    expect(second.result.warnings.filter((w) => w.code === 'name-conflict-renamed')).toHaveLength(0);
    expect(byName(second.next.screens[0]!.root, 'tip')).not.toBeNull();
  });
});

describe('applyAiOps — 正常批量应用', () => {
  it('create_screen 真正新增独立屏幕并返回可切换的 ID', () => {
    const p = proj();
    const result = applyAiOps(p, [{
      op: 'create_screen',
      name: 'settings',
      displayPreset: 'WF2D-8620',
      root: {
        type: 'obj',
        inlineStyles: [{ props: { bg_color: '#101828', bg_opa: 255 } }],
        children: [{ type: 'label', name: 'title', props: { text: '设置' } }],
      },
    }], screenId(p));
    expect(result.errors).toEqual([]);
    expect(result.createdScreenId).toMatch(/[0-9a-f-]{36}/);
    expect(result.displayChange).toEqual({
      presetId: 'WF2D-8620', width: 240, height: 240, shape: 'round',
    });
    const next = produce(p, result.recipe!);
    expect(next.screens).toHaveLength(2);
    const created = next.screens[1]!;
    expect(created.id).toBe(result.createdScreenId);
    expect(created.codeName).toBe('settings');
    expect(byName(created.root, 'title')?.props['text']).toBe('设置');
    expect(next.screens[0]!.root.children).toHaveLength(0);
  });

  it('create_screen 缺省名称自动命名，重名自动避让', () => {
    const p = proj();
    p.screens[0]!.codeName = 'settings';
    const unnamed = applyAiOps(p, [{ op: 'create_screen', root: { type: 'obj' } }]);
    const unnamedNext = produce(p, unnamed.recipe!);
    expect(unnamedNext.screens[1]!.codeName).toBe('screen_1');

    const duplicate = applyAiOps(p, [{ op: 'create_screen', name: 'settings', root: { type: 'obj' } }]);
    const duplicateNext = produce(p, duplicate.recipe!);
    expect(duplicateNext.screens[1]!.codeName).toBe('settings_2');
    expect(duplicate.warnings).toContainEqual(expect.objectContaining({ code: 'name-conflict-renamed' }));
  });

  it('create_screen 对全项目控件 codeName 去重', () => {
    const p = proj();
    p.screens[0]!.root.children.push({
      id: 'existing-title-id',
      type: 'label',
      codeName: 'settings_title',
      props: { text: '旧标题' },
      styleRefs: [],
      styles: [],
      events: [],
      bindings: [],
      children: [],
    });
    const result = applyAiOps(p, [{
      op: 'create_screen',
      name: 'settings',
      root: {
        type: 'obj',
        children: [
          { type: 'label', name: 'settings_title', props: { text: '设置' } },
          { type: 'button', name: 'save_button' },
        ],
      },
    }]);
    const next = produce(p, result.recipe!);
    expect(next.screens[1]!.root.children.map((node) => node.codeName))
      .toEqual(['settings_title_2', 'save_button']);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'name-conflict-renamed' }));
    expect(validateUiProjectV2(next).errors).toEqual([]);
  });

  it('普通 add 也避让其他屏幕已使用的 codeName', () => {
    const p = proj();
    const created = applyAiOps(p, [{
      op: 'create_screen',
      name: 'other',
      root: { type: 'obj', children: [{ type: 'label', name: 'shared_label' }] },
    }]);
    const withOther = produce(p, created.recipe!);
    const added = applyAiOps(withOther, [{
      op: 'add', parent: null, node: { type: 'label', name: 'shared_label' },
    }], withOther.screens[0]!.id);
    const next = produce(withOther, added.recipe!);
    expect(next.screens[0]!.root.children[0]!.codeName).toBe('shared_label_2');
    expect(validateUiProjectV2(next).errors).toEqual([]);
  });

  it('create_screen 必须独占一轮且根节点必须为 obj', () => {
    const mixed = applyAiOps(proj(), [
      { op: 'create_screen', root: { type: 'obj' } },
      { op: 'add', parent: null, node: { type: 'label' } },
    ]);
    expect(mixed.errors[0]!.code).toBe('create-screen-must-be-only-op');

    const badRoot = applyAiOps(proj(), [{ op: 'create_screen', root: { type: 'label' } }]);
    expect(badRoot.errors[0]!.code).toBe('root-not-obj');
  });

  it('create_screen 拒绝未知设备预设', () => {
    const result = applyAiOps(proj(), [{
      op: 'create_screen', displayPreset: 'NOT-A-DISPLAY', root: { type: 'obj' },
    }]);
    expect(result.recipe).toBeUndefined();
    expect(result.errors[0]).toMatchObject({ code: 'unknown-display-preset' });
  });

  it('整批 ops 一个 recipe:add(嵌套)+update+remove 一次成型', () => {
    const p = proj();
    const ops: AiOp[] = [
      {
        op: 'add', parent: null,
        node: {
          type: 'obj', name: 'panel',
          props: { width: 200, height: 200, align: 'center' },
          children: [{ type: 'label', name: 'hint', props: { text: '你好' } }],
        },
      },
      { op: 'add', parent: 'panel', node: { type: 'slider', name: 'vol', props: { value: 30 } } },
      { op: 'update', target: 'vol', props: { value: 55 }, flags: { hidden: false } },
      { op: 'remove', target: 'hint' },
    ];
    const { next, result } = apply(p, ops);
    expect(result.errors).toEqual([]);
    expect(result.recipe).toBeTypeOf('function');
    const panel = byName(next.screens[0]!.root, 'panel')!;
    expect(panel.children.map((c) => c.codeName)).toEqual(['vol']);
    const vol = panel.children[0]!;
    expect(vol.props['value']).toBe(55);
    expect(vol.flags).toEqual({ hidden: false });
    expect(vol.id).toMatch(/[0-9a-f-]{36}/);   // uuid 应用时生成
    // 原工程不被动过
    expect(p.screens[0]!.root.children).toHaveLength(0);
  });

  it('add 缺 width/height 用 registry defaultSize 预填', () => {
    const { next } = apply(proj(), [{ op: 'add', parent: null, node: { type: 'button', name: 'b' } }]);
    const b = byName(next.screens[0]!.root, 'b')!;
    expect(b.props['width']).toBe(100);
    expect(b.props['height']).toBe(40);
  });

  it('replace_screen 整屏重画', () => {
    const p0 = proj();
    const withStuff = apply(p0, [{ op: 'add', parent: null, node: { type: 'label', name: 'old' } }]).next;
    const { next, result } = apply(withStuff, [{
      op: 'replace_screen',
      root: {
        type: 'obj',
        props: { width: '100%', height: '100%' },
        inlineStyles: [{ props: { bg_color: '#001122' } }],
        children: [{ type: 'arc', name: 'gauge', props: { value: 40, align: 'center' } }],
      },
    }]);
    expect(result.errors).toEqual([]);
    const root = next.screens[0]!.root;
    expect(root.type).toBe('obj');
    expect(byName(root, 'old')).toBeNull();
    expect(byName(root, 'gauge')).not.toBeNull();
    expect(root.styles[0]!.props['bg_color']).toBe('#001122');
  });

  it('非法 selector state/part 丢弃 + warning', () => {
    const ops = [{
      op: 'add', parent: null,
      node: {
        type: 'slider', name: 's',
        inlineStyles: [{ selector: { states: ['pressed', 'glowing'], part: 'blade' }, props: { bg_color: '#ff0000' } }],
      },
    }] as unknown as AiOp[];
    const { next, result } = apply(proj(), ops);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.code === 'unknown-state-token')).toBe(true);
    expect(result.warnings.some((w) => w.code === 'unknown-part-token')).toBe(true);
    const s = byName(next.screens[0]!.root, 's')!;
    expect(s.styles[0]!.selector).toEqual({ states: ['pressed'] });
  });

  it('空 ops:无错误也无 recipe(纯聊天)', () => {
    const r = applyAiOps(proj(), []);
    expect(r.errors).toEqual([]);
    expect(r.recipe).toBeUndefined();
  });
});
