import { newUuid } from '@lvd/schema';
import type { LocalStyleGroup, WidgetNodeV2 } from '@lvd/schema/v2';

export const MATERIAL_ICON_ADORNMENT_ROLE = 'material-icon-adornment';

export interface MaterialIconAdornmentInput {
  codeName: string;
  iconName: string;
  sizePx: number;
}

function isAdornment(node: WidgetNodeV2): boolean {
  return node.editor?.generatedRole === MATERIAL_ICON_ADORNMENT_ROLE;
}

function mainStyle(node: WidgetNodeV2): LocalStyleGroup {
  let style = node.styles.find((item) => item.selector === undefined);
  if (!style) {
    style = { props: {} };
    node.styles.push(style);
  }
  return style;
}

/**
 * Material Symbols are image assets at runtime, but they remain an implementation
 * detail of the selected text component in the editor. This generated child is
 * therefore updated in place and never appears as a new peer on the canvas.
 */
export function upsertMaterialIconAdornment(
  node: WidgetNodeV2,
  input: MaterialIconAdornmentInput,
): boolean {
  if (node.type !== 'label' && node.type !== 'button') return false;

  let icon = node.children.find(isAdornment);
  if (!icon) {
    icon = {
      id: newUuid(),
      type: 'image',
      displayName: `Material 图标 · ${input.iconName}`,
      props: {},
      flags: { clickable: false },
      styleRefs: [],
      styles: [],
      events: [],
      bindings: [],
      children: [],
      editor: {
        locked: true,
        generatedRole: MATERIAL_ICON_ADORNMENT_ROLE,
      },
    };
    node.children.unshift(icon);
  }

  icon.displayName = `Material 图标 · ${input.iconName}`;
  icon.props = {
    src: input.codeName,
    width: input.sizePx,
    height: input.sizePx,
    align: 'left_mid',
    x: node.type === 'button' ? 12 : 0,
    y: 0,
  };

  if (node.type === 'label') {
    const style = mainStyle(node);
    if (icon.editor?.materialBasePadHor === undefined) {
      icon.editor = {
        ...icon.editor,
        materialBasePadHor: typeof style.props.pad_hor === 'number' ? style.props.pad_hor : null,
      };
    }
    // Migrate adornments created by the first implementation. Directional
    // padding is valid schema data, but the pinned LVGL preview driver only
    // supports pad_hor/pad_ver/pad_all.
    if (icon.editor.materialBasePadLeft !== undefined) {
      if (typeof icon.editor.materialBasePadLeft === 'number') {
        style.props.pad_left = icon.editor.materialBasePadLeft;
      } else {
        delete style.props.pad_left;
      }
      delete icon.editor.materialBasePadLeft;
    }
    const base = typeof icon.editor?.materialBasePadHor === 'number'
      ? icon.editor.materialBasePadHor
      : 0;
    style.props.pad_hor = base + input.sizePx + 6;
  }
  return true;
}

export function removeMaterialIconAdornment(node: WidgetNodeV2): boolean {
  const index = node.children.findIndex(isAdornment);
  if (index < 0) return false;
  const [icon] = node.children.splice(index, 1);
  if (node.type === 'label') {
    const styleIndex = node.styles.findIndex((item) => item.selector === undefined);
    const style = styleIndex < 0 ? undefined : node.styles[styleIndex];
    if (style) {
      const base = icon?.editor?.materialBasePadHor;
      if (typeof base === 'number') style.props.pad_hor = base;
      else delete style.props.pad_hor;

      const legacyBase = icon?.editor?.materialBasePadLeft;
      if (legacyBase !== undefined) {
        if (typeof legacyBase === 'number') style.props.pad_left = legacyBase;
        else delete style.props.pad_left;
      }
      if (Object.keys(style.props).length === 0) node.styles.splice(styleIndex, 1);
    }
  }
  return true;
}
