/**
 * v1 → v2 迁移测试。
 * 重点不是「能跑通」,而是**有损的地方必须报出来** —— must-confirm 的每一条都对应
 * 一个 v1 表达不出、迁移器不该替人拍板的事实。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LvProject } from '../project.js';
import { validateProject } from '../validate.js';
import { migrateV1ToV2, hasBlockingNotes } from '../v2/migrate.js';
import { validateUiProjectV2 } from '../v2/validate.js';
import { BUILTIN_ACTIONS, type ActionRegistry } from '../v2/uiProject.js';

const v1 = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../schema/fixtures/v1-migration-input.json', import.meta.url)), 'utf8',
)) as LvProject;

/** 迁移后 fixture 里的 callback 事件会指向这个 Action;真实工程要自己登记 */
const ACTIONS: ActionRegistry = {
  ...BUILTIN_ACTIONS,
  'custom.on_light_long_press': {
    id: 'custom.on_light_long_press',
    params: [{ name: 'userData', type: 'string' }],
  },
};

describe('fixture 是可迁移的存量 v1 工程', () => {
  it('普通入口只因 cPatch 被阻断', () => {
    const r = validateProject(v1);
    expect(r.errors).toEqual([expect.objectContaining({
      code: 'cpatch-forbidden',
      path: expect.stringContaining('.cPatch'),
    })]);
  });
});

describe('migrateV1ToV2', () => {
  const out = migrateV1ToV2(v1, { hash: (s) => `sha256-of-${s.length}` });

  it('产出的 v2 工程通过 v2 校验', () => {
    const r = validateUiProjectV2(out.uiProject, { actions: ACTIONS });
    expect(r.errors).toEqual([]);
  });

  it('meta 不再携带 lvglVersion —— 版本权威移到 BuildTarget(§4.2)', () => {
    expect('lvglVersion' in out.uiProject.meta).toBe(false);
    expect(out.buildTargetDraft.lvglVersion).toBe('9.5.0');
  });

  it('display 副本被替换为 designDisplayRef + 独立 DisplayProfile', () => {
    expect('display' in out.uiProject).toBe(false);
    expect(out.uiProject.designDisplayRef).toBe('display:480x480-rgb565@1');
    expect(out.displayProfile.logicalSize).toEqual({ width: 480, height: 480 });
    expect(out.displayProfile.colorFormat).toBe('RGB565');
  });

  it('colorDepth=16 标为 must-confirm —— RGB565 与 RGB565_SWAPPED 在 v1 里无法区分', () => {
    const n = out.notes.find((x) => x.code === 'color-format-ambiguous');
    expect(n?.severity).toBe('must-confirm');
    expect(n?.message).toContain('RGB565_SWAPPED');
  });

  it('visibleRect 留空而不是编造全屏值', () => {
    expect(out.displayProfile.visibleRect).toBeUndefined();
    expect(out.notes.some((n) => n.code === 'visible-rect-absent')).toBe(true);
  });

  it('cPatch 被抽进 trusted extension,原工程里不再有它(§8)', () => {
    expect(out.trustedExtension).not.toBeNull();
    expect(out.trustedExtension?.patches).toHaveLength(1);
    expect(out.trustedExtension?.patches[0]).toMatchObject({
      nodeId: 'n-light-slider',
      ownerId: '11111111-1111-4111-8111-111111111111',
      post: 'lv_slider_set_range($obj, 0, 100);',
    });
    expect(JSON.stringify(out.uiProject)).not.toContain('cPatch');
    expect(out.notes.some((n) => n.code === 'cpatch-extracted' && n.severity === 'must-confirm')).toBe(true);
  });

  it('提供 hash 时才填 sha256(schema 包不自带哈希实现)', () => {
    expect(out.trustedExtension?.patches[0]?.sha256).toBe('sha256-of-34');
    const noHash = migrateV1ToV2(v1);
    expect(noHash.trustedExtension?.patches[0]?.sha256).toBeUndefined();
  });

  it('节点标识分离:v1 的 name → v2 的 codeName', () => {
    const root = out.uiProject.screens[0]!.root;
    expect(root.codeName).toBe('home_root');
    expect('name' in root).toBe(false);
    const label = root.children[0]!;
    expect(label.codeName).toBe('light_label');
    expect(label.displayName).toBe('灯光标题');   // 中文展示名原样保留
  });

  it('inlineStyles → styles,styles → styleRefs', () => {
    const root = out.uiProject.screens[0]!.root;
    expect(root.styles).toHaveLength(1);          // 原 inlineStyles
    expect(root.styleRefs).toHaveLength(0);
    const label = root.children[0]!;
    expect(label.styleRefs).toEqual([{ styleId: 's-screen-card' }]);
  });

  it('4 类 subject/screen 事件都映射到内置 Action', () => {
    const [, slider, toggle, nav] = out.uiProject.screens[0]!.root.children;
    expect(slider!.events.map((e) => e.action)).toEqual(['subject.set', 'subject.increment']);
    expect(slider!.events[1]!.args).toMatchObject({ step: 5, min: 0, max: 100, rollover: true });
    expect(toggle!.events[0]!.action).toBe('subject.toggle');
    expect(nav!.events.map((e) => e.action)).toEqual(['screen.open', 'screen.create']);
    expect(nav!.events[0]!.args).toMatchObject({
      screen: '22222222-2222-4222-8222-222222222222', anim: 'fade_in', duration: 300, delay: 0,
    });
  });

  it('callback 事件映射为 custom.* 并标 must-confirm —— Action 必须有强类型契约(§5.3)', () => {
    const toggle = out.uiProject.screens[0]!.root.children[2]!;
    expect(toggle.events[1]!.action).toBe('custom.on_light_long_press');
    const n = out.notes.find((x) => x.code === 'callback-needs-action');
    expect(n?.severity).toBe('must-confirm');
  });

  it('绑定的 subject/styleRef 由 CName 改为 BizId', () => {
    const label = out.uiProject.screens[0]!.root.children[0]!;
    expect(label.bindings[0]).toEqual({ kind: 'prop', prop: 'text', subject: 'subject:light_level', fmt: '%d%%' });
    const slider = out.uiProject.screens[0]!.root.children[1]!;
    const styleBinding = slider.bindings.find((b) => b.kind === 'style');
    expect(styleBinding).toMatchObject({ styleId: 's-accent', subject: 'subject:light_on' });
  });

  it('颜色常量不自动转 Theme Token —— 自动转会编造语义 ID', () => {
    expect(out.uiProject.themes).toEqual([{ id: 'default', displayName: '默认', tokens: [] }]);
    expect(out.uiProject.consts).toHaveLength(3);
    const n = out.notes.find((x) => x.code === 'consts-to-tokens');
    expect(n?.severity).toBe('info');
    expect(n?.message).toContain('brand_primary');
  });

  it('BuildTarget 草稿缺 controllerProfileRef 并明确标出', () => {
    expect(out.buildTargetDraft.controllerProfileRef).toBeUndefined();
    expect(out.buildTargetDraft.uiProjectRef).toBe('ui:ctrl-430-lighting@1');
    expect(out.buildTargetDraft.themeRef).toBe('ui:ctrl-430-lighting@1#theme:default');
    const n = out.notes.find((x) => x.code === 'controller-profile-missing');
    expect(n?.severity).toBe('must-confirm');
  });

  it('目标 9.5 时,v1 的 exportXml 被标为过时', () => {
    const n = out.notes.find((x) => x.code === 'export-xml-obsolete');
    expect(n?.severity).toBe('must-confirm');
    expect(n?.message).toContain('9.5.0 已无 XML 引擎');
  });

  it('资产迁移:font/image/lottie 都进 v2,icons 留空', () => {
    expect(out.uiProject.assets.fonts.map((f) => f.id)).toEqual(['font:text_16']);
    expect(out.uiProject.assets.images.map((i) => i.id)).toEqual(['image:logo', 'image:spinner_anim']);
    expect(out.uiProject.assets.images[1]!.conv).toMatchObject({ kind: 'lottie' });
    expect(out.uiProject.assets.icons).toEqual([]);
  });

  it('整体仍有必须人工确认的项 —— 迁移不等于可发布', () => {
    expect(hasBlockingNotes(out)).toBe(true);
  });
});

describe('migrateV1ToV2 边界', () => {
  it('全非 ASCII 工程名回落 slug 并标 must-confirm', () => {
    const r = migrateV1ToV2({ ...v1, meta: { ...v1.meta, name: '静音舱控制器' } });
    expect(r.uiProject.meta.id).toBe('ui:untitled-ui');
    expect(r.notes.find((n) => n.code === 'ui-slug-fallback')?.severity).toBe('must-confirm');
  });

  it('显式 slug 覆盖派生值', () => {
    const r = migrateV1ToV2(v1, { uiProjectSlug: 'ctrl-430-a' });
    expect(r.uiProject.meta.id).toBe('ui:ctrl-430-a');
    expect(r.notes.some((n) => n.code === 'ui-slug-fallback')).toBe(false);
  });

  it('colorDepth 24/32 按 LVGL LV_COLOR_FORMAT_NATIVE 表映射,且不报歧义', () => {
    for (const [depth, cf] of [[24, 'RGB888'], [32, 'XRGB8888']] as const) {
      const r = migrateV1ToV2({ ...v1, display: { ...v1.display, colorDepth: depth } });
      expect(r.displayProfile.colorFormat).toBe(cf);
      expect(r.notes.some((n) => n.code === 'color-format-ambiguous')).toBe(false);
    }
  });

  it('无 cPatch 的工程不产出 trusted extension', () => {
    const clean = structuredClone(v1);
    delete clean.screens[0]!.root.children[1]!.cPatch;
    const r = migrateV1ToV2(clean);
    expect(r.trustedExtension).toBeNull();
  });

  it('事件引用了不存在的 subject → 丢弃该事件并标 must-confirm,而不是生成悬空引用', () => {
    const broken = structuredClone(v1);
    broken.subjects = broken.subjects.filter((s) => s.name !== 'light_on');
    const r = migrateV1ToV2(broken);
    const toggle = r.uiProject.screens[0]!.root.children[2]!;
    expect(toggle.events.map((e) => e.action)).toEqual(['custom.on_light_long_press']);
    expect(r.notes.some((n) => n.code === 'event-subject-missing' && n.severity === 'must-confirm')).toBe(true);
    // 丢弃后产物仍必须自洽
    expect(validateUiProjectV2(r.uiProject, { actions: ACTIONS }).errors).toEqual([]);
  });
});
