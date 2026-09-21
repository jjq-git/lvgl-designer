/**
 * 基础枚举 token 表,与 vendor/lvgl/src/others/xml/lv_xml_base_types.c 一一对应。
 */
import type { EnumSpec } from './registryTypes.js';

/** lv_xml_align_to_enum(base_types.c:71-85) */
export const ALIGN_ENUM: EnumSpec = {
  tokens: [
    'top_left', 'top_mid', 'top_right',
    'bottom_left', 'bottom_mid', 'bottom_right',
    'right_mid', 'left_mid', 'center',
  ],
  cPrefix: 'LV_ALIGN_',
};

/** lv_xml_flex_flow_to_enum(:176-189) */
export const FLEX_FLOW_ENUM: EnumSpec = {
  tokens: [
    'column', 'column_reverse', 'column_wrap', 'column_wrap_reverse',
    'row', 'row_reverse', 'row_wrap', 'row_wrap_reverse',
  ],
  cPrefix: 'LV_FLEX_FLOW_',
};

/** lv_xml_flex_align_to_enum(:191-202) */
export const FLEX_ALIGN_ENUM: EnumSpec = {
  tokens: ['center', 'end', 'start', 'space_around', 'space_between', 'space_evenly'],
  cPrefix: 'LV_FLEX_ALIGN_',
};

/** lv_xml_grid_align_to_enum(:204-217) */
export const GRID_ALIGN_ENUM: EnumSpec = {
  tokens: ['center', 'end', 'start', 'stretch', 'space_around', 'space_between', 'space_evenly'],
  cPrefix: 'LV_GRID_ALIGN_',
};

/** lv_xml_scroll_snap_to_enum(:156-164) */
export const SCROLL_SNAP_ENUM: EnumSpec = {
  tokens: ['none', 'start', 'center', 'end'],
  cPrefix: 'LV_SCROLL_SNAP_',
};

/** lv_xml_scrollbar_mode_to_enum(:167-174) */
export const SCROLLBAR_MODE_ENUM: EnumSpec = {
  tokens: ['off', 'on', 'active', 'auto'],
  cPrefix: 'LV_SCROLLBAR_MODE_',
};

/** lv_xml_dir_to_enum(:87-100) */
export const DIR_ENUM: EnumSpec = {
  tokens: ['none', 'top', 'bottom', 'left', 'right', 'hor', 'ver', 'all'],
  cPrefix: 'LV_DIR_',
};

/** lv_xml_border_side_to_enum(:102-113) */
export const BORDER_SIDE_ENUM: EnumSpec = {
  tokens: ['none', 'top', 'bottom', 'left', 'right', 'full'],
  cPrefix: 'LV_BORDER_SIDE_',
};

/** lv_xml_grad_dir_to_enum(:115-123) */
export const GRAD_DIR_ENUM: EnumSpec = {
  tokens: ['none', 'hor', 'ver'],
  cPrefix: 'LV_GRAD_DIR_',
};

/** lv_xml_base_dir_to_enum(:125-133) */
export const BASE_DIR_ENUM: EnumSpec = {
  tokens: ['auto', 'ltr', 'rtl'],
  cPrefix: 'LV_BASE_DIR_',
};

/** lv_xml_text_align_to_enum(:135-144) */
export const TEXT_ALIGN_ENUM: EnumSpec = {
  tokens: ['left', 'right', 'center', 'auto'],
  cPrefix: 'LV_TEXT_ALIGN_',
};

/** lv_xml_text_decor_to_enum(:146-154) */
export const TEXT_DECOR_ENUM: EnumSpec = {
  tokens: ['none', 'underline', 'strikethrough'],
  cPrefix: 'LV_TEXT_DECOR_',
};

/** lv_xml_layout_to_enum(:219-227) */
export const LAYOUT_ENUM: EnumSpec = {
  tokens: ['none', 'flex', 'grid'],
  cPrefix: 'LV_LAYOUT_',
};

/** lv_xml_blend_mode_to_enum(:229-239) */
export const BLEND_MODE_ENUM: EnumSpec = {
  tokens: ['normal', 'additive', 'subtractive', 'multiply', 'difference'],
  cPrefix: 'LV_BLEND_MODE_',
};

/** lv_xml_state_to_enum(:42-58,样式 selector 用) */
export const STATE_TOKENS = [
  'default', 'pressed', 'checked', 'hovered', 'scrolled', 'disabled',
  'focused', 'focus_key', 'edited', 'user_1', 'user_2', 'user_3', 'user_4',
] as const;

/** lv_xml_style_part_to_enum(可表达子集,无 LV_PART_ANY/TICKS token) */
export const PART_TOKENS = [
  'main', 'scrollbar', 'indicator', 'knob', 'selected', 'items', 'cursor',
] as const;

/** lv_xml_trigger_text_to_enum_value(base_types.c:241-312)全集 */
export const TRIGGER_TOKENS = [
  'all', 'pressed', 'pressing', 'press_lost',
  'short_clicked', 'single_clicked', 'double_clicked', 'triple_clicked',
  'long_pressed', 'long_pressed_repeat', 'clicked', 'released',
  'scroll_begin', 'scroll_throw_begin', 'scroll_end', 'scroll',
  'gesture', 'key', 'rotary', 'focused', 'defocused', 'leave',
  'hit_test', 'indev_reset', 'hover_over', 'hover_leave',
  'cover_check', 'refr_ext_draw_size',
  'draw_main_begin', 'draw_main', 'draw_main_end',
  'draw_post_begin', 'draw_post', 'draw_post_end', 'draw_task_added',
  'value_changed', 'insert', 'refresh', 'ready', 'cancel',
  'create', 'delete', 'child_changed', 'child_created', 'child_deleted',
  'screen_unload_start', 'screen_load_start', 'screen_loaded', 'screen_unloaded',
  'size_changed', 'style_changed', 'layout_changed', 'get_self_size',
  'invalidate_area', 'resolution_changed', 'color_format_changed',
  'refr_request', 'refr_start', 'refr_ready',
  'render_start', 'render_ready',
  'flush_start', 'flush_finish', 'flush_wait_start', 'flush_wait_finish',
  'vsync',
] as const;

/** lv_xml_screen_load_anim_text_to_enum_value(:317-338) */
export const SCREEN_LOAD_ANIM_TOKENS = [
  'none', 'over_left', 'over_right', 'over_top', 'over_bottom',
  'move_left', 'move_right', 'move_top', 'move_bottom',
  'fade_in', 'fade_on', 'fade_out',
  'out_left', 'out_right', 'out_top', 'out_bottom',
] as const;
