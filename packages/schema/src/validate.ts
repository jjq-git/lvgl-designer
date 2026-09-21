/**
 * 校验:zod 外壳(结构)+ registry 驱动的 props/枚举校验。
 * 未知字段策略:editor、x- 前缀键、registry 不认识的 props 键 → 保留但告警。
 */
import { z } from 'zod';
import type { LvProject, PropValue, ScreenDef, WidgetNode } from './project.js';
import type { ChildSpec, PropSpec, WidgetSpec } from './registryTypes.js';
import { checkCName } from './ids.js';
import { isColorHex, isConstRef } from './format.js';
import { OBJ_BASE, REGISTRY, findChildSpec } from './widgets/index.js';
import { STYLE_PROPS } from './styleProps.js';

/* ------------------------------------------------------------- zod 外壳 */

const zPropValue: z.ZodType<unknown> = z.union([
  z.string(), z.number(), z.boolean(),
  z.array(z.number()), z.array(z.string()),
  z.object({ $const: z.string() }),
]);

const zSelector = z.object({
  states: z.array(z.string()).optional(),
  part: z.string().optional(),
}).optional();

const zWidgetNode: z.ZodType<unknown> = z.lazy(() => z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().optional(),
  displayName: z.string().optional(),
  props: z.record(zPropValue),
  flags: z.record(z.boolean()).optional(),
  states: z.record(z.boolean()).optional(),
  styles: z.array(z.object({ styleId: z.string(), selector: zSelector })),
  inlineStyles: z.array(z.object({ selector: zSelector, props: z.record(zPropValue) })),
  events: z.array(z.object({ kind: z.string(), trigger: z.string() }).passthrough()),
  bindings: z.array(z.object({ kind: z.string(), subject: z.string() }).passthrough()),
  children: z.array(zWidgetNode),
  cPatch: z.object({ post: z.string().optional() }).optional(),
  editor: z.record(z.unknown()).optional(),
}).passthrough());

const zNamedStyle = z.object({
  id: z.string(),
  name: z.string(),
  props: z.record(zPropValue),
});

const zScreen = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string().optional(),
  isHome: z.boolean().optional(),
  styles: z.array(zNamedStyle),
  consts: z.array(z.object({ name: z.string(), type: z.string(), value: z.string() })),
  root: zWidgetNode,
}).passthrough();

const zProject = z.object({
  schemaVersion: z.number().int(),
  meta: z.object({
    name: z.string(),
    lvglVersion: z.literal('9.4'),
    appVersion: z.string(),
    createdAt: z.string(),
    modifiedAt: z.string(),
  }).passthrough(),
  display: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    shape: z.enum(['rect', 'round']),
    colorDepth: z.union([z.literal(16), z.literal(24), z.literal(32)]),
    dpi: z.number().optional(),
  }).passthrough(),
  screens: z.array(zScreen).min(1),
  components: z.array(z.unknown()),
  styles: z.array(zNamedStyle),
  consts: z.array(z.object({
    name: z.string(),
    type: z.enum(['int', 'px', 'color', 'string', 'percent']),
    value: z.string(),
  })),
  subjects: z.array(z.object({ name: z.string(), type: z.string() }).passthrough()),
  assets: z.object({
    fonts: z.array(z.object({ name: z.string() }).passthrough()),
    images: z.array(z.object({ name: z.string() }).passthrough()),
  }),
  translations: z.union([
    z.null(),
    z.object({ languages: z.array(z.string()), entries: z.array(z.unknown()) }),
  ]),
  codegen: z.object({
    outputDirName: z.string(),
    exportXml: z.boolean(),
    userIncludes: z.array(z.string()),
  }).passthrough(),
  editor: z.record(z.unknown()).optional(),
}).passthrough();

/* --------------------------------------------------------------- 结果类型 */

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/* --------------------------------------------------------------- 值检查 */

const PCT_RE = /^-?\d+%$/;

function valueMatchesType(v: PropValue, spec: Pick<PropSpec, 'type' | 'enum' | 'min' | 'max'>): string | null {
  if (isConstRef(v)) return null;   // const 引用在任何值位都合法,存在性另查
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
    case 'pointList': {
      if (!Array.isArray(v) || !v.every((x) => typeof x === 'number')) return '应为数值数组(x1,y1,x2,y2,…)';
      return v.length % 2 === 0 ? null : '坐标数组长度应为偶数(x/y 成对)';
    }
    case 'stringList':
    case 'stringQuotedList':
      return Array.isArray(v) && v.every((x) => typeof x === 'string') ? null : '应为字符串数组';
    case 'orFlags': {
      if (typeof v !== 'string') return '应为字符串(空格分组,组内 | 位或)';
      if (spec.enum) {
        const bad = v.split(/[\s|]+/).filter(Boolean).find((t) => !spec.enum!.tokens.includes(t));
        if (bad) return `非法 token "${bad}",可选:${spec.enum.tokens.join('|')}`;
      }
      return null;
    }
    default:
      // string / imageRef / fontRef / styleRef / subject / orFlags / gridTemplate
      return typeof v === 'string' ? null : '应为字符串';
  }
}

/* ------------------------------------------------------------- 树级校验 */

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

function validateInlineStyleProps(
  ctx: Ctx, path: string, props: Record<string, PropValue>,
): void {
  for (const [key, value] of Object.entries(props)) {
    const spec = STYLE_PROPS[key];
    if (!spec) {
      warn(ctx, `${path}.${key}`, 'unknown-style-prop', `未知样式属性 ${key}(保留但不生效)`);
      continue;
    }
    const msg = valueMatchesType(value, {
      type: spec.type === 'gradRef' ? 'string' : spec.type,
      enum: spec.enum,
    });
    if (msg) err(ctx, `${path}.${key}`, 'bad-style-value', `${key}:${msg}`);
  }
}

/** 父节点上下文:widget 或 结构子元素(tabview-tab 等) */
interface ParentCtx { spec?: WidgetSpec; childSpec?: ChildSpec }

function validateNode(
  ctx: Ctx,
  node: WidgetNode,
  path: string,
  screenNames: Set<string>,
  styleIds: Set<string>,
  parent?: ParentCtx,
): void {
  if (node.cPatch?.post !== undefined) {
    err(ctx, `${path}.cPatch`, 'cpatch-forbidden',
      '普通工程禁止 cPatch；任意 C 必须进独立 trusted extension manifest');
  }

  // ---- 类型解析:widget 或 父 widget 声明的结构子元素
  const spec = REGISTRY.get(node.type);
  const childSpec = spec ? undefined : parent?.spec?.children?.find((c) => c.type === node.type);
  if (!spec && !childSpec) {
    const declared = findChildSpec(node.type);
    if (declared) {
      err(ctx, path, 'illegal-child',
        `${node.type} 只能作为 ${declared.parent.type} 的子元素`);
    } else {
      err(ctx, path, 'unknown-widget', `未知 widget 类型 ${node.type}`);
    }
    return;
  }

  // ---- 普通 widget 放进不收子 widget 的父节点 → error
  if (spec && parent) {
    const accepts = parent.childSpec
      ? parent.childSpec.acceptsWidgetChildren
      : parent.spec!.acceptsWidgetChildren;
    if (!accepts) {
      const parentType = parent.childSpec?.type ?? parent.spec!.type;
      err(ctx, `${path}`, 'illegal-child', `${parentType} 不接受子 widget ${node.type}`);
      return;
    }
  }

  const isObjLike = spec !== undefined || childSpec!.isObj;

  // name:合法性 + screen 内唯一(非 obj 系结构子元素无对象,不可命名)
  if (node.name !== undefined) {
    if (!isObjLike) {
      warn(ctx, `${path}.name`, 'name-ignored', `${node.type} 无对象句柄,name 被忽略`);
    } else {
      const nameErr = checkCName(node.name);
      if (nameErr) err(ctx, `${path}.name`, `name-${nameErr.code}`, nameErr.message);
      else if (screenNames.has(node.name)) {
        err(ctx, `${path}.name`, 'name-duplicate', `name 在 screen 内重复:${node.name}`);
      } else {
        screenNames.add(node.name);
      }
    }
  }

  // props:(obj 基类,如适用)∪ 专有 ∪ createProps ∪ 伴生键
  const own: PropSpec[] = spec
    ? [...spec.props]
    : [...(childSpec!.createProps ?? []), ...childSpec!.props];
  const known = new Map<string, PropSpec>();
  for (const p of isObjLike ? [...OBJ_BASE.props, ...own] : own) {
    known.set(p.key, p);
    for (const c of p.companions ?? []) {
      known.set(c.key, {
        key: c.key, type: c.type, enum: c.enum, channel: 'both',
        c: { setter: '' }, ui: { group: 'value', label: c.key, control: 'text' },
      });
    }
  }
  for (const [key, value] of Object.entries(node.props)) {
    if (key.startsWith('x-')) continue;                    // 扩展键保留
    const propSpec = known.get(key);
    if (!propSpec) {
      warn(ctx, `${path}.props.${key}`, 'unknown-prop', `${node.type} 无属性 ${key}(保留但告警)`);
      continue;
    }
    const msg = valueMatchesType(value, propSpec);
    if (msg) err(ctx, `${path}.props.${key}`, 'bad-value', `${key}:${msg}`);
  }

  // 必填 createProps(无 default 且非 optional 即必填,如 table-cell 的 row/column)
  for (const cp of childSpec?.createProps ?? []) {
    if (cp.default === undefined && !cp.optional && node.props[cp.key] === undefined) {
      err(ctx, `${path}.props.${cp.key}`, 'missing-create-prop',
        `${node.type} 缺少必填属性 ${cp.key}`);
    }
  }

  // flags / states 键合法性(非 obj 系无)
  if (!isObjLike && (Object.keys(node.flags ?? {}).length > 0
    || Object.keys(node.states ?? {}).length > 0
    || node.styles.length > 0 || node.inlineStyles.length > 0
    || node.events.length > 0 || node.bindings.length > 0)) {
    warn(ctx, path, 'non-obj-extras', `${node.type} 无对象句柄,flags/states/样式/事件/绑定不生效`);
  }
  for (const key of Object.keys(node.flags ?? {})) {
    if (!(OBJ_BASE.flags as readonly string[]).includes(key)) {
      err(ctx, `${path}.flags.${key}`, 'unknown-flag', `未知 flag:${key}`);
    }
  }
  for (const key of Object.keys(node.states ?? {})) {
    if (!(OBJ_BASE.states as readonly string[]).includes(key)) {
      err(ctx, `${path}.states.${key}`, 'unknown-state', `未知 state:${key}`);
    }
  }

  // 命名样式引用存在性
  node.styles.forEach((u, i) => {
    if (!styleIds.has(u.styleId)) {
      err(ctx, `${path}.styles[${i}]`, 'dangling-style', `styleId 不存在:${u.styleId}`);
    }
  });

  // 内联样式
  node.inlineStyles.forEach((g, i) => {
    validateInlineStyleProps(ctx, `${path}.inlineStyles[${i}].props`, g.props);
  });

  // 子树
  node.children.forEach((c, i) => {
    validateNode(ctx, c, `${path}.children[${i}]`, screenNames, styleIds, { spec, childSpec });
  });
}

function validateScreen(ctx: Ctx, screen: ScreenDef, path: string, globalStyleIds: Set<string>): void {
  const nameErr = checkCName(screen.name);
  if (nameErr) err(ctx, `${path}.name`, `name-${nameErr.code}`, nameErr.message);
  if (screen.root.type !== 'obj') {
    err(ctx, `${path}.root`, 'root-not-obj', 'screen 根节点 type 必须为 obj');
  }
  const styleIds = new Set(globalStyleIds);
  for (const s of screen.styles) styleIds.add(s.id);
  for (const s of screen.styles) {
    validateInlineStyleProps(ctx, `${path}.styles(${s.name}).props`, s.props);
  }
  const screenNames = new Set<string>();
  validateNode(ctx, screen.root, `${path}.root`, screenNames, styleIds);
}

/* ---------------------------------------------------------------- 入口 */

export function validateProject(doc: unknown): ValidationResult {
  const ctx: Ctx = { errors: [], warnings: [] };

  const shell = zProject.safeParse(doc);
  if (!shell.success) {
    for (const issue of shell.error.issues) {
      err(ctx, issue.path.join('.'), 'shape', issue.message);
    }
    return { valid: false, errors: ctx.errors, warnings: ctx.warnings };
  }

  const project = doc as LvProject;

  // 一期:components 非空即拒绝(评审 G7)
  if (project.components.length > 0) {
    err(ctx, 'components', 'components-not-supported', '一期不支持自定义 component(必须为空数组)');
  }

  // 全局符号共用一个去重域:screen/style/const/subject/asset 名
  const globalNames = new Map<string, string>();
  const claim = (name: string, kind: string, path: string) => {
    const nameErr = checkCName(name);
    if (nameErr) err(ctx, path, `name-${nameErr.code}`, nameErr.message);
    const prev = globalNames.get(name);
    if (prev) err(ctx, path, 'global-name-duplicate', `全局名冲突:${name}(已被 ${prev} 占用)`);
    else globalNames.set(name, kind);
  };
  project.screens.forEach((s, i) => claim(s.name, 'screen', `screens[${i}].name`));
  project.styles.forEach((s, i) => claim(s.name, 'style', `styles[${i}].name`));
  project.consts.forEach((c, i) => claim(c.name, 'const', `consts[${i}].name`));
  project.subjects.forEach((s, i) => claim(s.name, 'subject', `subjects[${i}].name`));
  project.assets.fonts.forEach((f, i) => claim(f.name, 'font', `assets.fonts[${i}].name`));
  project.assets.images.forEach((im, i) => claim(im.name, 'image', `assets.images[${i}].name`));

  // 全局命名样式属性
  const globalStyleIds = new Set<string>();
  for (const s of project.styles) {
    globalStyleIds.add(s.id);
    validateInlineStyleProps(ctx, `styles(${s.name}).props`, s.props);
  }

  // 逐屏
  project.screens.forEach((s, i) => validateScreen(ctx, s, `screens[${i}]`, globalStyleIds));

  return { valid: ctx.errors.length === 0, errors: ctx.errors, warnings: ctx.warnings };
}
