#!/usr/bin/env node
/**
 * audit-parsers.mjs — M0 清单第 10 项:parser 属性对账
 *
 * 扫 vendor/lvgl/src/others/xml/parsers/*.c,对每个 widget 提取:
 *   - apply_cb 里 lv_streq("attr") 的全部属性名(含分支内引用的枚举辅助函数 token 表)
 *   - 枚举辅助函数(*_text_to_enum_value / *_to_enum)的 token → 枚举常量映射
 *   - create_cb 里读取的属性
 *   - lv_xml_obj_parser.c 单列:普通属性 / flags / states / 内联 style_ 前缀 / 事件与绑定子元素
 * 输出 scripts/out/parser-attrs.json 与 scripts/out/parser-attrs.md。
 * 零依赖,node >= 18。
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PARSER_DIR = join(ROOT, 'vendor/lvgl/src/others/xml/parsers');
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');

/* ---------- C 源预处理:剥注释(保留字符串字面量),行号保持 ---------- */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode = 'code'; // code | block | line | str | chr
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && d === '*') { mode = 'block'; i += 2; out += '  '; continue; }
      if (c === '/' && d === '/') { mode = 'line'; i += 2; out += '  '; continue; }
      if (c === '"') { mode = 'str'; out += c; i++; continue; }
      if (c === "'") { mode = 'chr'; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === 'block') {
      if (c === '*' && d === '/') { mode = 'code'; i += 2; out += '  '; continue; }
      out += c === '\n' ? '\n' : ' '; i++; continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += '\n'; i++; continue; }
      out += ' '; i++; continue;
    }
    if (mode === 'str' || mode === 'chr') {
      if (c === '\\') { out += c + (d ?? ''); i += 2; continue; }
      if ((mode === 'str' && c === '"') || (mode === 'chr' && c === "'")) mode = 'code';
      out += c; i++; continue;
    }
  }
  return out;
}

/* ---------- 提取所有函数定义(名字 + 体),简单花括号配平 ---------- */
function extractFunctions(code) {
  const fns = [];
  // 函数头:行首(可缩进)返回类型 + 名 + (…) + { ,排除 if/for/while/switch
  const headRe = /^[ \t]*(?:static[ \t]+)?(?:const[ \t]+)?[A-Za-z_][\w]*(?:[ \t]+[\w]+)*[ \t*]+\**([A-Za-z_]\w*)[ \t]*\(([^;{}]*)\)[ \t]*\r?\n?[ \t]*\{/gm;
  let m;
  while ((m = headRe.exec(code)) !== null) {
    const name = m[1];
    if (['if', 'for', 'while', 'switch', 'return', 'sizeof'].includes(name)) continue;
    const bodyStart = code.indexOf('{', m.index + m[0].length - 1);
    let depth = 0, j = bodyStart;
    for (; j < code.length; j++) {
      if (code[j] === '{') depth++;
      else if (code[j] === '}') { depth--; if (depth === 0) break; }
    }
    fns.push({ name, params: m[2], body: code.slice(bodyStart, j + 1) });
    headRe.lastIndex = j;
  }
  return fns;
}

/* ---------- 从一段代码里取 lv_streq 的字符串实参(另一实参为标识符) ---------- */
function streqLiterals(code, varNames = null) {
  const out = [];
  const re = /lv_streq\s*\(\s*(?:"((?:[^"\\]|\\.)*)"\s*,\s*([A-Za-z_]\w*)|([A-Za-z_]\w*(?:->\w+)*)\s*,\s*"((?:[^"\\]|\\.)*)")\s*\)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const lit = m[1] !== undefined ? m[1] : m[4];
    const ident = m[1] !== undefined ? m[2] : m[3];
    if (varNames && !varNames.includes(ident)) continue;
    out.push({ literal: lit, ident, index: m.index });
  }
  return out;
}

/* ---------- 枚举辅助函数:token → 枚举常量 ---------- */
function parseEnumHelper(fn) {
  // if(lv_streq("tok", txt)) return LV_XXX;  (顺序不定)
  const tokens = [];
  const re = /lv_streq\s*\(\s*(?:"([^"]*)"\s*,\s*[A-Za-z_]\w*|[A-Za-z_]\w*\s*,\s*"([^"]*)")\s*\)\s*\)?\s*(?:\{\s*)?return\s+([^;]+);/g;
  let m;
  while ((m = re.exec(fn.body)) !== null) {
    tokens.push({ token: m[1] ?? m[2], value: m[3].trim() });
  }
  return tokens;
}

/* ---------- apply/create 体按 lv_streq("attr", name) 切分支,记录分支代码 ---------- */
function parseAttrBranches(body, enumHelpers) {
  // 匹配变量通常叫 name;obj 里还有 prop_name(style 宏展开前不可见,单独处理宏)
  const hits = streqLiterals(body).filter(h => /^(name|prop_name)$/.test(h.ident));
  const attrs = [];
  for (let k = 0; k < hits.length; k++) {
    const start = hits[k].index;
    const end = k + 1 < hits.length ? hits[k + 1].index : body.length;
    const branch = body.slice(start, end);
    const attr = { name: hits[k].literal };
    // 分支里调用的枚举辅助函数
    for (const [hn, tokens] of Object.entries(enumHelpers)) {
      if (branch.includes(hn + '(')) {
        attr.enum = tokens.map(t => t.token);
        attr.enumHelper = hn;
      }
    }
    // 记录首个 setter 调用(排除 lv_streq / lv_xml_* 转换器),便于分类
    const setter = branch.match(/\b(lv_(?!streq\b|xml_)\w+)\s*\(/);
    if (setter) attr.call = setter[1];
    // 分支内经 lv_xml_get_value_of(attrs, "X") 读取的伴生属性
    const comps = [...branch.matchAll(/lv_xml_get_value_of\s*\(\s*attrs\s*,\s*"([^"]+)"/g)].map(m => m[1]);
    if (comps.length) attr.companions = [...new Set(comps)];
    attrs.push(attr);
  }
  // 分支之外(函数头部)经 get_value_of 读取的属性,也算 apply 读取的属性
  const firstBranch = hits.length ? hits[0].index : body.length;
  const head = body.slice(0, firstBranch);
  for (const m of head.matchAll(/lv_xml_get_value_of\s*\(\s*attrs\s*,\s*"([^"]+)"/g)) {
    if (!attrs.some(a => a.name === m[1])) attrs.push({ name: m[1], via: 'get_value_of' });
  }
  return attrs;
}

/* ---------- 主扫描 ---------- */
const files = readdirSync(PARSER_DIR).filter(f => f.endsWith('.c')).sort();
const result = { generatedAt: new Date().toISOString(), source: 'vendor/lvgl/src/others/xml/parsers', widgets: {}, obj: null };

for (const file of files) {
  const widget = basename(file, '.c').replace(/^lv_xml_/, '').replace(/_parser$/, '');
  const code = stripComments(readFileSync(join(PARSER_DIR, file), 'utf8'));
  const fns = extractFunctions(code);

  // 1. 枚举辅助函数表
  const enumHelpers = {};
  const enumTables = {};
  for (const fn of fns) {
    if (/(_text_to_enum_value|_to_enum(_value)?)$/.test(fn.name) || /text_to_/.test(fn.name)) {
      const toks = parseEnumHelper(fn);
      if (toks.length) { enumHelpers[fn.name] = toks; enumTables[fn.name] = toks; }
    }
  }

  // 2. create / apply 函数
  const entry = { file: `parsers/${file}`, create: {}, apply: {}, enums: {} };
  for (const [hn, toks] of Object.entries(enumTables)) {
    entry.enums[hn] = Object.fromEntries(toks.map(t => [t.token, t.value]));
  }
  for (const fn of fns) {
    if (fn.name.endsWith('_create')) {
      const attrs = parseAttrBranches(fn.body, enumHelpers).map(a => a.name);
      // create 里 lv_xml_get_value_of / 直接遍历 attrs 读的属性
      const getVal = [...fn.body.matchAll(/lv_xml_get_value_of\s*\(\s*attrs\s*,\s*"([^"]+)"/g)].map(m => m[1]);
      const all = [...new Set([...attrs, ...getVal])];
      if (all.length) entry.create[fn.name] = all;
      else entry.create[fn.name] = [];
    } else if (fn.name.endsWith('_apply')) {
      entry.apply[fn.name] = parseAttrBranches(fn.body, enumHelpers);
    }
  }
  if (widget === 'obj') result.obj = entry;
  else result.widgets[widget] = entry;
}

/* ---------- obj 基类细分:普通属性 / flags / states / bind / 子元素 ---------- */
if (result.obj) {
  const objCode = stripComments(readFileSync(join(PARSER_DIR, 'lv_xml_obj_parser.c'), 'utf8'));
  const obj = result.obj;
  const main = obj.apply['lv_xml_obj_apply'] ?? [];
  const cls = { props: [], flags: [], states: [], bind: [] };
  for (const a of main) {
    if (a.call === 'lv_obj_set_flag') cls.flags.push(a.name);
    else if (a.call === 'lv_obj_set_state') cls.states.push(a.name);
    else if (a.name.startsWith('bind_')) cls.bind.push(a.name);
    else cls.props.push(a.name);
  }
  // 内联 style_ 前缀属性:SET_STYLE_IF(prop, ...) 宏调用
  const styleProps = [...objCode.matchAll(/^\s*(?:else\s+)?SET_STYLE_IF\s*\(\s*(\w+)\s*,/gm)].map(m => 'style_' + m[1]);
  cls.inlineStyleProps = [...new Set(styleProps)];
  // 子元素(事件/绑定/样式):lv_obj_xml_<sub>_apply
  cls.childElements = {};
  for (const [fname, attrs] of Object.entries(obj.apply)) {
    if (fname === 'lv_xml_obj_apply') continue;
    const sub = fname.replace(/^lv_obj_xml_/, '').replace(/_apply$/, '');
    cls.childElements[sub] = attrs.map(a => a.enum ? { name: a.name, enum: a.enum } : a.name);
  }
  obj.classified = cls;
}

/* ---------- 输出 JSON ---------- */
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'parser-attrs.json'), JSON.stringify(result, null, 2) + '\n');

/* ---------- 输出 Markdown ---------- */
const md = [];
md.push('# LVGL 9.4 XML parser 属性对账表', '', `> 由 scripts/audit-parsers.mjs 自动生成于 ${result.generatedAt},源:${result.source}`, '');
md.push('## widget × 属性 × 枚举值', '');
md.push('| widget | apply 函数 | 属性 | 枚举值 |', '|---|---|---|---|');
const fmtName = (a) => a.companions ? `${a.name} (+${a.companions.join(', +')})` : a.name;
for (const [w, e] of Object.entries(result.widgets)) {
  for (const [fname, attrs] of Object.entries(e.apply)) {
    const enumCol = attrs.filter(a => a.enum).map(a => `**${a.name}**: ${a.enum.join(' \\| ')}`).join('<br>') || '—';
    md.push(`| ${w} | \`${fname}\` | ${attrs.map(fmtName).join(', ') || '(无)'} | ${enumCol} |`);
  }
  for (const [fname, attrs] of Object.entries(e.create)) {
    if (attrs.length) md.push(`| ${w} | \`${fname}\` (create) | ${attrs.join(', ')} | — |`);
  }
}
md.push('', '## obj 基类(lv_xml_obj_parser.c)', '');
if (result.obj?.classified) {
  const c = result.obj.classified;
  md.push(`- **普通属性 (${c.props.length})**: ${c.props.join(', ')}`);
  md.push(`- **flags (${c.flags.length})**: ${c.flags.join(', ')}`);
  md.push(`- **states (${c.states.length})**: ${c.states.join(', ')}`);
  md.push(`- **bind (${c.bind.length})**: ${c.bind.join(', ')}`);
  md.push(`- **内联 style_ 属性 (${c.inlineStyleProps.length})**: ${c.inlineStyleProps.join(', ')}`);
  md.push('', '### 子元素(事件/绑定/样式)', '');
  md.push('| 子元素 | 属性 |', '|---|---|');
  for (const [sub, attrs] of Object.entries(c.childElements)) {
    md.push(`| ${sub} | ${attrs.map(a => typeof a === 'string' ? a : `${a.name}(${a.enum.join('\\|')})`).join(', ') || '(无)'} |`);
  }
}
md.push('', '## 枚举 token 表(全部辅助函数)', '');
md.push('| widget | 函数 | token → 枚举 |', '|---|---|---|');
for (const [w, e] of [...Object.entries(result.widgets), ['obj', result.obj]]) {
  for (const [fn, map] of Object.entries(e.enums)) {
    md.push(`| ${w} | \`${fn}\` | ${Object.entries(map).map(([t, v]) => `${t}→${v}`).join('<br>')} |`);
  }
}
md.push('');
writeFileSync(join(OUT_DIR, 'parser-attrs.md'), md.join('\n'));

/* ---------- 控制台摘要 ---------- */
console.log('widget attr counts (main apply, excl. obj-base):');
for (const [w, e] of Object.entries(result.widgets)) {
  const main = Object.entries(e.apply).find(([n]) => n === `lv_xml_${w}_apply`);
  const subs = Object.entries(e.apply).filter(([n]) => n !== `lv_xml_${w}_apply`);
  const line = `${w}: ${main ? main[1].length : 0}` +
    (subs.length ? '  [' + subs.map(([n, a]) => `${n.replace(/^lv_xml_|_apply$/g, '')}:${a.length}`).join(', ') + ']' : '');
  console.log('  ' + line);
}
if (result.obj?.classified) {
  const c = result.obj.classified;
  console.log(`obj: props=${c.props.length} flags=${c.flags.length} states=${c.states.length} bind=${c.bind.length} inlineStyle=${c.inlineStyleProps.length} childElems=${Object.keys(c.childElements).length}`);
}
console.log('wrote scripts/out/parser-attrs.{json,md}');
