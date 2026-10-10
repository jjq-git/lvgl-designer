import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@lvd/schema';
import { migrateV1ToV2 } from '@lvd/schema/v2';
import {
  bindLegacyPaletteToTheme,
  countThemeStyleRefs,
  generateThemeFromCurrentStyles,
} from './themeBinding';

describe('legacy theme binding', () => {
  it('binds legacy WF3 colors to available semantic tokens', () => {
    const migrated = migrateV1ToV2(createEmptyProject('WF3 legacy'));
    migrated.uiProject.themes[0]!.tokens.push(
      { id: 'color.background', type: 'color', value: '#000000' },
      { id: 'color.accent', type: 'color', value: '#808080' },
      { id: 'color.text.onaccent', type: 'color', value: '#FFFFFF' },
    );
    migrated.uiProject.screens[0]!.root.styles.push({ props: { bg_color: '#FFFFFF' } });
    migrated.uiProject.screens[0]!.root.children.push({
      id: 'child',
      type: 'label',
      props: {},
      styleRefs: [],
      styles: [{ props: { text_color: '#0B8583' } }],
      events: [],
      bindings: [],
      children: [],
    });

    expect(countThemeStyleRefs(migrated.uiProject)).toBe(0);
    expect(bindLegacyPaletteToTheme(migrated.uiProject, 'default')).toBe(2);
    expect(countThemeStyleRefs(migrated.uiProject)).toBe(2);
    expect(migrated.uiProject.screens[0]!.root.styles[0]!.props.bg_color)
      .toEqual({ $token: 'color.background' });
    expect(migrated.uiProject.screens[0]!.root.children[0]!.styles[0]!.props.text_color)
      .toEqual({ $token: 'color.accent' });
  });

  it('incrementally binds literals from a partially migrated WF3 light project', () => {
    const migrated = migrateV1ToV2(createEmptyProject('WF3 partially migrated'));
    migrated.uiProject.themes[0]!.tokens.push(
      { id: 'color.background', type: 'color', value: '#F5F7F7' },
      { id: 'color.border', type: 'color', value: '#D8E2E2' },
      { id: 'color.accent', type: 'color', value: '#0F766E' },
      { id: 'color.accent.strong', type: 'color', value: '#115E59' },
      { id: 'color.text.primary', type: 'color', value: '#1F2937' },
      { id: 'font.text.body', type: 'fontRef', value: 'wf3_cn_14' },
    );
    migrated.uiProject.screens[0]!.root.styles.push({
      props: {
        bg_color: '#F4F7F3',
        border_color: '#D5E0D5',
      },
    });
    migrated.uiProject.screens[0]!.root.children.push({
      id: 'child',
      type: 'label',
      props: {},
      styleRefs: [],
      styles: [{
        props: {
          bg_color: '#A8E6A3',
          text_color: { $token: 'color.text.primary' },
          text_font: 'montserrat_14',
        },
      }, {
        selector: { states: ['pressed'] },
        props: { bg_color: '#3D7D43' },
      }],
      events: [],
      bindings: [],
      children: [],
    });

    expect(countThemeStyleRefs(migrated.uiProject)).toBe(1);
    expect(bindLegacyPaletteToTheme(migrated.uiProject, 'default')).toBe(5);
    expect(countThemeStyleRefs(migrated.uiProject)).toBe(6);
    expect(migrated.uiProject.screens[0]!.root.styles[0]!.props).toMatchObject({
      bg_color: { $token: 'color.background' },
      border_color: { $token: 'color.border' },
    });
    expect(migrated.uiProject.screens[0]!.root.children[0]!.styles[0]!.props.bg_color)
      .toEqual({ $token: 'color.accent' });
    expect(migrated.uiProject.screens[0]!.root.children[0]!.styles[0]!.props.text_font)
      .toEqual({ $token: 'font.text.body' });
    expect(migrated.uiProject.screens[0]!.root.children[0]!.styles[1]!.props.bg_color)
      .toEqual({ $token: 'color.accent.strong' });
  });

  it('generates an editable theme for an old project with only literal visuals', () => {
    const migrated = migrateV1ToV2(createEmptyProject('Legacy product UI'));
    migrated.uiProject.screens[0]!.root.styles.push({
      props: { bg_color: '#EAF4FA', border_color: '#B8D8E8' },
    });
    migrated.uiProject.screens[0]!.root.children.push({
      id: 'title',
      type: 'label',
      props: { text: 'BRAND A' },
      styleRefs: [],
      styles: [{ props: { text_color: '#397FA8', text_font: 'montserrat_20' } }],
      events: [],
      bindings: [],
      children: [],
    });

    const generated = generateThemeFromCurrentStyles(migrated.uiProject, 'default');

    expect(generated).toMatchObject({ themeId: 'default', tokenCount: 4, bindingCount: 4 });
    expect(migrated.uiProject.themes[0]?.tokens).toEqual(expect.arrayContaining([
      { id: 'color.background', type: 'color', value: '#EAF4FA' },
      { id: 'color.palette.397fa8', type: 'color', value: '#397FA8' },
      { id: 'font.size.20', type: 'fontRef', value: 'montserrat_20' },
    ]));
    expect(migrated.uiProject.screens[0]!.root.styles[0]!.props.bg_color)
      .toEqual({ $token: 'color.background' });
    expect(migrated.uiProject.screens[0]!.root.children[0]!.styles[0]!.props.text_font)
      .toEqual({ $token: 'font.size.20' });
  });
});
