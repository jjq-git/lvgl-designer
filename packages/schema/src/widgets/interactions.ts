/**
 * 组件交互能力矩阵。
 *
 * 这里记录的是设计器应优先暴露的“组件语义事件”，不是 LVGL_EVENT_ALL 的机械全集。
 * 所有 lv_obj_t 理论上都能挂任意事件回调，但把绘制、布局、刷新等内部事件展示给普通
 * 组件会产生大量无效配置。矩阵按 vendor/lvgl v9.5.0 各 widget 的 constructor/event_cb
 * 和主动 lv_obj_send_event() 行为校准。
 */
import type { TriggerToken } from '../project.js';

export interface WidgetInteractionSpec {
  /** 检查器推荐并允许新建的语义事件，按默认优先级排列。 */
  events: readonly TriggerToken[];
  /** 组件属性中直接引用 Subject（例如 spangroup span 的 bind_text）。 */
  usesSubjects?: boolean;
}

const spec = (
  events: readonly TriggerToken[],
  usesSubjects = false,
): WidgetInteractionSpec => usesSubjects ? { events, usesSubjects } : { events };

/** 与 ALL_WIDGETS 一一对应；测试会阻止新增组件时漏配。 */
export const WIDGET_INTERACTIONS: Readonly<Record<string, WidgetInteractionSpec>> = Object.freeze({
  obj: spec(['clicked', 'pressed', 'released', 'scroll_begin', 'scroll', 'scroll_end']),
  label: spec([]),
  button: spec(['clicked', 'long_pressed', 'pressed', 'released']),
  slider: spec(['value_changed', 'pressed', 'pressing', 'released']),
  switch: spec(['value_changed', 'clicked', 'pressed', 'released']),
  checkbox: spec(['value_changed', 'clicked', 'pressed', 'released']),
  bar: spec([]),
  arc: spec(['value_changed', 'pressed', 'pressing', 'released']),
  image: spec([]),
  dropdown: spec(['value_changed', 'ready', 'cancel', 'focused', 'defocused']),
  roller: spec(['value_changed', 'clicked', 'focused', 'defocused']),
  textarea: spec(['value_changed', 'insert', 'ready', 'focused', 'defocused']),
  spinbox: spec(['value_changed', 'focused', 'defocused']),
  qrcode: spec([]),
  scale: spec([]),
  buttonmatrix: spec(['value_changed', 'pressed', 'pressing', 'released', 'focused', 'defocused']),
  calendar: spec(['value_changed']),
  chart: spec(['value_changed', 'pressed', 'released']),
  keyboard: spec(['value_changed', 'ready', 'cancel']),
  spangroup: spec([], true),
  table: spec(['value_changed', 'pressed', 'pressing', 'released', 'focused']),
  tabview: spec(['value_changed']),
  led: spec([]),
  line: spec([]),
  spinner: spec([]),
  imagebutton: spec(['clicked', 'long_pressed', 'pressed', 'released', 'press_lost']),
  animimage: spec([]),
  msgbox: spec([]),
  list: spec(['scroll_begin', 'scroll', 'scroll_end']),
  menu: spec(['value_changed']),
  win: spec([]),
  tileview: spec(['value_changed', 'scroll_begin', 'scroll', 'scroll_end']),
  arclabel: spec([]),
  canvas: spec([]),
  lottie: spec([]),
});

/** 只有 isObj 的结构子元素能直接挂事件；非对象句柄不提供交互页。 */
export const CHILD_INTERACTIONS: Readonly<Record<string, WidgetInteractionSpec>> = Object.freeze({
  'dropdown-list': spec(['scroll_begin', 'scroll', 'scroll_end']),
  'calendar-header_arrow': spec([]),
  'calendar-header_dropdown': spec([]),
  'tabview-tab': spec(['scroll_begin', 'scroll', 'scroll_end']),
  'tabview-tab_bar': spec([]),
  'tabview-tab_button': spec(['clicked', 'pressed', 'released']),
  'msgbox-button': spec(['clicked', 'long_pressed', 'pressed', 'released']),
  'list-text': spec([]),
  'list-button': spec(['clicked', 'long_pressed', 'pressed', 'released']),
  'menu-page': spec(['scroll_begin', 'scroll', 'scroll_end']),
  'win-button': spec(['clicked', 'long_pressed', 'pressed', 'released']),
  'tileview-tile': spec(['scroll_begin', 'scroll', 'scroll_end']),
});

export const SCREEN_INTERACTION: WidgetInteractionSpec = spec([
  'screen_load_start', 'screen_loaded', 'screen_unload_start', 'screen_unloaded',
  'resolution_changed',
]);

export function getWidgetInteraction(type: string): WidgetInteractionSpec {
  return WIDGET_INTERACTIONS[type] ?? CHILD_INTERACTIONS[type] ?? spec([]);
}
