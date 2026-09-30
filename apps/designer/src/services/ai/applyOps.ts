/**
 * applyAiOps:AI ops → 校验 + 单个 mutate recipe(整批 ops 一条 undo 历史)。
 *
 * 契约(不得私改):
 *   applyAiOps(project, ops) → { recipe:(draft)=>void, errors: AiOpError[] }
 *   errors 非空则不产 recipe,错误列表供自动修复回路喂回模型。
 *
 * 校验规则:
 * - type 不在 REGISTRY → error
 * - props 键不在 registry(widget 专有 ∪ OBJ_BASE ∪ 伴生键)→ 丢弃 + warning(非 fatal)
 * - 枚举值非法 / 值类型不符 → error
 * - update/remove 的 target 找不到 → error;禁止 remove 屏根
 * - replace_screen 的 root.type 必须为 'obj' → 否则 error
 * - name 非法自动净化 + warning;冲突自动 _2/_3… 后缀 + warning
 *
 * 实现:先在 structuredClone 的 screen 上完整跑一遍(收集 errors/warnings),
 * 全部通过才返回 recipe;recipe 在 immer draft 上重放同一套确定性逻辑。
 */
import {
  OBJ_BASE, PART_TOKENS, REGISTRY, STATE_TOKENS, STYLE_PROPS,
  checkCName, isColorHex, isConstRef, newUuid,
  type EnumSpec, type PropSpec, type Selector,
} from '@lvd/schema';
import {
  isTokenRef,
  type LocalStyleGroup,
  type PropValueV2,
  type ScreenDefV2,
  type UiProject,
  type WidgetNodeV2,
} from '@lvd/schema/v2';
import type { AiOp, NodeSpec } from './opsSchema.js';

/* ------------------------------------------------------------------ 类型 */

export interface AiOpIssue {
  opIndex: number;          // 出错的 op 下标;-1 = 整体问题
  path: string;             // 如 ops[0].node.props.mode
  code: string;
  message: string;
}
export type AiOpError = AiOpIssue;
export type AiOpWarning = AiOpIssue;

export interface ApplyOpsResult {
  /** errors 为空时给出；由 projectStore.mutateV2 作为一条历史提交。 */
  recipe?: (draft: UiProject) => void;
  errors: AiOpError[];
  warnings: AiOpWarning[];
}

/* ------------------------------------------------------------- 值类型检查 */

const PCT_RE = /^-?\d+%$/;

interface ValueSpec {
  type: string;
  enum?: EnumSpec;
  min?: number;
  max?: number;
}

/** 返回 null=合法;与 @lvd/schema validate.ts 的 valueMatchesType 语义一致 */
function valueMatchesType(v: PropValueV2, spec: ValueSpec): string | null {
  if (isTokenRef(v) || isConstRef(v)) return null;
  switch (spec.type) {
    case 'int':
      if (typeof v !== 'number' || !Number.isFinite(v)) return '应为数值';
      if (spec.min !== undefined && v < spec.min) return `小于最小值 ${spec.min}`;
      if (spec.max !== undefined && v > spec.max) return `大于最大值 ${spec.max}`;
      return null;
    case 'size':
      if (typeof v === 'number') return null;
      if (v === 'content') return null;
      if (typeof v === 'string' && PCT_RE.test(v)) return null;
      return "应为数值、'content' 或 'n%'";
    case 'opa':
      if (typeof v === 'number') return v >= 0 && v <= 255 ? null : '应在 0-255';
      if (typeof v === 'string' && PCT_RE.test(v)) return null;
      return "应为 0-255 或 'n%'";
    case 'bool':
      return typeof v === 'boolean' ? null : '应为布尔';
    case 'color':
      return isColorHex(v) ? null : "应为 '#RGB' 或 '#RRGGBB'";
    case 'enum': {
      if (typeof v !== 'string') return '应为枚举 token 字符串';
      if (spec.enum && !spec.enum.tokens.includes(v)) {
        return `非法枚举值,可选:${spec.enum.tokens.join('|')}`;
      }
      return null;
    }
    case 'intList':
      return Array.isArray(v) && v.every((x) => typeof x === 'number') ? null : '应为数值数组';
    case 'pointList':
      return Array.isArray(v)
        && v.length >= 2
        && v.length % 2 === 0
        && v.every((x) => typeof x === 'number' && Number.isFinite(x))
        ? null
        : '应为有限数值坐标数组 [x1,y1,x2,y2,…]';
    case 'stringQuotedList':
      return Array.isArray(v) && v.every((x) => typeof x === 'string') ? null : '应为字符串数组';
    default:
      // string / imageRef / fontRef / styleRef / subject / orFlags / gridTemplate / gradRef
      return typeof v === 'string' ? null : '应为字符串';
  }
}

/** widget 已知 props:OBJ_BASE ∪ 专有 ∪ 伴生键 */
function knownPropsOf(type: string): Map<string, ValueSpec> {
  const spec = REGISTRY.get(type);
  const known = new Map<string, ValueSpec>();
  const put = (p: PropSpec): void => {
    known.set(p.key, { type: p.type, enum: p.enum, min: p.min, max: p.max });
    for (const c of p.companions ?? []) {
      known.set(c.key, { type: c.type, enum: c.enum });
    }
  };
  for (const p of OBJ_BASE.props) put(p);
  for (const p of spec?.props ?? []) put(p);
  return known;
}

/* --------------------------------------------------------------- 树工具 */

function findByName(
  node: WidgetNodeV2,
  parent: WidgetNodeV2 | null,
  name: string,
): { node: WidgetNodeV2; parent: WidgetNodeV2 | null } | null {
  if (node.codeName === name) return { node, parent };
  for (const c of node.children) {
    const hit = findByName(c, node, name);
    if (hit) return hit;
  }
  return null;
}

function collectNames(node: WidgetNodeV2, into: Set<string>): void {
  if (node.codeName) into.add(node.codeName);
  for (const c of node.children) collectNames(c, into);
}

/* --------------------------------------------------------------- 上下文 */

interface Ctx {
  errors: AiOpError[];
  warnings: AiOpWarning[];
  used: Set<string>;        // screen 内已占用 name(含 screen.name)
}

function err(ctx: Ctx, opIndex: number, path: string, code: string, message: string): void {
  ctx.errors.push({ opIndex, path, code, message });
}
function warn(ctx: Ctx, opIndex: number, path: string, code: string, message: string): void {
  ctx.warnings.push({ opIndex, path, code, message });
}

/* ------------------------------------------------------------- name 处理 */

/** 非法 name 净化成合法 CName 素材(可能仍与保留字冲突,由 checkCName 再兜) */
function sanitizeName(raw: string): string {
  let s = raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  s = s.replace(/^[^a-z]+/, '');
  if (s === '') s = 'widget';
  return s.slice(0, 48);
}

/** 净化 + 冲突自动 _2/_3… 后缀;占用 ctx.used */
function resolveName(ctx: Ctx, opIndex: number, path: string, rawName: string): string {
  let base = rawName;
  if (checkCName(base) !== null) {
    base = sanitizeName(base);
    if (checkCName(base) !== null) base = `w_${base}`.slice(0, 48);
    warn(ctx, opIndex, path, 'name-sanitized', `name 非法,已改为 ${base}(原 ${JSON.stringify(rawName)})`);
  }
  let name = base;
  if (ctx.used.has(name)) {
    let n = 2;
    while (ctx.used.has(`${base}_${n}`)) n++;
    name = `${base}_${n}`;
    warn(ctx, opIndex, path, 'name-conflict-renamed', `name 冲突,${base} → ${name}`);
  }
  ctx.used.add(name);
  return name;
}

/* ---------------------------------------------------------- props 校验 */

function validateProps(
  ctx: Ctx, opIndex: number, path: string, type: string,
  props: Record<string, PropValueV2>,
): Record<string, PropValueV2> {
  const known = knownPropsOf(type);
  const kept: Record<string, PropValueV2> = {};
  for (const [key, value] of Object.entries(props)) {
    const spec = known.get(key);
    if (!spec) {
      warn(ctx, opIndex, `${path}.${key}`, 'unknown-prop', `${type} 无属性 ${key},已丢弃`);
      continue;
    }
    let normalized = value;
    if (spec.type === 'pointList' && typeof value === 'string') {
      const coordinates = value.trim().split(/[\s,]+/).map(Number);
      if (coordinates.length >= 2 && coordinates.length % 2 === 0
        && coordinates.every((coordinate) => Number.isFinite(coordinate))) {
        normalized = coordinates;
        warn(ctx, opIndex, `${path}.${key}`, 'point-list-normalized',
          `${key} 已转换为数值坐标数组`);
      }
    }
    const msg = valueMatchesType(normalized, spec);
    if (msg) {
      err(ctx, opIndex, `${path}.${key}`, spec.type === 'enum' ? 'bad-enum' : 'bad-value', `${key}:${msg}`);
      continue;
    }
    kept[key] = normalized;
  }
  return kept;
}

/** selector 宽容校验:非法 state 丢弃该项、非法 part 丢弃 part,均出 warning */
function validateSelector(
  ctx: Ctx, opIndex: number, path: string, sel: Selector | undefined,
): Selector | undefined {
  if (!sel) return undefined;
  const out: Selector = {};
  if (sel.states) {
    const kept = sel.states.filter((s) => {
      const ok = (STATE_TOKENS as readonly string[]).includes(s);
      if (!ok) warn(ctx, opIndex, `${path}.states`, 'unknown-state-token', `未知状态 ${String(s)},已丢弃`);
      return ok;
    });
    if (kept.length > 0) out.states = kept;
  }
  if (sel.part !== undefined) {
    if ((PART_TOKENS as readonly string[]).includes(sel.part)) out.part = sel.part;
    else warn(ctx, opIndex, `${path}.part`, 'unknown-part-token', `未知 part ${String(sel.part)},已丢弃`);
  }
  return out.states || out.part ? out : undefined;
}

function validateInlineStyles(
  ctx: Ctx, opIndex: number, path: string, groups: LocalStyleGroup[],
): LocalStyleGroup[] {
  const out: LocalStyleGroup[] = [];
  groups.forEach((g, i) => {
    const kept: Record<string, PropValueV2> = {};
    for (const [key, value] of Object.entries(g.props ?? {})) {
      const spec = STYLE_PROPS[key];
      if (!spec) {
        warn(ctx, opIndex, `${path}[${i}].props.${key}`, 'unknown-style-prop', `未知样式属性 ${key},已丢弃`);
        continue;
      }
      const msg = valueMatchesType(value, {
        type: spec.type === 'gradRef' ? 'string' : spec.type,
        enum: spec.enum,
      });
      if (msg) {
        err(ctx, opIndex, `${path}[${i}].props.${key}`,
          spec.type === 'enum' ? 'bad-enum' : 'bad-style-value', `${key}:${msg}`);
        continue;
      }
      kept[key] = value;
    }
    const selector = validateSelector(ctx, opIndex, `${path}[${i}].selector`, g.selector);
    out.push({ ...(selector ? { selector } : {}), props: kept });
  });
  return out;
}

function validateBoolKeys(
  ctx: Ctx, opIndex: number, path: string,
  rec: Record<string, boolean>, allowed: readonly string[], kind: string,
): Record<string, boolean> {
  const kept: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(rec)) {
    if (!allowed.includes(key)) {
      warn(ctx, opIndex, `${path}.${key}`, `unknown-${kind}`, `未知 ${kind}:${key},已丢弃`);
      continue;
    }
    kept[key] = value;
  }
  return kept;
}

/* ------------------------------------------------------- NodeSpec → 节点 */

function materialize(
  ctx: Ctx, opIndex: number, path: string, spec: NodeSpec,
  opts: { prefillDefaultSize: boolean },
): WidgetNodeV2 | null {
  const widgetSpec = REGISTRY.get(spec.type);
  if (!widgetSpec) {
    err(ctx, opIndex, `${path}.type`, 'unknown-widget',
      `未知 widget 类型 ${JSON.stringify(spec.type)},可用:${[...REGISTRY.keys()].join('|')}`);
    return null;
  }
  const props = validateProps(ctx, opIndex, `${path}.props`, spec.type, spec.props ?? {});
  // 与编辑器拖放一致:缺 width/height 用 registry defaultSize 预填
  if (opts.prefillDefaultSize && widgetSpec.defaultSize) {
    if (props['width'] === undefined) props['width'] = widgetSpec.defaultSize.w as PropValueV2;
    if (props['height'] === undefined) props['height'] = widgetSpec.defaultSize.h as PropValueV2;
  }
  const node: WidgetNodeV2 = {
    id: newUuid(),
    type: spec.type,
    props,
    styleRefs: [],
    styles: spec.inlineStyles
      ? validateInlineStyles(ctx, opIndex, `${path}.inlineStyles`, spec.inlineStyles)
      : [],
    events: [],
    bindings: [],
    children: [],
  };
  if (spec.name !== undefined) {
    node.codeName = resolveName(ctx, opIndex, `${path}.name`, spec.name);
  }
  if (spec.flags) {
    node.flags = validateBoolKeys(ctx, opIndex, `${path}.flags`, spec.flags, OBJ_BASE.flags, 'flag');
  }
  if (spec.states) {
    node.states = validateBoolKeys(ctx, opIndex, `${path}.states`, spec.states, OBJ_BASE.states, 'state');
  }
  const children = spec.children ?? [];
  if (children.length > 0 && !widgetSpec.acceptsWidgetChildren) {
    warn(ctx, opIndex, `${path}.children`, 'children-not-accepted',
      `${spec.type} 不接受子 widget,children 已丢弃`);
  } else {
    children.forEach((c, i) => {
      const child = materialize(ctx, opIndex, `${path}.children[${i}]`, c, { prefillDefaultSize: true });
      if (child) node.children.push(child);
    });
  }
  return node;
}

/* ------------------------------------------------------------ ops 执行 */

/** 在给定 screen(克隆或 immer draft)上顺序执行 ops;确定性,两次跑结果一致 */
function runOps(screen: ScreenDefV2, ops: AiOp[], errors: AiOpError[], warnings: AiOpWarning[]): void {
  const used = new Set<string>([screen.codeName]);
  collectNames(screen.root, used);
  const ctx: Ctx = { errors, warnings, used };

  ops.forEach((op, i) => {
    const p = `ops[${i}]`;
    switch (op.op) {
      case 'replace_screen': {
        if (op.root.type !== 'obj') {
          err(ctx, i, `${p}.root.type`, 'root-not-obj', "replace_screen 的 root.type 必须为 'obj'");
          return;
        }
        ctx.used.clear();
        ctx.used.add(screen.codeName);
        const root = materialize(ctx, i, `${p}.root`, op.root, { prefillDefaultSize: false });
        if (root) screen.root = root;
        return;
      }
      case 'add': {
        let parent: WidgetNodeV2 | null = screen.root;
        if (op.parent !== null) {
          const hit = findByName(screen.root, null, op.parent);
          if (!hit) {
            err(ctx, i, `${p}.parent`, 'target-not-found', `parent 控件不存在:${op.parent}`);
            return;
          }
          parent = hit.node;
        }
        const parentSpec = REGISTRY.get(parent.type);
        if (parentSpec && !parentSpec.acceptsWidgetChildren) {
          warn(ctx, i, `${p}.parent`, 'children-not-accepted',
            `${parent.type} 通常不接受子 widget(照加,但画布可能不显示)`);
        }
        const node = materialize(ctx, i, `${p}.node`, op.node, { prefillDefaultSize: true });
        if (node) parent.children.push(node);
        return;
      }
      case 'update': {
        const hit = findByName(screen.root, null, op.target);
        if (!hit) {
          err(ctx, i, `${p}.target`, 'target-not-found', `控件不存在:${op.target}`);
          return;
        }
        const node = hit.node;
        if (op.props) {
          const kept = validateProps(ctx, i, `${p}.props`, node.type, op.props);
          Object.assign(node.props, kept);
        }
        if (op.inlineStyles) {
          // 整组替换(模型每次给全量内联样式)
          node.styles = validateInlineStyles(ctx, i, `${p}.inlineStyles`, op.inlineStyles);
        }
        if (op.flags) {
          const kept = validateBoolKeys(ctx, i, `${p}.flags`, op.flags, OBJ_BASE.flags, 'flag');
          node.flags = { ...node.flags, ...kept };
        }
        if (op.states) {
          const kept = validateBoolKeys(ctx, i, `${p}.states`, op.states, OBJ_BASE.states, 'state');
          node.states = { ...node.states, ...kept };
        }
        return;
      }
      case 'remove': {
        const hit = findByName(screen.root, null, op.target);
        if (!hit) {
          err(ctx, i, `${p}.target`, 'target-not-found', `控件不存在:${op.target}`);
          return;
        }
        if (!hit.parent) {
          err(ctx, i, `${p}.target`, 'cannot-remove-root', '不能删除屏幕根节点(可用 replace_screen 重画)');
          return;
        }
        const idx = hit.parent.children.indexOf(hit.node);
        if (idx >= 0) hit.parent.children.splice(idx, 1);
        const freed = new Set<string>();
        collectNames(hit.node, freed);
        for (const n of freed) ctx.used.delete(n);
        return;
      }
    }
  });
}

/* ------------------------------------------------------------------ 入口 */

/**
 * 校验 + 生成 recipe。
 * @param screenId 目标 screen;缺省 = 第一屏(集成方应传 activeScreenId)
 */
export function applyAiOps(
  project: UiProject,
  ops: AiOp[],
  screenId?: string,
): ApplyOpsResult {
  const errors: AiOpError[] = [];
  const warnings: AiOpWarning[] = [];

  const screen = screenId !== undefined
    ? project.screens.find((s) => s.id === screenId)
    : project.screens[0];
  if (!screen) {
    return {
      errors: [{ opIndex: -1, path: 'screen', code: 'screen-not-found', message: `screen 不存在:${screenId ?? '(无)'}` }],
      warnings,
    };
  }
  if (ops.length === 0) {
    return { errors, warnings };   // 纯聊天回合:无 recipe 亦无错误
  }

  // 第一遍:克隆上模拟,收集全部问题
  const sim = structuredClone(screen);
  runOps(sim, ops, errors, warnings);
  if (errors.length > 0) return { errors, warnings };

  // 全绿:recipe 在 draft 上重放同一确定性逻辑(整批 = 一条 undo 历史)
  const sid = screen.id;
  const recipe = (draft: UiProject): void => {
    const s = draft.screens.find((x) => x.id === sid);
    if (!s) return;
    runOps(s, ops, [], []);
  };
  return { recipe, errors, warnings };
}
