import { describe, expect, it } from 'vitest';
import type { ThemeDef } from '@lvd/schema/v2';
import {
  embeddedThemeId,
  parseThemeTokenValue,
  replaceEmptyThemesWithPreset,
  themeTokenLabel,
} from './ThemePanel';

describe('ThemePanel helpers', () => {
  it('extracts embedded theme ids without accepting standalone refs', () => {
    expect(embeddedThemeId('ui:wf3@1#theme:wf3-light')).toBe('wf3-light');
    expect(embeddedThemeId('theme:night@4')).toBeNull();
  });

  it('normalizes and validates editable token values', () => {
    expect(parseThemeTokenValue('color', '#a8e6a3')).toBe('#A8E6A3');
    expect(parseThemeTokenValue('color', 'green')).toBeNull();
    expect(parseThemeTokenValue('opa', '255')).toBe(255);
    expect(parseThemeTokenValue('opa', '256')).toBeNull();
    expect(parseThemeTokenValue('percent', '50.5')).toBe(50.5);
    expect(parseThemeTokenValue('percent', '-1')).toBeNull();
    expect(parseThemeTokenValue('fontRef', 'wf3_cn_16')).toBe('wf3_cn_16');
    expect(parseThemeTokenValue('fontRef', '  ')).toBeNull();
  });

  it('initializes only a completely empty theme collection', () => {
    const empty: ThemeDef[] = [{ id: 'default', tokens: [] }];
    const preset: ThemeDef[] = [{
      id: 'industrial-base',
      tokens: [{ id: 'color.background', type: 'color', value: '#FFFFFF' }],
    }];
    expect(replaceEmptyThemesWithPreset(empty, preset)).toEqual(preset);
    expect(replaceEmptyThemesWithPreset(preset, empty)).toBeNull();
  });

  it('shows friendly Chinese names while preserving unknown token ids', () => {
    expect(themeTokenLabel('color.accent')).toBe('主强调色');
    expect(themeTokenLabel('font.size.18')).toContain('18px');
    expect(themeTokenLabel('color.palette.abcdef')).toContain('#ABCDEF');
    expect(themeTokenLabel('customer.custom')).toBe('customer.custom');
  });
});
