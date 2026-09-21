/**
 * M1 widget 描述表(2/2):slider / bar / arc / dropdown / roller /
 * textarea / spinbox / qrcode / scale。
 * 属性名/枚举 token 与 scripts/out/parser-attrs.json 逐字一致;
 * 伴生属性(value-animated / options-mode 等)用 companions 记录。
 */
import type { WidgetSpec } from '../registryTypes.js';

export const sliderSpec: WidgetSpec = {
  type: 'slider', xmlTag: 'lv_slider', lvUseGuard: 'LV_USE_SLIDER',
  cCreate: 'lv_slider_create($parent)',
  props: [
    {
      key: 'min_value', type: 'int', default: 0, channel: 'both',
      c: { setter: 'lv_slider_set_min_value($obj, $v)' },
      ui: { group: 'value', label: '最小值', control: 'number' },
    },
    {
      key: 'max_value', type: 'int', default: 100, channel: 'both',
      c: { setter: 'lv_slider_set_max_value($obj, $v)' },
      ui: { group: 'value', label: '最大值', control: 'number' },
    },
    {
      key: 'value', type: 'int', default: 0, channel: 'both',
      companions: [{ key: 'value_animated', type: 'bool', xmlAttr: 'value-animated' }],
      c: { setter: 'lv_slider_set_value($obj, $v, $value_animated:LV_ANIM_ON:LV_ANIM_OFF)' },
      ui: { group: 'value', label: '当前值', control: 'number' },
    },
    {
      key: 'start_value', type: 'int', channel: 'both',
      companions: [{ key: 'start_value_animated', type: 'bool', xmlAttr: 'start_value-animated' }],
      c: { setter: 'lv_slider_set_start_value($obj, $v, $start_value_animated:LV_ANIM_ON:LV_ANIM_OFF)' },
      ui: { group: 'value', label: '起始值', control: 'number' },
      notes: ['range 模式左端'],
    },
    {
      key: 'orientation', type: 'enum', default: 'auto', channel: 'both',
      enum: { tokens: ['auto', 'horizontal', 'vertical'], cPrefix: 'LV_SLIDER_ORIENTATION_' },
      c: { setter: 'lv_slider_set_orientation($obj, $v)' },
      ui: { group: 'behavior', label: '方向', control: 'select' },
    },
    {
      key: 'mode', type: 'enum', default: 'normal', channel: 'both',
      enum: { tokens: ['normal', 'range', 'symmetrical'], cPrefix: 'LV_SLIDER_MODE_' },
      c: { setter: 'lv_slider_set_mode($obj, $v)' },
      ui: { group: 'behavior', label: '模式', control: 'select' },
    },
  ],
  bindableProps: ['value'],
  parts: ['main', 'indicator', 'knob'],
  acceptsWidgetChildren: false,
  palette: { category: 'input', label: '滑条', icon: 'slider' },
  defaultSize: { w: 150, h: 10 },
};

export const barSpec: WidgetSpec = {
  type: 'bar', xmlTag: 'lv_bar', lvUseGuard: 'LV_USE_BAR',
  cCreate: 'lv_bar_create($parent)',
  props: [
    {
      key: 'value', type: 'int', default: 0, channel: 'both',
      companions: [{ key: 'value_animated', type: 'bool', xmlAttr: 'value-animated' }],
      c: { setter: 'lv_bar_set_value($obj, $v, $value_animated:LV_ANIM_ON:LV_ANIM_OFF)' },
      ui: { group: 'value', label: '当前值', control: 'number' },
    },
    {
      key: 'start_value', type: 'int', channel: 'both',
      companions: [{ key: 'start_value_animated', type: 'bool', xmlAttr: 'start_value-animated' }],
      c: { setter: 'lv_bar_set_start_value($obj, $v, $start_value_animated:LV_ANIM_ON:LV_ANIM_OFF)' },
      ui: { group: 'value', label: '起始值', control: 'number' },
    },
    {
      key: 'min_value', type: 'int', default: 0, channel: 'both',
      c: { setter: 'lv_bar_set_min_value($obj, $v)' },
      ui: { group: 'value', label: '最小值', control: 'number' },
    },
    {
      key: 'max_value', type: 'int', default: 100, channel: 'both',
      c: { setter: 'lv_bar_set_max_value($obj, $v)' },
      ui: { group: 'value', label: '最大值', control: 'number' },
    },
    {
      key: 'orientation', type: 'enum', default: 'auto', channel: 'both',
      enum: { tokens: ['auto', 'horizontal', 'vertical'], cPrefix: 'LV_BAR_ORIENTATION_' },
      c: { setter: 'lv_bar_set_orientation($obj, $v)' },
      ui: { group: 'behavior', label: '方向', control: 'select' },
    },
    {
      key: 'mode', type: 'enum', default: 'normal', channel: 'both',
      enum: { tokens: ['normal', 'range', 'symmetrical'], cPrefix: 'LV_BAR_MODE_' },
      c: { setter: 'lv_bar_set_mode($obj, $v)' },
      ui: { group: 'behavior', label: '模式', control: 'select' },
    },
  ],
  bindableProps: ['value'],
  parts: ['main', 'indicator'],
  acceptsWidgetChildren: false,
  palette: { category: 'display', label: '进度条', icon: 'bar' },
  defaultSize: { w: 150, h: 15 },
};

export const arcSpec: WidgetSpec = {
  type: 'arc', xmlTag: 'lv_arc', lvUseGuard: 'LV_USE_ARC',
  cCreate: 'lv_arc_create($parent)',
  props: [
    {
      key: 'start_angle', type: 'int', default: 135, channel: 'both',
      c: { setter: 'lv_arc_set_start_angle($obj, $v)' },
      ui: { group: 'value', label: '起始角', control: 'number' },
    },
    {
      key: 'end_angle', type: 'int', default: 45, channel: 'both',
      c: { setter: 'lv_arc_set_end_angle($obj, $v)' },
      ui: { group: 'value', label: '结束角', control: 'number' },
    },
    {
      key: 'bg_start_angle', type: 'int', default: 135, channel: 'both',
      c: { setter: 'lv_arc_set_bg_start_angle($obj, $v)' },
      ui: { group: 'value', label: '背景起始角', control: 'number' },
    },
    {
      key: 'bg_end_angle', type: 'int', default: 45, channel: 'both',
      c: { setter: 'lv_arc_set_bg_end_angle($obj, $v)' },
      ui: { group: 'value', label: '背景结束角', control: 'number' },
    },
    {
      key: 'rotation', type: 'int', default: 0, channel: 'both',
      c: { setter: 'lv_arc_set_rotation($obj, $v)' },
      ui: { group: 'value', label: '旋转', control: 'number' },
    },
    {
      key: 'value', type: 'int', default: 0, channel: 'both',
      c: { setter: 'lv_arc_set_value($obj, $v)' },
      ui: { group: 'value', label: '当前值', control: 'number' },
    },
    {
      key: 'min_value', type: 'int', default: 0, channel: 'both',
      c: { setter: 'lv_arc_set_min_value($obj, $v)' },
      ui: { group: 'value', label: '最小值', control: 'number' },
    },
    {
      key: 'max_value', type: 'int', default: 100, channel: 'both',
      c: { setter: 'lv_arc_set_max_value($obj, $v)' },
      ui: { group: 'value', label: '最大值', control: 'number' },
    },
    {
      key: 'mode', type: 'enum', default: 'normal', channel: 'both',
      enum: { tokens: ['normal', 'symmetrical', 'reverse'], cPrefix: 'LV_ARC_MODE_' },
      c: { setter: 'lv_arc_set_mode($obj, $v)' },
      ui: { group: 'behavior', label: '模式', control: 'select' },
    },
    {
      key: 'change_rate', type: 'int', default: 720, min: 0, channel: 'c-only',
      c: { setter: 'lv_arc_set_change_rate($obj, $v)' },
      ui: { group: 'behavior', label: '变化速率(度/秒)', control: 'number' },
      notes: ['9.4 XML 预览不生效；9.5 IR Preview/C 可直接调 setter'],
    },
    {
      key: 'knob_offset', type: 'int', default: 0, channel: 'c-only',
      c: { setter: 'lv_arc_set_knob_offset($obj, $v)' },
      ui: { group: 'geometry', label: '旋钮偏移', control: 'number' },
      notes: ['9.4 XML 预览不生效；9.5 IR Preview/C 可直接调 setter'],
    },
  ],
  bindableProps: ['value'],
  parts: ['main', 'indicator', 'knob'],
  acceptsWidgetChildren: false,
  palette: { category: 'input', label: '弧形', icon: 'arc' },
  defaultSize: { w: 150, h: 150 },
  notes: ['change_rate/knob_offset 已建模为 typed property；9.4 XML 迁移预览仍不生效'],
};

export const dropdownSpec: WidgetSpec = {
  type: 'dropdown', xmlTag: 'lv_dropdown', lvUseGuard: 'LV_USE_DROPDOWN',
  cCreate: 'lv_dropdown_create($parent)',
  props: [
    {
      key: 'options', type: 'string', channel: 'both',
      c: { setter: 'lv_dropdown_set_options($obj, $v)' },
      ui: { group: 'content', label: '选项(\\n 分隔)', control: 'text' },
    },
    {
      key: 'text', type: 'string', channel: 'both',
      c: { setter: 'lv_dropdown_set_text($obj, $v)' },
      ui: { group: 'content', label: '固定文本', control: 'text' },
    },
    {
      key: 'selected', type: 'int', default: 0, channel: 'both',
      c: { setter: 'lv_dropdown_set_selected($obj, $v)' },
      ui: { group: 'value', label: '选中项', control: 'number' },
    },
    {
      key: 'symbol', type: 'imageRef', channel: 'both',
      c: { setter: 'lv_dropdown_set_symbol($obj, $v)' },
      ui: { group: 'content', label: '符号', control: 'asset-picker' },
    },
  ],
  bindableProps: ['value'],
  parts: ['main', 'indicator'],
  children: [
    {
      type: 'dropdown-list', xmlTag: 'lv_dropdown-list', kind: 'getter', isObj: true,
      cCreate: 'lv_dropdown_get_list($parent)',
      props: [],
      acceptsWidgetChildren: false,
    },
  ],
  acceptsWidgetChildren: false,
  palette: { category: 'input', label: '下拉框', icon: 'dropdown' },
  defaultSize: { w: 130, h: 'content' },
  notes: ['无 dir/max_height/selected_highlight(XML 未暴露)'],
};

export const rollerSpec: WidgetSpec = {
  type: 'roller', xmlTag: 'lv_roller', lvUseGuard: 'LV_USE_ROLLER',
  cCreate: 'lv_roller_create($parent)',
  props: [
    {
      key: 'selected', type: 'int', default: 0, channel: 'both',
      companions: [{ key: 'selected_animated', type: 'bool', xmlAttr: 'value-animated' }],
      c: { setter: 'lv_roller_set_selected($obj, $v, $selected_animated:LV_ANIM_ON:LV_ANIM_OFF)' },
      ui: { group: 'value', label: '选中项', control: 'number' },
      notes: ['动画伴生属性名上游笔误为 value-animated(parser:59),emitter 照发'],
    },
    {
      key: 'visible_row_count', type: 'int', default: 3, channel: 'both',
      c: { setter: 'lv_roller_set_visible_row_count($obj, $v)' },
      ui: { group: 'behavior', label: '可见行数', control: 'number' },
    },
    {
      key: 'options', type: 'string', channel: 'both',
      companions: [{
        key: 'options_mode', type: 'enum', xmlAttr: 'options-mode',
        enum: { tokens: ['normal', 'infinite'], cPrefix: 'LV_ROLLER_MODE_' },
      }],
      c: { setter: 'lv_roller_set_options($obj, $v, $options_mode)' },
      ui: { group: 'content', label: '选项(\\n 分隔)', control: 'text' },
    },
  ],
  bindableProps: ['value'],
  parts: ['main', 'selected'],
  acceptsWidgetChildren: false,
  palette: { category: 'input', label: '滚轮', icon: 'roller' },
  defaultSize: { w: 'content', h: 'content' },
};

export const textareaSpec: WidgetSpec = {
  type: 'textarea', xmlTag: 'lv_textarea', lvUseGuard: 'LV_USE_TEXTAREA',
  cCreate: 'lv_textarea_create($parent)',
  props: [
    {
      key: 'text', type: 'string', channel: 'both',
      c: { setter: 'lv_textarea_set_text($obj, $v)' },
      ui: { group: 'content', label: '文本', control: 'text' },
    },
    {
      key: 'placeholder_text', type: 'string', channel: 'both',
      c: { setter: 'lv_textarea_set_placeholder_text($obj, $v)' },
      ui: { group: 'content', label: '占位文本', control: 'text' },
    },
    {
      key: 'one_line', type: 'bool', default: false, channel: 'both',
      c: { setter: 'lv_textarea_set_one_line($obj, $v)' },
      ui: { group: 'behavior', label: '单行', control: 'toggle' },
    },
    {
      key: 'password_mode', type: 'bool', default: false, channel: 'both',
      c: { setter: 'lv_textarea_set_password_mode($obj, $v)' },
      ui: { group: 'behavior', label: '密码模式', control: 'toggle' },
    },
    {
      key: 'password_show_time', type: 'int', channel: 'both',
      c: { setter: 'lv_textarea_set_password_show_time($obj, $v)' },
      ui: { group: 'behavior', label: '密码显示时长', control: 'number' },
    },
    {
      key: 'text_selection', type: 'bool', default: false, channel: 'both',
      c: { setter: 'lv_textarea_set_text_selection($obj, $v)' },
      ui: { group: 'behavior', label: '可选中文本', control: 'toggle' },
    },
    {
      key: 'cursor_pos', type: 'int', channel: 'both',
      c: { setter: 'lv_textarea_set_cursor_pos($obj, $v)' },
      ui: { group: 'value', label: '光标位置', control: 'number' },
    },
    {
      // 一期唯一的 c-only 刚需项之一(ARCHITECTURE §4):XML parser 未实现,C 照发
      key: 'max_length', type: 'int', min: 0, channel: 'c-only',
      c: { setter: 'lv_textarea_set_max_length($obj, $v)' },
      ui: { group: 'behavior', label: '最大长度(仅代码)', control: 'number' },
      notes: ['9.4 XML parser 未实现,仅进 C 产物,画布不生效(角标提示)'],
    },
  ],
  bindableProps: [],
  parts: ['main', 'scrollbar', 'selected', 'cursor'],
  acceptsWidgetChildren: false,
  palette: { category: 'input', label: '文本框', icon: 'textarea' },
  defaultSize: { w: 150, h: 70 },
  notes: ['无 accepted_chars/password_bullet(XML 未暴露)'],
};

export const spinboxSpec: WidgetSpec = {
  type: 'spinbox', xmlTag: 'lv_spinbox', lvUseGuard: 'LV_USE_SPINBOX',
  cCreate: 'lv_spinbox_create($parent)',
  props: [
    {
      key: 'value', type: 'int', default: 0, channel: 'both',
      c: { setter: 'lv_spinbox_set_value($obj, $v)' },
      ui: { group: 'value', label: '当前值', control: 'number' },
    },
    {
      key: 'rollover', type: 'bool', default: false, channel: 'both',
      c: { setter: 'lv_spinbox_set_rollover($obj, $v)' },
      ui: { group: 'behavior', label: '循环', control: 'toggle' },
    },
    {
      key: 'digit_count', type: 'int', default: 5, min: 1, max: 10, channel: 'both',
      c: { setter: 'lv_spinbox_set_digit_count($obj, $v)' },
      ui: { group: 'behavior', label: '位数', control: 'number' },
    },
    {
      key: 'dec_point_pos', type: 'int', default: 0, channel: 'both',
      c: { setter: 'lv_spinbox_set_dec_point_pos($obj, $v)' },
      ui: { group: 'behavior', label: '小数点位置', control: 'number' },
    },
    {
      key: 'min_value', type: 'int', channel: 'both',
      c: { setter: 'lv_spinbox_set_min_value($obj, $v)' },
      ui: { group: 'value', label: '最小值', control: 'number' },
    },
    {
      key: 'max_value', type: 'int', channel: 'both',
      c: { setter: 'lv_spinbox_set_max_value($obj, $v)' },
      ui: { group: 'value', label: '最大值', control: 'number' },
    },
    {
      key: 'step', type: 'int', default: 1, channel: 'both',
      c: { setter: 'lv_spinbox_set_step($obj, $v)' },
      ui: { group: 'behavior', label: '步进', control: 'number' },
    },
  ],
  bindableProps: ['value'],
  parts: ['main', 'scrollbar', 'selected', 'cursor'],
  acceptsWidgetChildren: false,
  palette: { category: 'input', label: '数字框', icon: 'spinbox' },
  defaultSize: { w: 100, h: 40 },
};

export const qrcodeSpec: WidgetSpec = {
  type: 'qrcode', xmlTag: 'lv_qrcode', lvUseGuard: 'LV_USE_QRCODE',
  cCreate: 'lv_qrcode_create($parent)',
  props: [
    {
      key: 'size', type: 'int', min: 1, channel: 'both',
      c: { setter: 'lv_qrcode_set_size($obj, $v)' },
      ui: { group: 'geometry', label: '边长', control: 'number' },
    },
    {
      key: 'dark_color', type: 'color', default: '#000000', channel: 'both',
      c: { setter: 'lv_qrcode_set_dark_color($obj, $v)' },
      ui: { group: 'content', label: '深色', control: 'color' },
    },
    {
      key: 'light_color', type: 'color', default: '#ffffff', channel: 'both',
      c: { setter: 'lv_qrcode_set_light_color($obj, $v)' },
      ui: { group: 'content', label: '浅色', control: 'color' },
    },
    {
      key: 'data', type: 'string', channel: 'both',
      c: { setter: 'lv_qrcode_update($obj, $v, lv_strlen($v))' },
      ui: { group: 'content', label: '内容', control: 'text' },
    },
    {
      key: 'quiet_zone', type: 'bool', channel: 'both',
      c: { setter: 'lv_qrcode_set_quiet_zone($obj, $v)' },
      ui: { group: 'behavior', label: '静区', control: 'toggle' },
    },
  ],
  bindableProps: [],
  parts: ['main'],
  acceptsWidgetChildren: false,
  palette: { category: 'display', label: '二维码', icon: 'qrcode' },
  defaultSize: { w: 100, h: 100 },
};

export const scaleSpec: WidgetSpec = {
  type: 'scale', xmlTag: 'lv_scale', lvUseGuard: 'LV_USE_SCALE',
  cCreate: 'lv_scale_create($parent)',
  props: [
    {
      key: 'mode', type: 'enum', default: 'horizontal_bottom', channel: 'both',
      enum: {
        tokens: [
          'horizontal_top', 'horizontal_bottom', 'vertical_left',
          'vertical_right', 'round_inner', 'round_outer',
        ],
        cPrefix: 'LV_SCALE_MODE_',
      },
      c: { setter: 'lv_scale_set_mode($obj, $v)' },
      ui: { group: 'behavior', label: '模式', control: 'select' },
    },
    {
      key: 'total_tick_count', type: 'int', default: 11, min: 2, channel: 'both',
      c: { setter: 'lv_scale_set_total_tick_count($obj, $v)' },
      ui: { group: 'behavior', label: '总刻度数', control: 'number' },
    },
    {
      key: 'major_tick_every', type: 'int', default: 5, min: 1, channel: 'both',
      c: { setter: 'lv_scale_set_major_tick_every($obj, $v)' },
      ui: { group: 'behavior', label: '主刻度间隔', control: 'number' },
    },
    {
      key: 'label_show', type: 'bool', default: true, channel: 'both',
      c: { setter: 'lv_scale_set_label_show($obj, $v)' },
      ui: { group: 'behavior', label: '显示标签', control: 'toggle' },
    },
    {
      key: 'post_draw', type: 'bool', default: false, channel: 'both',
      c: { setter: 'lv_scale_set_post_draw($obj, $v)' },
      ui: { group: 'behavior', label: '后绘制', control: 'toggle' },
    },
    {
      key: 'draw_ticks_on_top', type: 'bool', default: false, channel: 'both',
      c: { setter: 'lv_scale_set_draw_ticks_on_top($obj, $v)' },
      ui: { group: 'behavior', label: '刻度置顶', control: 'toggle' },
    },
    {
      key: 'min_value', type: 'int', default: 0, channel: 'both',
      c: { setter: 'lv_scale_set_min_value($obj, $v)' },
      ui: { group: 'value', label: '最小值', control: 'number' },
    },
    {
      key: 'max_value', type: 'int', default: 100, channel: 'both',
      c: { setter: 'lv_scale_set_max_value($obj, $v)' },
      ui: { group: 'value', label: '最大值', control: 'number' },
    },
    {
      key: 'angle_range', type: 'int', default: 270, channel: 'both',
      c: { setter: 'lv_scale_set_angle_range($obj, $v)' },
      ui: { group: 'value', label: '角度范围', control: 'number' },
    },
    {
      key: 'rotation', type: 'int', channel: 'both',
      c: { setter: 'lv_scale_set_rotation($obj, $v)' },
      ui: { group: 'value', label: '旋转', control: 'number' },
    },
  ],
  bindableProps: [],
  parts: ['main', 'indicator', 'items'],
  // 一期不做 scale-section 子元素(任务定案),children 不声明
  acceptsWidgetChildren: false,
  palette: { category: 'display', label: '刻度尺', icon: 'scale' },
  defaultSize: { w: 200, h: 100 },
  notes: ['section 子元素一期不做;text_src 上游未实现(parser:56 注释)'],
};
