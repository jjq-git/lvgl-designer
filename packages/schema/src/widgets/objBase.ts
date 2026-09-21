/**
 * obj 基类:全部 widget 共享的普通属性 + flags + states。
 * 与 parser-attrs.json 的 obj.classified 节逐字一致
 * (源头 lv_xml_obj_parser.c:92-154;name 单列在 WidgetNode.name,不进 props)。
 */
import type { ObjFlagKey, ObjStateKey } from '../project.js';
import type { ObjBase, PropSpec } from '../registryTypes.js';
import { ALIGN_ENUM, FLEX_FLOW_ENUM, SCROLL_SNAP_ENUM, SCROLLBAR_MODE_ENUM } from '../enums.js';

const props: PropSpec[] = [
  {
    key: 'x', type: 'size', default: 0, channel: 'both',
    c: { setter: 'lv_obj_set_x($obj, $v)' },
    ui: { group: 'geometry', label: 'X', control: 'number' },
  },
  {
    key: 'y', type: 'size', default: 0, channel: 'both',
    c: { setter: 'lv_obj_set_y($obj, $v)' },
    ui: { group: 'geometry', label: 'Y', control: 'number' },
  },
  {
    key: 'width', type: 'size', channel: 'both',
    c: { setter: 'lv_obj_set_width($obj, $v)' },
    ui: { group: 'geometry', label: '宽', control: 'number' },
  },
  {
    key: 'height', type: 'size', channel: 'both',
    c: { setter: 'lv_obj_set_height($obj, $v)' },
    ui: { group: 'geometry', label: '高', control: 'number' },
  },
  {
    key: 'align', type: 'enum', enum: ALIGN_ENUM, default: 'top_left', channel: 'both',
    c: { setter: 'lv_obj_set_align($obj, $v)' },
    ui: { group: 'geometry', label: '对齐', control: 'select' },
  },
  {
    key: 'flex_flow', type: 'enum', enum: FLEX_FLOW_ENUM, channel: 'both',
    c: { setter: 'lv_obj_set_flex_flow($obj, $v)' },
    ui: { group: 'geometry', label: 'Flex 流向', control: 'select' },
  },
  {
    key: 'flex_grow', type: 'int', min: 0, channel: 'both',
    c: { setter: 'lv_obj_set_flex_grow($obj, $v)' },
    ui: { group: 'geometry', label: 'Flex 伸展', control: 'number' },
  },
  {
    key: 'ext_click_area', type: 'int', min: 0, channel: 'both',
    c: { setter: 'lv_obj_set_ext_click_area($obj, $v)' },
    ui: { group: 'behavior', label: '扩展点击区', control: 'number' },
  },
  {
    key: 'scroll_snap_x', type: 'enum', enum: SCROLL_SNAP_ENUM, default: 'none', channel: 'both',
    c: { setter: 'lv_obj_set_scroll_snap_x($obj, $v)' },
    ui: { group: 'behavior', label: '横向吸附', control: 'select' },
  },
  {
    key: 'scroll_snap_y', type: 'enum', enum: SCROLL_SNAP_ENUM, default: 'none', channel: 'both',
    c: { setter: 'lv_obj_set_scroll_snap_y($obj, $v)' },
    ui: { group: 'behavior', label: '纵向吸附', control: 'select' },
  },
  {
    key: 'scrollbar_mode', type: 'enum', enum: SCROLLBAR_MODE_ENUM, default: 'auto', channel: 'both',
    c: { setter: 'lv_obj_set_scrollbar_mode($obj, $v)' },
    ui: { group: 'behavior', label: '滚动条', control: 'select' },
  },
];

/** 25 个 flag,顺序照 parser(lv_obj_set_flag) */
const flags: readonly ObjFlagKey[] = [
  'hidden', 'clickable', 'click_focusable', 'checkable', 'scrollable',
  'scroll_elastic', 'scroll_momentum', 'scroll_one', 'scroll_chain_hor',
  'scroll_chain_ver', 'scroll_chain', 'scroll_on_focus', 'scroll_with_arrow',
  'snappable', 'press_lock', 'event_bubble', 'event_trickle', 'state_trickle',
  'gesture_bubble', 'adv_hittest', 'ignore_layout', 'floating',
  'send_draw_task_events', 'overflow_visible', 'flex_in_new_track',
];

/** 8 个 state(lv_obj_set_state) */
const states: readonly ObjStateKey[] = [
  'checked', 'focused', 'focus_key', 'edited', 'hovered',
  'pressed', 'scrolled', 'disabled',
];

export const OBJ_BASE: ObjBase = { props, flags, states };
