/**
 * 本地兜底 XML emitter(仅当 @lvd/codegen 尚未提供 emitXml 时由 adapter 启用)。
 *
 * 与契约同形:emitXml(project) → { globalsXml, screens[{name,xml,lineMap,previewNameToId}], diagnostics }。
 * 语法事实照 docs/design/03 §2.1(<screen><view>、style_* 内联、<style> 子元素挂载、
 * bind_*、<lv_obj-event_cb>、颜色一律 0x 字面量、每节点强制 name)。
 */
import {
  OBJ_BASE,
  REGISTRY,
  STYLE_PROPS,
  formatValueForXml,
  previewName,
  type ConstDef,
  type EnumSpec,
  type InlineStyleGroup,
  type LvProject,
  type NamedStyle,
  type PropSpec,
  type PropTypeName,
  type PropValue,
  type ScreenDef,
  type Selector,
  type SubjectDef,
  type WidgetNode,
} from '@lvd/schema';
import type { Diagnostic, EmitXmlResult, XmlScreenOut } from './types';

/* ---------------- 基础工具 ---------------- */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface AttrSpec {
  xmlAttr: string;
  type?: PropTypeName;
  enum?: EnumSpec;
}

/** widget type → (JSON prop key → xml 属性名/类型) 映射(含 OBJ_BASE 与 companions) */
const keyMapCache = new Map<string, Map<string, AttrSpec>>();

export function keyMapFor(type: string): Map<string, AttrSpec> {
  let m = keyMapCache.get(type);
  if (m) return m;
  m = new Map();
  const add = (p: PropSpec): void => {
    m!.set(p.key, { xmlAttr: p.key, type: p.type, enum: p.enum });
    for (const c of p.companions ?? []) {
      m!.set(c.key, { xmlAttr: c.xmlAttr, type: c.type, enum: c.enum });
    }
  };
  for (const p of OBJ_BASE.props) add(p);
  const spec = REGISTRY.get(type);
  if (spec) for (const p of spec.props) if (p.channel === 'both') add(p);
  keyMapCache.set(type, m);
  return m;
}

export function selectorSuffix(sel: Selector | undefined): string {
  if (!sel) return '';
  const toks: string[] = [];
  for (const s of sel.states ?? []) if (s !== 'default') toks.push(s);
  if (sel.part && sel.part !== 'main') toks.push(sel.part);
  return toks.length ? `:${toks.join('|')}` : '';
}

function selectorAttr(sel: Selector | undefined): string {
  const s = selectorSuffix(sel);
  return s ? s.slice(1) : '';
}

export function fmtStyleValue(key: string, v: PropValue): string {
  const sp = STYLE_PROPS[key];
  return formatValueForXml(v, sp ? { type: sp.type as PropTypeName, enum: sp.enum } : {});
}

/* ---------------- 节点 → 属性表 ---------------- */

function nodeAttrs(node: WidgetNode, diagnostics: Diagnostic[]): [string, string][] {
  const km = keyMapFor(node.type);
  const out: [string, string][] = [];
  for (const [key, v] of Object.entries(node.props)) {
    if (v === undefined || v === null) continue;
    const spec = km.get(key);
    if (!spec) {
      diagnostics.push({
        severity: 'warning',
        code: 'W_UNKNOWN_PROP',
        message: `未知属性 ${node.type}.${key},按原名透传`,
        nodeId: node.id,
      });
      out.push([key, formatValueForXml(v)]);
      continue;
    }
    out.push([spec.xmlAttr, formatValueForXml(v, { type: spec.type, enum: spec.enum })]);
  }
  for (const [k, v] of Object.entries(node.flags ?? {})) {
    if (v === undefined) continue;
    out.push([k, v ? 'true' : 'false']);
  }
  for (const [k, v] of Object.entries(node.states ?? {})) {
    if (v === undefined) continue;
    out.push([k, v ? 'true' : 'false']);
  }
  for (const g of node.inlineStyles) {
    const suffix = selectorSuffix(g.selector);
    for (const [key, v] of Object.entries(g.props)) {
      if (v === undefined || v === null) continue;
      out.push([`style_${key}${suffix}`, fmtStyleValue(key, v)]);
    }
  }
  // 绑定(prop 绑定是属性;flag/state/style 绑定是子元素,M1 UI 不做,跳过)
  for (const b of node.bindings) {
    if (b.kind === 'prop') {
      out.push([`bind_${b.prop}`, b.subject]);
      if (b.prop === 'text' && b.fmt) out.push(['bind_text-fmt', b.fmt]);
    }
  }
  return out;
}

/* ---------------- 输出器 ---------------- */

class Writer {
  lines: string[] = [];
  lineMap: { line: number; nodeId: string }[] = [];
  push(indent: number, text: string, nodeId?: string): void {
    this.lines.push('  '.repeat(indent) + text);
    if (nodeId) this.lineMap.push({ line: this.lines.length, nodeId });
  }
  toString(): string {
    return this.lines.join('\n');
  }
}

function attrsToStr(attrs: [string, string][]): string {
  return attrs.map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
}

function styleNameById(project: LvProject, screen: ScreenDef, styleId: string): string | null {
  const all = [...screen.styles, ...project.styles];
  return all.find((s) => s.id === styleId)?.name ?? null;
}

function emitNodeChildrenElems(
  w: Writer,
  node: WidgetNode,
  indent: number,
  project: LvProject,
  screen: ScreenDef,
  diagnostics: Diagnostic[],
  nameToId: Record<string, string>,
): void {
  // 命名样式挂载
  for (const u of node.styles) {
    const nm = styleNameById(project, screen, u.styleId);
    if (!nm) {
      diagnostics.push({
        severity: 'warning',
        code: 'W_DANGLING_STYLE',
        message: `节点引用了不存在的样式 ${u.styleId}`,
        nodeId: node.id,
      });
      continue;
    }
    const sel = selectorAttr(u.selector);
    w.push(indent, `<style name="${esc(nm)}"${sel ? ` selector="${esc(sel)}"` : ''}/>`, node.id);
  }
  // 事件(M1 只发 callback;subject/screen 事件二期 UI)
  for (const ev of node.events) {
    if (ev.kind === 'callback') {
      const ud = ev.userData !== undefined ? ` user_data="${esc(ev.userData)}"` : '';
      w.push(
        indent,
        `<lv_obj-event_cb trigger="${esc(ev.trigger)}" callback="${esc(ev.callback)}"${ud}/>`,
        node.id,
      );
    }
  }
  for (const child of node.children) {
    emitNode(w, child, indent, project, screen, diagnostics, nameToId);
  }
}

function emitNode(
  w: Writer,
  node: WidgetNode,
  indent: number,
  project: LvProject,
  screen: ScreenDef,
  diagnostics: Diagnostic[],
  nameToId: Record<string, string>,
): void {
  const spec = REGISTRY.get(node.type);
  const tag = spec?.xmlTag ?? `lv_${node.type}`;
  const pn = previewName(node);
  nameToId[pn] = node.id;
  const attrs: [string, string][] = [['name', pn], ...nodeAttrs(node, diagnostics)];
  const hasElems =
    node.children.length > 0 || node.styles.length > 0 || node.events.some((e) => e.kind === 'callback');
  if (!hasElems) {
    w.push(indent, `<${tag}${attrsToStr(attrs)}/>`, node.id);
    return;
  }
  w.push(indent, `<${tag}${attrsToStr(attrs)}>`, node.id);
  emitNodeChildrenElems(w, node, indent + 1, project, screen, diagnostics, nameToId);
  w.push(indent, `</${tag}>`);
}

/* ---------------- screen / globals ---------------- */

function emitScreen(project: LvProject, screen: ScreenDef, diagnostics: Diagnostic[]): XmlScreenOut {
  const w = new Writer();
  const nameToId: Record<string, string> = {};
  w.push(0, '<screen>');
  if (screen.styles.length) {
    w.push(1, '<styles>');
    for (const s of screen.styles) w.push(2, styleDefXml(s));
    w.push(1, '</styles>');
  }
  const root = screen.root;
  // 屏对象建成后 name 自动 = 组件名(screen.name),view 不发 name;根节点经 screen.name 反查。
  nameToId[screen.name] = root.id;
  const rootAttrs = nodeAttrs(root, diagnostics);
  const hasElems =
    root.children.length > 0 || root.styles.length > 0 || root.events.some((e) => e.kind === 'callback');
  if (!hasElems) {
    w.push(1, `<view${attrsToStr(rootAttrs)}/>`, root.id);
  } else {
    w.push(1, `<view${attrsToStr(rootAttrs)}>`, root.id);
    emitNodeChildrenElems(w, root, 2, project, screen, diagnostics, nameToId);
    w.push(1, '</view>');
  }
  w.push(0, '</screen>');
  return { name: screen.name, xml: w.toString(), lineMap: w.lineMap, previewNameToId: nameToId };
}

function styleDefXml(s: NamedStyle): string {
  const attrs: [string, string][] = [['name', s.name]];
  for (const [k, v] of Object.entries(s.props)) {
    if (v === undefined || v === null) continue;
    attrs.push([k, fmtStyleValue(k, v)]);
  }
  return `<style${attrsToStr(attrs)}/>`;
}

function constXml(c: ConstDef): string {
  return `<${c.type} name="${esc(c.name)}" value="${esc(c.value)}"/>`;
}

function subjectXml(s: SubjectDef): string {
  const attrs: [string, string][] = [['name', s.name]];
  if (s.type === 'color') {
    attrs.push(['value', formatValueForXml(s.initial, { type: 'color' })]);
  } else {
    attrs.push(['value', String(s.initial)]);
  }
  if ((s.type === 'int' || s.type === 'float') && s.min !== undefined) attrs.push(['min_value', String(s.min)]);
  if ((s.type === 'int' || s.type === 'float') && s.max !== undefined) attrs.push(['max_value', String(s.max)]);
  return `<${s.type}${attrsToStr(attrs)}/>`;
}

function emitGlobals(project: LvProject): string {
  const w = new Writer();
  w.push(0, '<globals>');
  if (project.consts.length) {
    w.push(1, '<consts>');
    for (const c of project.consts) w.push(2, constXml(c));
    w.push(1, '</consts>');
  }
  if (project.styles.length) {
    w.push(1, '<styles>');
    for (const s of project.styles) w.push(2, styleDefXml(s));
    w.push(1, '</styles>');
  }
  if (project.subjects.length) {
    w.push(1, '<subjects>');
    for (const s of project.subjects) w.push(2, subjectXml(s));
    w.push(1, '</subjects>');
  }
  w.push(0, '</globals>');
  return w.toString();
}

/* ---------------- 入口 ---------------- */

export function localEmitXml(project: LvProject): EmitXmlResult {
  const diagnostics: Diagnostic[] = [];
  const screens = project.screens.map((s) => emitScreen(project, s, diagnostics));
  return { globalsXml: emitGlobals(project), screens, diagnostics };
}
