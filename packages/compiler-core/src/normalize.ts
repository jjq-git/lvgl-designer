/**
 * normalize:LvProject → IR。
 * pass1 resolveRefs / pass3 eliminateDefaults / pass5 assignNames
 * (pass2 lowerSugar 一期无糖可降;pass4 样式提升已砍,评审 O1)。
 */
import {
  OBJ_BASE, REGISTRY, STYLE_PROPS, checkCName, findChildSpec,
  type Binding, type ChildSpec, type CName, type EventAction, type LvProject,
  type ObjFlagKey, type ObjStateKey, type PropSpec, type PropValue,
  type ScreenDef, type WidgetNode, type WidgetSpec,
} from '@lvd/schema';
import type { Diagnostic } from './diagnostics.js';
import type { IRBinding, IREvent, IRNamedStyle, IRNode, IRProject, IRScreen } from './types.js';

export interface NormalizeResult {
  ir: IRProject;
  diagnostics: Diagnostic[];
}

/** 匿名节点预览名:'_x' + uuid 去连字符前 8 位(跨包契约) */
export function anonPreviewName(id: string): string {
  return `_x${id.replace(/-/g, '').slice(0, 8)}`;
}

interface Ctx {
  diags: Diagnostic[];
  subjectTypes: Map<CName, 'int' | 'float' | 'string' | 'color'>;
  screenIdToName: Map<string, CName>;
  imageNames: Set<CName>;
  usedNames: Set<string>;          // per-screen name 去重域
}

function warn(ctx: Ctx, code: string, message: string, nodeId?: string): void {
  ctx.diags.push({ severity: 'warning', code, message, nodeId });
}
function err(ctx: Ctx, code: string, message: string, nodeId?: string): void {
  ctx.diags.push({ severity: 'error', code, message, nodeId });
}

function scalarEq(a: PropValue, b: PropValue): boolean {
  if (Array.isArray(a) || Array.isArray(b) || typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

/** 收集节点可用 propSpec:objBase(可选)+ createProps + 专有,含 companion 键 */
function knownPropKeys(
  own: readonly PropSpec[],
  createProps: readonly PropSpec[],
  useObjBase: boolean,
): Map<string, PropSpec | 'companion'> {
  const m = new Map<string, PropSpec | 'companion'>();
  const all = useObjBase
    ? [...OBJ_BASE.props, ...createProps, ...own]
    : [...createProps, ...own];
  for (const p of all) {
    m.set(p.key, p);
    for (const c of p.companions ?? []) m.set(c.key, 'companion');
  }
  return m;
}

function resolveStyleName(
  styleId: string,
  screen: ScreenDef,
  project: LvProject,
): CName | undefined {
  const s = screen.styles.find((x) => x.id === styleId) ?? project.styles.find((x) => x.id === styleId);
  return s?.name;
}

/** 父节点上下文:widget 或 结构子元素(tabview-tab 等) */
interface ParentCtx { spec?: WidgetSpec; childSpec?: ChildSpec }

function normalizeNode(
  node: WidgetNode,
  parent: ParentCtx | undefined,
  screen: ScreenDef,
  project: LvProject,
  ctx: Ctx,
  isRoot: boolean,
): IRNode | null {
  // ---- 描述表解析(widget 或父 widget 的 ChildSpec,如 chart-series)
  const spec: WidgetSpec | undefined = REGISTRY.get(node.type);
  const childSpec: ChildSpec | undefined = spec
    ? undefined
    : parent?.spec?.children?.find((c) => c.type === node.type);
  if (!spec && !childSpec) {
    const declared = findChildSpec(node.type);
    if (declared) {
      err(ctx, 'E_ILLEGAL_CHILD',
        `${node.type} 只能作为 ${declared.parent.type} 的子元素`, node.id);
    } else {
      err(ctx, 'E_UNKNOWN_TYPE', `未知 widget 类型:${node.type}`, node.id);
    }
    return null;
  }

  // ---- 普通 widget 放进不收子 widget 的父节点 → error(children 校验)
  if (spec && parent) {
    const accepts = parent.childSpec
      ? parent.childSpec.acceptsWidgetChildren
      : parent.spec!.acceptsWidgetChildren;
    if (!accepts) {
      const parentType = parent.childSpec?.type ?? parent.spec!.type;
      err(ctx, 'E_ILLEGAL_CHILD', `${parentType} 不接受子 widget ${node.type}`, node.id);
      return null;
    }
  }

  const xmlTag = spec ? spec.xmlTag : childSpec!.xmlTag;
  const cCreate = spec ? spec.cCreate : (childSpec!.cCreate ?? '');
  const ownPropSpecs = spec ? spec.props : childSpec!.props;
  const createPropSpecs: readonly PropSpec[] = childSpec?.createProps ?? [];
  const useObjBase = spec ? true : childSpec!.isObj;
  const emitName = spec ? true : childSpec!.isObj;

  // ---- 必填 createProps(无 default 即必填,如 table-cell 的 row/column;
  //      optional 标记除外:缺省 C 发 NULL,如 list-button·win-button icon / menu-page title)
  for (const cp of createPropSpecs) {
    if (!cp.optional && cp.default === undefined && node.props[cp.key] === undefined) {
      err(ctx, 'E_MISSING_CREATE_PROP', `${node.type} 缺少必填属性 ${cp.key}`, node.id);
    }
  }

  // ---- pass5 命名(root 的名字恒为 screen 名;无句柄的结构子元素不可命名)
  let name = '';
  let named = false;
  if (childSpec && !childSpec.isObj && node.name) {
    warn(ctx, 'W_NAME_IGNORED', `${node.type} 无对象句柄,name 被忽略:${node.name}`, node.id);
  }
  if (isRoot) {
    name = screen.name;
    named = true;
  } else if (node.name && emitName) {
    const nameErr = checkCName(node.name);
    if (nameErr) {
      warn(ctx, 'W_BAD_NAME', `节点名非法(${nameErr.code}),按匿名处理:${node.name}`, node.id);
    } else {
      name = node.name;
      if (ctx.usedNames.has(name)) {
        let n = 2;
        while (ctx.usedNames.has(`${name}_${n}`)) n++;
        const renamed = `${name}_${n}`;
        warn(ctx, 'W_DUP_NAME', `screen "${screen.name}" 内重名 "${name}",改为 "${renamed}"`, node.id);
        name = renamed;
      }
      named = true;
    }
  }
  if (named && !isRoot) ctx.usedNames.add(name);

  // ---- pass3 默认值消除 + 未知键剔除
  const known = knownPropKeys(ownPropSpecs, createPropSpecs, useObjBase);
  const props: Record<string, PropValue> = {};
  for (const [k, v] of Object.entries(node.props)) {
    const entry = known.get(k);
    if (entry === undefined) {
      warn(ctx, 'W_UNKNOWN_PROP', `未知属性 ${node.type}.${k},已跳过`, node.id);
      continue;
    }
    if (entry !== 'companion' && entry.default !== undefined && scalarEq(v, entry.default)) {
      continue; // == 默认值,消除
    }
    props[k] = v;
  }

  // ---- flags / states(OBJ_BASE 顺序;非 obj 系子件无)
  const flags: [ObjFlagKey, boolean][] = [];
  const states: [ObjStateKey, boolean][] = [];
  if (useObjBase) {
    for (const f of OBJ_BASE.flags) {
      const v = node.flags?.[f];
      if (v !== undefined) flags.push([f, v]);
    }
    for (const s of OBJ_BASE.states) {
      const v = node.states?.[s];
      if (v !== undefined) states.push([s, v]);
    }
  }

  // ---- 非 obj 系结构子元素(series/cell 等):无对象句柄,
  //      flags/states/样式/事件/绑定全部丢弃并告警
  if (!useObjBase) {
    const extras = Object.keys(node.flags ?? {}).length + Object.keys(node.states ?? {}).length
      + node.styles.length + node.inlineStyles.length
      + node.events.length + node.bindings.length;
    if (extras > 0) {
      warn(ctx, 'W_NON_OBJ_EXTRAS',
        `${node.type} 无对象句柄,flags/states/样式/事件/绑定已忽略`, node.id);
    }
    const children: IRNode[] = [];
    for (const c of node.children) {
      const irc = normalizeNode(c, { spec, childSpec }, screen, project, ctx, false);
      if (irc) children.push(irc);
    }
    return {
      id: node.id, type: node.type, xmlTag, cCreate, ownPropSpecs, createPropSpecs,
      childKind: childSpec!.kind, cHandleType: childSpec!.cHandleType, emitName,
      useObjBase, name: '', named: false,
      previewName: anonPreviewName(node.id),
      props, flags: [], states: [], inlineStyles: [], styleUses: [],
      bindings: [], events: [], cPatch: node.cPatch, children,
    };
  }

  // ---- 内联样式(未知样式键剔除)
  const inlineStyles = node.inlineStyles
    .map((g) => {
      const p: Record<string, PropValue> = {};
      for (const [k, v] of Object.entries(g.props)) {
        if (STYLE_PROPS[k]) p[k] = v;
        else warn(ctx, 'W_UNKNOWN_STYLE_PROP', `未知样式属性 ${k},已跳过`, node.id);
      }
      return { selector: g.selector, props: p };
    })
    .filter((g) => Object.keys(g.props).length > 0);

  // ---- 命名样式引用(styleId → name)
  const styleUses: IRNode['styleUses'] = [];
  for (const u of node.styles) {
    const styleName = resolveStyleName(u.styleId, screen, project);
    if (!styleName) {
      err(ctx, 'E_DANGLING_STYLE', `悬空 styleId:${u.styleId}`, node.id);
      continue;
    }
    styleUses.push({ styleName, selector: u.selector });
  }

  // ---- 绑定
  const bindings: IRBinding[] = [];
  for (const b of node.bindings) {
    const irb = normalizeBinding(b, spec, node, ctx);
    if (irb) bindings.push(irb);
  }

  // ---- 事件
  const events: IREvent[] = [];
  for (const e of node.events) {
    const ire = normalizeEvent(e, node, ctx);
    if (ire) events.push(ire);
  }

  // ---- 子节点
  const children: IRNode[] = [];
  for (const c of node.children) {
    const irc = normalizeNode(c, { spec, childSpec }, screen, project, ctx, false);
    if (irc) children.push(irc);
  }

  return {
    id: node.id, type: node.type, xmlTag, cCreate, ownPropSpecs, createPropSpecs,
    childKind: childSpec?.kind, cHandleType: childSpec?.cHandleType, emitName,
    useObjBase, name, named,
    previewName: named ? name : anonPreviewName(node.id),
    props, flags, states, inlineStyles, styleUses, bindings, events,
    cPatch: node.cPatch, children,
  };
}

function normalizeBinding(
  b: Binding,
  spec: WidgetSpec | undefined,
  node: WidgetNode,
  ctx: Ctx,
): IRBinding | null {
  if (b.kind === 'style') {
    warn(ctx, 'W_UNSUPPORTED_BINDING', 'bind_style 一期不实现,已跳过', node.id);
    return null;
  }
  if (!ctx.subjectTypes.has(b.subject)) {
    err(ctx, 'E_DANGLING_SUBJECT', `绑定引用不存在的 subject:${b.subject}`, node.id);
    return null;
  }
  if (b.kind === 'prop') {
    if (!spec || !spec.bindableProps.includes(b.prop)) {
      err(ctx, 'E_UNBINDABLE_PROP', `${node.type} 不支持 bind_${b.prop}`, node.id);
      return null;
    }
    return { kind: 'prop', prop: b.prop, subject: b.subject, fmt: b.fmt };
  }
  if (b.kind === 'flag') {
    return { kind: 'flag', flag: b.flag, op: b.op, subject: b.subject, refValue: b.refValue };
  }
  return { kind: 'state', state: b.state, op: b.op, subject: b.subject, refValue: b.refValue };
}

function normalizeEvent(e: EventAction, node: WidgetNode, ctx: Ctx): IREvent | null {
  switch (e.kind) {
    case 'callback': {
      if (checkCName(e.callback)) {
        err(ctx, 'E_BAD_CALLBACK_NAME', `回调名非法:${e.callback}`, node.id);
        return null;
      }
      return { kind: 'callback', trigger: e.trigger, callback: e.callback, userData: e.userData };
    }
    case 'subject_set': {
      if (!ctx.subjectTypes.has(e.subject)) {
        err(ctx, 'E_DANGLING_SUBJECT', `事件引用不存在的 subject:${e.subject}`, node.id);
        return null;
      }
      return { kind: 'subject_set', trigger: e.trigger, subject: e.subject, subjectType: e.subjectType, value: e.value };
    }
    case 'subject_toggle': {
      if (!ctx.subjectTypes.has(e.subject)) {
        err(ctx, 'E_DANGLING_SUBJECT', `事件引用不存在的 subject:${e.subject}`, node.id);
        return null;
      }
      return { kind: 'subject_toggle', trigger: e.trigger, subject: e.subject };
    }
    case 'subject_increment': {
      if (!ctx.subjectTypes.has(e.subject)) {
        err(ctx, 'E_DANGLING_SUBJECT', `事件引用不存在的 subject:${e.subject}`, node.id);
        return null;
      }
      return {
        kind: 'subject_increment', trigger: e.trigger, subject: e.subject,
        step: e.step, min: e.min, max: e.max, rollover: e.rollover,
      };
    }
    case 'screen_load':
    case 'screen_create': {
      const screenName = ctx.screenIdToName.get(e.screenId);
      if (!screenName) {
        err(ctx, 'E_DANGLING_SCREEN', `事件引用不存在的 screenId:${e.screenId}`, node.id);
        return null;
      }
      return {
        kind: e.kind, trigger: e.trigger, screenName,
        animType: e.animType, duration: e.duration, delay: e.delay,
      };
    }
  }
}

function normalizeNamedStyles(
  styles: LvProject['styles'],
  ctx: Ctx,
): IRNamedStyle[] {
  return styles.map((s) => {
    const props: Record<string, PropValue> = {};
    for (const [k, v] of Object.entries(s.props)) {
      if (STYLE_PROPS[k]) props[k] = v;
      else warn(ctx, 'W_UNKNOWN_STYLE_PROP', `命名样式 ${s.name} 含未知样式属性 ${k},已跳过`);
    }
    return { name: s.name, props };
  });
}

export function normalizeProject(project: LvProject): NormalizeResult {
  const diags: Diagnostic[] = [];
  const ctx: Ctx = {
    diags,
    subjectTypes: new Map(project.subjects.map((s) => [s.name, s.type])),
    screenIdToName: new Map(project.screens.map((s) => [s.id, s.name])),
    imageNames: new Set(project.assets.images.map((i) => i.name)),
    usedNames: new Set(),
  };

  if (project.components.length > 0) {
    diags.push({
      severity: 'error', code: 'E_COMPONENTS_UNSUPPORTED',
      message: 'components 一期不支持(评审 G7),已忽略',
    });
  }

  const screens: IRScreen[] = [];
  for (const screen of project.screens) {
    ctx.usedNames = new Set([screen.name]);       // name 按 screen 作用域去重;screen 名占位
    const root = normalizeNode(screen.root, undefined, screen, project, ctx, true);
    if (!root) continue;
    screens.push({
      id: screen.id,
      name: screen.name,
      consts: screen.consts,
      styles: normalizeNamedStyles(screen.styles, ctx),
      root,
    });
  }

  const home = project.screens.find((s) => s.isHome) ?? project.screens[0];

  const ir: IRProject = {
    name: project.meta.name,
    display: project.display,
    consts: project.consts,
    styles: normalizeNamedStyles(project.styles, ctx),
    subjects: project.subjects,
    fonts: project.assets.fonts,
    images: project.assets.images,
    screens,
    homeScreenName: home?.name ?? 'main',
    userIncludes: project.codegen.userIncludes,
  };
  return { ir, diagnostics: diags };
}
