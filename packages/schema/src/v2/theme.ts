/**
 * Schema v2 —— Theme Token(方案 §4.6、§5.1)。
 *
 * 核心规则:Token 用**语义 ID**(`color.text.primary`),不受 C 标识符约束。
 * Schema 不应被 C/XML 命名规则反向绑定;C/XML 符号在 Lowering 阶段生成并锁定,写入 manifest。
 *
 * 样式属性引用 token 用显式包装对象 `{ $token: 'color.background' }`,与字面值区分。
 * 引用不存在的 token、或类型不匹配(color token 赋给 radius 类属性)→ 语义校验阶段拒绝,
 * **不做静默回退**。
 */
import type { StylePropType } from '../styleProps.js';
import type { StandaloneThemeRef } from './refs.js';

/** 语义 ID:点分小写段,例如 `color.text.primary`、`radius.control` */
export const TOKEN_ID_RE = /^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/;

/**
 * Token 类型。刻意比 StylePropType 窄:
 * token 是设计语义值,不承载 gradRef/gridTemplate 这类结构化字面量。
 */
export type ThemeTokenType = 'color' | 'px' | 'percent' | 'int' | 'opa' | 'fontRef' | 'imageRef';

export interface ThemeToken {
  id: string;
  type: ThemeTokenType;
  /** color → '#RRGGBB';px/int/opa → number;percent → number(0..100);fontRef/imageRef → 资源 name */
  value: string | number;
  description?: string;
}

export interface ThemeDef {
  /** 工程内唯一;BuildTarget.themeRef 的 fragment 部分引用它 */
  id: string;
  displayName?: string;
  /** 继承另一个同工程 Theme 的 token(浅覆盖);禁止成环 */
  extends?: string;
  tokens: ThemeToken[];
}

/** Owner-scoped reusable Theme stored as an immutable catalog revision. */
export interface ThemeRevision {
  schemaVersion: 1;
  kind: 'lvgl-theme';
  /** `theme:<slug>`; references append `@revision`. */
  id: string;
  revision: number;
  displayName?: string;
  /** Optional immutable parent revision. The build resolver flattens this chain. */
  extends?: StandaloneThemeRef;
  tokens: ThemeToken[];
}

/** 值级 token 引用 */
export type TokenRef = { $token: string };

export function isTokenRef(v: unknown): v is TokenRef {
  return typeof v === 'object' && v !== null
    && Object.keys(v).length === 1
    && typeof (v as TokenRef).$token === 'string';
}

/**
 * token 类型 → 可赋给的样式属性类型。
 * 这张表是「类型匹配」校验的事实源:`color` token 不能赋给 `radius`(size 类)属性。
 */
const TOKEN_ASSIGNABLE: Record<ThemeTokenType, readonly StylePropType[]> = {
  color: ['color'],
  px: ['size', 'int'],
  percent: ['size'],
  int: ['int', 'size'],
  opa: ['opa'],
  fontRef: ['fontRef'],
  imageRef: ['imageRef'],
};

export function tokenAssignableTo(tokenType: ThemeTokenType, propType: StylePropType): boolean {
  return TOKEN_ASSIGNABLE[tokenType].includes(propType);
}

/**
 * 解析 Theme 的有效 token 表(处理 extends 链)。
 * 成环或指向不存在的父 Theme 时返回 null —— 调用方报错,不静默降级。
 */
export function resolveTheme(
  themes: readonly ThemeDef[],
  themeId: string,
): Map<string, ThemeToken> | null {
  const byId = new Map(themes.map((t) => [t.id, t]));
  const chain: ThemeDef[] = [];
  const seen = new Set<string>();
  let cur = byId.get(themeId);
  while (cur !== undefined) {
    if (seen.has(cur.id)) return null;      // 成环
    seen.add(cur.id);
    chain.push(cur);
    const parentId = cur.extends;
    if (parentId === undefined) break;
    const parent = byId.get(parentId);
    if (parent === undefined) return null;  // 父不存在
    cur = parent;
  }
  if (chain.length === 0) return null;
  // 从最远祖先开始铺,子覆盖父
  const out = new Map<string, ThemeToken>();
  for (const t of chain.reverse()) {
    for (const tok of t.tokens) out.set(tok.id, tok);
  }
  return out;
}
