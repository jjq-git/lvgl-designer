/**
 * Schema v1 → v2 迁移器(方案 §9 阶段 1)。
 *
 * 设计原则:**有损的地方必须说出来,不静默取默认值。**
 * 迁移产出 4 件东西:
 *   1. UiProject v2
 *   2. 由 v1 `display` 派生并锁定的 DisplayProfile
 *   3. BuildTarget 草稿(缺 controllerProfileRef,必须人工补)
 *   4. 从 cPatch 抽出的 trusted extension manifest(有 cPatch 时)
 * 外加一份 notes:severity='must-confirm' 的每一条都必须人工确认后才能进发布构建。
 */
import type {
  ComponentDef, ConstDef, EventAction, LvProject, PropValue, ScreenDef,
  StyleUsage, WidgetNode, Binding, NamedStyle,
} from '../project.js';
import type { ColorFormat, DisplayProfile, LvglVersion } from './profiles.js';
import { formatRef, formatThemeRef, type ControllerRef, type DisplayRef, type UiRef } from './refs.js';
import type {
  AssetEntry, BindingV2, BizId, ComponentDefV2, LocalStyleGroup, NamedStyleV2, PropValueV2,
  ScreenDefV2, StyleUsageV2, SubjectDefV2, UiEvent, UiProject, WidgetNodeV2,
} from './uiProject.js';
import type { TrustedExtensionManifest, TrustedPatch } from './trustedExtension.js';

/* ---------------------------------------------------------------- 结果类型 */

export type MigrationSeverity = 'must-confirm' | 'info';

export interface MigrationNote {
  severity: MigrationSeverity;
  code: string;
  path: string;
  message: string;
}

export interface MigrateOptions {
  /** UiProject 的 slug(`ui:<slug>`)。缺省由 meta.name 派生;非 ASCII 名字派生不出时回落并告警 */
  uiProjectSlug?: string;
  /** DisplayProfile 的 slug。缺省由分辨率与色彩格式派生,如 `480x480-rgb565` */
  displaySlug?: string;
  /** 目标 LVGL 版本。缺省 '9.5.0';v1 的 meta.lvglVersion='9.4' 只是历史事实,不是目标 */
  lvglVersion?: LvglVersion;
  /** 计算 cPatch 内容哈希。不提供则 TrustedPatch.sha256 留空(发布前必须补) */
  hash?: (input: string) => string;
}

/** BuildTarget 草稿:controllerProfileRef 无法从 v1 推导,必须人工补 */
export interface BuildTargetDraft {
  schemaVersion: 1;
  kind: 'lvgl-build-target';
  id: string;
  revision: number;
  uiProjectRef: UiRef;
  controllerProfileRef?: ControllerRef;
  themeRef: string;
  lvglVersion: LvglVersion;
}

export interface MigrateResult {
  uiProject: UiProject;
  displayProfile: DisplayProfile;
  buildTargetDraft: BuildTargetDraft;
  trustedExtension: TrustedExtensionManifest | null;
  notes: MigrationNote[];
}

/* ------------------------------------------------------------------ 工具 */

function slugify(s: string): string {
  const out = s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return out.length > 0 && /^[a-z0-9]/.test(out) ? out : '';
}

/**
 * v1 colorDepth → v2 colorFormat。
 * 映射依据是 LVGL 自己的 `LV_COLOR_FORMAT_NATIVE` 表(src/misc/lv_color.h:202-219):
 *   16 → RGB565 / 24 → RGB888 / 32 → XRGB8888
 * 但 16bpp 在 schema 层无法区分 RGB565 与 RGB565_SWAPPED —— 那是面板走线决定的,
 * v1 根本没存。所以 16 一律标 must-confirm。
 */
const DEPTH_TO_CF: Record<16 | 24 | 32, ColorFormat> = {
  16: 'RGB565',
  24: 'RGB888',
  32: 'XRGB8888',
};

const DEFAULT_THEME_ID = 'default';

/* ------------------------------------------------------------------ 主流程 */

export function migrateV1ToV2(v1: LvProject, opts: MigrateOptions = {}): MigrateResult {
  const notes: MigrationNote[] = [];
  const note = (severity: MigrationSeverity, code: string, path: string, message: string): void => {
    notes.push({ severity, code, path, message });
  };

  /* ---- meta / slug ---- */

  let uiSlug = opts.uiProjectSlug ?? slugify(v1.meta.name);
  if (uiSlug === '') {
    uiSlug = 'untitled-ui';
    note('must-confirm', 'ui-slug-fallback', 'meta.name',
      `工程名「${v1.meta.name}」无法派生合法 slug(可能全为非 ASCII),已回落为 "${uiSlug}"。`
      + '同名回落会让多个工程 id 冲突,请显式指定 uiProjectSlug。');
  }

  /* ---- DisplayProfile:由 v1.display 派生并锁定 ---- */

  const { width, height, shape, colorDepth, dpi } = v1.display;
  const colorFormat = DEPTH_TO_CF[colorDepth];
  const displaySlug = opts.displaySlug ?? `${width}x${height}-${colorFormat.toLowerCase()}`;

  const displayProfile: DisplayProfile = {
    schemaVersion: 1,
    kind: 'display-profile',
    id: `display:${displaySlug}`,
    revision: 1,
    displayName: `${width}×${height} ${shape === 'round' ? '圆' : '方'} ${colorFormat}`,
    logicalSize: { width, height },
    shape,
    colorFormat,
    ...(dpi === undefined ? {} : { dpi }),
    // visibleRect 刻意不填:v1 没有该概念,填了就是编造。条屏工程迁移后须人工补。
  };

  if (colorDepth === 16) {
    note('must-confirm', 'color-format-ambiguous', 'display.colorDepth',
      'v1 只存 colorDepth=16,无法区分 RGB565 与 RGB565_SWAPPED(二者都是 16bpp 但驱动含义不同)。'
      + `已按 LVGL LV_COLOR_FORMAT_NATIVE 取 "${colorFormat}",请对照面板驱动确认。`);
  } else {
    note('info', 'color-format-derived', 'display.colorDepth',
      `colorDepth=${colorDepth} → colorFormat="${colorFormat}"(依据 LVGL LV_COLOR_FORMAT_NATIVE 表)。`);
  }
  note('info', 'visible-rect-absent', 'display',
    'v1 无 visibleRect 概念,迁移后留空(视为全屏)。若目标是插黑条屏(如 TXW620002B0 逻辑 480×960、'
    + '可视仅中间 360 列),必须人工补 visibleRect,否则产品预览会画错开孔。');

  const designDisplayRef: DisplayRef = formatRef('display', displaySlug, 1);

  /* ---- 名称 → id 映射(binding 的 styleRef 是 CName,v2 要 BizId) ---- */

  const styleIdByName = new Map<string, BizId>();
  const collectStyles = (list: NamedStyle[]): void => {
    for (const s of list) styleIdByName.set(s.name, s.id);
  };
  collectStyles(v1.styles);
  for (const sc of v1.screens) collectStyles(sc.styles);
  for (const c of v1.components as ComponentDef[]) collectStyles(c.styles);

  const subjectIdByName = new Map<string, BizId>(
    v1.subjects.map((s) => [s.name, `subject:${s.name}`]),
  );

  /* ---- cPatch 抽取 ---- */

  const patches: TrustedPatch[] = [];

  /* ---- 树迁移 ---- */

  function migrateProps(props: Record<string, PropValue>): Record<string, PropValueV2> {
    // v1 的 PropValue 全部是 v2 PropValueV2 的子集($const 结构相同);token 引用是 v2 才有的新能力
    return { ...props } as Record<string, PropValueV2>;
  }

  function migrateStyleUsage(u: StyleUsage): StyleUsageV2 {
    return u.selector === undefined ? { styleId: u.styleId } : { styleId: u.styleId, selector: u.selector };
  }

  function migrateBinding(b: Binding, path: string): BindingV2 | null {
    const subject = subjectIdByName.get(b.subject);
    if (subject === undefined) {
      note('must-confirm', 'binding-subject-missing', path,
        `绑定引用了未定义的 subject "${b.subject}",已丢弃该绑定。`);
      return null;
    }
    switch (b.kind) {
      case 'prop':
        return b.fmt === undefined
          ? { kind: 'prop', prop: b.prop, subject }
          : { kind: 'prop', prop: b.prop, subject, fmt: b.fmt };
      case 'flag':
        return { kind: 'flag', flag: b.flag, op: b.op, subject, refValue: b.refValue };
      case 'state':
        return { kind: 'state', state: b.state, op: b.op, subject, refValue: b.refValue };
      case 'style': {
        const styleId = styleIdByName.get(b.styleRef);
        if (styleId === undefined) {
          note('must-confirm', 'binding-style-missing', path,
            `样式绑定引用了未定义的命名样式 "${b.styleRef}",已丢弃该绑定。`);
          return null;
        }
        return b.selector === undefined
          ? { kind: 'style', styleId, subject, refValue: b.refValue }
          : { kind: 'style', styleId, selector: b.selector, subject, refValue: b.refValue };
      }
    }
  }

  function migrateEvent(e: EventAction, path: string): UiEvent | null {
    switch (e.kind) {
      case 'callback':
        // v1 直接挂 C 回调名。v2 要求 Action 必须在 Action Registry 中有强类型契约(§5.3)。
        note('must-confirm', 'callback-needs-action', path,
          `v1 回调 "${e.callback}" 已映射为 Action "custom.${e.callback}",`
          + '但它尚未登记进 Action Registry。请补契约,或改为已有的业务 Action。');
        return {
          on: e.trigger,
          action: `custom.${e.callback}`,
          ...(e.userData === undefined ? {} : { args: { userData: e.userData } }),
        };
      case 'subject_set': {
        const s = subjectIdByName.get(e.subject);
        if (s === undefined) { noteMissingSubject(e.subject, path); return null; }
        return { on: e.trigger, action: 'subject.set', args: { subject: s, value: e.value } };
      }
      case 'subject_toggle': {
        const s = subjectIdByName.get(e.subject);
        if (s === undefined) { noteMissingSubject(e.subject, path); return null; }
        return { on: e.trigger, action: 'subject.toggle', args: { subject: s } };
      }
      case 'subject_increment': {
        const s = subjectIdByName.get(e.subject);
        if (s === undefined) { noteMissingSubject(e.subject, path); return null; }
        const args: Record<string, string | number | boolean> = { subject: s };
        if (e.step !== undefined) args.step = e.step;
        if (e.min !== undefined) args.min = e.min;
        if (e.max !== undefined) args.max = e.max;
        if (e.rollover !== undefined) args.rollover = e.rollover;
        return { on: e.trigger, action: 'subject.increment', args };
      }
      case 'screen_load':
      case 'screen_create': {
        const args: Record<string, string | number> = { screen: e.screenId };
        if (e.animType !== undefined) args.anim = e.animType;
        if (e.duration !== undefined) args.duration = e.duration;
        if (e.delay !== undefined) args.delay = e.delay;
        return {
          on: e.trigger,
          action: e.kind === 'screen_load' ? 'screen.open' : 'screen.create',
          args,
        };
      }
    }
  }

  function noteMissingSubject(name: string, path: string): void {
    note('must-confirm', 'event-subject-missing', path,
      `事件引用了未定义的 subject "${name}",已丢弃该事件。`);
  }

  function migrateNode(n: WidgetNode, ownerId: BizId, path: string): WidgetNodeV2 {
    if (n.cPatch?.post !== undefined) {
      const post = n.cPatch.post;
      patches.push({
        nodeId: n.id,
        ownerId,
        post,
        ...(opts.hash === undefined ? {} : { sha256: opts.hash(post) }),
      });
      note('must-confirm', 'cpatch-extracted', `${path}.cPatch`,
        'v2 普通工程禁止 cPatch,该片段已抽入 trusted extension manifest,需权限+内容哈希+人工审查。'
        + '优先考虑改为 typed property:去 XML 后 calendar 高亮日期 / chart scatter X / '
        + 'arc change_rate·knob_offset 等原本必须 cPatch 的属性都能直接建模。');
    }

    const localStyles: LocalStyleGroup[] = n.inlineStyles.map((g) =>
      g.selector === undefined
        ? { props: migrateProps(g.props) }
        : { selector: g.selector, props: migrateProps(g.props) });

    return {
      id: n.id,
      type: n.type,
      ...(n.name === undefined ? {} : { codeName: n.name }),
      ...(n.displayName === undefined ? {} : { displayName: n.displayName }),
      props: migrateProps(n.props),
      ...(n.flags === undefined ? {} : { flags: n.flags }),
      ...(n.states === undefined ? {} : { states: n.states }),
      styleRefs: n.styles.map(migrateStyleUsage),
      styles: localStyles,
      events: n.events
        .map((e, i) => migrateEvent(e, `${path}.events[${i}]`))
        .filter((e): e is UiEvent => e !== null),
      bindings: n.bindings
        .map((b, i) => migrateBinding(b, `${path}.bindings[${i}]`))
        .filter((b): b is BindingV2 => b !== null),
      children: n.children.map((c, i) => migrateNode(c, ownerId, `${path}.children[${i}]`)),
      ...(n.editor === undefined ? {} : { editor: n.editor }),
    };
  }

  function migrateNamedStyle(s: NamedStyle): NamedStyleV2 {
    return { id: s.id, codeName: s.name, props: migrateProps(s.props) };
  }

  function migrateScreen(s: ScreenDef, i: number): ScreenDefV2 {
    return {
      id: s.id,
      codeName: s.name,
      ...(s.displayName === undefined ? {} : { displayName: s.displayName }),
      ...(s.isHome === undefined ? {} : { isHome: s.isHome }),
      styles: s.styles.map(migrateNamedStyle),
      consts: s.consts,
      root: migrateNode(s.root, s.id, `screens[${i}].root`),
    };
  }

  function migrateComponent(c: ComponentDef, i: number): ComponentDefV2 {
    return {
      id: c.id,
      codeName: c.name,
      ...(c.displayName === undefined ? {} : { displayName: c.displayName }),
      api: c.api.map((p) => ({
        name: p.name,
        type: 'string' as const,   // v1 的 ComponentApiProp.type 是自由字符串,无法可靠映射
        ...(p.default === undefined ? {} : { default: p.default }),
      })),
      styles: c.styles.map(migrateNamedStyle),
      consts: c.consts,
      root: migrateNode(c.root, c.id, `components[${i}].root`),
    };
  }

  /* ---- subjects ---- */

  const subjects: SubjectDefV2[] = v1.subjects.map((s) => {
    const base = { id: `subject:${s.name}`, codeName: s.name };
    switch (s.type) {
      case 'int':
      case 'float':
        return {
          ...base, type: s.type, initial: s.initial,
          ...(s.min === undefined ? {} : { min: s.min }),
          ...(s.max === undefined ? {} : { max: s.max }),
        };
      case 'string':
        return { ...base, type: 'string', initial: s.initial };
      case 'color':
        return { ...base, type: 'color', initial: s.initial };
    }
  });

  /* ---- assets ---- */

  const fonts: AssetEntry[] = v1.assets.fonts.map((f) => ({
    id: `font:${f.name}`,
    codeName: f.name,
    file: f.file,
    conv: {
      loader: f.loader,
      ...(f.sizePx === undefined ? {} : { sizePx: f.sizePx }),
      ...(f.conv === undefined ? {} : {
        bpp: f.conv.bpp,
        ranges: f.conv.ranges,
        ...(f.conv.symbols === undefined ? {} : { symbols: f.conv.symbols }),
        ...(f.conv.autoCollect === undefined ? {} : { autoCollect: f.conv.autoCollect }),
        ...(f.conv.license === undefined ? {} : { license: f.conv.license }),
        ...(f.conv.licenseText === undefined ? {} : { licenseText: f.conv.licenseText }),
        ...(f.conv.licenseUrl === undefined ? {} : { licenseUrl: f.conv.licenseUrl }),
        ...(f.conv.copyright === undefined ? {} : { copyright: f.conv.copyright }),
      }),
    },
  }));

  const images: AssetEntry[] = v1.assets.images.map((im) => ({
    id: `image:${im.name}`,
    codeName: im.name,
    file: im.file,
    conv: {
      ...(im.kind === undefined ? {} : { kind: im.kind }),
      colorFormat: im.conv.colorFormat,
      ...(im.conv.stride === undefined ? {} : { stride: im.conv.stride }),
    },
  }));

  if (v1.assets.images.some((im) => im.kind === 'lottie')) {
    note('info', 'lottie-asset', 'assets.images',
      'lottie 资源已并入 images 并在 conv.kind 标记。v2 的 icons 分类为空 —— '
      + 'v1 无图标概念,如需接入 platforms/icons 共享图标链,请人工填充。');
  }

  /* ---- consts → theme token 的迁移建议(不自动转换) ---- */

  const colorConsts = v1.consts.filter((c: ConstDef) => c.type === 'color');
  if (colorConsts.length > 0) {
    note('info', 'consts-to-tokens', 'consts',
      `发现 ${colorConsts.length} 个颜色常量(${colorConsts.slice(0, 5).map((c) => c.name).join(', ')}`
      + `${colorConsts.length > 5 ? ' …' : ''})。迁移器**不自动**把它们转成 Theme Token —— `
      + 'const 是值级 IR、token 是设计语义,自动转换会编造语义 ID。建议人工提升为 '
      + '`color.*` token 以启用 Theme 切换。');
  }

  /* ---- lvglVersion:从 meta 移到 BuildTarget ---- */

  const lvglVersion = opts.lvglVersion ?? '9.5.0';
  note(lvglVersion === '9.5.0' ? 'must-confirm' : 'info', 'lvgl-version-moved', 'meta.lvglVersion',
    `v1 的 meta.lvglVersion="${v1.meta.lvglVersion}" 已移出 UiProject,改由 BuildTarget.lvglVersion 决定,`
    + `当前草稿取 "${lvglVersion}"。注意 9.5 移除了 XML 引擎,预览通道必须走 IR 直驱`
    + '(见 docs/lvgl-version-baseline.md §2.2)。');

  /* ---- codegen 选项:exportXml 在 9.5 上无意义 ---- */

  if (v1.codegen.exportXml && lvglVersion === '9.5.0') {
    note('must-confirm', 'export-xml-obsolete', 'codegen.exportXml',
      'v1 开启了 exportXml,但目标 9.5.0 已无 XML 引擎,导出的 XML 没有任何 LVGL 运行时能加载它。'
      + 'v2 不再保留该选项,请确认不依赖 XML 产物。');
  }

  /* ---- 组装 ---- */

  const uiProject: UiProject = {
    schemaVersion: 2,
    kind: 'lvgl-ui-project',
    meta: {
      id: `ui:${uiSlug}`,
      revision: 1,
      name: v1.meta.name,
      appVersion: v1.meta.appVersion,
      createdAt: v1.meta.createdAt,
      modifiedAt: v1.meta.modifiedAt,
    },
    designDisplayRef,
    themes: [{ id: DEFAULT_THEME_ID, displayName: '默认', tokens: [] }],
    subjects,
    screens: v1.screens.map(migrateScreen),
    components: (v1.components as ComponentDef[]).map(migrateComponent),
    styles: v1.styles.map(migrateNamedStyle),
    consts: v1.consts,
    assets: { fonts, images, icons: [] },
    translations: v1.translations,
    ...(v1.editor === undefined ? {} : { editor: v1.editor }),
  };

  const uiRef: UiRef = formatRef('ui', uiSlug, 1);

  const buildTargetDraft: BuildTargetDraft = {
    schemaVersion: 1,
    kind: 'lvgl-build-target',
    id: `target:${uiSlug}-draft`,
    revision: 1,
    uiProjectRef: uiRef,
    // controllerProfileRef 刻意留空 —— v1 没有外壳概念,编不出来
    themeRef: formatThemeRef(uiRef, DEFAULT_THEME_ID),
    lvglVersion,
  };

  note('must-confirm', 'controller-profile-missing', 'buildTarget.controllerProfileRef',
    'v1 无 ControllerProfile 概念,BuildTarget 草稿缺 controllerProfileRef,必须人工补一个'
    + `外壳 Profile,且其 displayRef 必须等于 "${designDisplayRef}"。`);

  note('info', 'theme-empty', 'themes',
    `已建空 Theme "${DEFAULT_THEME_ID}"。v1 无 Theme 概念,token 表为空 —— `
    + '在补齐 token 之前,BuildTarget 可以构建,但 Theme 切换能力等同于没有。');

  const trustedExtension: TrustedExtensionManifest | null = patches.length === 0 ? null : {
    schemaVersion: 1,
    kind: 'trusted-extension',
    uiProjectId: `ui:${uiSlug}`,
    patches,
  };

  return { uiProject, displayProfile, buildTargetDraft, trustedExtension, notes };
}

/** 便捷判定:是否还有必须人工确认的项 */
export function hasBlockingNotes(r: MigrateResult): boolean {
  return r.notes.some((n) => n.severity === 'must-confirm');
}
