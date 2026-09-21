/** Deterministic font conversion used by the trusted build worker. */

export const PKG_NAME = '@lvd/asset-pipeline';

export interface FontConversionOptions {
  codeName: string;
  sizePx: number;
  bpp?: 1 | 2 | 4 | 8;
  ranges?: string;
  symbols?: string;
}

export interface ConvertedFont {
  cSource: string;
  glyphCount: number;
  requestedGlyphCount: number;
  missingCodePoints: number[];
  ranges: number[];
}

const CODE_NAME = /^[a-z][a-z0-9_]*$/;
const MAX_GLYPHS = 8192;
const TEXT_KEYS = new Set([
  'text', 'texts', 'title', 'label', 'message', 'placeholder_text',
  'options', 'map', 'prefix', 'suffix',
]);

/** Collect user-visible Unicode symbols without pulling IDs or code names. */
export function collectProjectTextSymbols(project: unknown): string {
  const points = new Set<number>();
  const add = (text: string): void => {
    for (const symbol of text.normalize('NFC')) {
      const point = symbol.codePointAt(0);
      if (point !== undefined && point >= 0x20) points.add(point);
    }
  };
  const visit = (value: unknown, key = ''): void => {
    if (typeof value === 'string') {
      if (TEXT_KEYS.has(key)) add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child, key);
      return;
    }
    if (value && typeof value === 'object') {
      const inheritText = TEXT_KEYS.has(key);
      for (const [childKey, child] of Object.entries(value)) visit(child, inheritText ? key : childKey);
    }
  };
  visit(project);
  return [...points].sort((a, b) => a - b).map((point) => String.fromCodePoint(point)).join('');
}

function textSymbols(value: unknown): Set<number> {
  const points = new Set<number>();
  const visit = (current: unknown, key = ''): void => {
    if (typeof current === 'string') {
      if (TEXT_KEYS.has(key)) {
        for (const symbol of current.normalize('NFC')) {
          const point = symbol.codePointAt(0);
          if (point !== undefined && point >= 0x20) points.add(point);
        }
      }
      return;
    }
    if (Array.isArray(current)) {
      for (const child of current) visit(child, key);
      return;
    }
    if (current && typeof current === 'object') {
      const inheritText = TEXT_KEYS.has(key);
      for (const [childKey, child] of Object.entries(current)) visit(child, inheritText ? key : childKey);
    }
  };
  visit(value);
  return points;
}

function orderedSymbols(points: Iterable<number>): string {
  return [...new Set(points)].sort((a, b) => a - b).map((point) => String.fromCodePoint(point)).join('');
}

/**
 * Collect text per custom font reference. Text follows the effective text_font
 * on each widget (global/screen named styles, local styles, and inheritance).
 * Translation alternatives are added only to fonts that are actually used.
 */
export function collectProjectTextSymbolsByFont(project: unknown): Record<string, string> {
  if (!project || typeof project !== 'object') return {};
  const root = project as Record<string, unknown>;
  const themes = Array.isArray(root.themes) ? root.themes : [];
  const fontTokens = new Map<string, string>();
  for (const theme of themes) {
    if (!theme || typeof theme !== 'object') continue;
    const tokens = Array.isArray((theme as Record<string, unknown>).tokens)
      ? (theme as Record<string, unknown>).tokens as unknown[] : [];
    for (const token of tokens) {
      if (!token || typeof token !== 'object') continue;
      const item = token as Record<string, unknown>;
      if (item.type === 'fontRef' && typeof item.id === 'string' && typeof item.value === 'string') {
        fontTokens.set(item.id, item.value);
      }
    }
  }
  const resolveFont = (value: unknown): string | null => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof (value as Record<string, unknown>).$token === 'string') {
      const tokenId = (value as { $token: string }).$token;
      return fontTokens.get(tokenId) ?? null;
    }
    return null;
  };
  const globalStyles = new Map<string, Record<string, unknown>>();
  const registerStyles = (styles: unknown): void => {
    if (!Array.isArray(styles)) return;
    for (const style of styles) {
      if (!style || typeof style !== 'object') continue;
      const item = style as Record<string, unknown>;
      if (typeof item.id === 'string' && item.props && typeof item.props === 'object') {
        globalStyles.set(item.id, item.props as Record<string, unknown>);
      }
    }
  };
  registerStyles(root.styles);
  const byFont = new Map<string, Set<number>>();
  const usedFonts = new Set<string>();
  const addText = (fonts: Set<string>, props: unknown): void => {
    const points = textSymbols(props);
    if (points.size === 0) return;
    for (const font of fonts) {
      usedFonts.add(font);
      const target = byFont.get(font) ?? new Set<number>();
      for (const point of points) target.add(point);
      byFont.set(font, target);
    }
  };
  const visitNode = (node: unknown, inherited: Set<string>, styles: Map<string, Record<string, unknown>>): void => {
    if (!node || typeof node !== 'object') return;
    const item = node as Record<string, unknown>;
    const selected = new Set<string>();
    if (Array.isArray(item.styleRefs)) {
      for (const usage of item.styleRefs) {
        if (!usage || typeof usage !== 'object') continue;
        const id = (usage as Record<string, unknown>).styleId;
        const font = typeof id === 'string' ? resolveFont(styles.get(id)?.text_font) : null;
        if (font) selected.add(font);
      }
    }
    if (Array.isArray(item.styles)) {
      for (const style of item.styles) {
        const props = style && typeof style === 'object' ? (style as Record<string, unknown>).props : null;
        const font = props && typeof props === 'object'
          ? resolveFont((props as Record<string, unknown>).text_font) : null;
        if (font) selected.add(font);
      }
    }
    const effective = selected.size > 0 ? selected : inherited;
    addText(effective, item.props);
    if (Array.isArray(item.children)) {
      for (const child of item.children) visitNode(child, effective, styles);
    }
  };
  const screens = Array.isArray(root.screens) ? root.screens : [];
  for (const screen of screens) {
    if (!screen || typeof screen !== 'object') continue;
    const item = screen as Record<string, unknown>;
    const styles = new Map(globalStyles);
    if (Array.isArray(item.styles)) {
      for (const style of item.styles) {
        if (!style || typeof style !== 'object') continue;
        const entry = style as Record<string, unknown>;
        if (typeof entry.id === 'string' && entry.props && typeof entry.props === 'object') {
          styles.set(entry.id, entry.props as Record<string, unknown>);
        }
      }
    }
    visitNode(item.root, new Set(), styles);
  }
  const components = Array.isArray(root.components) ? root.components : [];
  for (const component of components) {
    if (component && typeof component === 'object') {
      visitNode((component as Record<string, unknown>).root, new Set(), globalStyles);
    }
  }
  const translationPoints = textSymbols({ texts: root.translations });
  for (const font of usedFonts) {
    const target = byFont.get(font) ?? new Set<number>();
    for (const point of translationPoints) target.add(point);
    byFont.set(font, target);
  }
  return Object.fromEntries([...byFont.entries()].map(([font, points]) => [font, orderedSymbols(points)]));
}

function codePoint(token: string): number {
  const normalized = token.trim().replace(/^U\+/i, '0x');
  const value = Number(normalized);
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) {
    throw new Error(`invalid font code point: ${token}`);
  }
  return value;
}

/** Parse `0x20-0x7e, U+4E00-U+4E5F` to lv_font_conv triples. */
export function parseFontRanges(spec = '0x20-0x7e', symbols = ''): { ranges: number[]; glyphCount: number } {
  const intervals: Array<[number, number]> = [];
  for (const token of spec.split(/[\s,;]+/).filter(Boolean)) {
    const pair = token.split(/-|\.\./);
    const start = codePoint(pair[0]!);
    const end = pair.length === 1 ? start : codePoint(pair[1]!);
    if (start > end) throw new Error(`font range start exceeds end: ${token}`);
    intervals.push([start, end]);
  }
  for (const symbol of symbols) {
    const point = symbol.codePointAt(0);
    if (point !== undefined) intervals.push([point, point]);
  }
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push([...interval]);
  }
  const glyphCount = merged.reduce((total, [start, end]) => total + end - start + 1, 0);
  if (glyphCount === 0) throw new Error('font conversion requires at least one glyph');
  if (glyphCount > MAX_GLYPHS) throw new Error(`font conversion exceeds ${MAX_GLYPHS} glyph limit`);
  return { ranges: merged.flatMap(([start, end]) => [start, end, start]), glyphCount };
}

type FontBundle = {
  convertFont(
    input: Uint8Array,
    options: { size: number; bpp: number; format: 'lvgl'; name: string; range: number[] },
  ): Promise<string | Uint8Array>;
  findMissingCodePoints(input: Uint8Array, codePoints: number[]): number[];
};

async function bundle(): Promise<FontBundle> {
  const globals = globalThis as typeof globalThis & { __dirname?: string };
  globals.__dirname ??= '.';
  return import('../spike/browser-bundle.mjs') as Promise<FontBundle>;
}

function expandRangeTriples(ranges: number[]): number[] {
  const points: number[] = [];
  for (let index = 0; index < ranges.length; index += 3) {
    for (let point = ranges[index]!; point <= ranges[index + 1]!; point += 1) points.push(point);
  }
  return points;
}

/** Inspect cmap coverage without relying on lv_font_conv silently dropping missing glyphs. */
export async function findMissingFontCodePoints(input: Uint8Array, codePoints: number[]): Promise<number[]> {
  const unique = [...new Set(codePoints)].sort((a, b) => a - b);
  if (unique.some((point) => !Number.isInteger(point) || point < 0 || point > 0x10ffff)) {
    throw new Error('font coverage inspection received an invalid Unicode code point');
  }
  return (await bundle()).findMissingCodePoints(input, unique);
}

export async function convertFontToLvglC(
  input: Uint8Array,
  options: FontConversionOptions,
): Promise<ConvertedFont> {
  if (!CODE_NAME.test(options.codeName)) throw new Error(`invalid font codeName: ${options.codeName}`);
  if (!Number.isInteger(options.sizePx) || options.sizePx < 4 || options.sizePx > 256) {
    throw new Error('font sizePx must be an integer between 4 and 256');
  }
  const bpp = options.bpp ?? 4;
  if (![1, 2, 4, 8].includes(bpp)) throw new Error('font bpp must be 1, 2, 4, or 8');
  const parsed = parseFontRanges(options.ranges, options.symbols);
  const requestedCodePoints = expandRangeTriples(parsed.ranges);
  const missingCodePoints = await findMissingFontCodePoints(input, requestedCodePoints);
  const converted = await (await bundle()).convertFont(input, {
    size: options.sizePx,
    bpp,
    format: 'lvgl',
    name: `font_${options.codeName}`,
    range: parsed.ranges,
  });
  const cSource = typeof converted === 'string' ? converted : new TextDecoder().decode(converted);
  if (!cSource.includes(`const lv_font_t font_${options.codeName}`)) {
    throw new Error('lv_font_conv returned an unexpected C symbol');
  }
  return {
    cSource,
    glyphCount: parsed.glyphCount - missingCodePoints.length,
    requestedGlyphCount: parsed.glyphCount,
    missingCodePoints,
    ranges: parsed.ranges,
  };
}
