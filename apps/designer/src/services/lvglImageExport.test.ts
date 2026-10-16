import { describe, expect, it } from 'vitest';
import { convertLottieToLvglC, convertRgbaToLvglC } from './lvglImageExport';

const twoPixels = {
  width: 2,
  height: 1,
  data: new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 128,
  ]),
};

describe('local LVGL image C export', () => {
  it('exports Material-style alpha masks as A8 descriptors', () => {
    const result = convertRgbaToLvglC(twoPixels, 'ic_test_24', 'A8');
    expect(result).toMatchObject({ width: 2, height: 1, stride: 2, dataSize: 2 });
    expect(result.cSource).toContain('0xff,0x80,');
    expect(result.cSource).toContain('.cf = LV_COLOR_FORMAT_A8');
    expect(result.cSource).toContain('const lv_image_dsc_t img_ic_test_24');
  });

  it('uses LVGL BGRA byte order for ARGB8888', () => {
    const result = convertRgbaToLvglC(twoPixels, 'picture', 'ARGB8888');
    expect(result.cSource).toContain('0x00,0x00,0xff,0xff,0x00,0xff,0x00,0x80,');
    expect(result).toMatchObject({ stride: 8, dataSize: 8 });
  });

  it('appends the alpha plane after RGB565 pixel data', () => {
    const result = convertRgbaToLvglC(twoPixels, 'picture', 'RGB565A8');
    expect(result.cSource).toContain('0x00,0xf8,0xe0,0x07,0xff,0x80,');
    expect(result).toMatchObject({ stride: 4, dataSize: 6 });
  });

  it('fails explicitly for indexed formats instead of leaving a missing source file', () => {
    expect(() => convertRgbaToLvglC(twoPixels, 'picture', 'I4'))
      .toThrow('本地 C 导出暂不支持索引色 I4');
  });

  it('exports validated Lottie bytes as a C array', () => {
    const bytes = new TextEncoder().encode('{"layers":[]}');
    const source = convertLottieToLvglC(bytes, 'spinner');
    expect(source).toContain('const uint8_t lottie_spinner[]');
    expect(source).toContain('const size_t lottie_spinner_size');
  });
});
