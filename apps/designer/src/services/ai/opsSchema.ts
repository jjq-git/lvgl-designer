/**
 * AI ops 协议:类型 + 宽容解析(剥 markdown 围栏)+ 结构校验。
 *
 * 模型输出契约(不得私改):
 *   { reply: string; ops: AiOp[] }
 *   AiOp = replace_screen | add | update | remove
 *   NodeSpec = 简化版 WidgetNode(无 id,应用时生成 uuid)
 *
 * 注:zod 在 workspace 里只是 @lvd/schema 的依赖,@lvd/designer 未声明依赖、
 * pnpm 严格 node_modules 下解析不到;本轮"只许新建文件"不能改 package.json,
 * 故此处结构校验手写(接口与 zod safeParse 等价,后续可无痛换 zod)。
 */
import type { InlineStyleGroup, PropValue } from '@lvd/schema';

/* ------------------------------------------------------------------ 类型 */

/** 简化版 WidgetNode:无 id/styles/events/bindings,应用时补全 */
export interface NodeSpec {
  type: string;
  name?: string;
  props?: Record<string, PropValue>;
  inlineStyles?: InlineStyleGroup[];
  flags?: Record<string, boolean>;
  states?: Record<string, boolean>;
  children?: NodeSpec[];
}

export type AiOp =
  | { op: 'replace_screen'; root: NodeSpec }
  | { op: 'add'; parent: string | null; node: NodeSpec }   // parent=控件name,null=屏根
  | {
      op: 'update';
      target: string;
      props?: Record<string, PropValue>;
      inlineStyles?: InlineStyleGroup[];
      flags?: Record<string, boolean>;
      states?: Record<string, boolean>;
    }
  | { op: 'remove'; target: string };

export interface DsAiReply {
  reply: string;
  ops: AiOp[];
}

export interface ParseResult {
  data?: DsAiReply;
  /** 非空 = 解析失败,可整体喂回模型修复 */
  errors: string[];
}

/* ---------------------------------------------------------- 围栏/杂质剥离 */

/**
 * 宽容提取 JSON 文本:
 * 1. 整体就是 JSON → 原样;
 * 2. ```json ... ``` 围栏(前后可带闲话)→ 取围栏内;
 * 3. 兜底:取第一个 '{' 到最后一个 '}' 的子串。
 */
export function extractJsonText(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('{')) return s;
  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(s);
  if (fence?.[1]) return fence[1].trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) return s.slice(a, b + 1);
  return s;
}

/* ------------------------------------------------------------ 结构校验 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isScalarPropValue(v: unknown): boolean {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return true;
  if (Array.isArray(v)) {
    return v.every((x) => typeof x === 'number') || v.every((x) => typeof x === 'string');
  }
  if (isRecord(v) && typeof v['$const'] === 'string') return true;
  return false;
}

function checkPropsRecord(v: unknown, path: string, errors: string[]): Record<string, PropValue> | undefined {
  if (v === undefined) return undefined;
  if (!isRecord(v)) {
    errors.push(`${path}:应为对象(键→值)`);
    return undefined;
  }
  for (const [k, val] of Object.entries(v)) {
    if (!isScalarPropValue(val)) {
      errors.push(`${path}.${k}:值只能是 string/number/boolean/数组/{$const}`);
    }
  }
  return v as Record<string, PropValue>;
}

function checkBoolRecord(v: unknown, path: string, errors: string[]): Record<string, boolean> | undefined {
  if (v === undefined) return undefined;
  if (!isRecord(v)) {
    errors.push(`${path}:应为对象(键→boolean)`);
    return undefined;
  }
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== 'boolean') errors.push(`${path}.${k}:应为 boolean`);
  }
  return v as Record<string, boolean>;
}

function checkInlineStyles(v: unknown, path: string, errors: string[]): InlineStyleGroup[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    errors.push(`${path}:应为数组 [{selector?, props}]`);
    return undefined;
  }
  const out: InlineStyleGroup[] = [];
  v.forEach((g, i) => {
    if (!isRecord(g)) {
      errors.push(`${path}[${i}]:应为对象 {selector?, props}`);
      return;
    }
    const props = checkPropsRecord(g['props'], `${path}[${i}].props`, errors) ?? {};
    let selector: InlineStyleGroup['selector'];
    const sel = g['selector'];
    if (sel !== undefined) {
      if (!isRecord(sel)) {
        errors.push(`${path}[${i}].selector:应为对象 {states?:string[], part?:string}`);
      } else {
        selector = sel as InlineStyleGroup['selector'];
      }
    }
    out.push({ selector, props });
  });
  return out;
}

const MAX_NODE_DEPTH = 16;

function checkNodeSpec(v: unknown, path: string, errors: string[], depth = 0): NodeSpec | undefined {
  if (depth > MAX_NODE_DEPTH) {
    errors.push(`${path}:节点嵌套过深(>${MAX_NODE_DEPTH})`);
    return undefined;
  }
  if (!isRecord(v)) {
    errors.push(`${path}:应为节点对象 {type, ...}`);
    return undefined;
  }
  const before = errors.length;
  const type = v['type'];
  if (typeof type !== 'string' || type === '') {
    errors.push(`${path}.type:必填,应为 widget 类型字符串`);
  }
  const name = v['name'];
  if (name !== undefined && typeof name !== 'string') {
    errors.push(`${path}.name:应为字符串`);
  }
  const props = checkPropsRecord(v['props'], `${path}.props`, errors);
  const flags = checkBoolRecord(v['flags'], `${path}.flags`, errors);
  const states = checkBoolRecord(v['states'], `${path}.states`, errors);
  const inlineStyles = checkInlineStyles(v['inlineStyles'], `${path}.inlineStyles`, errors);
  let children: NodeSpec[] | undefined;
  const rawChildren = v['children'];
  if (rawChildren !== undefined) {
    if (!Array.isArray(rawChildren)) {
      errors.push(`${path}.children:应为节点数组`);
    } else {
      children = [];
      rawChildren.forEach((c, i) => {
        const child = checkNodeSpec(c, `${path}.children[${i}]`, errors, depth + 1);
        if (child) children!.push(child);
      });
    }
  }
  if (errors.length > before) return undefined;
  return {
    type: type as string,
    ...(name !== undefined ? { name: name as string } : {}),
    ...(props !== undefined ? { props } : {}),
    ...(inlineStyles !== undefined ? { inlineStyles } : {}),
    ...(flags !== undefined ? { flags } : {}),
    ...(states !== undefined ? { states } : {}),
    ...(children !== undefined ? { children } : {}),
  };
}

const OP_KINDS = ['replace_screen', 'add', 'update', 'remove'] as const;

function checkOp(v: unknown, path: string, errors: string[]): AiOp | undefined {
  if (!isRecord(v)) {
    errors.push(`${path}:应为操作对象 {op, ...}`);
    return undefined;
  }
  const op = v['op'];
  if (typeof op !== 'string' || !(OP_KINDS as readonly string[]).includes(op)) {
    errors.push(`${path}.op:必须是 ${OP_KINDS.join('|')} 之一,得到 ${JSON.stringify(op)}`);
    return undefined;
  }
  const before = errors.length;
  switch (op) {
    case 'replace_screen': {
      const root = checkNodeSpec(v['root'], `${path}.root`, errors);
      if (errors.length > before || !root) return undefined;
      return { op: 'replace_screen', root };
    }
    case 'add': {
      const parent = v['parent'];
      // 宽容:缺省 parent 视为 null(屏根)
      if (parent !== undefined && parent !== null && typeof parent !== 'string') {
        errors.push(`${path}.parent:应为控件 name 字符串或 null(屏根)`);
      }
      const node = checkNodeSpec(v['node'], `${path}.node`, errors);
      if (errors.length > before || !node) return undefined;
      return { op: 'add', parent: (parent ?? null) as string | null, node };
    }
    case 'update': {
      const target = v['target'];
      if (typeof target !== 'string' || target === '') {
        errors.push(`${path}.target:必填,应为控件 name`);
      }
      const props = checkPropsRecord(v['props'], `${path}.props`, errors);
      const flags = checkBoolRecord(v['flags'], `${path}.flags`, errors);
      const states = checkBoolRecord(v['states'], `${path}.states`, errors);
      const inlineStyles = checkInlineStyles(v['inlineStyles'], `${path}.inlineStyles`, errors);
      if (errors.length > before) return undefined;
      return {
        op: 'update',
        target: target as string,
        ...(props !== undefined ? { props } : {}),
        ...(inlineStyles !== undefined ? { inlineStyles } : {}),
        ...(flags !== undefined ? { flags } : {}),
        ...(states !== undefined ? { states } : {}),
      };
    }
    case 'remove': {
      const target = v['target'];
      if (typeof target !== 'string' || target === '') {
        errors.push(`${path}.target:必填,应为控件 name`);
        return undefined;
      }
      return { op: 'remove', target };
    }
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ 入口 */

/**
 * 宽容解析模型输出:剥围栏 → JSON.parse → 结构校验。
 * errors 非空则 data 为 undefined。
 */
export function parseAiReply(raw: string): ParseResult {
  const errors: string[] = [];
  const text = extractJsonText(raw);
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { errors: [`JSON 解析失败:${e instanceof Error ? e.message : String(e)}`] };
  }
  if (!isRecord(doc)) {
    return { errors: ['顶层必须是 JSON 对象 {reply, ops}'] };
  }
  const rawReply = doc['reply'];
  if (rawReply !== undefined && typeof rawReply !== 'string') {
    errors.push('reply:应为字符串');
  }
  const reply = typeof rawReply === 'string' ? rawReply : '';

  const rawOps = doc['ops'];
  const ops: AiOp[] = [];
  if (rawOps === undefined) {
    // 宽容:没有 ops 视为纯聊天回复
  } else if (!Array.isArray(rawOps)) {
    errors.push('ops:应为操作数组');
  } else {
    rawOps.forEach((o, i) => {
      const op = checkOp(o, `ops[${i}]`, errors);
      if (op) ops.push(op);
    });
  }
  if (errors.length > 0) return { errors };
  return { data: { reply, ops }, errors: [] };
}
