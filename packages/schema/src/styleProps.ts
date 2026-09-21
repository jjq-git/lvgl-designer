/**
 * 样式属性全集(一张表,检查器 / XML emitter / C emitter 共用)。
 * 与 parser-attrs.json 的 inlineStyleProps 清单(112 项,去 style_ 前缀)逐字一致;
 * 值类型逐项核对自 vendor/lvgl/src/others/xml/lv_xml_style.c:158-321。
 *
 * - key:JSON/命名样式键;XML 内联属性名 = 'style_' + key
 * - cSuffix:lv_style_set_<cSuffix>() / lv_obj_set_style_<cSuffix>()
 * - m1Inspector:M1 检查器展示子集(~25 项常用)
 */
import type { EnumSpec } from './registryTypes.js';
import {
  ALIGN_ENUM, BASE_DIR_ENUM, BLEND_MODE_ENUM, BORDER_SIDE_ENUM, FLEX_ALIGN_ENUM,
  FLEX_FLOW_ENUM, GRAD_DIR_ENUM, GRID_ALIGN_ENUM, LAYOUT_ENUM, TEXT_ALIGN_ENUM,
  TEXT_DECOR_ENUM,
} from './enums.js';

export type StylePropType =
  | 'size' | 'int' | 'bool' | 'color' | 'opa' | 'enum'
  | 'imageRef' | 'fontRef' | 'gradRef' | 'gridTemplate';

export interface StylePropSpec {
  key: string;
  type: StylePropType;
  enum?: EnumSpec;
  cSuffix: string;
  m1Inspector?: boolean;
}

function p(
  key: string,
  type: StylePropType,
  extra: { enum?: EnumSpec; m1Inspector?: boolean } = {},
): [string, StylePropSpec] {
  return [key, { key, type, cSuffix: key, ...extra }];
}

export const STYLE_PROPS: Record<string, StylePropSpec> = Object.fromEntries([
  /* 尺寸/位置 */
  p('width', 'size'),
  p('min_width', 'size'),
  p('max_width', 'size'),
  p('height', 'size'),
  p('min_height', 'size'),
  p('max_height', 'size'),
  p('length', 'size'),
  p('radius', 'size', { m1Inspector: true }),
  p('radial_offset', 'int'),
  p('align', 'enum', { enum: ALIGN_ENUM, m1Inspector: true }),
  /* pad */
  p('pad_left', 'int'),
  p('pad_right', 'int'),
  p('pad_top', 'int'),
  p('pad_bottom', 'int'),
  p('pad_hor', 'int', { m1Inspector: true }),
  p('pad_ver', 'int', { m1Inspector: true }),
  p('pad_all', 'int', { m1Inspector: true }),
  p('pad_row', 'int'),
  p('pad_column', 'int'),
  p('pad_gap', 'int'),
  p('pad_radial', 'int'),
  /* margin */
  p('margin_left', 'int'),
  p('margin_right', 'int'),
  p('margin_top', 'int'),
  p('margin_bottom', 'int'),
  p('margin_hor', 'int'),
  p('margin_ver', 'int'),
  p('margin_all', 'int'),
  /* 杂项 */
  p('base_dir', 'enum', { enum: BASE_DIR_ENUM }),
  p('clip_corner', 'bool'),
  /* 背景 */
  p('bg_opa', 'opa', { m1Inspector: true }),
  p('bg_color', 'color', { m1Inspector: true }),
  p('bg_grad_dir', 'enum', { enum: GRAD_DIR_ENUM }),
  p('bg_grad_color', 'color'),
  p('bg_main_stop', 'int'),
  p('bg_grad_stop', 'int'),
  p('bg_grad', 'gradRef'),
  p('bg_image_src', 'imageRef'),
  p('bg_image_tiled', 'bool'),
  p('bg_image_recolor', 'color'),
  p('bg_image_recolor_opa', 'opa'),
  /* border */
  p('border_color', 'color', { m1Inspector: true }),
  p('border_width', 'int', { m1Inspector: true }),
  p('border_opa', 'opa', { m1Inspector: true }),
  p('border_side', 'enum', { enum: BORDER_SIDE_ENUM }),
  p('border_post', 'bool'),
  /* outline */
  p('outline_color', 'color', { m1Inspector: true }),
  p('outline_width', 'int', { m1Inspector: true }),
  p('outline_opa', 'opa', { m1Inspector: true }),
  p('outline_pad', 'int', { m1Inspector: true }),
  /* shadow */
  p('shadow_width', 'int', { m1Inspector: true }),
  p('shadow_color', 'color', { m1Inspector: true }),
  p('shadow_offset_x', 'int', { m1Inspector: true }),
  p('shadow_offset_y', 'int', { m1Inspector: true }),
  p('shadow_spread', 'int', { m1Inspector: true }),
  p('shadow_opa', 'opa', { m1Inspector: true }),
  /* text */
  p('text_color', 'color', { m1Inspector: true }),
  p('text_font', 'fontRef', { m1Inspector: true }),
  p('text_opa', 'opa', { m1Inspector: true }),
  p('text_align', 'enum', { enum: TEXT_ALIGN_ENUM, m1Inspector: true }),
  p('text_letter_space', 'int'),
  p('text_line_space', 'int'),
  p('text_decor', 'enum', { enum: TEXT_DECOR_ENUM }),
  /* image */
  p('image_opa', 'opa'),
  p('image_recolor', 'color'),
  p('image_recolor_opa', 'opa'),
  /* line */
  p('line_color', 'color'),
  p('line_opa', 'opa'),
  p('line_width', 'int'),
  p('line_dash_width', 'int'),
  p('line_dash_gap', 'int'),
  p('line_rounded', 'bool'),
  /* arc */
  p('arc_color', 'color'),
  p('arc_opa', 'opa'),
  p('arc_width', 'int'),
  p('arc_rounded', 'bool'),
  p('arc_image_src', 'imageRef'),
  /* 混合/变换 */
  p('opa', 'opa', { m1Inspector: true }),
  p('opa_layered', 'opa'),
  p('color_filter_opa', 'opa'),
  p('anim_duration', 'int'),
  p('blend_mode', 'enum', { enum: BLEND_MODE_ENUM }),
  p('transform_width', 'int'),
  p('transform_height', 'int'),
  p('translate_x', 'int'),
  p('translate_y', 'int'),
  p('translate_radial', 'int'),
  p('transform_scale_x', 'int'),
  p('transform_scale_y', 'int'),
  p('transform_rotation', 'int'),
  p('transform_pivot_x', 'int'),
  p('transform_pivot_y', 'int'),
  p('transform_skew_x', 'int'),
  p('transform_skew_y', 'int'),
  p('bitmap_mask_src', 'imageRef'),
  p('rotary_sensitivity', 'int'),
  p('recolor', 'color'),
  p('recolor_opa', 'opa'),
  /* 布局 */
  p('layout', 'enum', { enum: LAYOUT_ENUM }),
  p('flex_flow', 'enum', { enum: FLEX_FLOW_ENUM }),
  p('flex_grow', 'int'),
  p('flex_main_place', 'enum', { enum: FLEX_ALIGN_ENUM }),
  p('flex_cross_place', 'enum', { enum: FLEX_ALIGN_ENUM }),
  p('flex_track_place', 'enum', { enum: FLEX_ALIGN_ENUM }),
  p('grid_column_align', 'enum', { enum: GRID_ALIGN_ENUM }),
  p('grid_row_align', 'enum', { enum: GRID_ALIGN_ENUM }),
  p('grid_cell_column_pos', 'int'),
  p('grid_cell_column_span', 'int'),
  p('grid_cell_x_align', 'enum', { enum: GRID_ALIGN_ENUM }),
  p('grid_cell_row_pos', 'int'),
  p('grid_cell_row_span', 'int'),
  p('grid_cell_y_align', 'enum', { enum: GRID_ALIGN_ENUM }),
  // 注:grid_column_dsc_array / grid_row_dsc_array 仅命名样式通道支持
  // (lv_xml_style.c:286-321),不在 obj parser 内联 style_ 清单里,
  // 本表以内联清单(112 项)为准,二期随 grid 布局 UI 一起补。
]);

/** M1 检查器子集(键列表,顺序即面板顺序) */
export const M1_INSPECTOR_STYLE_KEYS: readonly string[] = Object.values(STYLE_PROPS)
  .filter((s) => s.m1Inspector)
  .map((s) => s.key);

/**
 * text_font 一期取值:WASM 已编入的内置 montserrat 字体(8..48 偶数号)。
 * XML token 与 C 符号 &lv_font_montserrat_<n> 一一对应。
 */
export const M1_TEXT_FONTS: readonly string[] = Array.from(
  { length: (48 - 8) / 2 + 1 },
  (_, i) => `montserrat_${8 + i * 2}`,
);
