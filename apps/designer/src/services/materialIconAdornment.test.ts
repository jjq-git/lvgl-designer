import { describe, expect, it } from 'vitest';
import type { WidgetNodeV2 } from '@lvd/schema/v2';
import {
  MATERIAL_ICON_ADORNMENT_ROLE,
  removeMaterialIconAdornment,
  upsertMaterialIconAdornment,
} from './materialIconAdornment';

function label(): WidgetNodeV2 {
  return {
    id: 'label-1',
    type: 'label',
    props: { text: 'HOME' },
    styleRefs: [],
    styles: [{ props: { pad_hor: 4, text_color: '#222222' } }],
    events: [],
    bindings: [],
    children: [],
  };
}

describe('Material icon adornment', () => {
  it('updates one generated child instead of creating peer widgets', () => {
    const node = label();
    expect(upsertMaterialIconAdornment(node, { codeName: 'home_24', iconName: 'home', sizePx: 24 })).toBe(true);
    expect(node.children).toHaveLength(1);
    expect(node.children[0]?.editor?.generatedRole).toBe(MATERIAL_ICON_ADORNMENT_ROLE);
    expect(node.children[0]?.props.src).toBe('home_24');
    expect(node.styles[0]?.props.pad_hor).toBe(34);

    upsertMaterialIconAdornment(node, { codeName: 'settings_32', iconName: 'settings', sizePx: 32 });
    expect(node.children).toHaveLength(1);
    expect(node.children[0]?.props.src).toBe('settings_32');
    expect(node.styles[0]?.props.pad_hor).toBe(42);
  });

  it('restores existing layout when switching back to a text icon', () => {
    const node = label();
    upsertMaterialIconAdornment(node, { codeName: 'home_24', iconName: 'home', sizePx: 24 });
    expect(removeMaterialIconAdornment(node)).toBe(true);
    expect(node.children).toEqual([]);
    expect(node.styles[0]?.props).toEqual({ pad_hor: 4, text_color: '#222222' });
  });

  it('migrates adornments created with unsupported directional padding', () => {
    const node = label();
    node.styles[0]!.props = { pad_left: 34, text_color: '#222222' };
    node.children.push({
      id: 'legacy-icon',
      type: 'image',
      props: {},
      flags: { clickable: false },
      styleRefs: [],
      styles: [],
      events: [],
      bindings: [],
      children: [],
      editor: {
        generatedRole: MATERIAL_ICON_ADORNMENT_ROLE,
        materialBasePadLeft: null,
      },
    });

    upsertMaterialIconAdornment(node, { codeName: 'home_24', iconName: 'home', sizePx: 24 });

    expect(node.styles[0]?.props).toEqual({ pad_hor: 30, text_color: '#222222' });
    expect(node.children[0]?.editor?.materialBasePadLeft).toBeUndefined();
    expect(node.children[0]?.editor?.materialBasePadHor).toBeNull();
  });

  it('supports button adornments without changing the button text child', () => {
    const node: WidgetNodeV2 = {
      ...label(),
      id: 'button-1',
      type: 'button',
      props: {},
      children: [label()],
    };
    upsertMaterialIconAdornment(node, { codeName: 'power_20', iconName: 'power', sizePx: 20 });
    expect(node.children.filter((child) => child.type === 'label')).toHaveLength(1);
    expect(node.children.filter((child) => child.editor?.generatedRole === MATERIAL_ICON_ADORNMENT_ROLE)).toHaveLength(1);
  });
});
