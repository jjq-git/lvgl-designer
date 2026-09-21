/**
 * M2 官方 7 控件描述表:buttonmatrix / calendar / chart / keyboard /
 * spangroup / table / tabview(全部有官方 XML parser)。
 * 属性名/枚举 token 与 scripts/out/parser-attrs.json 逐字一致;
 * 结构子元素用 ChildSpec(kind: add / getter / virtual)描述,
 * C 生成形态见 packages/codegen c94 emitter。
 */
import type { WidgetSpec } from '../registryTypes.js';
import { DIR_ENUM } from '../enums.js';

/* ------------------------------------------------------------ buttonmatrix */

/** lv_xml_buttonmatrix_parser.c ctrl_text_to_enum_value 的 28 token(顺序照抄) */
export const BUTTONMATRIX_CTRL_TOKENS = [
  'none',
  'width_1', 'width_2', 'width_3', 'width_4', 'width_5',
  'width_6', 'width_7', 'width_8', 'width_9', 'width_10',
  'width_11', 'width_12', 'width_13', 'width_14', 'width_15',
  'hidden', 'no_repeat', 'disabled', 'checkable', 'checked',
  'click_trig', 'popover', 'recolor', 'reserved_1', 'reserved_2',
  'custom_1', 'custom_2',
] as const;

export const buttonmatrixSpec: WidgetSpec = {
  type: 'buttonmatrix', xmlTag: 'lv_buttonmatrix', lvUseGuard: 'LV_USE_BUTTONMATRIX',
  cCreate: 'lv_buttonmatrix_create($parent)',
  props: [
    {
      // JSON 存 string[](按钮文本,'\n' 换行);XML 发引号串列表 'A' 'B' '\n' 'C';
      // C 发 static const char * 数组($strarr 特殊模板)
      key: 'map', type: 'stringQuotedList', channel: 'both',
      c: { setter: 'lv_buttonmatrix_set_map($obj, $strarr)' },
      ui: { group: 'content', label: '按钮表', control: 'text' },
    },
    {
      // 空格分隔按钮组,组内 '|' 位或;C 逐按钮 set_button_ctrl($idx, $ored)
      key: 'ctrl_map', type: 'orFlags', channel: 'both',
      enum: { tokens: BUTTONMATRIX_CTRL_TOKENS, cPrefix: 'LV_BUTTONMATRIX_CTRL_' },
      c: { setter: 'lv_buttonmatrix_set_button_ctrl($obj, $idx, $ored)' },
      ui: { group: 'behavior', label: '按钮控制', control: 'text' },
      notes: ['parser 解析缓冲 512 字节(lv_xml_buttonmatrix_parser.c:108),超长截断'],
    },
    {
      key: 'selected_button', type: 'int', channel: 'both',
      c: { setter: 'lv_buttonmatrix_set_selected_button($obj, $v)' },
      ui: { group: 'value', label: '选中按钮', control: 'number' },
    },
    {
      key: 'one_checked', type: 'bool', default: false, channel: 'both',
      c: { setter: 'lv_buttonmatrix_set_one_checked($obj, $v)' },
      ui: { group: 'behavior', label: '单选', control: 'toggle' },
    },
  ],
  bindableProps: [],
  parts: ['main', 'items'],
  acceptsWidgetChildren: false,
  palette: { category: 'input', label: '按钮矩阵', icon: 'buttonmatrix' },
  defaultSize: { w: 200, h: 150 },
};

/* ---------------------------------------------------------------- calendar */

export const calendarSpec: WidgetSpec = {
  type: 'calendar', xmlTag: 'lv_calendar', lvUseGuard: 'LV_USE_CALENDAR',
  cCreate: 'lv_calendar_create($parent)',
  props: [
    {
      key: 'today_year', type: 'int', channel: 'both',
      c: { setter: 'lv_calendar_set_today_year($obj, $v)' },
      ui: { group: 'value', label: '今天·年', control: 'number' },
    },
    {
      key: 'today_month', type: 'int', min: 1, max: 12, channel: 'both',
      c: { setter: 'lv_calendar_set_today_month($obj, $v)' },
      ui: { group: 'value', label: '今天·月', control: 'number' },
    },
    {
      key: 'today_day', type: 'int', min: 1, max: 31, channel: 'both',
      c: { setter: 'lv_calendar_set_today_day($obj, $v)' },
      ui: { group: 'value', label: '今天·日', control: 'number' },
    },
    {
      key: 'shown_year', type: 'int', channel: 'both',
      c: { setter: 'lv_calendar_set_shown_year($obj, $v)' },
      ui: { group: 'value', label: '显示·年', control: 'number' },
    },
    {
      key: 'shown_month', type: 'int', min: 1, max: 12, channel: 'both',
      c: { setter: 'lv_calendar_set_shown_month($obj, $v)' },
      ui: { group: 'value', label: '显示·月', control: 'number' },
    },
  ],
  bindableProps: [],
  parts: ['main', 'items'],
  children: [
    {
      type: 'calendar-header_arrow', xmlTag: 'lv_calendar-header_arrow',
      kind: 'add', isObj: true,
      cCreate: 'lv_calendar_add_header_arrow($parent)',
      props: [],
      acceptsWidgetChildren: false,
      notes: ['受 LV_USE_CALENDAR_HEADER_ARROW 宏控制'],
    },
    {
      type: 'calendar-header_dropdown', xmlTag: 'lv_calendar-header_dropdown',
      kind: 'add', isObj: true,
      cCreate: 'lv_calendar_add_header_dropdown($parent)',
      props: [],
      acceptsWidgetChildren: false,
      notes: ['受 LV_USE_CALENDAR_HEADER_DROPDOWN 宏控制'],
    },
  ],
  acceptsWidgetChildren: false,
  palette: { category: 'display', label: '日历', icon: 'calendar' },
  defaultSize: { w: 230, h: 230 },
  notes: ['高亮日期需新增 typed date-list property，普通工程不得用 cPatch 绕过'],
};

/* ------------------------------------------------------------------- chart */

export const chartSpec: WidgetSpec = {
  type: 'chart', xmlTag: 'lv_chart', lvUseGuard: 'LV_USE_CHART',
  cCreate: 'lv_chart_create($parent)',
  props: [
    {
      key: 'type', type: 'enum', default: 'line', channel: 'both',
      enum: { tokens: ['none', 'line', 'bar', 'stacked', 'scatter'], cPrefix: 'LV_CHART_TYPE_' },
      c: { setter: 'lv_chart_set_type($obj, $v)' },
      ui: { group: 'behavior', label: '图表类型', control: 'select' },
    },
    {
      key: 'point_count', type: 'int', min: 0, default: 10, channel: 'both',
      c: { setter: 'lv_chart_set_point_count($obj, $v)' },
      ui: { group: 'value', label: '数据点数', control: 'number' },
    },
    {
      key: 'update_mode', type: 'enum', default: 'shift', channel: 'both',
      enum: { tokens: ['shift', 'circular'], cPrefix: 'LV_CHART_UPDATE_MODE_' },
      c: { setter: 'lv_chart_set_update_mode($obj, $v)' },
      ui: { group: 'behavior', label: '更新模式', control: 'select' },
    },
    {
      key: 'hor_div_line_count', type: 'int', default: 3, channel: 'both',
      c: { setter: 'lv_chart_set_hor_div_line_count($obj, $v)' },
      ui: { group: 'behavior', label: '横分割线', control: 'number' },
    },
    {
      key: 'ver_div_line_count', type: 'int', default: 5, channel: 'both',
      c: { setter: 'lv_chart_set_ver_div_line_count($obj, $v)' },
      ui: { group: 'behavior', label: '纵分割线', control: 'number' },
    },
  ],
  bindableProps: [],
  parts: ['main', 'items', 'indicator', 'scrollbar', 'cursor'],
  children: [
    {
      type: 'chart-series', xmlTag: 'lv_chart-series', kind: 'add', isObj: false,
      cCreate: 'lv_chart_add_series($parent, $color, $axis)',
      cHandleType: 'lv_chart_series_t *',
      createProps: [
        {
          key: 'color', type: 'color', default: '#ff0000', channel: 'both',
          c: { setter: '' }, ui: { group: 'content', label: '颜色', control: 'color' },
        },
        {
          key: 'axis', type: 'enum', default: 'primary_y', channel: 'both',
          enum: {
            tokens: ['primary_x', 'primary_y', 'secondary_x', 'secondary_y'],
            cPrefix: 'LV_CHART_AXIS_',
          },
          c: { setter: '' }, ui: { group: 'content', label: '轴', control: 'select' },
        },
      ],
      props: [
        {
          // 空格分隔 int,parser 逐点 set_next_value;C 用 $each 逐元素展开
          key: 'values', type: 'intList', channel: 'both',
          c: { setter: 'lv_chart_set_next_value($parent, $obj, $each)' },
          ui: { group: 'value', label: '数据', control: 'text' },
        },
      ],
      acceptsWidgetChildren: false,
    },
    {
      type: 'chart-cursor', xmlTag: 'lv_chart-cursor', kind: 'add', isObj: false,
      cCreate: 'lv_chart_add_cursor($parent, $color, $dir)',
      cHandleType: 'lv_chart_cursor_t *',
      createProps: [
        {
          key: 'color', type: 'color', default: '#0000ff', channel: 'both',
          c: { setter: '' }, ui: { group: 'content', label: '颜色', control: 'color' },
        },
        {
          key: 'dir', type: 'enum', default: 'all', channel: 'both',
          enum: DIR_ENUM,
          c: { setter: '' }, ui: { group: 'content', label: '方向', control: 'select' },
        },
      ],
      props: [
        {
          key: 'pos_x', type: 'int', channel: 'both',
          c: { setter: 'lv_chart_set_cursor_pos_x($parent, $obj, $v)' },
          ui: { group: 'value', label: 'X', control: 'number' },
        },
        {
          key: 'pos_y', type: 'int', channel: 'both',
          c: { setter: 'lv_chart_set_cursor_pos_y($parent, $obj, $v)' },
          ui: { group: 'value', label: 'Y', control: 'number' },
        },
      ],
      acceptsWidgetChildren: false,
    },
    {
      type: 'chart-axis', xmlTag: 'lv_chart-axis', kind: 'virtual', isObj: false,
      createProps: [
        {
          key: 'axis', type: 'enum', default: 'primary_y', channel: 'both',
          enum: {
            tokens: ['primary_x', 'primary_y', 'secondary_x', 'secondary_y'],
            cPrefix: 'LV_CHART_AXIS_',
          },
          c: { setter: '' }, ui: { group: 'content', label: '轴', control: 'select' },
        },
      ],
      props: [
        {
          key: 'min_value', type: 'int', channel: 'both',
          c: { setter: 'lv_chart_set_axis_min_value($parent, $axis, $v)' },
          ui: { group: 'value', label: '最小', control: 'number' },
        },
        {
          key: 'max_value', type: 'int', channel: 'both',
          c: { setter: 'lv_chart_set_axis_max_value($parent, $axis, $v)' },
          ui: { group: 'value', label: '最大', control: 'number' },
        },
      ],
      acceptsWidgetChildren: false,
    },
  ],
  acceptsWidgetChildren: false,
  palette: { category: 'chart', label: '图表', icon: 'chart' },
  defaultSize: { w: 200, h: 150 },
  notes: ['scatter X/Y 需新增 typed point-series property，普通工程不得用 cPatch 绕过'],
};

/* ---------------------------------------------------------------- keyboard */

export const keyboardSpec: WidgetSpec = {
  type: 'keyboard', xmlTag: 'lv_keyboard', lvUseGuard: 'LV_USE_KEYBOARD',
  cCreate: 'lv_keyboard_create($parent)',
  props: [
    {
      key: 'mode', type: 'enum', default: 'text_lower', channel: 'both',
      enum: {
        tokens: [
          'text_upper', 'text_lower', 'text_arabic', 'number', 'special',
          'user_1', 'user_2', 'user_3', 'user_4',
        ],
        cPrefix: 'LV_KEYBOARD_MODE_',
      },
      c: { setter: 'lv_keyboard_set_mode($obj, $v)' },
      ui: { group: 'behavior', label: '键盘模式', control: 'select' },
      notes: ['text_arabic 依赖 LV_USE_ARABIC_PERSIAN_CHARS'],
    },
    {
      key: 'popovers', type: 'bool', default: false, channel: 'both',
      c: { setter: 'lv_keyboard_set_popovers($obj, $v)' },
      ui: { group: 'behavior', label: '按键气泡', control: 'toggle' },
    },
    {
      // 一期 c-only 刚需项(ARCHITECTURE §4):parser:58 被注释,XML 无法关联;
      // 值 = 同 screen 内 textarea 的 name,C 发 ui_<screen>.<name>($ref 模板)
      key: 'textarea', type: 'string', channel: 'c-only',
      c: { setter: 'lv_keyboard_set_textarea($obj, $ref)' },
      ui: { group: 'behavior', label: '关联文本框(仅代码)', control: 'text' },
      notes: [
        '9.4 XML parser 未实现,仅进 C 产物,画布不生效(角标提示)',
        '目标 textarea 必须命名、与键盘同 screen、且在树中先于键盘创建',
      ],
    },
  ],
  bindableProps: [],
  parts: ['main', 'items'],
  acceptsWidgetChildren: false,
  palette: { category: 'input', label: '键盘', icon: 'keyboard' },
  defaultSize: { w: '100%', h: 120 },
};

/* --------------------------------------------------------------- spangroup */

export const spangroupSpec: WidgetSpec = {
  type: 'spangroup', xmlTag: 'lv_spangroup', lvUseGuard: 'LV_USE_SPAN',
  cCreate: 'lv_spangroup_create($parent)',
  props: [
    {
      key: 'overflow', type: 'enum', default: 'clip', channel: 'both',
      enum: { tokens: ['clip', 'ellipsis'], cPrefix: 'LV_SPAN_OVERFLOW_' },
      c: { setter: 'lv_spangroup_set_overflow($obj, $v)' },
      ui: { group: 'behavior', label: '溢出处理', control: 'select' },
    },
    {
      key: 'max_lines', type: 'int', channel: 'both',
      c: { setter: 'lv_spangroup_set_max_lines($obj, $v)' },
      ui: { group: 'behavior', label: '最大行数', control: 'number' },
    },
    {
      key: 'indent', type: 'int', default: 0, channel: 'both',
      c: { setter: 'lv_spangroup_set_indent($obj, $v)' },
      ui: { group: 'behavior', label: '首行缩进', control: 'number' },
    },
  ],
  bindableProps: [],
  parts: ['main'],
  children: [
    {
      type: 'spangroup-span', xmlTag: 'lv_spangroup-span', kind: 'add', isObj: false,
      cCreate: 'lv_spangroup_add_span($parent)',
      cHandleType: 'lv_span_t *',
      props: [
        {
          key: 'text', type: 'string', channel: 'both',
          c: { setter: 'lv_spangroup_set_span_text($parent, $obj, $v)' },
          ui: { group: 'content', label: '文本', control: 'text' },
        },
        {
          // 只能引用命名 style(design/01 §3.3);值 = style 名
          key: 'style', type: 'styleRef', channel: 'both',
          c: { setter: 'lv_spangroup_set_span_style($parent, $obj, $v)' },
          ui: { group: 'content', label: '样式', control: 'select' },
        },
        {
          key: 'bind_text', type: 'subject', channel: 'both',
          companions: [{ key: 'bind_text_fmt', type: 'string', xmlAttr: 'bind_text-fmt' }],
          c: { setter: 'lv_spangroup_bind_span_text($parent, $obj, $v, $bind_text_fmt)' },
          ui: { group: 'content', label: '文本绑定', control: 'subject-picker' },
        },
      ],
      acceptsWidgetChildren: false,
    },
  ],
  acceptsWidgetChildren: false,
  palette: { category: 'basic', label: '富文本', icon: 'spangroup' },
  defaultSize: { w: 150, h: 'content' },
};

/* ------------------------------------------------------------------- table */

/** lv_xml_table_parser.c table_ctrl_to_enum 的 7 token(顺序照抄) */
export const TABLE_CELL_CTRL_TOKENS = [
  'none', 'merge_right', 'text_crop', 'custom_1', 'custom_2', 'custom_3', 'custom_4',
] as const;

export const tableSpec: WidgetSpec = {
  type: 'table', xmlTag: 'lv_table', lvUseGuard: 'LV_USE_TABLE',
  cCreate: 'lv_table_create($parent)',
  props: [
    {
      key: 'column_count', type: 'int', min: 0, default: 1, channel: 'both',
      c: { setter: 'lv_table_set_column_count($obj, $v)' },
      ui: { group: 'value', label: '列数', control: 'number' },
    },
    {
      key: 'row_count', type: 'int', min: 0, default: 1, channel: 'both',
      c: { setter: 'lv_table_set_row_count($obj, $v)' },
      ui: { group: 'value', label: '行数', control: 'number' },
    },
  ],
  bindableProps: [],
  parts: ['main', 'items'],
  children: [
    {
      type: 'table-column', xmlTag: 'lv_table-column', kind: 'virtual', isObj: false,
      createProps: [
        {
          key: 'column', type: 'int', min: 0, channel: 'both',
          c: { setter: '' }, ui: { group: 'value', label: '列', control: 'number' },
        },
      ],
      props: [
        {
          key: 'width', type: 'int', min: 0, channel: 'both',
          c: { setter: 'lv_table_set_column_width($parent, $column, $v)' },
          ui: { group: 'value', label: '列宽', control: 'number' },
        },
      ],
      acceptsWidgetChildren: false,
    },
    {
      type: 'table-cell', xmlTag: 'lv_table-cell', kind: 'virtual', isObj: false,
      createProps: [
        {
          key: 'row', type: 'int', min: 0, channel: 'both',
          c: { setter: '' }, ui: { group: 'value', label: '行', control: 'number' },
        },
        {
          key: 'column', type: 'int', min: 0, channel: 'both',
          c: { setter: '' }, ui: { group: 'value', label: '列', control: 'number' },
        },
      ],
      props: [
        {
          key: 'value', type: 'string', channel: 'both',
          c: { setter: 'lv_table_set_cell_value($parent, $row, $column, $v)' },
          ui: { group: 'content', label: '内容', control: 'text' },
        },
        {
          key: 'ctrl', type: 'orFlags', channel: 'both',
          enum: { tokens: TABLE_CELL_CTRL_TOKENS, cPrefix: 'LV_TABLE_CELL_CTRL_' },
          c: { setter: 'lv_table_set_cell_ctrl($parent, $row, $column, $v)' },
          ui: { group: 'behavior', label: '单元格控制', control: 'text' },
        },
      ],
      acceptsWidgetChildren: false,
    },
  ],
  acceptsWidgetChildren: false,
  palette: { category: 'display', label: '表格', icon: 'table' },
  defaultSize: { w: 'content', h: 'content' },
};

/* ----------------------------------------------------------------- tabview */

export const tabviewSpec: WidgetSpec = {
  type: 'tabview', xmlTag: 'lv_tabview', lvUseGuard: 'LV_USE_TABVIEW',
  cCreate: 'lv_tabview_create($parent)',
  props: [
    {
      key: 'active', type: 'int', min: 0, default: 0, channel: 'both',
      c: { setter: 'lv_tabview_set_active($obj, $v, LV_ANIM_OFF)' },
      ui: { group: 'value', label: '当前页', control: 'number' },
      notes: [
        'parser 切页动画时长写死 0(lv_xml_tabview_parser.c:58),C 同发 LV_ANIM_OFF',
        '上游语义:active 在开标签阶段应用,早于 tab 子元素创建(XML/C 同构,tab_cur 会先记下)',
      ],
    },
    {
      key: 'tab_bar_position', type: 'enum', default: 'top', channel: 'both',
      enum: DIR_ENUM,       // parser 走 lv_xml_dir_to_enum(base type)
      c: { setter: 'lv_tabview_set_tab_bar_position($obj, $v)' },
      ui: { group: 'behavior', label: '页签栏位置', control: 'select' },
    },
  ],
  bindableProps: [],
  parts: ['main'],
  children: [
    {
      type: 'tabview-tab', xmlTag: 'lv_tabview-tab', kind: 'add', isObj: true,
      cCreate: 'lv_tabview_add_tab($parent, $text)',
      createProps: [
        {
          key: 'text', type: 'string', channel: 'both',
          c: { setter: '' }, ui: { group: 'content', label: '页签文本', control: 'text' },
        },
      ],
      props: [],
      acceptsWidgetChildren: true,       // tab 是容器,可放任意 widget
    },
    {
      type: 'tabview-tab_bar', xmlTag: 'lv_tabview-tab_bar', kind: 'getter', isObj: true,
      cCreate: 'lv_tabview_get_tab_bar($parent)',
      props: [],
      acceptsWidgetChildren: false,
    },
    {
      type: 'tabview-tab_button', xmlTag: 'lv_tabview-tab_button', kind: 'getter', isObj: true,
      cCreate: 'lv_tabview_get_tab_button($parent, $index)',
      createProps: [
        {
          key: 'index', type: 'int', min: 0, default: 0, channel: 'both',
          c: { setter: '' }, ui: { group: 'value', label: '页签序号', control: 'number' },
        },
      ],
      props: [],
      acceptsWidgetChildren: false,
      notes: ['必须放在全部 tabview-tab 之后(getter 依赖 tab 已创建,parser:96)'],
    },
  ],
  acceptsWidgetChildren: false,
  palette: { category: 'container', label: '标签页', icon: 'tabview' },
  defaultSize: { w: 200, h: 200 },
};
