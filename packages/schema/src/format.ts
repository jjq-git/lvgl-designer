/**
 * 值格式化(XML emitter / C emitter / L1 热重载共用一份表)。
 * 依据 docs/design/01 §4.4:
 *
 * | JSON            | → XML         | → C                      |
 * |-----------------|---------------|--------------------------|
 * | '#1A2B3C'       | 0x1A2B3C      | lv_color_hex(0x1A2B3C)   |
 * | 'content'       | content       | LV_SIZE_CONTENT          |
 * | '50%'(size)     | 50%           | lv_pct(50)               |
 * | '50%'(opa)      | 50%           | 128(v*255/100 取整)      |
 * | true/false      | "true"/"false"| true/false               |
 * | {$const:'gap'}  | #gap          | UI_CONST_GAP 宏          |
 * | enum token      | token         | cPrefix+TOKEN(cOverride) |
 */
import type { ConstRef, PropValue } from './project.js';
import type { EnumSpec, PropTypeName } from './registryTypes.js';

const COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const PCT_RE = /^(-?\d+)%$/;

export function isConstRef(v: PropValue): v is ConstRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && '$const' in v;
}

export function isColorHex(v: unknown): v is string {
  return typeof v === 'string' && COLOR_RE.test(v);
}

/** const 名 → C 宏名:gap → UI_CONST_GAP */
export function constMacroName(name: string): string {
  return `UI_CONST_${name.toUpperCase()}`;
}

export interface FormatOpts {
  type?: PropTypeName;
  enum?: EnumSpec;
}

/** JSON 值 → XML 属性值字符串(XML 转义由 emitter 负责) */
export function formatValueForXml(value: PropValue, opts: FormatOpts = {}): string {
  if (isConstRef(value)) return `#${value.$const}`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (opts.type === 'stringQuotedList') {
      // buttonmatrix map:'A' 'B' '\n'(换行按钮发字面量 \n,parser:85 特判还原)
      return value
        .map((s) => `'${String(s)
          .replace(/\\/g, '\\\\')
          .replace(/'/g, "\\'")
          .replace(/\n/g, '\\n')}'`)
        .join(' ');
    }
    if (opts.type === 'pointList') {
      // line points:JSON 平铺 [x1,y1,x2,y2,…] → "x1,y1 x2,y2"(对内逗号、对间空格)
      const pairs: string[] = [];
      for (let i = 0; i + 1 < value.length; i += 2) {
        pairs.push(`${String(value[i])},${String(value[i + 1])}`);
      }
      return pairs.join(' ');
    }
    return value.map(String).join(' ');                           // intList / stringList 空格分隔
  }
  // string:
  if (isColorHex(value) && opts.type !== 'string') {
    // '#RRGGBB' 在 XML 属性值里会触发 const 解析,必须转 0x 形式
    return `0x${value.slice(1)}`;
  }
  return value;
}

/** JSON 值 → C 表达式字符串 */
export function formatValueForC(value: PropValue, opts: FormatOpts = {}): string {
  if (isConstRef(value)) return constMacroName(value.$const);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((v) => formatValueForC(v as PropValue, { type: opts.type === 'intList' ? 'int' : opts.type }))
      .join(', ');
  }
  // string 分派
  const t = opts.type;
  if (t === 'enum' || (opts.enum && t !== 'string')) {
    return formatEnumForC(value, opts.enum);
  }
  if (t === 'color' || (t === undefined && isColorHex(value))) {
    return `lv_color_hex(0x${normalizeHex(value)})`;
  }
  if (t === 'size') {
    if (value === 'content') return 'LV_SIZE_CONTENT';
    const m = PCT_RE.exec(value);
    if (m) return `lv_pct(${m[1]})`;
    return value; // 数字以字符串形态存的兜底
  }
  if (t === 'opa') {
    const m = PCT_RE.exec(value);
    if (m) return String(Math.round((Number(m[1]) * 255) / 100));
    return value;
  }
  // 普通字符串 → C 字符串字面量
  return cQuote(value);
}

/** enum token → C 标识符 */
export function formatEnumForC(token: string, spec?: EnumSpec): string {
  if (!spec) return token.toUpperCase();
  const override = spec.cOverride?.[token];
  if (override) return override;
  return `${spec.cPrefix}${token.toUpperCase()}`;
}

function normalizeHex(color: string): string {
  const hex = color.slice(1);
  if (hex.length === 3) {
    // #abc → aabbcc(与 lv_xml_to_color 的 hex3 语义一致)
    return hex.split('').map((c) => c + c).join('');
  }
  return hex;
}

function cQuote(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}
