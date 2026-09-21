/**
 * Schema v2 校验(方案 §4.7 四层):
 *   1. 结构校验  —— zod 外壳
 *   2. 语义校验  —— 引用完整、ID 唯一、父子关系、Selector、Action 参数、循环依赖
 *   3. 目标能力校验 —— 由 validateAgainstCapability() 单独提供(需要能力包,不在本层强制)
 *   4. 信任校验  —— 普通工程不得含 cPatch / trusted extension 痕迹
 *
 * 与 v1 的 validate.ts 同构:errors 阻断,warnings 不阻断。
 */
import { zUiProject } from './schemas.js';
import { STYLE_PROPS } from '../styleProps.js';
import { REGISTRY, findChildSpec } from '../widgets/index.js';
import { checkCName } from '../ids.js';
import { PART_TOKENS, STATE_TOKENS } from '../enums.js';
import type { ValidationIssue, ValidationResult } from '../validate.js';
import { isRefOfKind, parseRef, parseThemeRef } from './refs.js';
import {
  SW_COLOR_FORMATS, effectiveVisibleRect,
  type ColorFormat, type ControllerProfile, type DisplayProfile,
  type LvglCapabilitySummary,
} from './profiles.js';
import { TOKEN_ID_RE, isTokenRef, resolveTheme, tokenAssignableTo, type ThemeToken } from './theme.js';
import {
  BUILTIN_ACTIONS, type ActionRegistry, type UiProject, type WidgetNodeV2,
} from './uiProject.js';

/* ------------------------------------------------------------------ 上下文 */

interface Ctx {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

function err(ctx: Ctx, path: string, code: string, message: string): void {
  ctx.errors.push({ path, code, message });
}
function warn(ctx: Ctx, path: string, code: string, message: string): void {
  ctx.warnings.push({ path, code, message });
}

/* ------------------------------------------------------------- 语义校验 */

const PART_SET = new Set<string>(PART_TOKENS);
const STATE_SET = new Set<string>(STATE_TOKENS);

function checkSelector(ctx: Ctx, sel: { part?: string; states?: string[] } | undefined, path: string): void {
  if (sel === undefined) return;
  if (sel.part !== undefined && !PART_SET.has(sel.part)) {
    err(ctx, path, 'bad-part', `未知 part token "${sel.part}"`);
  }
  for (const s of sel.states ?? []) {
    if (!STATE_SET.has(s)) err(ctx, path, 'bad-state', `未知 state token "${s}"`);
  }
}

/** 检查一组样式属性:键必须在 STYLE_PROPS 里;token 引用必须存在且类型可赋 */
function checkStyleProps(
  ctx: Ctx,
  props: Record<string, unknown>,
  path: string,
  tokens: Map<string, ThemeToken> | null,
): void {
  for (const [key, value] of Object.entries(props)) {
    const spec = STYLE_PROPS[key];
    if (spec === undefined) {
      if (!key.startsWith('x-')) {
        warn(ctx, `${path}.${key}`, 'unknown-style-prop', `未登记的样式属性 "${key}",保留但不生成`);
      }
      continue;
    }
    if (!isTokenRef(value)) continue;

    const tokenId = value.$token;
    if (!TOKEN_ID_RE.test(tokenId)) {
      err(ctx, `${path}.${key}`, 'bad-token-id',
        `token id "${tokenId}" 不是合法语义 ID(点分小写段,如 color.text.primary)`);
      continue;
    }
    if (tokens === null) continue;   // theme 本身有错,不重复报
    const tok = tokens.get(tokenId);
    if (tok === undefined) {
      // §4.6:引用不存在的 token 在语义校验阶段拒绝,不做静默回退
      err(ctx, `${path}.${key}`, 'token-not-found', `引用了未定义的 token "${tokenId}"`);
      continue;
    }
    if (!tokenAssignableTo(tok.type, spec.type)) {
      err(ctx, `${path}.${key}`, 'token-type-mismatch',
        `token "${tokenId}" 类型为 ${tok.type},不能赋给 ${spec.type} 类属性 "${key}"`);
    }
  }
}

interface NodeCtx {
  ids: Set<string>;
  codeNames: Map<string, string>;   // codeName -> 首次出现的 path
  styleIds: Set<string>;
  subjectIds: Set<string>;
  screenIds: Set<string>;
  actions: ActionRegistry;
  tokens: Map<string, ThemeToken> | null;
}

function validateNode(
  ctx: Ctx, node: WidgetNodeV2, path: string, nc: NodeCtx, parentType: string | null,
): void {
  /* id 唯一 */
  if (nc.ids.has(node.id)) err(ctx, path, 'duplicate-id', `重复的业务 id "${node.id}"`);
  nc.ids.add(node.id);

  /* codeName:只有需要导出符号的节点才有,必须满足 C 标识符约束(§4.6) */
  if (node.codeName !== undefined) {
    const e = checkCName(node.codeName);
    if (e !== null) err(ctx, `${path}.codeName`, 'bad-code-name', `codeName "${node.codeName}" 非法:${e.message}`);
    const prev = nc.codeNames.get(node.codeName);
    if (prev !== undefined) {
      err(ctx, `${path}.codeName`, 'duplicate-code-name',
        `codeName "${node.codeName}" 与 ${prev} 冲突(会生成同名 C 符号)`);
    } else {
      nc.codeNames.set(node.codeName, path);
    }
  }

  /* 类型解析:widget 或父 widget 声明的结构子元素 */
  const spec = REGISTRY.get(node.type);
  const asChild = findChildSpec(node.type);
  if (spec === undefined && asChild === undefined) {
    err(ctx, path, 'unknown-widget', `未登记的 widget 类型 "${node.type}"`);
  } else if (spec === undefined && asChild !== undefined && asChild.parent.type !== parentType) {
    // 结构子元素(如 chart-series)只能出现在声明它的 widget 之下
    err(ctx, path, 'misplaced-child',
      `"${node.type}" 只能作为 "${asChild.parent.type}" 的子元素,当前父节点是 "${parentType ?? '(根)'}"`);
  }

  /* 样式 */
  for (const [i, u] of node.styleRefs.entries()) {
    checkSelector(ctx, u.selector, `${path}.styleRefs[${i}].selector`);
    if (!nc.styleIds.has(u.styleId)) {
      err(ctx, `${path}.styleRefs[${i}]`, 'style-not-found', `引用了未定义的命名样式 "${u.styleId}"`);
    }
  }
  for (const [i, g] of node.styles.entries()) {
    checkSelector(ctx, g.selector, `${path}.styles[${i}].selector`);
    checkStyleProps(ctx, g.props, `${path}.styles[${i}].props`, nc.tokens);
  }

  /* 事件 → Action Registry */
  for (const [i, ev] of node.events.entries()) {
    const p = `${path}.events[${i}]`;
    const action = nc.actions[ev.action];
    if (action === undefined) {
      err(ctx, p, 'unknown-action', `Action "${ev.action}" 不在 Action Registry 中`);
      continue;
    }
    const args = ev.args ?? {};
    for (const param of action.params) {
      if (param.required === true && args[param.name] === undefined && param.default === undefined) {
        err(ctx, p, 'missing-action-arg', `Action "${ev.action}" 缺必填参数 "${param.name}"`);
      }
      const v = args[param.name];
      if (v === undefined) continue;
      if (param.type === 'screenRef' && typeof v === 'string' && !nc.screenIds.has(v)) {
        err(ctx, p, 'screen-not-found', `Action 参数 "${param.name}" 指向不存在的 screen "${v}"`);
      }
      if (param.type === 'subjectRef' && typeof v === 'string' && !nc.subjectIds.has(v)) {
        err(ctx, p, 'subject-not-found', `Action 参数 "${param.name}" 指向不存在的 subject "${v}"`);
      }
      // 受控枚举(如 pod 设置字段):不在白名单里的值直接拒绝,不做静默透传
      if (param.enum !== undefined && typeof v === 'string' && !param.enum.includes(v)) {
        err(ctx, p, 'action-arg-not-in-enum',
          `Action "${ev.action}" 的参数 "${param.name}" 取值 "${v}" 不在白名单内`);
      }
      if (typeof v === 'number') {
        if (param.min !== undefined && v < param.min) {
          err(ctx, p, 'action-arg-out-of-range',
            `Action "${ev.action}" 的参数 "${param.name}"=${v} 小于下限 ${param.min}`);
        }
        if (param.max !== undefined && v > param.max) {
          err(ctx, p, 'action-arg-out-of-range',
            `Action "${ev.action}" 的参数 "${param.name}"=${v} 大于上限 ${param.max}`);
        }
      }
    }
    for (const name of Object.keys(args)) {
      if (!action.params.some((pp) => pp.name === name)) {
        warn(ctx, p, 'extra-action-arg', `Action "${ev.action}" 不接受参数 "${name}"`);
      }
    }
  }

  /* 绑定 */
  for (const [i, b] of node.bindings.entries()) {
    const p = `${path}.bindings[${i}]`;
    if (!nc.subjectIds.has(b.subject)) {
      err(ctx, p, 'subject-not-found', `绑定引用了不存在的 subject "${b.subject}"`);
    }
    if (b.kind === 'style') {
      if (!nc.styleIds.has(b.styleId)) {
        err(ctx, p, 'style-not-found', `样式绑定引用了不存在的命名样式 "${b.styleId}"`);
      }
      checkSelector(ctx, b.selector, `${p}.selector`);
    }
  }

  for (const [i, c] of node.children.entries()) {
    validateNode(ctx, c, `${path}.children[${i}]`, nc, node.type);
  }
}

/* ---------------------------------------------------------------- 入口 */

export interface ValidateV2Options {
  /** 业务 Action;与 BUILTIN_ACTIONS 合并。缺省只有内置导航/Subject 动作 */
  actions?: ActionRegistry;
}

export function validateUiProjectV2(doc: unknown, opts: ValidateV2Options = {}): ValidationResult {
  const ctx: Ctx = { errors: [], warnings: [] };

  const parsed = zUiProject.safeParse(doc);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.') || '(root)';
      // cPatch 会被 .strict() 报成 unrecognized_keys —— 换成信任层的明确措辞
      const isCPatch = issue.code === 'unrecognized_keys'
        && (issue as unknown as { keys?: string[] }).keys?.includes('cPatch') === true;
      err(ctx, path, isCPatch ? 'cpatch-forbidden' : 'schema',
        isCPatch
          ? 'v2 普通工程禁止 cPatch,任意 C 片段必须进独立 trusted extension manifest(§8)'
          : issue.message);
    }
    return { valid: false, errors: ctx.errors, warnings: ctx.warnings };
  }

  const p = parsed.data as unknown as UiProject;

  /* ---- designDisplayRef ---- */
  if (!isRefOfKind(p.designDisplayRef, 'display')) {
    err(ctx, 'designDisplayRef', 'bad-ref',
      `designDisplayRef "${p.designDisplayRef}" 不是合法的 display 引用(应形如 display:<slug>@<revision>)`);
  }

  /* ---- themes ---- */
  const themeIds = new Set<string>();
  for (const [i, t] of p.themes.entries()) {
    if (themeIds.has(t.id)) err(ctx, `themes[${i}]`, 'duplicate-theme', `重复的 theme id "${t.id}"`);
    themeIds.add(t.id);
    const seen = new Set<string>();
    for (const [j, tok] of t.tokens.entries()) {
      if (!TOKEN_ID_RE.test(tok.id)) {
        err(ctx, `themes[${i}].tokens[${j}]`, 'bad-token-id',
          `token id "${tok.id}" 不是合法语义 ID(点分小写段,如 color.text.primary)`);
      }
      if (seen.has(tok.id)) {
        err(ctx, `themes[${i}].tokens[${j}]`, 'duplicate-token', `theme "${t.id}" 内重复 token "${tok.id}"`);
      }
      seen.add(tok.id);
    }
  }
  for (const [i, t] of p.themes.entries()) {
    if (t.extends !== undefined && !themeIds.has(t.extends)) {
      err(ctx, `themes[${i}].extends`, 'theme-parent-missing', `继承了不存在的 theme "${t.extends}"`);
    } else if (t.extends !== undefined && resolveTheme(p.themes, t.id) === null) {
      err(ctx, `themes[${i}].extends`, 'theme-cycle', `theme "${t.id}" 的继承链成环`);
    }
  }

  /* 用于 token 校验的表:取第一个 theme(v1 迁移产物只有一个)。
   * 多 Theme 工程的严格做法是按 BuildTarget 选中的 Theme 校验 —— 那属于跨对象校验,
   * 见 validateCrossRefs();此处只保证「至少在默认 Theme 下引用是完整的」。 */
  const firstTheme = p.themes[0];
  const tokens = firstTheme === undefined
    ? new Map<string, ThemeToken>()
    : resolveTheme(p.themes, firstTheme.id);

  /* ---- 全局唯一性 ---- */
  const styleIds = new Set<string>();
  const collectStyleIds = (list: { id: string }[], path: string): void => {
    for (const [i, s] of list.entries()) {
      if (styleIds.has(s.id)) err(ctx, `${path}[${i}]`, 'duplicate-style-id', `重复的样式 id "${s.id}"`);
      styleIds.add(s.id);
    }
  };
  collectStyleIds(p.styles, 'styles');
  for (const [i, sc] of p.screens.entries()) collectStyleIds(sc.styles, `screens[${i}].styles`);

  const subjectIds = new Set(p.subjects.map((s) => s.id));
  if (subjectIds.size !== p.subjects.length) {
    err(ctx, 'subjects', 'duplicate-subject-id', 'subject id 重复');
  }

  const screenIds = new Set<string>();
  for (const [i, sc] of p.screens.entries()) {
    if (screenIds.has(sc.id)) err(ctx, `screens[${i}]`, 'duplicate-screen-id', `重复的 screen id "${sc.id}"`);
    screenIds.add(sc.id);
  }
  const homes = p.screens.filter((s) => s.isHome === true);
  if (homes.length === 0) warn(ctx, 'screens', 'no-home', '没有任何 screen 标记 isHome');
  if (homes.length > 1) err(ctx, 'screens', 'multiple-home', `${homes.length} 个 screen 同时标记 isHome`);

  /* ---- 样式属性 / token ---- */
  for (const [i, s] of p.styles.entries()) checkStyleProps(ctx, s.props, `styles[${i}].props`, tokens);

  /* ---- 树 ---- */
  const nc: NodeCtx = {
    ids: new Set(),
    codeNames: new Map(),
    styleIds,
    subjectIds,
    screenIds,
    actions: { ...BUILTIN_ACTIONS, ...(opts.actions ?? {}) },
    tokens,
  };
  for (const [i, sc] of p.screens.entries()) {
    const e = checkCName(sc.codeName);
    if (e !== null) err(ctx, `screens[${i}].codeName`, 'bad-code-name', `screen codeName 非法:${e.message}`);
    for (const [j, s] of sc.styles.entries()) {
      checkStyleProps(ctx, s.props, `screens[${i}].styles[${j}].props`, tokens);
    }
    if (sc.root.type !== 'obj') {
      err(ctx, `screens[${i}].root`, 'bad-root-type', `screen 根节点 type 必须是 "obj",实为 "${sc.root.type}"`);
    }
    validateNode(ctx, sc.root, `screens[${i}].root`, nc, null);
  }

  return { valid: ctx.errors.length === 0, errors: ctx.errors, warnings: ctx.warnings };
}

/* -------------------------------------------------- Profile / BuildTarget */

export function validateDisplayProfile(d: DisplayProfile): ValidationResult {
  const ctx: Ctx = { errors: [], warnings: [] };
  if (d.logicalSize.width <= 0 || d.logicalSize.height <= 0) {
    err(ctx, 'logicalSize', 'bad-size', '逻辑分辨率必须为正');
  }
  if (!SW_COLOR_FORMATS.includes(d.colorFormat)) {
    err(ctx, 'colorFormat', 'unsupported-color-format', `软件渲染器不支持 "${d.colorFormat}"`);
  }
  if (d.visibleRect !== undefined) {
    const r = d.visibleRect;
    const inside = r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0
      && r.x + r.width <= d.logicalSize.width
      && r.y + r.height <= d.logicalSize.height;
    if (!inside) {
      err(ctx, 'visibleRect', 'visible-rect-out-of-bounds',
        `visibleRect 必须完全位于 logicalSize(${d.logicalSize.width}×${d.logicalSize.height})之内`);
    }
  }
  if (d.shape === 'round' && d.logicalSize.width !== d.logicalSize.height) {
    warn(ctx, 'shape', 'round-not-square',
      '圆屏的逻辑分辨率通常是正方形;非正方形圆屏请确认是否真实存在');
  }
  return { valid: ctx.errors.length === 0, errors: ctx.errors, warnings: ctx.warnings };
}

export interface CrossRefInput {
  uiProject: UiProject;
  controller: ControllerProfile;
  display: DisplayProfile;
  buildTarget: {
    uiProjectRef: string;
    controllerProfileRef: string;
    themeRef: string;
    lvglVersion: string;
  };
  capability?: LvglCapabilitySummary;
}

/**
 * BuildTarget 的跨对象一致性校验(§4.4):
 *  - UI 与 Controller 必须指向**同一个** DisplayProfile(含 revision)
 *  - 工程内 themeRef 的 ui 部分必须等于 uiProjectRef；独立 Theme revision
 *    必须已由平台解析并以相同 id 注入本次不可变 UiProject 构建快照
 *  - colorFormat 必须在目标版本能力包声明的支持列表内(第 3 层:目标能力校验)
 */
export function validateCrossRefs(input: CrossRefInput): ValidationResult {
  const ctx: Ctx = { errors: [], warnings: [] };
  const { uiProject, controller, display, buildTarget, capability } = input;

  const expectedUiRef = `${uiProject.meta.id}@${uiProject.meta.revision}`;
  if (buildTarget.uiProjectRef !== expectedUiRef) {
    err(ctx, 'buildTarget.uiProjectRef', 'ui-project-ref-mismatch',
      `BuildTarget.uiProjectRef "${buildTarget.uiProjectRef}" 与传入的 UiProject `
      + `快照 "${expectedUiRef}" 不一致`);
  }

  const expectedControllerRef = `${controller.id}@${controller.revision}`;
  if (buildTarget.controllerProfileRef !== expectedControllerRef) {
    err(ctx, 'buildTarget.controllerProfileRef', 'controller-profile-ref-mismatch',
      `BuildTarget.controllerProfileRef "${buildTarget.controllerProfileRef}" 与传入的 `
      + `ControllerProfile 快照 "${expectedControllerRef}" 不一致`);
  }

  if (uiProject.designDisplayRef !== controller.displayRef) {
    err(ctx, 'buildTarget', 'display-mismatch',
      `UI 的 designDisplayRef "${uiProject.designDisplayRef}" 与 Controller 的 displayRef `
      + `"${controller.displayRef}" 不一致 —— 二者必须指向同一个不可变 DisplayProfile`);
  }

  const dref = parseRef(uiProject.designDisplayRef);
  if (dref !== null && (`display:${dref.slug}` !== display.id || dref.revision !== display.revision)) {
    err(ctx, 'buildTarget', 'display-profile-mismatch',
      `传入的 DisplayProfile(${display.id}@${display.revision})不是引用指向的那一个`);
  }

  const theme = parseThemeRef(buildTarget.themeRef);
  const standaloneTheme = parseRef(buildTarget.themeRef);
  if (theme === null && standaloneTheme?.kind !== 'theme') {
    err(ctx, 'buildTarget.themeRef', 'bad-theme-ref',
      `themeRef "${buildTarget.themeRef}" 格式非法(应为 ui:<slug>@<rev>#theme:<id> 或 theme:<slug>@<rev>)`);
  } else if (theme !== null) {
    if (theme.ui !== buildTarget.uiProjectRef) {
      err(ctx, 'buildTarget.themeRef', 'theme-ref-ui-mismatch',
        `themeRef 内嵌的 "${theme.ui}" 与 uiProjectRef "${buildTarget.uiProjectRef}" 不一致`);
    }
    if (!uiProject.themes.some((t) => t.id === theme.themeId)) {
      err(ctx, 'buildTarget.themeRef', 'theme-not-found',
        `UiProject 中没有 theme "${theme.themeId}"`);
    }
  } else if (!uiProject.themes.some((t) => t.id === `theme:${standaloneTheme!.slug}`)) {
    err(ctx, 'buildTarget.themeRef', 'theme-not-found',
      `解析后的 UiProject 构建快照中没有独立 Theme "theme:${standaloneTheme!.slug}"`);
  }

  if (capability !== undefined) {
    if (!capability.supportedColorFormats.includes(display.colorFormat as ColorFormat)) {
      err(ctx, 'display.colorFormat', 'color-format-unsupported-by-target',
        `LVGL ${capability.version} 能力包未声明支持 "${display.colorFormat}"`);
    }
    if (capability.version !== buildTarget.lvglVersion) {
      err(ctx, 'buildTarget.lvglVersion', 'capability-version-mismatch',
        `能力包版本 ${capability.version} 与 BuildTarget.lvglVersion ${buildTarget.lvglVersion} 不一致`);
    }
  }

  /* 视口宽高比:旋转后应与显示区域兼容(不要求数值相等,单位不同) */
  const vp = controller.frame.screenViewport;
  const vis = effectiveVisibleRect(display);
  const rotated = vp.rotation === 90 || vp.rotation === 270;
  const vpW = rotated ? vp.height : vp.width;
  const vpH = rotated ? vp.width : vp.height;
  if (vpW > 0 && vpH > 0 && vis.width > 0 && vis.height > 0) {
    const ratio = (vpW / vpH) / (vis.width / vis.height);
    if (ratio < 0.98 || ratio > 1.02) {
      warn(ctx, 'controller.frame.screenViewport', 'aspect-mismatch',
        `外壳视口宽高比(旋转后 ${vpW}×${vpH})与显示可视区(${vis.width}×${vis.height})相差超过 2%,`
        + '预览会出现拉伸');
    }
  }

  return { valid: ctx.errors.length === 0, errors: ctx.errors, warnings: ctx.warnings };
}
