import { M1_TEXT_FONTS } from '@lvd/schema';
import type { AssetEntry } from '@lvd/schema/v2';

export const BUILTIN_FONT_FAMILY_ID = 'builtin:montserrat';
export const BUILTIN_FONT_SIZES = M1_TEXT_FONTS
  .map((name) => Number(/^montserrat_(\d+)$/.exec(name)?.[1]))
  .filter((size) => Number.isInteger(size));

export interface FontFamilyOption {
  id: string;
  label: string;
  sourceCodeName: string | null;
  sourceSha256: string | null;
  sizes: number[];
  resizable: boolean;
  instances: { sizePx: number; fontRef: string }[];
}

export interface FontSelection {
  familyId: string;
  sizePx: number;
}

function fontSize(asset: AssetEntry): number {
  const size = asset.conv?.sizePx;
  return typeof size === 'number' && Number.isInteger(size) ? size : 16;
}

function fileStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
}

function familyLabel(asset: AssetEntry): string {
  const configured = asset.conv?.familyName;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  const stem = fileStem(asset.file.fileName);
  return stem || asset.displayName || asset.codeName || '自定义字体';
}

function sourceRank(asset: AssetEntry): number {
  return asset.conv?.generatedFontInstance === true ? 1 : 0;
}

/**
 * The persisted LVGL model stores one font object per size. The editor groups
 * objects backed by the same font bytes into one user-facing font family.
 */
export function fontFamilyOptions(assets: readonly AssetEntry[]): FontFamilyOption[] {
  const bySha = new Map<string, AssetEntry[]>();
  for (const asset of assets) {
    if (!asset.codeName) continue;
    const list = bySha.get(asset.file.sha256) ?? [];
    list.push(asset);
    bySha.set(asset.file.sha256, list);
  }

  const custom = [...bySha.entries()].map(([sha256, entries]) => {
    const ordered = [...entries].sort((a, b) => sourceRank(a) - sourceRank(b));
    const source = ordered[0]!;
    return {
      id: `asset:${sha256}`,
      label: familyLabel(source),
      sourceCodeName: source.codeName ?? null,
      sourceSha256: sha256,
      sizes: [...new Set(entries.map(fontSize))].sort((a, b) => a - b),
      resizable: entries.some((asset) => asset.conv?.loader === 'tiny_ttf'),
      instances: entries
        .filter((asset): asset is AssetEntry & { codeName: string } => Boolean(asset.codeName))
        .map((asset) => ({ sizePx: fontSize(asset), fontRef: asset.codeName })),
    } satisfies FontFamilyOption;
  }).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));

  return [{
    id: BUILTIN_FONT_FAMILY_ID,
    label: 'Montserrat（内置，仅英文/数字）',
    sourceCodeName: null,
    sourceSha256: null,
    sizes: [...BUILTIN_FONT_SIZES],
    resizable: true,
    instances: M1_TEXT_FONTS.map((fontRef, index) => ({
      sizePx: BUILTIN_FONT_SIZES[index]!, fontRef,
    })),
  }, ...custom];
}

export function resolveFontSelection(
  fontRef: string | undefined,
  assets: readonly AssetEntry[],
): FontSelection | null {
  if (!fontRef) return null;
  const builtIn = /^montserrat_(\d+)$/.exec(fontRef);
  if (builtIn && M1_TEXT_FONTS.includes(fontRef)) {
    return { familyId: BUILTIN_FONT_FAMILY_ID, sizePx: Number(builtIn[1]) };
  }
  const asset = assets.find((item) => item.codeName === fontRef);
  if (!asset) return null;
  return { familyId: `asset:${asset.file.sha256}`, sizePx: fontSize(asset) };
}

export function nearestBuiltInFontSize(sizePx: number): number {
  return BUILTIN_FONT_SIZES.reduce((nearest, candidate) => (
    Math.abs(candidate - sizePx) < Math.abs(nearest - sizePx) ? candidate : nearest
  ), BUILTIN_FONT_SIZES[0] ?? 14);
}

export function builtInFontRef(sizePx: number): string {
  return `montserrat_${nearestBuiltInFontSize(sizePx)}`;
}

