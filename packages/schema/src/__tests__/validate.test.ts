import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, createNode } from '../factory.js';
import { validateProject } from '../validate.js';
import { loadProjectJson, ProjectFormatError, ProjectTooNewError, ProjectValidationError } from '../migrations.js';
import { autoName, checkCName, newUuid, previewName } from '../ids.js';
import { SCHEMA_VERSION, type LvProject } from '../project.js';

function proj(): LvProject {
  return createEmptyProject('t');
}

describe('createEmptyProject / createNode', () => {
  it('默认 240x240 圆屏 + 单屏 main + isHome', () => {
    const p = proj();
    expect(p.display).toMatchObject({ width: 240, height: 240, shape: 'round' });
    expect(p.screens).toHaveLength(1);
    expect(p.screens[0]!.name).toBe('main');
    expect(p.screens[0]!.isHome).toBe(true);
    expect(p.screens[0]!.root.type).toBe('obj');
    expect(p.codegen.exportXml).toBe(false);
  });

  it('createNode 预填 defaultSize,未知类型抛错', () => {
    const btn = createNode('button');
    expect(btn.type).toBe('button');
    expect(btn.props['width']).toBe(100);
    expect(btn.props['height']).toBe(40);
    const label = createNode('label');
    expect(label.props['width']).toBe('content');
    // M3 后 spinner 是合法自研控件,未知类型改用不存在的名字
    const spinner = createNode('spinner');
    expect(spinner.type).toBe('spinner');
    expect(() => createNode('gizmo3000')).toThrow(/未知 widget/);
  });
});

describe('validateProject', () => {
  it('空工程合法', () => {
    const r = validateProject(proj());
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it('带合法 widget 树合法', () => {
    const p = proj();
    const slider = createNode('slider');
    slider.name = 'volume';
    slider.props['value'] = 30;
    slider.props['mode'] = 'range';
    slider.inlineStyles.push({ props: { bg_color: '#ff0000', pad_all: 4 } });
    p.screens[0]!.root.children.push(slider);
    const r = validateProject(p);
    expect(r.errors).toEqual([]);
  });

  it('非法枚举值 / 类型错 → error', () => {
    const p = proj();
    const slider = createNode('slider');
    slider.props['mode'] = 'diagonal';       // 非法 token
    slider.props['value'] = 'abc';           // 应为数值
    p.screens[0]!.root.children.push(slider);
    const r = validateProject(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === 'bad-value' && e.path.includes('mode'))).toBe(true);
    expect(r.errors.some((e) => e.code === 'bad-value' && e.path.includes('value'))).toBe(true);
  });

  it('未知 prop → warning 不阻断(保留但告警)', () => {
    const p = proj();
    const b = createNode('button');
    b.props['no_such_prop'] = 1;
    p.screens[0]!.root.children.push(b);
    const r = validateProject(p);
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.code === 'unknown-prop')).toBe(true);
  });

  it('screen 内 widget name 重复 → error;非法 name → error', () => {
    const p = proj();
    const a = createNode('button');
    a.name = 'btn_1';
    const b = createNode('button');
    b.name = 'btn_1';
    const c = createNode('button');
    c.name = 'lv_bad';                        // 保留前缀
    p.screens[0]!.root.children.push(a, b, c);
    const r = validateProject(p);
    expect(r.errors.some((e) => e.code === 'name-duplicate')).toBe(true);
    expect(r.errors.some((e) => e.code === 'name-reserved_prefix')).toBe(true);
  });

  it('全局符号共用去重域(screen 与 subject 同名冲突)', () => {
    const p = proj();
    p.subjects.push({ name: 'main', type: 'int', initial: 0 });
    const r = validateProject(p);
    expect(r.errors.some((e) => e.code === 'global-name-duplicate')).toBe(true);
  });

  it('未知 flag / 悬空 styleId → error', () => {
    const p = proj();
    const b = createNode('button');
    b.flags = { hidden: true, not_a_flag: true } as never;
    b.styles.push({ styleId: 'nope' });
    p.screens[0]!.root.children.push(b);
    const r = validateProject(p);
    expect(r.errors.some((e) => e.code === 'unknown-flag')).toBe(true);
    expect(r.errors.some((e) => e.code === 'dangling-style')).toBe(true);
  });

  it('components 非空 → 一期拒绝(评审 G7)', () => {
    const p = proj();
    (p.components as unknown[]).push({});
    const r = validateProject(p);
    expect(r.errors.some((e) => e.code === 'components-not-supported')).toBe(true);
  });

  it('普通工程和导入入口拒绝 cPatch', () => {
    const p = proj();
    const button = createNode('button');
    button.cPatch = { post: 'dangerous_call($obj);' };
    p.screens[0]!.root.children.push(button);

    const validation = validateProject(p);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContainEqual(expect.objectContaining({
      code: 'cpatch-forbidden', path: expect.stringContaining('.cPatch'),
    }));
    expect(() => loadProjectJson(JSON.parse(JSON.stringify(p))))
      .toThrow(ProjectValidationError);
  });

  it('SubjectDef 支持 min/max(ARCHITECTURE 修正)', () => {
    const p = proj();
    p.subjects.push({ name: 'counter', type: 'int', initial: 0, min: 0, max: 10 });
    expect(validateProject(p).valid).toBe(true);
  });
});

describe('loadProjectJson(迁移框架)', () => {
  it('当前版本原样通过', () => {
    const p = proj();
    const { project } = loadProjectJson(JSON.parse(JSON.stringify(p)));
    expect(project.schemaVersion).toBe(SCHEMA_VERSION);
    expect(project.meta.name).toBe('t');
  });

  it('过新版本明确拒绝', () => {
    const p = JSON.parse(JSON.stringify(proj()));
    p.schemaVersion = SCHEMA_VERSION + 1;
    expect(() => loadProjectJson(p)).toThrow(ProjectTooNewError);
  });

  it('缺 schemaVersion / 非对象 → 格式错', () => {
    expect(() => loadProjectJson({})).toThrow(ProjectFormatError);
    expect(() => loadProjectJson('x')).toThrow(ProjectFormatError);
    expect(() => loadProjectJson(null)).toThrow(ProjectFormatError);
  });

  it('校验 error → ProjectValidationError', () => {
    const p = JSON.parse(JSON.stringify(proj()));
    p.screens[0].root.children.push({ ...createNode('button'), type: 'gizmo3000' });
    expect(() => loadProjectJson(p)).toThrow(ProjectValidationError);
  });
});

describe('ids', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('newUuid falls back when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {});
    expect(newUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('checkCName:合法/非法样例', () => {
    expect(checkCName('btn_start')).toBeNull();
    expect(checkCName('Btn')).toMatchObject({ code: 'pattern' });
    expect(checkCName('1abc')).toMatchObject({ code: 'pattern' });
    expect(checkCName('while')).toMatchObject({ code: 'keyword' });
    expect(checkCName('lv_x')).toMatchObject({ code: 'reserved_prefix' });
    expect(checkCName('ui_x')).toMatchObject({ code: 'reserved_prefix' });
    expect(checkCName('a'.repeat(64))).toMatchObject({ code: 'length' });
  });

  it('autoName:per-screen 最小可用序号', () => {
    expect(autoName('button', [])).toBe('button_1');
    expect(autoName('button', ['button_1', 'button_2'])).toBe('button_3');
    expect(autoName('button', ['button_2'])).toBe('button_1');
  });

  it('previewName:有名用名,匿名 _x+uuid 前 8 hex', () => {
    expect(previewName({ id: '12345678-9abc-def0-1234-56789abcdef0', name: 'ok' })).toBe('ok');
    expect(previewName({ id: '12345678-9abc-def0-1234-56789abcdef0' })).toBe('_x12345678');
  });
});
