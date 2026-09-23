/**
 * v2 校验测试:结构层(zod)+ 语义层 + 信任层。
 * 每个 invalid 用例都对准方案里一条明确写死的规则,断言的是 error code 而不是文案。
 */
import { describe, expect, it } from 'vitest';
import type { UiProject, WidgetNodeV2 } from '../v2/uiProject.js';
import type { ControllerProfile, DisplayProfile } from '../v2/profiles.js';
import { validateUiProjectV2, validateDisplayProfile, validateCrossRefs } from '../v2/validate.js';
import { componentType } from '../v2/components.js';

/* ------------------------------------------------------------------ 基线 */

function node(over: Partial<WidgetNodeV2> = {}): WidgetNodeV2 {
  return {
    id: 'n-root', type: 'obj', props: {},
    styleRefs: [], styles: [], events: [], bindings: [], children: [],
    ...over,
  };
}

function project(over: Partial<UiProject> = {}): UiProject {
  return {
    schemaVersion: 2,
    kind: 'lvgl-ui-project',
    meta: {
      id: 'ui:demo', revision: 1, name: 'demo', appVersion: '0.1.0',
      createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
    },
    designDisplayRef: 'display:480x480-rgb565@1',
    themes: [{
      id: 'default',
      tokens: [
        { id: 'color.background', type: 'color', value: '#111827' },
        { id: 'radius.control', type: 'px', value: 8 },
      ],
    }],
    subjects: [{ id: 'subject:level', codeName: 'level', type: 'int', initial: 0 }],
    screens: [{
      id: 'sc-home', codeName: 'home', isHome: true, styles: [], consts: [],
      root: node(),
    }],
    components: [],
    styles: [{ id: 'st-card', codeName: 'card', props: { radius: 12 } }],
    consts: [],
    assets: { fonts: [], images: [], icons: [] },
    translations: null,
    ...over,
  };
}

/** 只取 error code,断言更稳 */
function codes(p: unknown): string[] {
  return validateUiProjectV2(p).errors.map((e) => e.code);
}

/* ---------------------------------------------------------------- valid */

describe('v2 valid', () => {
  it('基线工程通过', () => {
    const r = validateUiProjectV2(project());
    expect(r.errors).toEqual([]);
  });

  it('token 引用类型匹配时通过', () => {
    const p = project();
    p.screens[0]!.root.styles = [{ props: { bg_color: { $token: 'color.background' }, radius: { $token: 'radius.control' } } }];
    expect(validateUiProjectV2(p).errors).toEqual([]);
  });

  it('内置 Action + 合法参数通过', () => {
    const p = project();
    p.screens[0]!.root.events = [
      { on: 'clicked', action: 'screen.open', args: { screen: 'sc-home' } },
      { on: 'clicked', action: 'subject.toggle', args: { subject: 'subject:level' } },
    ];
    expect(validateUiProjectV2(p).errors).toEqual([]);
  });

  it('Theme extends 链正常解析', () => {
    const p = project({
      themes: [
        { id: 'base', tokens: [{ id: 'color.background', type: 'color', value: '#000000' }] },
        { id: 'dark', extends: 'base', tokens: [{ id: 'color.text', type: 'color', value: '#ffffff' }] },
      ],
    });
    p.screens[0]!.root.styles = [{ props: { bg_color: { $token: 'color.background' } } }];
    // themes[0] 是 base,它自己就有 color.background
    expect(validateUiProjectV2(p).errors).toEqual([]);
  });

  it('可复用组件定义和关联实例通过', () => {
    const p = project();
    p.components.push({
      id: 'cmp-card', codeName: 'card', api: [], styles: [], consts: [],
      root: node({ id: 'cmp-root', type: 'button', codeName: 'root' }),
    });
    p.screens[0]!.root.children.push(node({
      id: 'instance-1', type: componentType('cmp-card'), codeName: 'card_1',
    }));
    expect(validateUiProjectV2(p).errors).toEqual([]);
  });
});

/* -------------------------------------------------------------- 信任层 */

describe('v2 信任层(§8)', () => {
  it('节点带 cPatch → cpatch-forbidden,而不是被静默丢弃', () => {
    const p = project() as unknown as Record<string, unknown>;
    const scr = (p.screens as { root: Record<string, unknown> }[])[0]!;
    scr.root.cPatch = { post: 'lv_obj_set_x($obj, 1);' };
    const r = validateUiProjectV2(p);
    expect(r.errors.map((e) => e.code)).toContain('cpatch-forbidden');
    expect(r.valid).toBe(false);
  });

  it('顶层多余字段也被 strict 拒绝(未知字段不静默保留)', () => {
    const p = { ...project(), sneaky: { post: 'x' } };
    expect(codes(p)).toContain('schema');
  });
});

/* -------------------------------------------------------------- 语义层 */

describe('v2 语义层', () => {
  it('组件实例悬空或组件依赖成环会被拒绝', () => {
    const missing = project();
    missing.screens[0]!.root.children.push(node({ id: 'instance-x', type: componentType('missing') }));
    expect(codes(missing)).toContain('component-not-found');

    const cyclic = project();
    cyclic.components.push(
      {
        id: 'cmp-a', codeName: 'cmp_a', api: [], styles: [], consts: [],
        root: node({ id: 'a-root', children: [node({ id: 'a-b', type: componentType('cmp-b') })] }),
      },
      {
        id: 'cmp-b', codeName: 'cmp_b', api: [], styles: [], consts: [],
        root: node({ id: 'b-root', children: [node({ id: 'b-a', type: componentType('cmp-a') })] }),
      },
    );
    expect(codes(cyclic)).toContain('component-cycle');
  });

  it('组件参数校验默认值、实例值和根属性重名', () => {
    const p = project();
    p.components.push({
      id: 'cmp-card', codeName: 'cmp_card',
      api: [
        { name: 'caption', type: 'int', default: 'wrong' },
        { name: 'width', type: 'size', default: 100 },
      ],
      styles: [], consts: [], root: node({ id: 'cmp-root', type: 'button' }),
    });
    p.screens[0]!.root.children.push(node({
      id: 'instance-1', type: componentType('cmp-card'), props: { caption: false },
    }));
    const result = codes(p);
    expect(result).toContain('component-api-conflict');
    expect(result.filter((code) => code === 'component-api-type')).toHaveLength(2);
  });

  it('引用不存在的 token → 拒绝,不静默回退(§4.6)', () => {
    const p = project();
    p.screens[0]!.root.styles = [{ props: { bg_color: { $token: 'color.nope' } } }];
    expect(codes(p)).toContain('token-not-found');
  });

  it('token 类型不匹配 → 拒绝(color 不能赋给 size 类属性)', () => {
    const p = project();
    p.screens[0]!.root.styles = [{ props: { radius: { $token: 'color.background' } } }];
    expect(codes(p)).toContain('token-type-mismatch');
  });

  it('token id 不是语义 ID → 拒绝', () => {
    const p = project();
    p.themes[0]!.tokens.push({ id: 'Color_Primary', type: 'color', value: '#fff' });
    expect(codes(p)).toContain('bad-token-id');
  });

  it('Theme 继承成环 → 拒绝', () => {
    const p = project({
      themes: [
        { id: 'a', extends: 'b', tokens: [] },
        { id: 'b', extends: 'a', tokens: [] },
      ],
    });
    expect(codes(p)).toContain('theme-cycle');
  });

  it('继承不存在的 Theme → 拒绝', () => {
    const p = project({ themes: [{ id: 'a', extends: 'ghost', tokens: [] }] });
    expect(codes(p)).toContain('theme-parent-missing');
  });

  it('Action 不在 Registry → 拒绝(§5.3)', () => {
    const p = project();
    p.screens[0]!.root.events = [{ on: 'clicked', action: 'light.toggle' }];
    expect(codes(p)).toContain('unknown-action');
  });

  it('业务 Action 可由 options 注入', () => {
    const p = project();
    p.screens[0]!.root.events = [{ on: 'clicked', action: 'light.toggle' }];
    const r = validateUiProjectV2(p, {
      actions: { 'light.toggle': { id: 'light.toggle', params: [] } },
    });
    expect(r.errors).toEqual([]);
  });

  it('Action 缺必填参数 → 拒绝', () => {
    const p = project();
    p.screens[0]!.root.events = [{ on: 'clicked', action: 'screen.open' }];
    expect(codes(p)).toContain('missing-action-arg');
  });

  it('screenRef / subjectRef 参数指向不存在的对象 → 拒绝', () => {
    const p = project();
    p.screens[0]!.root.events = [
      { on: 'clicked', action: 'screen.open', args: { screen: 'sc-ghost' } },
      { on: 'clicked', action: 'subject.toggle', args: { subject: 'subject:ghost' } },
    ];
    const c = codes(p);
    expect(c).toContain('screen-not-found');
    expect(c).toContain('subject-not-found');
  });

  it('多余的 Action 参数只告警,不阻断', () => {
    const p = project();
    p.screens[0]!.root.events = [{ on: 'clicked', action: 'screen.back', args: { nope: 1 } }];
    const r = validateUiProjectV2(p);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain('extra-action-arg');
  });

  it('绑定引用不存在的 subject / 样式 → 拒绝', () => {
    const p = project();
    p.screens[0]!.root.bindings = [
      { kind: 'prop', prop: 'value', subject: 'subject:ghost' },
      { kind: 'style', styleId: 'st-ghost', subject: 'subject:level', refValue: 1 },
    ];
    const c = codes(p);
    expect(c).toContain('subject-not-found');
    expect(c).toContain('style-not-found');
  });

  it('绑定能力和数据源类型不匹配 → 拒绝', () => {
    const p = project();
    p.subjects.push({ id: 'subject:text', codeName: 'text', type: 'string', initial: '1' });
    p.screens[0]!.root.children = [
      node({
        id: 'n-slider', type: 'slider',
        bindings: [{ kind: 'prop', prop: 'value', subject: 'subject:text' }],
      }),
      node({
        id: 'n-image', type: 'image',
        bindings: [{ kind: 'prop', prop: 'src', subject: 'subject:text' }],
      }),
      node({
        id: 'n-style', type: 'button',
        bindings: [{ kind: 'style', styleId: 'st-card', subject: 'subject:text', refValue: 1 }],
      }),
    ];
    const c = codes(p);
    expect(c).toContain('unbound-prop');
    expect(c.filter((code) => code === 'binding-subject-type')).toHaveLength(3);
  });

  it('styleRefs 指向不存在的命名样式 → 拒绝', () => {
    const p = project();
    p.screens[0]!.root.styleRefs = [{ styleId: 'st-ghost' }];
    expect(codes(p)).toContain('style-not-found');
  });

  it('重复业务 id → 拒绝', () => {
    const p = project();
    p.screens[0]!.root.children = [node({ id: 'n-root' })];
    expect(codes(p)).toContain('duplicate-id');
  });

  it('重复 codeName → 拒绝(会生成同名 C 符号)', () => {
    const p = project();
    p.screens[0]!.root.codeName = 'box';
    p.screens[0]!.root.children = [node({ id: 'n-2', codeName: 'box' })];
    expect(codes(p)).toContain('duplicate-code-name');
  });

  it('codeName 不满足 C 标识符约束 → 拒绝(§4.6)', () => {
    const p = project();
    p.screens[0]!.root.codeName = '灯光';
    expect(codes(p)).toContain('bad-code-name');
  });

  it('displayName 允许中文 —— 展示名与 C 符号是不同职责', () => {
    const p = project();
    p.screens[0]!.root.displayName = '灯光容器';
    expect(validateUiProjectV2(p).errors).toEqual([]);
  });

  it('未知 part / state token → 拒绝', () => {
    const p = project();
    // 故意越界:TS 侧本就不允许,这里断言的是运行时校验也拦得住(导入的 JSON 不受 TS 保护)
    p.screens[0]!.root.styles = [
      { selector: { part: 'nope', states: ['bogus'] } as never, props: {} },
    ];
    const c = codes(p);
    expect(c).toContain('bad-part');
    expect(c).toContain('bad-state');
  });

  it('未登记 widget 类型 → 拒绝;未登记样式属性只告警', () => {
    const p = project();
    p.screens[0]!.root.children = [node({ id: 'n-x', type: 'lv_nonexistent' })];
    p.screens[0]!.root.styles = [{ props: { not_a_style_prop: 1 } }];
    const r = validateUiProjectV2(p);
    expect(r.errors.map((e) => e.code)).toContain('unknown-widget');
    expect(r.warnings.map((w) => w.code)).toContain('unknown-style-prop');
  });

  it('结构子元素放错父节点 → 拒绝', () => {
    const p = project();
    p.screens[0]!.root.children = [node({ id: 'n-series', type: 'chart-series' })];
    expect(codes(p)).toContain('misplaced-child');
  });

  it('screen 根节点必须是 obj', () => {
    const p = project();
    p.screens[0]!.root = node({ type: 'label' });
    expect(codes(p)).toContain('bad-root-type');
  });

  it('多个 isHome → 拒绝;一个都没有 → 只告警', () => {
    const two = project();
    two.screens.push({ id: 'sc-2', codeName: 'second', isHome: true, styles: [], consts: [], root: node({ id: 'n-2' }) });
    expect(codes(two)).toContain('multiple-home');

    const none = project();
    delete none.screens[0]!.isHome;
    const r = validateUiProjectV2(none);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain('no-home');
  });

  it('designDisplayRef 格式非法 → 拒绝(必须带 revision)', () => {
    expect(codes(project({ designDisplayRef: 'display:480x480-rgb565' as never }))).toContain('schema');
    expect(codes(project({ designDisplayRef: 'controller:x@1' as never }))).toContain('schema');
  });
});

/* ------------------------------------------------------- DisplayProfile */

const display: DisplayProfile = {
  schemaVersion: 1, kind: 'display-profile', id: 'display:480x960-rgb565', revision: 1,
  logicalSize: { width: 480, height: 960 }, shape: 'rect', colorFormat: 'RGB565',
  visibleRect: { x: 60, y: 0, width: 360, height: 960 },
};

describe('validateDisplayProfile', () => {
  it('TXW620002B0 式插黑条屏(逻辑 480×960,可视中间 360 列)合法', () => {
    expect(validateDisplayProfile(display).errors).toEqual([]);
  });

  it('visibleRect 越界 → 拒绝', () => {
    const bad = { ...display, visibleRect: { x: 200, y: 0, width: 360, height: 960 } };
    expect(validateDisplayProfile(bad).errors.map((e) => e.code)).toContain('visible-rect-out-of-bounds');
  });

  it('非正方形圆屏 → 告警', () => {
    const r = validateDisplayProfile({ ...display, shape: 'round', visibleRect: undefined });
    expect(r.warnings.map((w) => w.code)).toContain('round-not-square');
  });
});

/* ---------------------------------------------------- BuildTarget 跨引用 */

const sqDisplay: DisplayProfile = {
  schemaVersion: 1, kind: 'display-profile', id: 'display:480x480-rgb565', revision: 1,
  logicalSize: { width: 480, height: 480 }, shape: 'rect', colorFormat: 'RGB565',
};

const controller: ControllerProfile = {
  schemaVersion: 1, kind: 'controller-profile', id: 'controller:ctrl-430-a', revision: 3,
  model: 'CTRL-430-A',
  displayRef: 'display:480x480-rgb565@1',
  frame: {
    assetRef: 'asset:ctrl-430-a.svg@sha256:deadbeef',
    viewBox: { x: 0, y: 0, width: 1040, height: 1040 },
    screenViewport: { x: 126, y: 135, width: 788, height: 788, rotation: 0 },
  },
};

const baseCross = {
  uiProject: project(),
  controller,
  display: sqDisplay,
  buildTarget: {
    uiProjectRef: 'ui:demo@1',
    controllerProfileRef: 'controller:ctrl-430-a@3',
    themeRef: 'ui:demo@1#theme:default',
    lvglVersion: '9.5.0',
  },
};

describe('validateCrossRefs(§4.4)', () => {
  it('UI 与 Controller 指向同一 DisplayProfile 时通过', () => {
    expect(validateCrossRefs(baseCross).errors).toEqual([]);
  });

  it('BuildTarget 必须引用传入的精确 UiProject 快照', () => {
    const r = validateCrossRefs({
      ...baseCross,
      buildTarget: { ...baseCross.buildTarget, uiProjectRef: 'ui:other@1' },
    });
    expect(r.errors.map((e) => e.code)).toContain('ui-project-ref-mismatch');
  });

  it('BuildTarget 必须引用传入的精确 ControllerProfile 快照，而非只比较 revision', () => {
    const r = validateCrossRefs({
      ...baseCross,
      buildTarget: { ...baseCross.buildTarget, controllerProfileRef: 'controller:other@3' },
    });
    expect(r.errors.map((e) => e.code)).toContain('controller-profile-ref-mismatch');
  });

  it('UI 与 Controller 的 DisplayProfile 不一致 → 拒绝', () => {
    const r = validateCrossRefs({
      ...baseCross,
      controller: { ...controller, displayRef: 'display:240x240-rgb565@1' },
    });
    expect(r.errors.map((e) => e.code)).toContain('display-mismatch');
  });

  it('引用的 revision 与传入的 Profile 对不上 → 拒绝', () => {
    const r = validateCrossRefs({ ...baseCross, display: { ...sqDisplay, revision: 2 } });
    expect(r.errors.map((e) => e.code)).toContain('display-profile-mismatch');
  });

  it('themeRef 内嵌的 uiRef 与 uiProjectRef 不一致 → 拒绝(该冗余正是风险点)', () => {
    const r = validateCrossRefs({
      ...baseCross,
      buildTarget: { ...baseCross.buildTarget, themeRef: 'ui:other@1#theme:default' },
    });
    expect(r.errors.map((e) => e.code)).toContain('theme-ref-ui-mismatch');
  });

  it('themeRef 指向工程里不存在的 Theme → 拒绝', () => {
    const r = validateCrossRefs({
      ...baseCross,
      buildTarget: { ...baseCross.buildTarget, themeRef: 'ui:demo@1#theme:ghost' },
    });
    expect(r.errors.map((e) => e.code)).toContain('theme-not-found');
  });

  it('目标能力包不支持该 colorFormat → 拒绝(第 3 层:目标能力校验)', () => {
    const r = validateCrossRefs({
      ...baseCross,
      capability: {
        version: '9.5.0', supportedColorFormats: ['XRGB8888'],
        supportedWidgets: [], hasXmlEngine: false,
      },
    });
    expect(r.errors.map((e) => e.code)).toContain('color-format-unsupported-by-target');
  });

  it('能力包版本与 BuildTarget.lvglVersion 不一致 → 拒绝', () => {
    const r = validateCrossRefs({
      ...baseCross,
      capability: {
        version: '9.4.0', supportedColorFormats: ['RGB565'],
        supportedWidgets: [], hasXmlEngine: true,
      },
    });
    expect(r.errors.map((e) => e.code)).toContain('capability-version-mismatch');
  });

  it('外壳视口宽高比与显示可视区不匹配 → 告警(预览会拉伸)', () => {
    const r = validateCrossRefs({
      ...baseCross,
      controller: {
        ...controller,
        frame: { ...controller.frame, screenViewport: { x: 0, y: 0, width: 788, height: 400, rotation: 0 } },
      },
    });
    expect(r.warnings.map((w) => w.code)).toContain('aspect-mismatch');
  });

  it('视口旋转 90° 后宽高比按旋转后计算', () => {
    const r = validateCrossRefs({
      ...baseCross,
      controller: {
        ...controller,
        frame: { ...controller.frame, screenViewport: { x: 0, y: 0, width: 788, height: 788, rotation: 90 } },
      },
    });
    expect(r.warnings.map((w) => w.code)).not.toContain('aspect-mismatch');
  });
});
