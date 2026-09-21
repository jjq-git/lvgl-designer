/**
 * PreviewProgram -> 受控 WASM bridge 调用。
 *
 * v1 故意只开放 P0 widget、line 点列表、table/tabview 结构切片及其受控能力。所有能力先完整
 * preflight，再变更 runtime，避免「前半棵树已创建，后半才发现不支持」。
 */
import type { PreviewNode, PreviewProgram } from '@lvd/preview-compiler';

const SUPPORTED_WIDGETS = new Set([
  'obj', 'label', 'button', 'image', 'slider', 'switch', 'arc', 'bar',
  'table', 'tabview', 'list', 'imagebutton', 'line', 'arclabel', 'spangroup', 'checkbox',
  'dropdown', 'roller', 'textarea', 'spinbox', 'buttonmatrix', 'keyboard', 'led', 'spinner',
  'qrcode', 'scale', 'calendar', 'msgbox', 'menu', 'win', 'tileview', 'chart', 'animimage', 'canvas', 'lottie',
]);
const STRUCTURAL_TYPES = new Map<string, { kind: PreviewNode['kind']; parent: string }>([
  ['tabview-tab', { kind: 'add', parent: 'tabview' }],
  ['tabview-tab_bar', { kind: 'getter', parent: 'tabview' }],
  ['tabview-tab_button', { kind: 'getter', parent: 'tabview' }],
  ['table-column', { kind: 'virtual', parent: 'table' }],
  ['table-cell', { kind: 'virtual', parent: 'table' }],
  ['list-text', { kind: 'add', parent: 'list' }],
  ['list-button', { kind: 'add', parent: 'list' }],
  ['spangroup-span', { kind: 'add', parent: 'spangroup' }],
  ['dropdown-list', { kind: 'getter', parent: 'dropdown' }],
  ['calendar-header_arrow', { kind: 'add', parent: 'calendar' }],
  ['calendar-header_dropdown', { kind: 'add', parent: 'calendar' }],
  ['msgbox-button', { kind: 'add', parent: 'msgbox' }],
  ['menu-page', { kind: 'add', parent: 'menu' }],
  ['win-button', { kind: 'add', parent: 'win' }],
  ['tileview-tile', { kind: 'add', parent: 'tileview' }],
  ['chart-series', { kind: 'add', parent: 'chart' }],
  ['chart-cursor', { kind: 'add', parent: 'chart' }],
  ['chart-axis', { kind: 'virtual', parent: 'chart' }],
]);
const COMMON_I32_PROPS = new Set(['x', 'y', 'width', 'height', 'flex_grow', 'ext_click_area']);
const COMMON_STRING_PROPS = new Set(['x', 'y', 'width', 'height']);
const TYPE_I32_PROPS: Record<string, ReadonlySet<string>> = {
  obj: new Set(), label: new Set(), button: new Set(), switch: new Set(), checkbox: new Set(),
  image: new Set(['rotation', 'scale_x', 'scale_y', 'pivot_x', 'pivot_y']),
  slider: new Set(['min_value', 'max_value', 'value', 'start_value']),
  bar: new Set(['min_value', 'max_value', 'value', 'start_value']),
  table: new Set(['column_count', 'row_count']),
  tabview: new Set(['active']),
  arc: new Set([
    'start_angle', 'end_angle', 'bg_start_angle', 'bg_end_angle', 'rotation',
    'value', 'min_value', 'max_value', 'change_rate', 'knob_offset',
  ]),
  line: new Set(['y_invert']),
  arclabel: new Set([
    'angle_start', 'angle_size', 'offset', 'radius', 'center_offset_x', 'center_offset_y',
  ]),
  spangroup: new Set(['max_lines', 'indent']),
  dropdown: new Set(['selected']),
  roller: new Set(['selected', 'visible_row_count']),
  textarea: new Set(['password_show_time', 'cursor_pos', 'max_length']),
  spinbox: new Set(['value', 'digit_count', 'dec_point_pos', 'min_value', 'max_value', 'step']),
  buttonmatrix: new Set(['selected_button']),
  keyboard: new Set(),
  msgbox: new Set(),
  led: new Set(['brightness']),
  spinner: new Set(['anim_duration', 'angle']),
  qrcode: new Set(['size']),
  scale: new Set([
    'total_tick_count', 'major_tick_every', 'min_value', 'max_value', 'angle_range', 'rotation',
  ]),
  calendar: new Set([
    'today_year', 'today_month', 'today_day', 'shown_year', 'shown_month',
  ]),
  chart: new Set(['point_count', 'hor_div_line_count', 'ver_div_line_count']),
  animimage: new Set(['duration', 'repeat_count']),
  'chart-cursor': new Set(['pos_x', 'pos_y']),
  'chart-axis': new Set(['min_value', 'max_value']),
};
const TYPE_STRING_PROPS: Record<string, ReadonlySet<string>> = {
  obj: new Set(), button: new Set(), slider: new Set(), switch: new Set(), arc: new Set(), bar: new Set(),
  table: new Set(), tabview: new Set(['tab_bar_position']),
  label: new Set(['text']),
  checkbox: new Set(['text']),
  image: new Set(['src']),
  list: new Set(),
  imagebutton: new Set([
    'src_released_left', 'src_released_mid', 'src_released_right',
    'src_pressed_left', 'src_pressed_mid', 'src_pressed_right', 'state',
  ]),
  line: new Set(),
  arclabel: new Set([
    'text', 'dir', 'text_vertical_align', 'text_horizontal_align',
  ]),
  spangroup: new Set(['overflow']),
  'spangroup-span': new Set(['text', 'style', 'bind_text', 'bind_text_fmt']),
  dropdown: new Set(['options', 'text', 'symbol']),
  roller: new Set(['options', 'options_mode']),
  textarea: new Set(['text', 'placeholder_text']),
  spinbox: new Set(),
  buttonmatrix: new Set(['ctrl_map']),
  keyboard: new Set(['mode', 'textarea']),
  led: new Set(['color']),
  spinner: new Set(),
  qrcode: new Set(['dark_color', 'light_color', 'data']),
  scale: new Set(['mode']),
  msgbox: new Set(['title', 'text']),
  menu: new Set(['mode_header', 'mode_root_back_button']),
  win: new Set(['title']),
  chart: new Set(['type', 'update_mode']),
  canvas: new Set(['fill_color']),
  lottie: new Set(['src']),
  'table-cell': new Set(['value', 'ctrl']),
};
const TYPE_POINT_LIST_PROPS: Record<string, ReadonlySet<string>> = {
  line: new Set(['points']),
};
const TYPE_STRING_LIST_PROPS: Record<string, ReadonlySet<string>> = {
  buttonmatrix: new Set(['map']),
  animimage: new Set(['srcs']),
};
const TYPE_I32_LIST_PROPS: Record<string, ReadonlySet<string>> = {
  'chart-series': new Set(['values']),
};
const TYPE_BOOL_PROPS: Record<string, ReadonlySet<string>> = {
  line: new Set(['y_invert']),
  arclabel: new Set(['recolor']),
  roller: new Set(['selected_animated']),
  textarea: new Set(['one_line', 'password_mode', 'text_selection']),
  spinbox: new Set(['rollover']),
  buttonmatrix: new Set(['one_checked']),
  keyboard: new Set(['popovers']),
  qrcode: new Set(['quiet_zone']),
  scale: new Set(['label_show', 'post_draw', 'draw_ticks_on_top']),
  msgbox: new Set(['close_button']),
};
const SUPPORTED_FLAGS = new Set([
  'hidden', 'clickable', 'click_focusable', 'checkable', 'scrollable',
  'scroll_elastic', 'scroll_momentum', 'scroll_one', 'scroll_chain_hor',
  'scroll_chain_ver', 'scroll_chain', 'scroll_on_focus', 'scroll_with_arrow',
  'snappable', 'press_lock', 'event_bubble', 'event_trickle', 'state_trickle',
  'gesture_bubble', 'adv_hittest', 'ignore_layout', 'floating',
  'send_draw_task_events', 'overflow_visible', 'flex_in_new_track',
]);
const SUPPORTED_STATES = new Set([
  'checked', 'focused', 'focus_key', 'edited', 'hovered', 'pressed', 'scrolled', 'disabled',
]);
const SELECTOR_PARTS = new Set(['main', 'scrollbar', 'indicator', 'knob', 'selected', 'items', 'cursor']);
const SELECTOR_STATES = new Set([
  'default', 'pressed', 'checked', 'scrolled', 'focused', 'focus_key', 'edited',
  'hovered', 'disabled', 'user_1', 'user_2', 'user_3', 'user_4',
]);
const STYLE_I32 = new Set([
  'radius', 'pad_hor', 'pad_ver', 'pad_all', 'bg_opa',
  'border_width', 'border_opa', 'outline_width', 'outline_opa', 'outline_pad',
  'shadow_width', 'shadow_offset_x', 'shadow_offset_y', 'shadow_spread', 'shadow_opa',
  'text_opa', 'opa',
]);
const STYLE_COLOR = new Set(['bg_color', 'border_color', 'outline_color', 'shadow_color', 'text_color']);
const STYLE_ENUM = new Set(['align', 'text_align']);
const STYLE_FONT = new Set(['text_font']);
const STYLE_STRING = new Set([...STYLE_COLOR, ...STYLE_ENUM, ...STYLE_FONT]);
const OPA_STYLES = new Set(['bg_opa', 'border_opa', 'outline_opa', 'shadow_opa', 'text_opa', 'opa']);
const STYLE_ENUM_VALUES: Record<string, ReadonlySet<string>> = {
  align: new Set([
    'top_left', 'top_mid', 'top_right', 'bottom_left', 'bottom_mid',
    'bottom_right', 'right_mid', 'left_mid', 'center',
  ]),
  text_align: new Set(['left', 'right', 'center', 'auto']),
};
const BIND_OPS = new Set(['eq', 'not_eq', 'gt', 'ge', 'lt', 'le']);
const VALUE_BIND_WIDGETS = new Set(['slider', 'bar', 'arc', 'dropdown', 'roller', 'spinbox']);
const CHECKED_BIND_WIDGETS = new Set(['obj', 'button', 'switch', 'imagebutton', 'checkbox']);
const EVENT_TRIGGERS = new Set([
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
  'refr_request', 'refr_start', 'refr_ready', 'render_start', 'render_ready',
  'flush_start', 'flush_finish', 'flush_wait_start', 'flush_wait_finish', 'vsync',
]);
const SCREEN_ANIMS = new Set([
  'none', 'over_left', 'over_right', 'over_top', 'over_bottom',
  'move_left', 'move_right', 'move_top', 'move_bottom',
  'fade_in', 'fade_on', 'fade_out', 'out_left', 'out_right', 'out_top', 'out_bottom',
]);
const TABVIEW_BAR_POSITIONS = new Set(['top', 'bottom', 'left', 'right']);
const TABLE_CELL_CTRLS = new Set([
  'none', 'merge_right', 'text_crop', 'custom_1', 'custom_2', 'custom_3', 'custom_4',
]);
const IMAGEBUTTON_STATES = new Set([
  'released', 'pressed', 'disabled',
  'checked_released', 'checked_pressed', 'checked_disabled',
]);
const ARCLABEL_DIRS = new Set(['clockwise', 'counter_clockwise']);
const ARCLABEL_TEXT_ALIGNS = new Set(['default', 'leading', 'center', 'trailing']);
const SPANGROUP_OVERFLOWS = new Set(['clip', 'ellipsis']);
const ROLLER_MODES = new Set(['normal', 'infinite']);
const BUTTONMATRIX_CTRLS = new Set([
  'none',
  ...Array.from({ length: 15 }, (_, index) => `width_${index + 1}`),
  'hidden', 'no_repeat', 'disabled', 'checkable', 'checked', 'click_trig', 'popover', 'recolor',
  'reserved_1', 'reserved_2', 'custom_1', 'custom_2',
]);
const KEYBOARD_MODES = new Set([
  'text_upper', 'text_lower', 'text_arabic', 'number', 'special',
  'user_1', 'user_2', 'user_3', 'user_4',
]);
const SCALE_MODES = new Set([
  'horizontal_top', 'horizontal_bottom', 'vertical_left', 'vertical_right',
  'round_inner', 'round_outer',
]);
const MENU_HEADER_MODES = new Set(['top_fixed', 'top_unfixed', 'bottom_fixed']);
const MENU_ROOT_BACK_BUTTON_MODES = new Set(['disabled', 'enabled']);
const TILEVIEW_DIRS = new Set(['none', 'left', 'right', 'top', 'bottom', 'hor', 'ver', 'all']);
const CHART_TYPES = new Set(['none', 'line', 'bar', 'stacked', 'scatter']);
const CHART_UPDATE_MODES = new Set(['shift', 'circular']);
const CHART_AXES = new Set(['primary_x', 'primary_y', 'secondary_x', 'secondary_y']);
const I32_MIN = -2147483648;
const I32_MAX = 2147483647;
const U32_MAX = 4294967295;

export interface PreviewBridge {
  begin(protocolVersion: number, width: number, height: number, colorFormat: string): number;
  createSubjectI32(
    name: string, initial: number, min: number, hasMin: boolean, max: number, hasMax: boolean,
  ): number;
  createSubjectFloat(
    name: string, initial: number, min: number, hasMin: boolean, max: number, hasMax: boolean,
  ): number;
  createSubjectString(name: string, initial: string, capacity: number): number;
  createSubjectColor(name: string, initial: string): number;
  createStyle(name: string): number;
  setNamedStyleI32(name: string, key: string, value: number): number;
  setNamedStyleString(name: string, key: string, value: string): number;
  createScreen(name: string): number;
  createNode(parentName: string, runtimeName: string, type: string): number;
  createStructural(parentName: string, runtimeName: string, type: string, arg: string): number;
  createListItem(
    parentName: string, runtimeName: string, type: 'list-text' | 'list-button',
    icon: string, text: string,
  ): number;
  setTableColumn(parentName: string, column: number, width: number): number;
  setTableCellValue(parentName: string, row: number, column: number, value: string): number;
  setTableCellCtrl(parentName: string, row: number, column: number, ctrl: string): number;
  setI32(runtimeName: string, key: string, value: number): number;
  setString(runtimeName: string, key: string, value: string): number;
  setPointList(runtimeName: string, key: string, value: string): number;
  setStringList(runtimeName: string, key: string, value: string): number;
  setI32List(runtimeName: string, key: string, value: string): number;
  setChartAxis(parentName: string, axis: string, key: string, value: number): number;
  setFlag(runtimeName: string, flag: string, enabled: boolean): number;
  setState(runtimeName: string, state: string, enabled: boolean): number;
  setStyleI32(
    runtimeName: string, key: string, value: number, part: string, states: string,
  ): number;
  setStyleString(
    runtimeName: string, key: string, value: string, part: string, states: string,
  ): number;
  addStyle(runtimeName: string, styleName: string, part: string, states: string): number;
  bindProp(runtimeName: string, prop: string, subjectName: string, format: string): number;
  bindFlag(runtimeName: string, flag: string, op: string, subjectName: string, refValue: number): number;
  bindState(runtimeName: string, state: string, op: string, subjectName: string, refValue: number): number;
  addCallbackEvent(
    runtimeName: string, trigger: string, callback: string, userData: string, hasUserData: boolean,
  ): number;
  addSubjectSetEvent(
    runtimeName: string, trigger: string, subjectName: string,
    subjectType: 'int' | 'float' | 'string', value: string,
  ): number;
  addSubjectToggleEvent(runtimeName: string, trigger: string, subjectName: string): number;
  addSubjectIncrementEvent(
    runtimeName: string, trigger: string, subjectName: string, step: number,
    min: number, hasMin: boolean, max: number, hasMax: boolean,
    rollover: boolean, hasRollover: boolean,
  ): number;
  addScreenEvent(
    runtimeName: string, trigger: string, action: 'screen_load' | 'screen_create', screenName: string,
    animType: string, duration: number, delay: number,
  ): number;
  finish(homeScreenName: string): number;
}

export interface PreviewSupportIssue {
  code: string;
  path: string;
  message: string;
}

function issue(
  out: PreviewSupportIssue[], code: string, path: string, message: string,
): void {
  out.push({ code, path, message });
}

type PreviewConst = PreviewProgram['globals']['consts'][number];
type PreviewSubject = PreviewProgram['globals']['subjects'][number];
type ConstType = PreviewConst['type'];
interface ResolvedConst { type: ConstType; value: string | number }
type ConstScope = ReadonlyMap<string, ResolvedConst>;

function isConstRef(value: unknown): value is { $const: string } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof (value as { $const?: unknown }).$const === 'string';
}

function percentNumber(value: string): number | undefined {
  const match = /^(-?\d+)%$/.exec(value);
  if (!match) return undefined;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : undefined;
}

function isRuntimeSizeString(value: string): boolean {
  const percent = percentNumber(value);
  return value === 'content' || (percent !== undefined && Math.abs(percent) <= 1000);
}

function parseConstValue(def: PreviewConst): ResolvedConst | undefined {
  switch (def.type) {
    case 'int':
    case 'px': {
      if (!/^-?\d+$/.test(def.value)) return undefined;
      const value = Number(def.value);
      return Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647
        ? { type: def.type, value } : undefined;
    }
    case 'percent': {
      const normalized = def.value.endsWith('%') ? def.value : `${def.value}%`;
      const value = percentNumber(normalized);
      return value !== undefined && value >= -2147483648 && value <= 2147483647
        ? { type: def.type, value: `${value}%` } : undefined;
    }
    case 'color': {
      const match = /^(?:#|0[xX])([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(def.value);
      return match ? { type: def.type, value: `#${match[1]}` } : undefined;
    }
    case 'string':
      return { type: def.type, value: def.value };
    default:
      return undefined;
  }
}

function collectConsts(
  defs: readonly PreviewConst[], path: string, out?: PreviewSupportIssue[],
): Map<string, ResolvedConst> {
  const values = new Map<string, ResolvedConst>();
  for (let index = 0; index < defs.length; index++) {
    const def = defs[index]!;
    const defPath = `${path}[${index}]`;
    if (def.name.length === 0) {
      if (out) issue(out, 'E_PREVIEW_CONST_NAME_INVALID', `${defPath}.name`, 'const 名称不得为空');
      continue;
    }
    if (values.has(def.name)) {
      if (out) issue(out, 'E_PREVIEW_DUPLICATE_CONST_NAME', `${defPath}.name`, `const 重复:${def.name}`);
      continue;
    }
    const value = parseConstValue(def);
    if (value === undefined) {
      if (out) issue(out, 'E_PREVIEW_CONST_VALUE_INVALID', `${defPath}.value`,
        `非法 ${def.type} const:${def.value}`);
      continue;
    }
    values.set(def.name, value);
  }
  return values;
}

function withScreenConsts(globalConsts: ConstScope, localDefs: readonly PreviewConst[]): Map<string, ResolvedConst> {
  const values = new Map(globalConsts);
  for (const def of localDefs) {
    const value = parseConstValue(def);
    if (value !== undefined) values.set(def.name, value);
  }
  return values;
}

const UNRESOLVED = Symbol('unresolved-preview-const');

function resolveValue(
  value: unknown,
  consts: ConstScope,
  path: string,
  out?: PreviewSupportIssue[],
  allowedTypes?: readonly ConstType[],
): unknown | typeof UNRESOLVED {
  if (!isConstRef(value)) return value;
  const entry = consts.get(value.$const);
  if (entry === undefined) {
    if (out) issue(out, 'E_PREVIEW_CONST_MISSING', path, `const 不存在:${value.$const}`);
    return UNRESOLVED;
  }
  if (allowedTypes && !allowedTypes.includes(entry.type)) {
    if (out) issue(out, 'E_PREVIEW_CONST_TYPE_MISMATCH', path,
      `const ${value.$const} 类型 ${entry.type} 不适用于此属性，期望:${allowedTypes.join('|')}`);
    return UNRESOLVED;
  }
  return entry.value;
}

function styleConstTypes(key: string): readonly ConstType[] | undefined {
  if (key === 'radius') return ['int', 'px', 'percent'];
  if (OPA_STYLES.has(key)) return ['int', 'percent'];
  if (STYLE_I32.has(key)) return ['int', 'px'];
  if (STYLE_COLOR.has(key)) return ['color'];
  if (STYLE_ENUM.has(key) || STYLE_FONT.has(key)) return ['string'];
  return undefined;
}

function propConstTypes(type: string, key: string): readonly ConstType[] | undefined {
  if (COMMON_STRING_PROPS.has(key)) return ['int', 'px', 'percent'];
  if (key === 'ext_click_area') return ['int', 'px'];
  if (key === 'flex_grow' || TYPE_I32_PROPS[type]?.has(key)) return ['int'];
  if (TYPE_STRING_PROPS[type]?.has(key)) return ['string'];
  return undefined;
}

function validateSubjects(
  subjects: readonly PreviewSubject[], out: PreviewSupportIssue[],
): Map<string, PreviewSubject> {
  const byName = new Map<string, PreviewSubject>();
  const validNumber = (value: number): boolean => Number.isFinite(value)
    && Number.isFinite(Math.fround(value));
  const validI32 = (value: number): boolean => Number.isInteger(value)
    && value >= -2147483648 && value <= 2147483647;
  for (let index = 0; index < subjects.length; index++) {
    const subject = subjects[index]!;
    const path = `globals.subjects[${index}]`;
    if (subject.name.length === 0) {
      issue(out, 'E_PREVIEW_SUBJECT_NAME_INVALID', `${path}.name`, 'subject 名称不得为空');
    } else if (byName.has(subject.name)) {
      issue(out, 'E_PREVIEW_DUPLICATE_SUBJECT_NAME', `${path}.name`, `subject 重复:${subject.name}`);
    } else {
      byName.set(subject.name, subject);
    }
    if (subject.type === 'int') {
      if (!validI32(subject.initial)
        || (subject.min !== undefined && !validI32(subject.min))
        || (subject.max !== undefined && !validI32(subject.max))) {
        issue(out, 'E_PREVIEW_SUBJECT_VALUE_INVALID', path, `int subject ${subject.name} 必须使用 int32`);
      }
      if (subject.min !== undefined && subject.max !== undefined && subject.min > subject.max) {
        issue(out, 'E_PREVIEW_SUBJECT_RANGE_INVALID', path, `subject ${subject.name} 的 min 大于 max`);
      }
      if ((subject.min !== undefined && subject.initial < subject.min)
        || (subject.max !== undefined && subject.initial > subject.max)) {
        issue(out, 'E_PREVIEW_SUBJECT_RANGE_INVALID', `${path}.initial`, `subject ${subject.name} 初值超出范围`);
      }
    } else if (subject.type === 'float') {
      if (!validNumber(subject.initial)
        || (subject.min !== undefined && !validNumber(subject.min))
        || (subject.max !== undefined && !validNumber(subject.max))) {
        issue(out, 'E_PREVIEW_SUBJECT_VALUE_INVALID', path, `float subject ${subject.name} 必须使用有限数值`);
      }
      if (subject.min !== undefined && subject.max !== undefined && subject.min > subject.max) {
        issue(out, 'E_PREVIEW_SUBJECT_RANGE_INVALID', path, `subject ${subject.name} 的 min 大于 max`);
      }
      if ((subject.min !== undefined && subject.initial < subject.min)
        || (subject.max !== undefined && subject.initial > subject.max)) {
        issue(out, 'E_PREVIEW_SUBJECT_RANGE_INVALID', `${path}.initial`, `subject ${subject.name} 初值超出范围`);
      }
    } else if (subject.type === 'string') {
      const initial: unknown = subject.initial;
      if (typeof initial !== 'string') {
        issue(out, 'E_PREVIEW_SUBJECT_VALUE_INVALID', `${path}.initial`, 'string subject 初值非法');
      }
    } else if (subject.type === 'color') {
      if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(subject.initial)) {
        issue(out, 'E_PREVIEW_SUBJECT_VALUE_INVALID', `${path}.initial`, `color subject ${subject.name} 初值非法`);
      }
    } else {
      issue(out, 'E_PREVIEW_SUBJECT_TYPE_UNSUPPORTED', `${path}.type`, `不支持 subject 类型:${String(subject)}`);
    }
  }
  return byName;
}

function validLabelFormat(format: string | undefined, type: PreviewSubject['type']): boolean {
  if (format === undefined) return type === 'int' || type === 'float' || type === 'string';
  const conversion = type === 'string'
    ? /^%s/
    : type === 'int'
      ? /^%[-+ 0#]*\d*(?:\.\d+)?d/
      : type === 'float'
        ? /^%[-+ 0#]*\d*(?:\.\d+)?f/
        : null;
  if (!conversion) return false;
  let count = 0;
  for (let index = 0; index < format.length; index++) {
    if (format[index] !== '%') continue;
    if (format[index + 1] === '%') {
      index++;
      continue;
    }
    const match = conversion.exec(format.slice(index));
    if (!match) return false;
    count++;
    index += match[0].length - 1;
  }
  return count === 1;
}

function validateBindings(
  node: PreviewNode,
  path: string,
  subjects: ReadonlyMap<string, PreviewSubject>,
  out: PreviewSupportIssue[],
): void {
  for (let index = 0; index < node.bindings.length; index++) {
    const binding = node.bindings[index]!;
    const bindingPath = `${path}.bindings[${index}]`;
    const subject = subjects.get(binding.subject);
    if (!subject) {
      issue(out, 'E_PREVIEW_SUBJECT_MISSING', `${bindingPath}.subject`, `subject 不存在:${binding.subject}`);
      continue;
    }
    if (binding.kind === 'prop') {
      if (binding.prop === 'value') {
        if (!VALUE_BIND_WIDGETS.has(node.type) || (subject.type !== 'int' && subject.type !== 'float')) {
          issue(out, 'E_PREVIEW_BINDING_UNSUPPORTED', bindingPath,
            `${node.type}.value 不支持 ${subject.type} subject`);
        }
      } else if (binding.prop === 'checked') {
        if (!CHECKED_BIND_WIDGETS.has(node.type) || subject.type !== 'int') {
          issue(out, 'E_PREVIEW_BINDING_UNSUPPORTED', bindingPath,
            `${node.type}.checked 仅支持 int subject`);
        }
      } else if (binding.prop === 'text') {
        if (node.type !== 'label' || !validLabelFormat(binding.fmt, subject.type)) {
          issue(out, 'E_PREVIEW_BINDING_UNSUPPORTED', bindingPath,
            `${node.type}.text 的 ${subject.type} subject/format 不受支持`);
        }
      } else {
        issue(out, 'E_PREVIEW_BINDING_UNSUPPORTED', bindingPath,
          `v1 driver 不支持 ${node.type}.bind_${binding.prop}`);
      }
    } else {
      if (subject.type !== 'int') {
        issue(out, 'E_PREVIEW_BINDING_UNSUPPORTED', bindingPath, 'flag/state 条件绑定仅支持 int subject');
      }
      if (!BIND_OPS.has(binding.op) || !Number.isInteger(binding.refValue)
        || binding.refValue < -2147483648 || binding.refValue > 2147483647) {
        issue(out, 'E_PREVIEW_BINDING_CONDITION_INVALID', bindingPath, 'binding 条件或 refValue 非法');
      }
      if (binding.kind === 'flag' && !SUPPORTED_FLAGS.has(binding.flag)) {
        issue(out, 'E_PREVIEW_FLAG_UNSUPPORTED', `${bindingPath}.flag`, `不支持 flag:${binding.flag}`);
      }
      if (binding.kind === 'state' && !SUPPORTED_STATES.has(binding.state)) {
        issue(out, 'E_PREVIEW_STATE_UNSUPPORTED', `${bindingPath}.state`, `不支持 state:${binding.state}`);
      }
    }
  }
}

function validateEvents(
  node: PreviewNode,
  path: string,
  subjects: ReadonlyMap<string, PreviewSubject>,
  screenNames: ReadonlySet<string>,
  out: PreviewSupportIssue[],
): void {
  const validI32 = (value: number): boolean => Number.isInteger(value)
    && value >= I32_MIN && value <= I32_MAX;
  const validU32 = (value: number): boolean => Number.isInteger(value)
    && value >= 0 && value <= U32_MAX;

  for (let index = 0; index < node.events.length; index++) {
    const event = node.events[index]!;
    const eventPath = `${path}.events[${index}]`;
    if (!EVENT_TRIGGERS.has(event.trigger)) {
      issue(out, 'E_PREVIEW_EVENT_TRIGGER_UNSUPPORTED', `${eventPath}.trigger`,
        `不支持 event trigger:${event.trigger}`);
    }

    if (event.kind === 'callback') {
      if (event.callback.length === 0) {
        issue(out, 'E_PREVIEW_EVENT_CALLBACK_INVALID', `${eventPath}.callback`, 'callback 名称不得为空');
      }
      continue;
    }

    if (event.kind === 'subject_set' || event.kind === 'subject_toggle'
      || event.kind === 'subject_increment') {
      const subject = subjects.get(event.subject);
      if (!subject) {
        issue(out, 'E_PREVIEW_SUBJECT_MISSING', `${eventPath}.subject`, `subject 不存在:${event.subject}`);
        continue;
      }
      if (event.kind === 'subject_set') {
        if (subject.type !== event.subjectType) {
          issue(out, 'E_PREVIEW_EVENT_SUBJECT_TYPE_MISMATCH', `${eventPath}.subjectType`,
            `subject ${event.subject} 实际为 ${subject.type}，事件声明为 ${event.subjectType}`);
        }
        const validValue = event.subjectType === 'int'
          ? /^-?\d+$/.test(event.value)
            && validI32(Number(event.value))
          : event.subjectType === 'float'
            ? event.value.trim().length > 0
              && Number.isFinite(Number(event.value))
              && Number.isFinite(Math.fround(Number(event.value)))
            : true;
        if (!validValue) {
          issue(out, 'E_PREVIEW_EVENT_VALUE_INVALID', `${eventPath}.value`,
            `${event.subjectType} subject_set 值非法:${event.value}`);
        }
      } else if (event.kind === 'subject_toggle') {
        if (subject.type !== 'int') {
          issue(out, 'E_PREVIEW_EVENT_SUBJECT_TYPE_MISMATCH', `${eventPath}.subject`,
            `subject_toggle 仅支持 int subject:${event.subject}`);
        }
      } else {
        if (subject.type !== 'int' && subject.type !== 'float') {
          issue(out, 'E_PREVIEW_EVENT_SUBJECT_TYPE_MISMATCH', `${eventPath}.subject`,
            `subject_increment 仅支持 int/float subject:${event.subject}`);
        }
        for (const key of ['step', 'min', 'max'] as const) {
          const value = event[key];
          if (value !== undefined && !validI32(value)) {
            issue(out, 'E_PREVIEW_EVENT_VALUE_INVALID', `${eventPath}.${key}`, `${key} 必须是 int32`);
          }
        }
        if (event.min !== undefined && event.max !== undefined && event.min > event.max) {
          issue(out, 'E_PREVIEW_EVENT_RANGE_INVALID', eventPath, 'subject_increment 的 min 大于 max');
        }
      }
      continue;
    }

    if (event.kind === 'screen_load' || event.kind === 'screen_create') {
      if (!screenNames.has(event.screenName)) {
        issue(out, 'E_PREVIEW_EVENT_SCREEN_MISSING', `${eventPath}.screenName`,
          `目标 screen 不存在:${event.screenName}`);
      }
      if (event.animType !== undefined && !SCREEN_ANIMS.has(event.animType)) {
        issue(out, 'E_PREVIEW_EVENT_ANIM_UNSUPPORTED', `${eventPath}.animType`,
          `不支持 screen animation:${event.animType}`);
      }
      if (event.duration !== undefined && !validU32(event.duration)) {
        issue(out, 'E_PREVIEW_EVENT_TIME_INVALID', `${eventPath}.duration`, 'duration 必须是 uint32');
      }
      if (event.delay !== undefined && !validU32(event.delay)) {
        issue(out, 'E_PREVIEW_EVENT_TIME_INVALID', `${eventPath}.delay`, 'delay 必须是 uint32');
      }
      continue;
    }

    issue(out, 'E_PREVIEW_EVENT_KIND_UNSUPPORTED', `${eventPath}.kind`,
      `不支持 event kind:${String((event as { kind?: unknown }).kind)}`);
  }
}

function validateSelector(
  selector: PreviewNode['inlineStyles'][number]['selector'] | undefined,
  path: string,
  out: PreviewSupportIssue[],
): void {
  if (selector?.part && !SELECTOR_PARTS.has(selector.part)) {
    issue(out, 'E_PREVIEW_STYLE_PART_UNSUPPORTED', `${path}.part`,
      `v1 driver 不支持 style part:${selector.part}`);
  }
  for (let index = 0; index < (selector?.states?.length ?? 0); index++) {
    const state = selector!.states![index]!;
    if (!SELECTOR_STATES.has(state)) {
      issue(out, 'E_PREVIEW_STYLE_STATE_UNSUPPORTED', `${path}.states[${index}]`,
        `v1 driver 不支持 style state:${state}`);
    }
  }
}

function validateStyleProps(
  props: Record<string, unknown>,
  path: string,
  consts: ConstScope,
  out: PreviewSupportIssue[],
): void {
  for (const [key, sourceValue] of Object.entries(props)) {
    const valuePath = `${path}.${key}`;
    const value = resolveValue(sourceValue, consts, valuePath, out, styleConstTypes(key));
    if (value === UNRESOLVED) continue;
    if (typeof value === 'number') {
      if (!Number.isInteger(value) || !Number.isFinite(value)
        || value < -2147483648 || value > 2147483647 || !STYLE_I32.has(key)) {
        issue(out, 'E_PREVIEW_STYLE_VALUE_UNSUPPORTED', valuePath, `v1 driver 不支持 style:${key}=${value}`);
      } else if (OPA_STYLES.has(key) && (value < 0 || value > 255)) {
        issue(out, 'E_PREVIEW_STYLE_OPA_INVALID', valuePath, `透明度超出 0..255:${value}`);
      }
    } else if (typeof value === 'string') {
      const percent = percentNumber(value);
      const opacity = OPA_STYLES.has(key) && percent !== undefined && percent >= 0 && percent <= 100;
      const size = key === 'radius' && (value === 'content'
        || (percent !== undefined && percent >= -2147483648 && percent <= 2147483647));
      const color = STYLE_COLOR.has(key) && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
      if (!STYLE_STRING.has(key) && !opacity && !size) {
        issue(out, 'E_PREVIEW_STYLE_VALUE_UNSUPPORTED', valuePath, `v1 driver 不支持 style:${key}`);
      } else if (STYLE_COLOR.has(key) && !color) {
        issue(out, 'E_PREVIEW_STYLE_COLOR_INVALID', valuePath, `非法颜色:${value}`);
      } else if (STYLE_ENUM.has(key) && !STYLE_ENUM_VALUES[key]?.has(value)) {
        issue(out, 'E_PREVIEW_STYLE_ENUM_INVALID', valuePath, `非法 ${key}:${value}`);
      } else if (OPA_STYLES.has(key) && !opacity) {
        issue(out, 'E_PREVIEW_STYLE_OPA_INVALID', valuePath, `非法透明度:${value}`);
      } else if (STYLE_FONT.has(key) && value.length === 0) {
        issue(out, 'E_PREVIEW_STYLE_FONT_INVALID', valuePath, '字体引用不得为空');
      }
    } else if (typeof value === 'boolean') {
      issue(out, 'E_PREVIEW_STYLE_VALUE_UNSUPPORTED', valuePath, `v1 driver 尚未开放 bool style:${key}`);
    } else {
      issue(out, 'E_PREVIEW_STYLE_VALUE_UNSUPPORTED', valuePath, `v1 driver 不支持复合 style:${key}`);
    }
  }
}

const STRUCTURAL_CREATE_PROPS: Record<
  string,
  readonly {
    key: string;
    types: readonly ConstType[];
    valueType: 'string' | 'nonnegative-int';
    optional?: boolean;
  }[]
> = {
  'tabview-tab': [{ key: 'text', types: ['string'], valueType: 'string' }],
  'tabview-tab_bar': [],
  'tabview-tab_button': [{ key: 'index', types: ['int'], valueType: 'nonnegative-int' }],
  'table-column': [{ key: 'column', types: ['int'], valueType: 'nonnegative-int' }],
  'table-cell': [
    { key: 'row', types: ['int'], valueType: 'nonnegative-int' },
    { key: 'column', types: ['int'], valueType: 'nonnegative-int' },
  ],
  'list-text': [{ key: 'text', types: ['string'], valueType: 'string' }],
  'list-button': [
    { key: 'icon', types: ['string'], valueType: 'string', optional: true },
    { key: 'text', types: ['string'], valueType: 'string' },
  ],
  'spangroup-span': [],
  'dropdown-list': [],
  'calendar-header_arrow': [],
  'calendar-header_dropdown': [],
  'msgbox-button': [{ key: 'text', types: ['string'], valueType: 'string' }],
  'menu-page': [{ key: 'title', types: ['string'], valueType: 'string', optional: true }],
  'win-button': [
    { key: 'icon', types: ['string'], valueType: 'string', optional: true },
    { key: 'width', types: ['int'], valueType: 'nonnegative-int' },
  ],
  'tileview-tile': [
    { key: 'col', types: ['int'], valueType: 'nonnegative-int' },
    { key: 'row', types: ['int'], valueType: 'nonnegative-int' },
    { key: 'dir', types: ['string'], valueType: 'string' },
  ],
  'chart-series': [
    { key: 'color', types: ['color'], valueType: 'string' },
    { key: 'axis', types: ['string'], valueType: 'string' },
  ],
  'chart-cursor': [
    { key: 'color', types: ['color'], valueType: 'string' },
    { key: 'dir', types: ['string'], valueType: 'string' },
  ],
  'chart-axis': [{ key: 'axis', types: ['string'], valueType: 'string' }],
};

function validateStructuralNode(
  node: PreviewNode,
  path: string,
  parentType: string | undefined,
  consts: ConstScope,
  out: PreviewSupportIssue[],
): void {
  const structural = STRUCTURAL_TYPES.get(node.type);
  if (!structural) {
    issue(out, 'E_PREVIEW_CHILD_KIND_UNSUPPORTED', `${path}.kind`,
      `当前 driver 不支持 ${node.kind} 结构子元素:${node.type}`);
    return;
  }
  if (structural.kind !== node.kind || structural.parent !== parentType) {
    issue(out, 'E_PREVIEW_CHILD_SHAPE_INVALID', path,
      `${node.type} 必须以 ${structural.kind} 形式直属于 ${structural.parent}`);
  }
  const specs = STRUCTURAL_CREATE_PROPS[node.type] ?? [];
  const known = new Set(specs.map((spec) => spec.key));
  for (const key of Object.keys(node.createProps)) {
    if (!known.has(key)) {
      issue(out, 'E_PREVIEW_CREATE_PROP_UNSUPPORTED', `${path}.createProps.${key}`,
        `${node.type} 不支持构造参数:${key}`);
    }
  }
  for (const spec of specs) {
    const valuePath = `${path}.createProps.${spec.key}`;
    if (!(spec.key in node.createProps)) {
      if (spec.optional) continue;
      issue(out, 'E_PREVIEW_CREATE_PROP_MISSING', valuePath, `${node.type} 缺少构造参数:${spec.key}`);
      continue;
    }
    const value = resolveValue(node.createProps[spec.key], consts, valuePath, out, spec.types);
    if (value === UNRESOLVED) continue;
    if (spec.valueType === 'string' ? typeof value !== 'string'
      : typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > I32_MAX) {
      issue(out, 'E_PREVIEW_CREATE_PROP_INVALID', valuePath, `${node.type}.${spec.key} 值非法`);
    }
  }
  if (node.kind === 'virtual') {
    const extras = node.flags.length + node.states.length + node.inlineStyles.length
      + node.styleUses.length + node.bindings.length + node.events.length + node.children.length;
    if (extras > 0) {
      issue(out, 'E_PREVIEW_VIRTUAL_EXTRAS_UNSUPPORTED', path,
        `${node.type} 无对象句柄，不支持 flag/state/style/binding/event/children`);
    }
  }
  if (node.type === 'win-button') {
    const width = resolveValue(node.createProps.width, consts, `${path}.createProps.width`);
    if (typeof width === 'number' && width < 1) {
      issue(out, 'E_PREVIEW_CREATE_PROP_INVALID', `${path}.createProps.width`, 'win-button.width must be positive');
    }
    const icon = resolveValue(node.createProps.icon, consts, `${path}.createProps.icon`);
    if (typeof icon === 'string' && icon.includes('\u001f')) {
      issue(out, 'E_PREVIEW_CREATE_PROP_INVALID', `${path}.createProps.icon`, 'win-button.icon cannot contain U+001F');
    }
  }
  if (node.type === 'tileview-tile') {
    for (const key of ['col', 'row'] as const) {
      const value = resolveValue(node.createProps[key], consts, `${path}.createProps.${key}`);
      if (typeof value === 'number' && value > 255) {
        issue(out, 'E_PREVIEW_CREATE_PROP_INVALID', `${path}.createProps.${key}`,
          `tileview-tile.${key} must fit uint8`);
      }
    }
    const dir = resolveValue(node.createProps.dir, consts, `${path}.createProps.dir`);
    if (typeof dir === 'string' && !TILEVIEW_DIRS.has(dir)) {
      issue(out, 'E_PREVIEW_CREATE_PROP_INVALID', `${path}.createProps.dir`, `tileview direction invalid:${dir}`);
    }
  }
  if (node.type === 'chart-series' || node.type === 'chart-cursor') {
    const color = resolveValue(node.createProps.color, consts, `${path}.createProps.color`);
    if (typeof color === 'string' && !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
      issue(out, 'E_PREVIEW_CREATE_PROP_INVALID', `${path}.createProps.color`, `chart color invalid:${color}`);
    }
  }
  if (node.type === 'chart-series' || node.type === 'chart-axis') {
    const axis = resolveValue(node.createProps.axis, consts, `${path}.createProps.axis`);
    if (typeof axis === 'string' && !CHART_AXES.has(axis)) {
      issue(out, 'E_PREVIEW_CREATE_PROP_INVALID', `${path}.createProps.axis`, `chart axis invalid:${axis}`);
    }
  }
  if (node.type === 'chart-cursor') {
    const dir = resolveValue(node.createProps.dir, consts, `${path}.createProps.dir`);
    if (typeof dir === 'string' && !TILEVIEW_DIRS.has(dir)) {
      issue(out, 'E_PREVIEW_CREATE_PROP_INVALID', `${path}.createProps.dir`, `chart cursor direction invalid:${dir}`);
    }
  }
  if (node.type === 'spangroup-span') {
    const extras = node.flags.length + node.states.length + node.inlineStyles.length
      + node.styleUses.length + node.bindings.length + node.events.length + node.children.length;
    if (extras > 0) {
      issue(out, 'E_PREVIEW_NON_OBJ_EXTRAS_UNSUPPORTED', path,
        'spangroup-span is not an lv_obj_t and cannot use object-only features');
    }
    for (const key of Object.keys(node.props)) {
      if (!TYPE_STRING_PROPS['spangroup-span']!.has(key)) {
        issue(out, 'E_PREVIEW_PROP_UNSUPPORTED', `${path}.props.${key}`,
          `v1 driver does not support spangroup-span.${key}`);
      }
    }
  }
  if (node.type === 'chart-series' || node.type === 'chart-cursor') {
    const extras = node.flags.length + node.states.length + node.inlineStyles.length
      + node.styleUses.length + node.bindings.length + node.events.length + node.children.length;
    if (extras > 0) {
      issue(out, 'E_PREVIEW_NON_OBJ_EXTRAS_UNSUPPORTED', path,
        `${node.type} is not an lv_obj_t and cannot use object-only features`);
    }
  }
}

function validateNode(
  node: PreviewNode,
  path: string,
  names: Set<string>,
  styleNames: ReadonlySet<string>,
  consts: ConstScope,
  subjects: ReadonlyMap<string, PreviewSubject>,
  screenNames: ReadonlySet<string>,
  out: PreviewSupportIssue[],
  parentType?: string,
): void {
  if (names.has(node.runtimeName)) {
    issue(out, 'E_PREVIEW_DUPLICATE_NAME', `${path}.runtimeName`, `runtimeName 重复:${node.runtimeName}`);
  }
  names.add(node.runtimeName);

  if (node.kind === 'widget') {
    if (!SUPPORTED_WIDGETS.has(node.type)) {
      issue(out, 'E_PREVIEW_WIDGET_UNSUPPORTED', `${path}.type`, `v1 driver 不支持 widget:${node.type}`);
    }
    if (Object.keys(node.createProps).length > 0) {
      issue(out, 'E_PREVIEW_CREATE_PROPS_UNSUPPORTED', `${path}.createProps`, '普通 widget 不应携带构造参数');
    }
    if (parentType === 'table' || parentType === 'tabview' || parentType === 'dropdown'
      || parentType === 'calendar' || parentType === 'menu' || parentType === 'tileview'
      || parentType === 'chart') {
      issue(out, 'E_PREVIEW_WIDGET_PARENT_UNSUPPORTED', path,
        `${parentType} 不接受普通 widget 子节点`);
    }
  } else {
    validateStructuralNode(node, path, parentType, consts, out);
  }
  for (let index = 0; index < node.styleUses.length; index++) {
    const styleUse = node.styleUses[index]!;
    const usePath = `${path}.styleUses[${index}]`;
    if (!styleNames.has(styleUse.styleName)) {
      issue(out, 'E_PREVIEW_STYLE_MISSING', `${usePath}.styleName`, `命名 style 不存在:${styleUse.styleName}`);
    }
    validateSelector(styleUse.selector, `${usePath}.selector`, out);
  }
  validateBindings(node, path, subjects, out);
  validateEvents(node, path, subjects, screenNames, out);

  for (const [key, sourceValue] of Object.entries(node.props)) {
    const valuePath = `${path}.props.${key}`;
    const value = resolveValue(sourceValue, consts, valuePath, out, propConstTypes(node.type, key));
    if (value === UNRESOLVED) continue;
    if (typeof value === 'number') {
      if (!Number.isInteger(value) || !Number.isFinite(value)
        || value < -2147483648 || value > 2147483647) {
        issue(out, 'E_PREVIEW_PROP_NUMBER_UNSUPPORTED', valuePath, 'v1 driver 仅支持 int32 数值');
      }
      if (!COMMON_I32_PROPS.has(key) && !TYPE_I32_PROPS[node.type]?.has(key)) {
        issue(out, 'E_PREVIEW_PROP_UNSUPPORTED', valuePath, `v1 driver 不支持 ${node.type}.${key}`);
      } else if (((node.type === 'table' && (key === 'column_count' || key === 'row_count'))
        || (node.type === 'tabview' && key === 'active')
        || (node.type === 'dropdown' && key === 'selected')
        || (node.type === 'roller' && (key === 'selected' || key === 'visible_row_count'))
        || (node.type === 'buttonmatrix' && key === 'selected_button')
        || (node.type === 'calendar' && (key === 'today_year' || key === 'shown_year'))
        || (node.type === 'chart'
          && (key === 'point_count' || key === 'hor_div_line_count' || key === 'ver_div_line_count'))
        || (node.type === 'animimage' && key === 'repeat_count')
        || (node.type === 'table-column' && key === 'width')) && value < 0) {
        issue(out, 'E_PREVIEW_PROP_RANGE_INVALID', valuePath, `${node.type}.${key} 不得为负数`);
      } else if (node.type === 'calendar'
        && (key === 'today_month' || key === 'shown_month')
        && (value < 1 || value > 12)) {
        issue(out, 'E_PREVIEW_PROP_RANGE_INVALID', valuePath, `${node.type}.${key} must be 1..12`);
      } else if (node.type === 'calendar' && key === 'today_day'
        && (value < 1 || value > 31)) {
        issue(out, 'E_PREVIEW_PROP_RANGE_INVALID', valuePath, 'calendar.today_day must be 1..31');
      } else if (node.type === 'animimage' && key === 'duration' && value < 1) {
        issue(out, 'E_PREVIEW_PROP_RANGE_INVALID', valuePath, 'animimage.duration must be positive');
      } else if ((node.type === 'canvas' || node.type === 'lottie')
        && (key === 'width' || key === 'height') && (value < 1 || value > 2048)) {
        issue(out, 'E_PREVIEW_PROP_RANGE_INVALID', valuePath,
          `${node.type}.${key} must be 1..2048`);
      }
    } else if (typeof value === 'string') {
      if (!COMMON_STRING_PROPS.has(key) && !TYPE_STRING_PROPS[node.type]?.has(key)) {
        issue(out, 'E_PREVIEW_PROP_UNSUPPORTED', valuePath, `v1 driver 不支持 ${node.type}.${key}`);
      } else if ((node.type === 'canvas' || node.type === 'lottie')
        && (key === 'width' || key === 'height')) {
        issue(out, 'E_PREVIEW_SIZE_UNSUPPORTED', valuePath,
          `${node.type}.${key} only supports px integers`);
      } else if (COMMON_STRING_PROPS.has(key) && !isRuntimeSizeString(value)) {
        issue(out, 'E_PREVIEW_SIZE_UNSUPPORTED', valuePath, `不支持的 size:${value}`);
      } else if (node.type === 'qrcode' && (key === 'dark_color' || key === 'light_color')
        && !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
        issue(out, 'E_PREVIEW_PROP_VALUE_UNSUPPORTED', valuePath, `qrcode color invalid:${value}`);
      } else if (node.type === 'canvas' && key === 'fill_color'
        && !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
        issue(out, 'E_PREVIEW_PROP_VALUE_UNSUPPORTED', valuePath, `canvas color invalid:${value}`);
      } else if (node.type === 'scale' && key === 'mode' && !SCALE_MODES.has(value)) {
        issue(out, 'E_PREVIEW_PROP_ENUM_INVALID', valuePath, `scale mode invalid:${value}`);
      } else if (node.type === 'menu' && key === 'mode_header' && !MENU_HEADER_MODES.has(value)) {
        issue(out, 'E_PREVIEW_PROP_ENUM_INVALID', valuePath, `menu mode_header invalid:${value}`);
      } else if (node.type === 'menu' && key === 'mode_root_back_button'
        && !MENU_ROOT_BACK_BUTTON_MODES.has(value)) {
        issue(out, 'E_PREVIEW_PROP_ENUM_INVALID', valuePath, `menu root back button mode invalid:${value}`);
      } else if (node.type === 'chart' && key === 'type' && !CHART_TYPES.has(value)) {
        issue(out, 'E_PREVIEW_PROP_ENUM_INVALID', valuePath, `chart type invalid:${value}`);
      } else if (node.type === 'chart' && key === 'update_mode' && !CHART_UPDATE_MODES.has(value)) {
        issue(out, 'E_PREVIEW_PROP_ENUM_INVALID', valuePath, `chart update mode invalid:${value}`);
      } else if (node.type === 'led' && key === 'color'
        && !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
        issue(out, 'E_PREVIEW_PROP_VALUE_UNSUPPORTED', valuePath, `led color invalid:${value}`);
      } else if (node.type === 'spangroup' && key === 'overflow'
        && !SPANGROUP_OVERFLOWS.has(value)) {
        issue(out, 'E_PREVIEW_PROP_ENUM_INVALID', valuePath, `spangroup overflow invalid:${value}`);
      } else if (node.type === 'spangroup-span' && key === 'style'
        && !styleNames.has(value)) {
        issue(out, 'E_PREVIEW_STYLE_MISSING', valuePath, `named style missing:${value}`);
      } else if (node.type === 'spangroup-span' && key === 'bind_text'
        && !subjects.has(value)) {
        issue(out, 'E_PREVIEW_SUBJECT_MISSING', valuePath, `subject missing:${value}`);
      } else if (node.type === 'roller' && key === 'options_mode'
        && !ROLLER_MODES.has(value)) {
        issue(out, 'E_PREVIEW_PROP_ENUM_INVALID', valuePath, `roller options_mode invalid:${value}`);
      } else if (node.type === 'buttonmatrix' && key === 'ctrl_map'
        && value.trim().split(/\s+/).some((group) => group.split('|').some((token) => !BUTTONMATRIX_CTRLS.has(token)))) {
        issue(out, 'E_PREVIEW_PROP_ENUM_INVALID', valuePath, `buttonmatrix ctrl_map invalid:${value}`);
      } else if (node.type === 'keyboard' && key === 'mode' && !KEYBOARD_MODES.has(value)) {
        issue(out, 'E_PREVIEW_PROP_ENUM_INVALID', valuePath, `keyboard mode invalid:${value}`);
      } else if (node.type === 'tabview' && key === 'tab_bar_position'
        && !TABVIEW_BAR_POSITIONS.has(value)) {
        issue(out, 'E_PREVIEW_PROP_ENUM_INVALID', valuePath, `tab_bar_position 非法:${value}`);
      } else if (node.type === 'table-cell' && key === 'ctrl'
        && value.split('|').some((token) => !TABLE_CELL_CTRLS.has(token))) {
        issue(out, 'E_PREVIEW_PROP_ENUM_INVALID', valuePath, `table cell ctrl 非法:${value}`);
      } else if (node.type === 'imagebutton' && key === 'state'
        && !IMAGEBUTTON_STATES.has(value)) {
        issue(out, 'E_PREVIEW_PROP_ENUM_INVALID', valuePath, `imagebutton state 非法:${value}`);
      } else if (node.type === 'arclabel' && key === 'dir' && !ARCLABEL_DIRS.has(value)) {
        issue(out, 'E_PREVIEW_PROP_ENUM_INVALID', valuePath, `arclabel dir 非法:${value}`);
      } else if (node.type === 'arclabel'
        && (key === 'text_vertical_align' || key === 'text_horizontal_align')
        && !ARCLABEL_TEXT_ALIGNS.has(value)) {
        issue(out, 'E_PREVIEW_PROP_ENUM_INVALID', valuePath, `arclabel text align 非法:${value}`);
      }
    } else if (typeof value === 'boolean') {
      if (!TYPE_BOOL_PROPS[node.type]?.has(key)) {
        issue(out, 'E_PREVIEW_PROP_UNSUPPORTED', valuePath, `v1 driver 尚未开放 bool prop:${node.type}.${key}`);
      }
    } else if (Array.isArray(value)) {
      if (TYPE_STRING_LIST_PROPS[node.type]?.has(key)) {
        const maxLength = node.type === 'animimage' ? 127 : 4096;
        if (value.length === 0 || value.length > maxLength
          || value.some((item) => typeof item !== 'string' || item.includes('\u001f'))) {
          issue(out, 'E_PREVIEW_STRING_LIST_INVALID', valuePath,
            `stringList must contain 1..${maxLength} strings without U+001F`);
        }
      } else if (TYPE_I32_LIST_PROPS[node.type]?.has(key)) {
        if (value.length > 4096 || value.some((item) => typeof item !== 'number'
          || !Number.isInteger(item) || item < I32_MIN || item > I32_MAX)) {
          issue(out, 'E_PREVIEW_I32_LIST_INVALID', valuePath,
            'intList must contain at most 4096 int32 values');
        }
      } else if (!TYPE_POINT_LIST_PROPS[node.type]?.has(key)) {
        issue(out, 'E_PREVIEW_PROP_VALUE_UNSUPPORTED', valuePath, 'v1 driver 不支持此数组属性');
      } else if (value.length === 0 || value.length % 2 !== 0
        || value.length > 8192
        || value.some((coordinate) => typeof coordinate !== 'number'
          || !Number.isFinite(coordinate) || !Number.isFinite(Math.fround(coordinate)))) {
        issue(out, 'E_PREVIEW_POINT_LIST_INVALID', valuePath,
          'pointList 必须包含 1..4096 对有限坐标');
      }
    } else {
      issue(out, 'E_PREVIEW_PROP_VALUE_UNSUPPORTED', valuePath, 'v1 driver 不支持此复合属性');
    }
  }

  if (node.type === 'canvas' || node.type === 'lottie') {
    const width = resolveValue(node.props.width ?? 100, consts, `${path}.props.width`);
    const height = resolveValue(node.props.height ?? 100, consts, `${path}.props.height`);
    if (typeof width === 'number' && typeof height === 'number'
      && width > 0 && height > 0 && width * height > 1048576) {
      issue(out, 'E_PREVIEW_PROP_RANGE_INVALID', `${path}.props.width`,
        `${node.type} pixel count must be at most 1048576`);
    }
  }

  if (node.type === 'spangroup-span') {
    const subjectSource = node.props.bind_text;
    const formatSource = node.props.bind_text_fmt;
    if (subjectSource === undefined && formatSource !== undefined) {
      issue(out, 'E_PREVIEW_BINDING_UNSUPPORTED', `${path}.props.bind_text_fmt`,
        'bind_text_fmt requires bind_text');
    } else if (subjectSource !== undefined) {
      const subjectName = resolveValue(
        subjectSource, consts, `${path}.props.bind_text`, out, ['string'],
      );
      const format = formatSource === undefined
        ? undefined
        : resolveValue(formatSource, consts, `${path}.props.bind_text_fmt`, out, ['string']);
      if (typeof subjectName === 'string' && (format === undefined || typeof format === 'string')) {
        const subject = subjects.get(subjectName);
        if (subject && !validLabelFormat(format, subject.type)) {
          issue(out, 'E_PREVIEW_BINDING_UNSUPPORTED', `${path}.props.bind_text_fmt`,
            `spangroup span text format does not support ${subject.type} subject`);
        }
      }
    }
  }

  for (let i = 0; i < node.flags.length; i++) {
    if (!SUPPORTED_FLAGS.has(node.flags[i]![0])) {
      issue(out, 'E_PREVIEW_FLAG_UNSUPPORTED', `${path}.flags[${i}]`, `v1 driver 不支持 flag:${node.flags[i]![0]}`);
    }
  }
  for (let i = 0; i < node.states.length; i++) {
    if (!SUPPORTED_STATES.has(node.states[i]![0])) {
      issue(out, 'E_PREVIEW_STATE_UNSUPPORTED', `${path}.states[${i}]`, `v1 driver 不支持 state:${node.states[i]![0]}`);
    }
  }

  for (let groupIndex = 0; groupIndex < node.inlineStyles.length; groupIndex++) {
    const group = node.inlineStyles[groupIndex]!;
    const groupPath = `${path}.inlineStyles[${groupIndex}]`;
    validateSelector(group.selector, `${groupPath}.selector`, out);
    validateStyleProps(group.props, `${groupPath}.props`, consts, out);
  }

  if (node.type === 'tabview') {
    let tabCount = 0;
    for (let index = 0; index < node.children.length; index++) {
      const child = node.children[index]!;
      if (child.type === 'tabview-tab') tabCount++;
      if (child.type === 'tabview-tab_button') {
        const valuePath = `${path}.children[${index}].createProps.index`;
        const value = resolveValue(child.createProps.index, consts, valuePath);
        if (typeof value === 'number' && Number.isInteger(value) && value >= tabCount) {
          issue(out, 'E_PREVIEW_STRUCTURAL_ORDER_INVALID', valuePath,
            `tabview-tab_button[${value}] 必须放在对应 tabview-tab 创建之后`);
        }
      }
    }
  }

  node.children.forEach((child, index) =>
    validateNode(
      child, `${path}.children[${index}]`, names, styleNames,
      consts, subjects, screenNames, out, node.type,
    ));
}

/** 返回空数组表示可在当前 v1 runtime driver 执行。 */
export function validatePreviewProgramSupport(program: PreviewProgram): PreviewSupportIssue[] {
  const out: PreviewSupportIssue[] = [];
  if (program.protocolVersion !== 1) {
    issue(out, 'E_PREVIEW_PROTOCOL_UNSUPPORTED', 'protocolVersion', `不支持协议版本:${program.protocolVersion}`);
  }
  if (!['RGB565', 'RGB565_SWAPPED', 'RGB888', 'XRGB8888', 'ARGB8888'].includes(program.display.colorFormat)) {
    issue(out, 'E_PREVIEW_COLOR_FORMAT_UNSUPPORTED', 'display.colorFormat',
      `不支持的 display colorFormat:${program.display.colorFormat}`);
  }
  if (!program.screens.some((screen) => screen.name === program.homeScreenName)) {
    issue(out, 'E_PREVIEW_HOME_SCREEN_MISSING', 'homeScreenName', '首页不在 screens 中');
  }

  const screenNames = new Set<string>();
  for (let i = 0; i < program.screens.length; i++) {
    const screen = program.screens[i]!;
    if (screenNames.has(screen.name)) {
      issue(out, 'E_PREVIEW_DUPLICATE_SCREEN', `screens[${i}].name`, `screen name 重复:${screen.name}`);
    }
    screenNames.add(screen.name);
  }
  const styleNames = new Set<string>();
  const globalConsts = collectConsts(program.globals.consts, 'globals.consts', out);
  const subjects = validateSubjects(program.globals.subjects, out);
  const screenConstScopes: Map<string, ResolvedConst>[] = [];
  const validateStyles = (
    styles: PreviewProgram['globals']['styles'], path: string, consts: ConstScope,
  ): void => {
    for (let index = 0; index < styles.length; index++) {
      const style = styles[index]!;
      const stylePath = `${path}[${index}]`;
      if (style.name.length === 0) {
        issue(out, 'E_PREVIEW_STYLE_NAME_INVALID', `${stylePath}.name`, '命名 style 名称不得为空');
      }
      if (styleNames.has(style.name)) {
        issue(out, 'E_PREVIEW_DUPLICATE_STYLE_NAME', `${stylePath}.name`, `命名 style 重复:${style.name}`);
      }
      styleNames.add(style.name);
      validateStyleProps(style.props, `${stylePath}.props`, consts, out);
    }
  };
  validateStyles(program.globals.styles, 'globals.styles', globalConsts);
  for (let i = 0; i < program.screens.length; i++) {
    const screen = program.screens[i]!;
    const localConsts = collectConsts(screen.consts, `screens[${i}].consts`, out);
    const consts = new Map(globalConsts);
    for (const [name, value] of localConsts) consts.set(name, value);
    screenConstScopes.push(consts);
    validateStyles(screen.styles, `screens[${i}].styles`, consts);
  }
  /* C v1 registry 仍以 name 全局寻址；跨屏同名在切换为 screen-scoped handle 前明确拒绝。 */
  const runtimeNames = new Set<string>();
  for (let i = 0; i < program.screens.length; i++) {
    const screen = program.screens[i]!;
    const path = `screens[${i}]`;
    if (screen.root.type !== 'obj' || screen.root.runtimeName !== screen.name) {
      issue(out, 'E_PREVIEW_ROOT_UNSUPPORTED', `${path}.root`, 'screen root 必须是与 screen 同名的 obj');
    }
    validateNode(
      screen.root, `${path}.root`, runtimeNames, styleNames,
      screenConstScopes[i]!, subjects, screenNames, out,
    );
  }
  return out;
}

function selectorArgs(selector: PreviewNode['inlineStyles'][number]['selector'] | undefined): [string, string] {
  return [
    selector?.part ?? 'main',
    (selector?.states ?? []).filter((state) => state !== 'default').join('|'),
  ];
}

function defineStyle(
  style: PreviewProgram['globals']['styles'][number],
  consts: ConstScope,
  bridge: PreviewBridge,
  check: (rc: number, operation: string) => void,
): void {
  check(bridge.createStyle(style.name), `preview.createStyle(${style.name})`);
  for (const [key, sourceValue] of Object.entries(style.props)) {
    const value = resolveValue(sourceValue, consts, `${style.name}.${key}`);
    if (value === UNRESOLVED) throw new Error(`preview unresolved const:${style.name}.${key}`);
    if (typeof value === 'number') {
      check(bridge.setNamedStyleI32(style.name, key, value),
        `preview.setNamedStyleI32(${style.name}.${key})`);
    } else if (typeof value === 'string') {
      check(bridge.setNamedStyleString(style.name, key, value),
        `preview.setNamedStyleString(${style.name}.${key})`);
    } else {
      throw new Error(`preview unsupported named style value:${style.name}.${key}`);
    }
  }
}

function defineSubject(
  subject: PreviewSubject,
  stringCapacity: number | undefined,
  bridge: PreviewBridge,
  check: (rc: number, operation: string) => void,
): void {
  let rc: number;
  if (subject.type === 'int') {
    rc = bridge.createSubjectI32(
      subject.name, subject.initial,
      subject.min ?? 0, subject.min !== undefined,
      subject.max ?? 0, subject.max !== undefined,
    );
  } else if (subject.type === 'float') {
    rc = bridge.createSubjectFloat(
      subject.name, subject.initial,
      subject.min ?? 0, subject.min !== undefined,
      subject.max ?? 0, subject.max !== undefined,
    );
  } else if (subject.type === 'string') {
    rc = bridge.createSubjectString(subject.name, subject.initial, stringCapacity ?? 64);
  } else {
    rc = bridge.createSubjectColor(subject.name, subject.initial);
  }
  check(rc, `preview.createSubject(${subject.name}:${subject.type})`);
}

function collectStringSubjectCapacities(program: PreviewProgram): Map<string, number> {
  const capacities = new Map<string, number>();
  const bytes = (value: string): number => new TextEncoder().encode(value).byteLength + 1;
  for (const subject of program.globals.subjects) {
    if (subject.type === 'string') capacities.set(subject.name, Math.max(64, bytes(subject.initial)));
  }
  const visit = (node: PreviewNode): void => {
    for (const event of node.events) {
      if (event.kind === 'subject_set' && event.subjectType === 'string') {
        capacities.set(event.subject, Math.max(capacities.get(event.subject) ?? 64, bytes(event.value)));
      }
    }
    node.children.forEach(visit);
  };
  for (const screen of program.screens) visit(screen.root);
  return capacities;
}

function resolvedCreateProp(node: PreviewNode, key: string, consts: ConstScope): string | number {
  const value = resolveValue(node.createProps[key], consts, `${node.runtimeName}.createProps.${key}`);
  if (value === UNRESOLVED || (typeof value !== 'string' && typeof value !== 'number')) {
    throw new Error(`preview unresolved structural create prop:${node.runtimeName}.${key}`);
  }
  return value;
}

function applyVirtualNode(
  node: PreviewNode,
  parentName: string,
  consts: ConstScope,
  bridge: PreviewBridge,
  check: (rc: number, operation: string) => void,
): void {
  if (node.type === 'table-column') {
    const column = resolvedCreateProp(node, 'column', consts) as number;
    if (node.props.width !== undefined) {
      const width = resolveValue(node.props.width, consts, `${node.runtimeName}.width`);
      if (typeof width !== 'number') throw new Error(`preview invalid table column width:${node.runtimeName}`);
      check(bridge.setTableColumn(parentName, column, width),
        `preview.setTableColumn(${parentName}:${column})`);
    }
    return;
  }
  if (node.type === 'table-cell') {
    const row = resolvedCreateProp(node, 'row', consts) as number;
    const column = resolvedCreateProp(node, 'column', consts) as number;
    if (node.props.value !== undefined) {
      const value = resolveValue(node.props.value, consts, `${node.runtimeName}.value`);
      if (typeof value !== 'string') throw new Error(`preview invalid table cell value:${node.runtimeName}`);
      check(bridge.setTableCellValue(parentName, row, column, value),
        `preview.setTableCellValue(${parentName}:${row}:${column})`);
    }
    if (node.props.ctrl !== undefined) {
      const ctrl = resolveValue(node.props.ctrl, consts, `${node.runtimeName}.ctrl`);
      if (typeof ctrl !== 'string') throw new Error(`preview invalid table cell ctrl:${node.runtimeName}`);
      check(bridge.setTableCellCtrl(parentName, row, column, ctrl),
        `preview.setTableCellCtrl(${parentName}:${row}:${column})`);
    }
    return;
  }
  if (node.type === 'chart-axis') {
    const axis = String(resolvedCreateProp(node, 'axis', consts));
    for (const key of ['min_value', 'max_value'] as const) {
      if (node.props[key] === undefined) continue;
      const value = resolveValue(node.props[key], consts, `${node.runtimeName}.${key}`);
      if (typeof value !== 'number') throw new Error(`preview invalid chart axis value:${node.runtimeName}.${key}`);
      check(bridge.setChartAxis(parentName, axis, key, value),
        `preview.setChartAxis(${parentName}:${axis}.${key})`);
    }
    return;
  }
  throw new Error(`preview unsupported virtual node:${node.type}`);
}

function applyNode(
  node: PreviewNode,
  parentName: string | null,
  consts: ConstScope,
  bridge: PreviewBridge,
  check: (rc: number, operation: string) => void,
): void {
  if (node.kind === 'virtual') {
    if (parentName === null) throw new Error(`preview virtual root:${node.type}`);
    applyVirtualNode(node, parentName, consts, bridge, check);
    return;
  }
  if (parentName !== null) {
    if (node.kind === 'widget') {
      check(bridge.createNode(parentName, node.runtimeName, node.type),
        `preview.createNode(${node.runtimeName}:${node.type})`);
    } else if (node.type === 'list-text' || node.type === 'list-button') {
      const icon = node.createProps.icon === undefined
        ? ''
        : String(resolvedCreateProp(node, 'icon', consts));
      const text = String(resolvedCreateProp(node, 'text', consts));
      check(bridge.createListItem(parentName, node.runtimeName, node.type, icon, text),
        `preview.createListItem(${node.runtimeName}:${node.type})`);
    } else {
      const arg = node.type === 'tabview-tab' || node.type === 'msgbox-button'
        ? String(resolvedCreateProp(node, 'text', consts))
        : node.type === 'menu-page'
          ? node.createProps.title === undefined
            ? ''
            : String(resolvedCreateProp(node, 'title', consts))
        : node.type === 'win-button'
          ? `${node.createProps.icon === undefined ? '' : String(resolvedCreateProp(node, 'icon', consts))}\u001f${String(resolvedCreateProp(node, 'width', consts))}`
        : node.type === 'tileview-tile'
          ? `${String(resolvedCreateProp(node, 'col', consts))}\u001f${String(resolvedCreateProp(node, 'row', consts))}\u001f${String(resolvedCreateProp(node, 'dir', consts))}`
        : node.type === 'chart-series'
          ? `${String(resolvedCreateProp(node, 'color', consts))}\u001f${String(resolvedCreateProp(node, 'axis', consts))}`
        : node.type === 'chart-cursor'
          ? `${String(resolvedCreateProp(node, 'color', consts))}\u001f${String(resolvedCreateProp(node, 'dir', consts))}`
        : node.type === 'tabview-tab_button'
          ? String(resolvedCreateProp(node, 'index', consts))
          : '';
      check(bridge.createStructural(parentName, node.runtimeName, node.type, arg),
        `preview.createStructural(${node.runtimeName}:${node.type})`);
    }
  }
  if (node.type === 'spangroup-span' && node.props.bind_text !== undefined) {
    const subject = resolveValue(node.props.bind_text, consts, `${node.runtimeName}.bind_text`);
    const format = node.props.bind_text_fmt === undefined
      ? ''
      : resolveValue(node.props.bind_text_fmt, consts, `${node.runtimeName}.bind_text_fmt`);
    if (typeof subject !== 'string' || typeof format !== 'string') {
      throw new Error(`preview unresolved span binding:${node.runtimeName}`);
    }
    check(bridge.bindProp(node.runtimeName, 'span_text', subject, format),
      `preview.bindProp(${node.runtimeName}.span_text:${subject})`);
  }
  for (const [key, sourceValue] of Object.entries(node.props)) {
    if (node.type === 'spangroup-span' && (key === 'bind_text' || key === 'bind_text_fmt')) continue;
    const value = resolveValue(sourceValue, consts, `${node.runtimeName}.${key}`);
    if (value === UNRESOLVED) throw new Error(`preview unresolved const:${node.runtimeName}.${key}`);
    if (typeof value === 'string') {
      check(bridge.setString(node.runtimeName, key, value), `preview.setString(${node.runtimeName}.${key})`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      check(bridge.setI32(node.runtimeName, key, typeof value === 'boolean' ? Number(value) : value),
        `preview.setI32(${node.runtimeName}.${key})`);
    } else if (Array.isArray(value) && node.type === 'line' && key === 'points') {
      const serialized = value.reduce<string[]>((pairs, coordinate, index) => {
        if (index % 2 === 0) pairs.push(`${coordinate},${value[index + 1]}`);
        return pairs;
      }, []).join(' ');
      check(bridge.setPointList(node.runtimeName, key, serialized),
        `preview.setPointList(${node.runtimeName}.${key})`);
    } else if (Array.isArray(value) && TYPE_STRING_LIST_PROPS[node.type]?.has(key)) {
      check(bridge.setStringList(node.runtimeName, key, value.join('\u001f')),
        `preview.setStringList(${node.runtimeName}.${key})`);
    } else if (Array.isArray(value) && TYPE_I32_LIST_PROPS[node.type]?.has(key)) {
      check(bridge.setI32List(node.runtimeName, key, value.join(' ')),
        `preview.setI32List(${node.runtimeName}.${key})`);
    } else {
      /* preflight 已拒绝其他复合值；const 已在上方解析为标量。 */
      throw new Error(`preview unsupported value:${node.runtimeName}.${key}`);
    }
  }
  for (const [flag, enabled] of node.flags) {
    check(bridge.setFlag(node.runtimeName, flag, enabled), `preview.setFlag(${node.runtimeName}.${flag})`);
  }
  for (const [state, enabled] of node.states) {
    check(bridge.setState(node.runtimeName, state, enabled), `preview.setState(${node.runtimeName}.${state})`);
  }
  for (const group of node.inlineStyles) {
    const [part, states] = selectorArgs(group.selector);
    for (const [key, sourceValue] of Object.entries(group.props)) {
      const value = resolveValue(sourceValue, consts, `${node.runtimeName}.${key}`);
      if (value === UNRESOLVED) throw new Error(`preview unresolved const:${node.runtimeName}.${key}`);
      if (typeof value === 'number') {
        check(bridge.setStyleI32(node.runtimeName, key, value, part, states),
          `preview.setStyleI32(${node.runtimeName}.${key})`);
      } else if (typeof value === 'string') {
        check(bridge.setStyleString(node.runtimeName, key, value, part, states),
          `preview.setStyleString(${node.runtimeName}.${key})`);
      } else {
        throw new Error(`preview unsupported style value:${node.runtimeName}.${key}`);
      }
    }
  }
  for (const styleUse of node.styleUses) {
    const [part, states] = selectorArgs(styleUse.selector);
    check(bridge.addStyle(node.runtimeName, styleUse.styleName, part, states),
      `preview.addStyle(${node.runtimeName}:${styleUse.styleName})`);
  }
  for (const binding of node.bindings) {
    if (binding.kind === 'prop') {
      check(bridge.bindProp(node.runtimeName, binding.prop, binding.subject, binding.fmt ?? ''),
        `preview.bindProp(${node.runtimeName}.${binding.prop}:${binding.subject})`);
    } else if (binding.kind === 'flag') {
      check(bridge.bindFlag(
        node.runtimeName, binding.flag, binding.op, binding.subject, binding.refValue,
      ), `preview.bindFlag(${node.runtimeName}.${binding.flag}:${binding.subject})`);
    } else {
      check(bridge.bindState(
        node.runtimeName, binding.state, binding.op, binding.subject, binding.refValue,
      ), `preview.bindState(${node.runtimeName}.${binding.state}:${binding.subject})`);
    }
  }
  for (const event of node.events) {
    if (event.kind === 'callback') {
      check(bridge.addCallbackEvent(
        node.runtimeName, event.trigger, event.callback, event.userData ?? '', event.userData !== undefined,
      ), `preview.addCallbackEvent(${node.runtimeName}:${event.trigger}:${event.callback})`);
    } else if (event.kind === 'subject_set') {
      check(bridge.addSubjectSetEvent(
        node.runtimeName, event.trigger, event.subject, event.subjectType, event.value,
      ), `preview.addSubjectSetEvent(${node.runtimeName}:${event.trigger}:${event.subject})`);
    } else if (event.kind === 'subject_toggle') {
      check(bridge.addSubjectToggleEvent(
        node.runtimeName, event.trigger, event.subject,
      ), `preview.addSubjectToggleEvent(${node.runtimeName}:${event.trigger}:${event.subject})`);
    } else if (event.kind === 'subject_increment') {
      check(bridge.addSubjectIncrementEvent(
        node.runtimeName, event.trigger, event.subject, event.step ?? 1,
        event.min ?? 0, event.min !== undefined,
        event.max ?? 0, event.max !== undefined,
        event.rollover ?? false, event.rollover !== undefined,
      ), `preview.addSubjectIncrementEvent(${node.runtimeName}:${event.trigger}:${event.subject})`);
    } else {
      check(bridge.addScreenEvent(
        node.runtimeName, event.trigger, event.kind, event.screenName,
        event.animType ?? 'none', event.duration ?? 0, event.delay ?? 0,
      ), `preview.addScreenEvent(${node.runtimeName}:${event.trigger}:${event.screenName})`);
    }
  }
  for (const child of node.children) applyNode(child, node.runtimeName, consts, bridge, check);
}

export function executePreviewProgram(
  program: PreviewProgram,
  bridge: PreviewBridge,
  check: (rc: number, operation: string) => void = (rc, operation) => {
    if (rc !== 0) throw new Error(`${operation} rc=${rc}`);
  },
): void {
  const issues = validatePreviewProgramSupport(program);
  if (issues.length > 0) {
    const detail = issues.map((entry) => `${entry.code}@${entry.path}:${entry.message}`).join('\n');
    throw new Error(`PreviewProgram 超出当前 runtime 能力:\n${detail}`);
  }

  check(bridge.begin(
    program.protocolVersion,
    program.display.width,
    program.display.height,
    program.display.colorFormat,
  ), 'preview.begin');
  const stringCapacities = collectStringSubjectCapacities(program);
  for (const subject of program.globals.subjects) {
    defineSubject(subject, stringCapacities.get(subject.name), bridge, check);
  }
  const globalConsts = collectConsts(program.globals.consts, 'globals.consts');
  for (const style of program.globals.styles) defineStyle(style, globalConsts, bridge, check);
  const screenConstScopes = program.screens.map(
    (screen) => withScreenConsts(globalConsts, screen.consts),
  );
  for (let index = 0; index < program.screens.length; index++) {
    const screen = program.screens[index]!;
    for (const style of screen.styles) defineStyle(style, screenConstScopes[index]!, bridge, check);
  }
  for (let index = 0; index < program.screens.length; index++) {
    const screen = program.screens[index]!;
    check(bridge.createScreen(screen.name), `preview.createScreen(${screen.name})`);
    applyNode(screen.root, null, screenConstScopes[index]!, bridge, check);
  }
  check(bridge.finish(program.homeScreenName), `preview.finish(${program.homeScreenName})`);
}
