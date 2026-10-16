import { describe, expect, it } from 'vitest';
import type { AssetEntry } from '@lvd/schema/v2';
import {
  BUILTIN_FONT_FAMILY_ID,
  builtInFontRef,
  fontFamilyOptions,
  resolveFontSelection,
} from './fontFamilies';

const font = (codeName: string, sizePx: number, generated = false): AssetEntry => ({
  id: `font:${codeName}`,
  codeName,
  file: { fileName: 'NotoSansSC-Regular.ttf', sha256: 'abc123', byteSize: 1234 },
  conv: {
    loader: 'tiny_ttf', sizePx, bpp: 4, ranges: '0x20-0x7e',
    generatedFontInstance: generated,
  },
});

describe('font family presentation', () => {
  it('groups size-specific assets backed by the same TTF', () => {
    const families = fontFamilyOptions([font('noto_sans_sc', 16), font('noto_sans_sc_24', 24, true)]);
    expect(families).toHaveLength(2);
    expect(families[1]).toMatchObject({
      id: 'asset:abc123',
      label: 'NotoSansSC Regular',
      sourceCodeName: 'noto_sans_sc',
      sizes: [16, 24],
    });
  });

  it('maps old font refs into separate family and size fields', () => {
    expect(resolveFontSelection('montserrat_20', [])).toEqual({
      familyId: BUILTIN_FONT_FAMILY_ID,
      sizePx: 20,
    });
    expect(resolveFontSelection('noto_sans_sc_24', [font('noto_sans_sc_24', 24, true)]))
      .toEqual({ familyId: 'asset:abc123', sizePx: 24 });
  });

  it('snaps built-in sizes to an available LVGL font', () => {
    expect(builtInFontRef(15)).toBe('montserrat_14');
    expect(builtInFontRef(47)).toBe('montserrat_46');
  });
});
