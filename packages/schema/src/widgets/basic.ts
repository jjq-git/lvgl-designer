/**
 * M1 widget 描述表(1/2):obj / label / button / image / checkbox / switch。
 * 属性名/枚举 token 与 scripts/out/parser-attrs.json 逐字一致。
 */
import type { WidgetSpec } from '../registryTypes.js';

export const objSpec: WidgetSpec = {
  type: 'obj', xmlTag: 'lv_obj', lvUseGuard: 'LV_USE_OBJ',
  cCreate: 'lv_obj_create($parent)',
  props: [],                       // 全部来自 OBJ_BASE
  bindableProps: ['checked'],      // bind_checked(obj 基类)
  parts: ['main', 'scrollbar'],
  acceptsWidgetChildren: true,
  palette: { category: 'container', label: '面板', icon: 'obj' },
  defaultSize: { w: 100, h: 100 },
};

export const labelSpec: WidgetSpec = {
  type: 'label', xmlTag: 'lv_label', lvUseGuard: 'LV_USE_LABEL',
  cCreate: 'lv_label_create($parent)',
  props: [
    {
      key: 'text', type: 'string', default: 'Text', channel: 'both',
      c: { setter: 'lv_label_set_text($obj, $v)' },
      ui: { group: 'content', label: '文本', control: 'text' },
    },
    {
      key: 'long_mode', type: 'enum', default: 'wrap', channel: 'both',
      enum: {
        tokens: ['wrap', 'scroll', 'scroll_circular', 'dots', 'clip'],
        cPrefix: 'LV_LABEL_LONG_MODE_',
      },
      c: { setter: 'lv_label_set_long_mode($obj, $v)' },
      ui: { group: 'behavior', label: '超长处理', control: 'select' },
    },
    {
      key: 'translation_tag', type: 'string', channel: 'both',
      c: { setter: 'lv_label_set_translation_tag($obj, $v)' },
      ui: { group: 'content', label: '翻译标签', control: 'text' },
      notes: ['依赖 LV_USE_TRANSLATION'],
    },
  ],
  bindableProps: ['text'],         // bind_text(+伴生 bind_text-fmt)
  parts: ['main', 'scrollbar', 'selected'],
  acceptsWidgetChildren: true,
  palette: { category: 'basic', label: '标签', icon: 'label' },
  defaultSize: { w: 'content', h: 'content' },
};

export const buttonSpec: WidgetSpec = {
  type: 'button', xmlTag: 'lv_button', lvUseGuard: 'LV_USE_BUTTON',
  cCreate: 'lv_button_create($parent)',
  props: [],                       // 无专有属性,仅 obj 基类
  bindableProps: ['checked'],
  parts: ['main'],
  acceptsWidgetChildren: true,     // 惯用法:内放 label
  palette: { category: 'basic', label: '按钮', icon: 'button' },
  defaultSize: { w: 100, h: 40 },
};

export const imageSpec: WidgetSpec = {
  type: 'image', xmlTag: 'lv_image', lvUseGuard: 'LV_USE_IMAGE',
  cCreate: 'lv_image_create($parent)',
  props: [
    {
      key: 'src', type: 'imageRef', channel: 'both',
      c: { setter: 'lv_image_set_src($obj, $v)' },
      ui: { group: 'content', label: '图片源', control: 'asset-picker' },
    },
    {
      key: 'inner_align', type: 'enum', default: 'center', channel: 'both',
      enum: {
        tokens: [
          'top_left', 'top_mid', 'top_right',
          'bottom_left', 'bottom_mid', 'bottom_right',
          'right_mid', 'left_mid', 'center', 'stretch', 'tile',
        ],
        cPrefix: 'LV_IMAGE_ALIGN_',
      },
      c: { setter: 'lv_image_set_inner_align($obj, $v)' },
      ui: { group: 'behavior', label: '内部对齐', control: 'select' },
    },
    {
      key: 'rotation', type: 'int', default: 0, channel: 'both',
      c: { setter: 'lv_image_set_rotation($obj, $v)' },
      ui: { group: 'value', label: '旋转(0.1°)', control: 'number' },
    },
    {
      key: 'scale_x', type: 'int', default: 256, channel: 'both',
      c: { setter: 'lv_image_set_scale_x($obj, $v)' },
      ui: { group: 'value', label: 'X 缩放(256=1x)', control: 'number' },
    },
    {
      key: 'scale_y', type: 'int', default: 256, channel: 'both',
      c: { setter: 'lv_image_set_scale_y($obj, $v)' },
      ui: { group: 'value', label: 'Y 缩放(256=1x)', control: 'number' },
    },
    {
      key: 'pivot_x', type: 'size', channel: 'both',
      c: { setter: 'lv_image_set_pivot_x($obj, $v)' },
      ui: { group: 'value', label: '轴心 X', control: 'number' },
    },
    {
      key: 'pivot_y', type: 'size', channel: 'both',
      c: { setter: 'lv_image_set_pivot_y($obj, $v)' },
      ui: { group: 'value', label: '轴心 Y', control: 'number' },
    },
  ],
  bindableProps: ['src'],          // bind_src
  parts: ['main'],
  acceptsWidgetChildren: false,
  palette: { category: 'media', label: '图片', icon: 'image' },
  defaultSize: { w: 'content', h: 'content' },
};

export const checkboxSpec: WidgetSpec = {
  type: 'checkbox', xmlTag: 'lv_checkbox', lvUseGuard: 'LV_USE_CHECKBOX',
  cCreate: 'lv_checkbox_create($parent)',
  props: [
    {
      key: 'text', type: 'string', default: 'Check box', channel: 'both',
      c: { setter: 'lv_checkbox_set_text($obj, $v)' },
      ui: { group: 'content', label: '文本', control: 'text' },
    },
  ],
  bindableProps: ['checked'],      // 基类 bind_checked
  parts: ['main', 'indicator'],
  acceptsWidgetChildren: false,
  palette: { category: 'input', label: '复选框', icon: 'checkbox' },
  defaultSize: { w: 'content', h: 'content' },
};

export const switchSpec: WidgetSpec = {
  type: 'switch', xmlTag: 'lv_switch', lvUseGuard: 'LV_USE_SWITCH',
  cCreate: 'lv_switch_create($parent)',
  props: [
    {
      key: 'orientation', type: 'enum', default: 'auto', channel: 'both',
      enum: {
        tokens: ['auto', 'horizontal', 'vertical'],
        cPrefix: 'LV_SWITCH_ORIENTATION_',
      },
      c: { setter: 'lv_switch_set_orientation($obj, $v)' },
      ui: { group: 'behavior', label: '方向', control: 'select' },
    },
  ],
  bindableProps: ['checked'],      // 基类 bind_checked
  parts: ['main', 'indicator', 'knob'],
  acceptsWidgetChildren: false,
  palette: { category: 'input', label: '开关', icon: 'switch' },
  defaultSize: { w: 50, h: 25 },
};
