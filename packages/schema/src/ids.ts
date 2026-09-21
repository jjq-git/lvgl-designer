/**
 * ID / 命名策略。依据 docs/design/01 §5 与 ARCHITECTURE §3.1。
 */
import type { CName, Uuid, WidgetNode } from './project.js';

export function newUuid(): Uuid {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 兜底(非加密场景够用)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const CNAME_RE = /^[a-z][a-z0-9_]*$/;
export const CNAME_MAX_LEN = 63;

/** C 关键字黑名单 */
const C_KEYWORDS = new Set([
  'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do',
  'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if',
  'inline', 'int', 'long', 'register', 'restrict', 'return', 'short',
  'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union',
  'unsigned', 'void', 'volatile', 'while',
]);

/** 保留前缀:与生成代码/LVGL 符号冲突 */
const RESERVED_PREFIXES = ['lv_', 'ui_'];

export interface CNameError { code: 'pattern' | 'length' | 'keyword' | 'reserved_prefix'; message: string }

/** 返回 null 表示合法 */
export function checkCName(name: string): CNameError | null {
  if (!CNAME_RE.test(name)) {
    return { code: 'pattern', message: `名称必须匹配 /^[a-z][a-z0-9_]*$/:${JSON.stringify(name)}` };
  }
  if (name.length > CNAME_MAX_LEN) {
    return { code: 'length', message: `名称超长(>${CNAME_MAX_LEN}):${name}` };
  }
  if (C_KEYWORDS.has(name)) {
    return { code: 'keyword', message: `名称是 C 关键字:${name}` };
  }
  for (const p of RESERVED_PREFIXES) {
    if (name.startsWith(p)) {
      return { code: 'reserved_prefix', message: `名称不得以 ${p} 开头:${name}` };
    }
  }
  return null;
}

export function isValidCName(name: string): name is CName {
  return checkCName(name) === null;
}

/**
 * 自动命名:<type>_<n>,n 为 screen 内同类型计数(取最小可用序号)。
 * existingNames 传入该 screen 内已占用的全部 name。
 */
export function autoName(type: string, existingNames: Iterable<string>): CName {
  const used = existingNames instanceof Set ? existingNames : new Set(existingNames);
  const base = type.replace(/-/g, '_');
  let n = 1;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/**
 * 预览通道强制 name:有用户名用之,匿名节点发 '_x' + uuid 去连字符前 8 位。
 * (ARCHITECTURE §3.1 / @lvd/codegen 契约)
 */
export function previewName(node: Pick<WidgetNode, 'id' | 'name'>): string {
  return node.name ?? `_x${node.id.replace(/-/g, '').slice(0, 8)}`;
}
