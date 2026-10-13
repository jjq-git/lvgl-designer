import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const sizes = [...read('runtime/lv_conf.h').matchAll(/^#define LV_FONT_MONTSERRAT_(\d+)\s+1\s*$/gm)]
  .map((match) => Number(match[1]));

describe('product icon font coverage', () => {
  it('covers every selectable built-in font size', () => {
    expect(sizes).toEqual(Array.from({ length: 21 }, (_, index) => 8 + index * 2));
    for (const size of sizes) {
      const font = read(`runtime/font-overrides/lv_font_montserrat_${size}.c`);
      expect(font, `${size}px quiet-pod icon`).toContain('U+F52B');
      expect(font).toContain(`lv_font_montserrat_${size} =`);
      // Retain ordinary text and existing navigation symbols at every size.
      expect(font).toContain('U+0041');
      expect(font).toContain('U+F015');
      expect(font).toContain('--font ../../../../runtime/font-overrides/PodscSymbols.ttf -r 62763');
    }
  });

  it('ships the overrides in both preview and container device builds', () => {
    expect(read('runtime/CMakeLists.txt')).toContain('foreach(LVD_FONT_SIZE RANGE 8 48 2)');
    expect(read('Dockerfile')).toContain('COPY runtime/font-overrides/lv_font_montserrat_*.c ./lvgl-source/src/font/');
  });
});
