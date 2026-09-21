/**
 * XML emitter(仅内存预览通道)。
 * 语法逐条对照 design/03 §2.1 事实表(vendor/lvgl/src/others/xml 实测):
 * - 屏幕文档 <screen><view ...>…</view></screen>
 * - 每节点强制 name(匿名 '_x'+id8);view 不发 name(lv_xml_create_screen 自动以组件名命名根)
 * - 内联样式 style_<prop>[:state...[:part]](':' 分隔,lv_xml_style.c:331-347)
 * - 命名样式挂载 <style name= selector="a|b"/>('|' 分隔);styles="x" 属性已被源码证伪,禁用
 * - 事件/绑定子元素发全注册名 lv_obj-*(lv_xml.c:216-247)
 * - 颜色一律 0xRRGGBB(# 触发 const 解析)
 */
import {
  OBJ_BASE, formatValueForXml,
  type CName, type ConstDef, type InlineStyleGroup, type LvProject,
  type PropSpec, type PropValue, type Selector, type SubjectDef,
} from '@lvd/schema';
import {
  normalizeProject,
  type Diagnostic, type IRNamedStyle, type IRNode, type IRProject,
} from '@lvd/compiler-core';

export interface XmlScreenResult {
  name: CName;
  xml: string;
  lineMap: { line: number; nodeId: string }[];
  previewNameToId: Record<string, string>;
}

export interface XmlEmitResult {
  globalsXml: string;                 // consts/styles/subjects 有内容才非空
  screens: XmlScreenResult[];
  diagnostics: Diagnostic[];
}

/* ---------------------------------------------------------------- writer */

class XmlWriter {
  private lines: string[] = [];
  private depth = 0;

  get nextLine(): number { return this.lines.length + 1; }   // 1-based

  push(text: string): void {
    this.lines.push(`${'    '.repeat(this.depth)}${text}`);
  }
  open(text: string): void { this.push(text); this.depth++; }
  close(text: string): void { this.depth--; this.push(text); }
  toString(): string { return `${this.lines.join('\n')}\n`; }
}

function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/\t/g, '&#9;');
}

function attr(name: string, value: string): string {
  return ` ${name}="${esc(value)}"`;
}

/* ------------------------------------------------------------- selectors */

/** <style selector="pressed|knob">:states 后接 part,default/main 不发 */
function selectorPipe(sel: Selector | undefined): string {
  if (!sel) return '';
  const parts: string[] = [];
  for (const s of sel.states ?? []) if (s !== 'default') parts.push(s);
  if (sel.part && sel.part !== 'main') parts.push(sel.part);
  return parts.join('|');
}

/** style_bg_color:pressed:knob 内联后缀 */
function selectorSuffix(sel: Selector | undefined): string {
  const s = selectorPipe(sel);
  return s ? `:${s.replace(/\|/g, ':')}` : '';
}

/* ----------------------------------------------------------------- 值/属性 */

function fmt(value: PropValue, spec?: PropSpec): string {
  return formatValueForXml(value, spec ? { type: spec.type, enum: spec.enum } : {});
}

function propAttrs(node: IRNode): string {
  // createProps(构造实参)发在开标签最前,其后 obj 基类、专有属性
  const specs = node.useObjBase
    ? [...node.createPropSpecs, ...OBJ_BASE.props, ...node.ownPropSpecs]
    : [...node.createPropSpecs, ...node.ownPropSpecs];
  let out = '';
  for (const spec of specs) {
    if (spec.channel === 'c-only') continue;         // XML 通道跳过
    const v = node.props[spec.key];
    if (v === undefined) continue;
    out += attr(spec.key, fmt(v, spec));
    for (const comp of spec.companions ?? []) {
      const cv = node.props[comp.key];
      if (cv === undefined) continue;
      out += attr(comp.xmlAttr, formatValueForXml(cv, { type: comp.type, enum: comp.enum }));
    }
  }
  return out;
}

function flagStateAttrs(node: IRNode): string {
  let out = '';
  for (const [f, v] of node.flags) out += attr(f, v ? 'true' : 'false');
  for (const [s, v] of node.states) out += attr(s, v ? 'true' : 'false');
  return out;
}

function bindAttrs(node: IRNode): string {
  let out = '';
  for (const b of node.bindings) {
    if (b.kind !== 'prop') continue;
    out += attr(`bind_${b.prop}`, b.subject);
    if (b.prop === 'text' && b.fmt !== undefined) out += attr('bind_text-fmt', b.fmt);
  }
  return out;
}

function inlineStyleAttrs(groups: InlineStyleGroup[]): string {
  let out = '';
  for (const g of groups) {
    const suffix = selectorSuffix(g.selector);
    for (const [k, v] of Object.entries(g.props)) {
      out += attr(`style_${k}${suffix}`, formatValueForXml(v));
    }
  }
  return out;
}

/* ------------------------------------------------------------- 子元素(事件/绑定/样式) */

function specialChildren(node: IRNode, w: XmlWriter): void {
  for (const u of node.styleUses) {
    const sel = selectorPipe(u.selector);
    w.push(`<style${attr('name', u.styleName)}${sel ? attr('selector', sel) : ''}/>`);
  }
  for (const b of node.bindings) {
    if (b.kind === 'flag') {
      w.push(`<lv_obj-bind_flag_if_${b.op}${attr('subject', b.subject)}${attr('flag', b.flag)}${attr('ref_value', String(b.refValue))}/>`);
    } else if (b.kind === 'state') {
      w.push(`<lv_obj-bind_state_if_${b.op}${attr('subject', b.subject)}${attr('state', b.state)}${attr('ref_value', String(b.refValue))}/>`);
    }
  }
  for (const e of node.events) {
    switch (e.kind) {
      case 'callback': {
        let a = attr('trigger', e.trigger) + attr('callback', e.callback);
        if (e.userData !== undefined) a += attr('user_data', e.userData);
        w.push(`<lv_obj-event_cb${a}/>`);
        break;
      }
      case 'subject_set':
        w.push(`<lv_obj-subject_set_${e.subjectType}_event${attr('trigger', e.trigger)}${attr('subject', e.subject)}${attr('value', e.value)}/>`);
        break;
      case 'subject_toggle':
        w.push(`<lv_obj-subject_toggle_event${attr('trigger', e.trigger)}${attr('subject', e.subject)}/>`);
        break;
      case 'subject_increment': {
        let a = attr('trigger', e.trigger) + attr('subject', e.subject);
        if (e.step !== undefined) a += attr('step', String(e.step));
        if (e.min !== undefined) a += attr('min_value', String(e.min));
        if (e.max !== undefined) a += attr('max_value', String(e.max));
        if (e.rollover !== undefined) a += attr('rollover', e.rollover ? 'true' : 'false');
        w.push(`<lv_obj-subject_increment_event${a}/>`);
        break;
      }
      case 'screen_load':
      case 'screen_create': {
        let a = attr('trigger', e.trigger) + attr('screen', e.screenName);
        if (e.animType !== undefined) a += attr('anim_type', e.animType);
        if (e.duration !== undefined) a += attr('duration', String(e.duration));
        if (e.delay !== undefined) a += attr('delay', String(e.delay));
        w.push(`<lv_obj-${e.kind}_event${a}/>`);
        break;
      }
    }
  }
}

function hasSpecialChildren(node: IRNode): boolean {
  return node.styleUses.length > 0
    || node.bindings.some((b) => b.kind !== 'prop')
    || node.events.length > 0;
}

/* --------------------------------------------------------------- 节点树 */

function emitNode(
  node: IRNode,
  w: XmlWriter,
  lineMap: { line: number; nodeId: string }[],
  nameToId: Record<string, string>,
): void {
  lineMap.push({ line: w.nextLine, nodeId: node.id });
  if (node.emitName) nameToId[node.previewName] = node.id;

  // 非 obj 系结构子元素(chart-series/table-cell 等)无对象,不发 name
  const attrs = (node.emitName ? attr('name', node.previewName) : '')
    + propAttrs(node)
    + flagStateAttrs(node)
    + bindAttrs(node)
    + inlineStyleAttrs(node.inlineStyles);

  if (node.children.length === 0 && !hasSpecialChildren(node)) {
    w.push(`<${node.xmlTag}${attrs}/>`);
    return;
  }
  w.open(`<${node.xmlTag}${attrs}>`);
  specialChildren(node, w);
  for (const c of node.children) emitNode(c, w, lineMap, nameToId);
  w.close(`</${node.xmlTag}>`);
}

/* ------------------------------------------------------ consts/styles/subjects */

function emitConsts(consts: ConstDef[], w: XmlWriter): void {
  if (consts.length === 0) return;
  w.open('<consts>');
  for (const c of consts) {
    // percent 型 XML 里等价于 px 数值 + '%',consts 值原样透传(lv_xml_register_const 存字符串)
    const tag = c.type === 'percent' ? 'px' : c.type;
    const value = c.type === 'color' && c.value.startsWith('#') ? `0x${c.value.slice(1)}` : c.value;
    w.push(`<${tag}${attr('name', c.name)}${attr('value', c.type === 'percent' ? `${value}%` : value)}/>`);
  }
  w.close('</consts>');
}

function emitStyles(styles: IRNamedStyle[], w: XmlWriter): void {
  if (styles.length === 0) return;
  w.open('<styles>');
  for (const s of styles) {
    let a = attr('name', s.name);
    for (const [k, v] of Object.entries(s.props)) a += attr(k, formatValueForXml(v));
    w.push(`<style${a}/>`);
  }
  w.close('</styles>');
}

function emitSubjects(subjects: SubjectDef[], w: XmlWriter): void {
  if (subjects.length === 0) return;
  w.open('<subjects>');
  for (const s of subjects) {
    let a = attr('name', s.name);
    if (s.type === 'color') {
      a += attr('value', `0x${s.initial.slice(1)}`);
    } else {
      a += attr('value', String(s.initial));
    }
    if ((s.type === 'int' || s.type === 'float')) {
      if (s.min !== undefined) a += attr('min_value', String(s.min));
      if (s.max !== undefined) a += attr('max_value', String(s.max));
    }
    w.push(`<${s.type}${a}/>`);
  }
  w.close('</subjects>');
}

/* ------------------------------------------------------------------ 入口 */

export function emitXmlFromIr(ir: IRProject, diagnostics: Diagnostic[]): XmlEmitResult {
  // globals.xml:只承载 consts/styles/subjects(ARCHITECTURE §3.5,资产走 bridge 直注册)
  let globalsXml = '';
  if (ir.consts.length > 0 || ir.styles.length > 0 || ir.subjects.length > 0) {
    const gw = new XmlWriter();
    gw.open('<globals>');
    emitConsts(ir.consts, gw);
    emitStyles(ir.styles, gw);
    emitSubjects(ir.subjects, gw);
    gw.close('</globals>');
    globalsXml = gw.toString();
  }

  const screens: XmlScreenResult[] = ir.screens.map((screen) => {
    const w = new XmlWriter();
    const lineMap: { line: number; nodeId: string }[] = [];
    const nameToId: Record<string, string> = {};

    w.open('<screen>');
    emitConsts(screen.consts, w);
    emitStyles(screen.styles, w);

    const root = screen.root;
    // view = screen 根:不发 name(lv_xml_create_screen 以组件名命名根对象);
    // width/height 显式发 display 尺寸(契约)
    lineMap.push({ line: w.nextLine, nodeId: root.id });
    nameToId[screen.name] = root.id;
    const viewAttrs = attr('width', String(ir.display.width))
      + attr('height', String(ir.display.height))
      + propAttrsNoSize(root)
      + flagStateAttrs(root)
      + bindAttrs(root)
      + inlineStyleAttrs(root.inlineStyles);

    if (root.children.length === 0 && !hasSpecialChildren(root)) {
      w.push(`<view${viewAttrs}/>`);
    } else {
      w.open(`<view${viewAttrs}>`);
      specialChildren(root, w);
      for (const c of root.children) emitNode(c, w, lineMap, nameToId);
      w.close('</view>');
    }
    w.close('</screen>');

    return { name: screen.name, xml: w.toString(), lineMap, previewNameToId: nameToId };
  });

  return { globalsXml, screens, diagnostics };
}

/** root 的 width/height 被 display 尺寸取代,其余 props 照发 */
function propAttrsNoSize(root: IRNode): string {
  const stripped: IRNode = {
    ...root,
    props: Object.fromEntries(
      Object.entries(root.props).filter(([k]) => k !== 'width' && k !== 'height'),
    ),
  };
  return propAttrs(stripped);
}

/** 契约入口:emitXml(project) */
export function emitXml(project: LvProject): XmlEmitResult {
  const { ir, diagnostics } = normalizeProject(project);
  return emitXmlFromIr(ir, diagnostics);
}
