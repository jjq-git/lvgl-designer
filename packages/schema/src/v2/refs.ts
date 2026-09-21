/**
 * Schema v2 —— 跨对象引用(方案 §4.1/§4.2)。
 *
 * 形态:`<kind>:<slug>@<revision>`,例如 `display:800x480-rgb565@1`。
 * 引用一律带 revision:Profile 是不可变快照,离线工程包据此避免「外部 Profile 更新后历史构建漂移」。
 *
 * 工程内 Theme 用 fragment 形式寻址:
 *   `ui:ctrl-430-lighting@12#theme:customer-a-dark`
 * 可复用的独立 Theme 使用 `theme:<slug>@<revision>`。BuildTarget 可选择两种
 * 形式之一；fragment 引用必须与 uiProjectRef 一致，独立引用必须锁定 catalog revision。
 */

export type RefKind = 'ui' | 'display' | 'controller' | 'input' | 'firmware' | 'theme';

/** `<kind>:<slug>@<revision>` */
export type Ref<K extends RefKind = RefKind> = `${K}:${string}@${number}`;

export type UiRef = Ref<'ui'>;
export type DisplayRef = Ref<'display'>;
export type ControllerRef = Ref<'controller'>;
export type InputRef = Ref<'input'>;
export type FirmwareRef = Ref<'firmware'>;
export type StandaloneThemeRef = Ref<'theme'>;

/** 工程内 `ui:<slug>@<rev>#theme:<themeId>` 或独立 `theme:<slug>@<revision>` */
export type ThemeRef = `${UiRef}#theme:${string}` | StandaloneThemeRef;

/** slug:小写起头,允许数字、点、连字符、下划线(`800x480-rgb565`、`ctrl-430-a`)。不受 C 标识符约束。 */
export const REF_SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/;

const REF_RE = /^([a-z]+):([a-z0-9][a-z0-9._-]*)@(\d+)$/;

export interface ParsedRef<K extends RefKind = RefKind> {
  kind: K;
  slug: string;
  revision: number;
}

const KINDS: readonly RefKind[] = ['ui', 'display', 'controller', 'input', 'firmware', 'theme'];

/** 解析引用;格式非法返回 null(调用方决定报错还是告警) */
export function parseRef(ref: string): ParsedRef | null {
  const m = REF_RE.exec(ref);
  if (m === null) return null;
  const [, rawKind, slug, rawRev] = m;
  if (rawKind === undefined || slug === undefined || rawRev === undefined) return null;
  const kind = rawKind as RefKind;
  if (!KINDS.includes(kind)) return null;
  const revision = Number(rawRev);
  // 前导零会让 "@01" 与 "@1" 指向同一对象却字面不等 —— 拒绝,保持引用可作 Map key
  if (!Number.isSafeInteger(revision) || revision < 1 || String(revision) !== rawRev) return null;
  return { kind, slug, revision };
}

export function formatRef<K extends RefKind>(kind: K, slug: string, revision: number): Ref<K> {
  return `${kind}:${slug}@${revision}` as Ref<K>;
}

export function isRefOfKind<K extends RefKind>(ref: string, kind: K): ref is Ref<K> {
  const p = parseRef(ref);
  return p !== null && p.kind === kind;
}

export interface ParsedThemeRef {
  ui: UiRef;
  themeId: string;
}

/** 解析 `ui:...@n#theme:xxx`;非法返回 null */
export function parseThemeRef(ref: string): ParsedThemeRef | null {
  const hash = ref.indexOf('#theme:');
  if (hash < 0) return null;
  const uiPart = ref.slice(0, hash);
  const themeId = ref.slice(hash + '#theme:'.length);
  if (!isRefOfKind(uiPart, 'ui') || themeId.length === 0) return null;
  return { ui: uiPart, themeId };
}

export function formatThemeRef(ui: UiRef, themeId: string): ThemeRef {
  return `${ui}#theme:${themeId}`;
}

/** 同一对象的不同版本:slug 相同、revision 不同 */
export function sameObject(a: string, b: string): boolean {
  const pa = parseRef(a);
  const pb = parseRef(b);
  return pa !== null && pb !== null && pa.kind === pb.kind && pa.slug === pb.slug;
}
