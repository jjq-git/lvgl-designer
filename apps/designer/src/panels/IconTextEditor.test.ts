import { describe, expect, it } from 'vitest';
import {
  applyLvglSymbol,
  filterLvglSymbols,
  formatLvglSymbolText,
  isScrollInsideIconPicker,
  parseLvglSymbolText,
} from './IconTextEditor';

describe('LVGL symbol text helpers', () => {
  it('inserts a symbol at the current selection or replaces all text', () => {
    expect(applyLvglSymbol('START', '\uf04b', 'insert', 0, 0)).toBe('\uf04bSTART');
    expect(applyLvglSymbol('AIR GOOD', '\uf00c', 'replace')).toBe('\uf00c');
    expect(applyLvglSymbol('ABCD', '\uf054', 'insert', 1, 3)).toBe('A\uf054D');
  });

  it('searches symbols by Chinese name and English keyword', () => {
    expect(filterLvglSymbols('主页').map((item) => item.name)).toContain('主页');
    expect(filterLvglSymbols('play').map((item) => item.name)).toContain('播放');
    expect(filterLvglSymbols('空气').map((item) => item.name)).toContain('刷新');
  });

  it('shows readable tokens in the editor while preserving LVGL glyphs in storage', () => {
    expect(formatLvglSymbolText('\uf054')).toBe('[图标:向右]');
    expect(formatLvglSymbolText('\uf04b START')).toBe('[图标:播放] START');
    expect(parseLvglSymbolText('[图标:确认]')).toBe('\uf00c');
  });

  it('keeps the picker open when its own icon list scrolls', () => {
    const inside = {} as Node;
    const outside = {} as Node;
    const popup = { contains: (node: Node) => node === inside };

    expect(isScrollInsideIconPicker(popup, inside)).toBe(true);
    expect(isScrollInsideIconPicker(popup, outside)).toBe(false);
    expect(isScrollInsideIconPicker(null, inside)).toBe(false);
  });
});
