import { describe, expect, it } from 'vitest';
import { constMacroName, formatEnumForC, formatValueForC, formatValueForXml } from '../format.js';

describe('formatValueForXml(design/01 §4.4)', () => {
  it('颜色 #RRGGBB → 0xRRGGBB(# 会触发 const 解析,必须转)', () => {
    expect(formatValueForXml('#1A2B3C', { type: 'color' })).toBe('0x1A2B3C');
    expect(formatValueForXml('#1A2B3C')).toBe('0x1A2B3C');
  });
  it('size:content 与 % 原样', () => {
    expect(formatValueForXml('content', { type: 'size' })).toBe('content');
    expect(formatValueForXml('50%', { type: 'size' })).toBe('50%');
    expect(formatValueForXml(120, { type: 'size' })).toBe('120');
  });
  it('bool 只发 true/false 两词(lv_xml_to_bool 只认 "false" 为假)', () => {
    expect(formatValueForXml(true)).toBe('true');
    expect(formatValueForXml(false)).toBe('false');
  });
  it('const 引用 → #name', () => {
    expect(formatValueForXml({ $const: 'gap' })).toBe('#gap');
  });
  it('数组空格分隔', () => {
    expect(formatValueForXml([10, 20, 30], { type: 'intList' })).toBe('10 20 30');
  });
  it('普通字符串原样(转义归 emitter)', () => {
    expect(formatValueForXml('Hello', { type: 'string' })).toBe('Hello');
  });
});

describe('formatValueForC(design/01 §4.4)', () => {
  it('颜色 → lv_color_hex,hex3 展开', () => {
    expect(formatValueForC('#1A2B3C', { type: 'color' })).toBe('lv_color_hex(0x1A2B3C)');
    expect(formatValueForC('#abc', { type: 'color' })).toBe('lv_color_hex(0xaabbcc)');
  });
  it('size:content → LV_SIZE_CONTENT,% → lv_pct', () => {
    expect(formatValueForC('content', { type: 'size' })).toBe('LV_SIZE_CONTENT');
    expect(formatValueForC('50%', { type: 'size' })).toBe('lv_pct(50)');
    expect(formatValueForC(120, { type: 'size' })).toBe('120');
  });
  it('opa:% → v*255/100 取整', () => {
    expect(formatValueForC('50%', { type: 'opa' })).toBe('128');
    expect(formatValueForC('100%', { type: 'opa' })).toBe('255');
    expect(formatValueForC(200, { type: 'opa' })).toBe('200');
  });
  it('bool → true/false', () => {
    expect(formatValueForC(true)).toBe('true');
    expect(formatValueForC(false)).toBe('false');
  });
  it('const 引用 → UI_CONST_ 宏', () => {
    expect(formatValueForC({ $const: 'gap' })).toBe('UI_CONST_GAP');
    expect(constMacroName('small_pad')).toBe('UI_CONST_SMALL_PAD');
  });
  it('enum → cPrefix + 大写 token,cOverride 优先', () => {
    const spec = {
      tokens: ['wrap', 'scroll_circular'] as const,
      cPrefix: 'LV_LABEL_LONG_MODE_',
    };
    expect(formatValueForC('wrap', { type: 'enum', enum: spec })).toBe('LV_LABEL_LONG_MODE_WRAP');
    expect(formatEnumForC('scroll_circular', spec)).toBe('LV_LABEL_LONG_MODE_SCROLL_CIRCULAR');
    expect(formatEnumForC('a', { tokens: ['a'], cPrefix: 'X_', cOverride: { a: 'Y_SPECIAL' } }))
      .toBe('Y_SPECIAL');
  });
  it('字符串 → C 字面量转义', () => {
    expect(formatValueForC('He said "hi"\n', { type: 'string' })).toBe('"He said \\"hi\\"\\n"');
  });
});
