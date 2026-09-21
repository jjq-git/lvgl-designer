import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  collectProjectTextSymbols,
  collectProjectTextSymbolsByFont,
  findMissingFontCodePoints,
  parseFontRanges,
} from './index.js';

describe('font asset pipeline', () => {
  it('parses, sorts, merges, and counts Unicode ranges deterministically', () => {
    expect(parseFontRanges('U+0041-U+0043, 0x20, 0x42-0x44', '中')).toEqual({
      ranges: [0x20, 0x20, 0x20, 0x41, 0x44, 0x41, 0x4e2d, 0x4e2d, 0x4e2d],
      glyphCount: 6,
    });
  });

  it('rejects reversed and excessive ranges', () => {
    expect(() => parseFontRanges('0x50-0x40')).toThrow(/start exceeds/);
    expect(() => parseFontRanges('0-9000')).toThrow(/glyph limit/);
  });

  it('collects visible widget and translation text but ignores identifiers', () => {
    expect(collectProjectTextSymbols({
      id: 'should_not_leak',
      screens: [{ codeName: 'main', props: { text: '温度 22°C', placeholder_text: '输入' } }],
      translations: { entries: [{ texts: { en: 'Power', zh: '电源' } }] },
    })).toBe(' 2CPeorw°入度温源电输');
  });

  it('collects text only for the custom font effectively referenced by each widget', () => {
    expect(collectProjectTextSymbolsByFont({
      themes: [{ tokens: [{ id: 'font.heading', type: 'fontRef', value: 'font:title' }] }],
      styles: [{ id: 'style:body', props: { text_font: 'font:body' } }],
      screens: [{
        styles: [{ id: 'style:title', props: { text_font: { $token: 'font.heading' } } }],
        root: {
          props: {}, styleRefs: [], styles: [],
          children: [
            { props: { text: '标题' }, styleRefs: [{ styleId: 'style:title' }], styles: [], children: [] },
            { props: { text: 'Body' }, styleRefs: [{ styleId: 'style:body' }], styles: [], children: [] },
            { props: { text: 'default' }, styleRefs: [], styles: [], children: [] },
          ],
        },
      }],
      translations: null,
    })).toEqual({ 'font:title': '标题', 'font:body': 'Bdoy' });
  });

  it('reports requested Unicode code points missing from the font cmap', async () => {
    const font = readFileSync(new URL('../spike/Montserrat-Medium.ttf', import.meta.url));
    await expect(findMissingFontCodePoints(font, [0x41, 0x4e2d])).resolves.toEqual([0x4e2d]);
  });
});
