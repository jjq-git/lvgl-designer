/**
 * M3 自研 13 控件描述表:led / line / spinner / imagebutton / animimage /
 * msgbox / list / menu / win / tileview / arclabel / canvas / lottie。
 * 唯一事实源:runtime/src/xml_parsers_extra/manifest.json(A 产出,已与 .c 逐字对齐)。
 * 属性名/枚举 token/子元素 tag 与 manifest 逐字一致,由
 * __tests__/manifest-parity.test.ts 对账。
 *
 * C setter 与 manifest.cSetter 的两处约定内偏差(parity 测试白名单):
 * - line.points:C 静态数组用 lv_line_set_points(manifest 为 _mutable,parser 堆持有)
 * - lottie.src:C 用 lv_lottie_set_src_data + extern 数组(manifest 为 set_src_file,
 *   MEMFS 路径仅预览通道可用),c94 emitter 特殊形态
 */
import type { WidgetSpec } from '../registryTypes.js';

/* ---------------------------------------------------------------------- led */

export const ledSpec: WidgetSpec = {
  type: 'led', xmlTag: 'lv_led', lvUseGuard: 'LV_USE_LED',
  cCreate: 'lv_led_create($parent)',
  props: [
    {
      key: 'color', type: 'color', channel: 'both',
      c: { setter: 'lv_led_set_color($obj, $v)' },
      ui: { group: 'content', label: '颜色', control: 'color' },
    },
    {
      key: 'brightness', type: 'int', min: 0, max: 255, default: 255, channel: 'both',
      c: { setter: 'lv_led_set_brightness($obj, $v)' },
      ui: { group: 'value', label: '亮度(0-255)', control: 'number' },
      notes: ['LV_LED_BRIGHT_MIN/MAX;开/关语义用 brightness 表达'],
    },
  ],
  bindableProps: [],
  parts: ['main'],
  acceptsWidgetChildren: false,
  palette: { category: 'display', label: 'LED', icon: 'led' },
  defaultSize: { w: 40, h: 40 },
};

/* --------------------------------------------------------------------- line */

export const lineSpec: WidgetSpec = {
  type: 'line', xmlTag: 'lv_line', lvUseGuard: 'LV_USE_LINE',
  cCreate: 'lv_line_create($parent)',
  props: [
    {
      // JSON 平铺 [x1,y1,x2,y2,…];XML "x1,y1 x2,y2";C 发 static 数组($ptarr/$n 模板)
      key: 'points', type: 'pointList', channel: 'both',
      c: { setter: 'lv_line_set_points($obj, $ptarr, $n)' },
      ui: { group: 'content', label: '点(x1,y1 x2,y2…)', control: 'text' },
      notes: ['parser 侧为 lv_line_set_points_mutable(堆数组自持);C 侧 static 数组用非 mutable 版'],
    },
    {
      key: 'y_invert', type: 'bool', default: false, channel: 'both',
      c: { setter: 'lv_line_set_y_invert($obj, $v)' },
      ui: { group: 'behavior', label: 'Y 轴反转', control: 'toggle' },
    },
  ],
  bindableProps: [],
  parts: ['main'],
  acceptsWidgetChildren: false,
  palette: { category: 'basic', label: '折线', icon: 'line' },
  defaultSize: { w: 'content', h: 'content' },
};

/* ------------------------------------------------------------------ spinner */

export const spinnerSpec: WidgetSpec = {
  type: 'spinner', xmlTag: 'lv_spinner', lvUseGuard: 'LV_USE_SPINNER',
  cCreate: 'lv_spinner_create($parent)',
  props: [
    // 两属性合一 setter:模板相同且不含 $v,emitter 按展开结果去重只发一次
    {
      key: 'anim_duration', type: 'int', min: 1, default: 1000, channel: 'both',
      c: { setter: 'lv_spinner_set_anim_params($obj, $anim_duration, $angle)' },
      ui: { group: 'value', label: '周期(ms)', control: 'number' },
    },
    {
      key: 'angle', type: 'int', min: 0, max: 360, default: 270, channel: 'both',
      c: { setter: 'lv_spinner_set_anim_params($obj, $anim_duration, $angle)' },
      ui: { group: 'value', label: '弧长(°)', control: 'number' },
    },
  ],
  bindableProps: [],
  parts: ['main', 'indicator'],
  acceptsWidgetChildren: false,
  palette: { category: 'display', label: '加载圈', icon: 'spinner' },
  defaultSize: { w: 100, h: 100 },
};

/* -------------------------------------------------------------- imagebutton */

const IMAGEBUTTON_STATE_ENUM = {
  tokens: [
    'released', 'pressed', 'disabled',
    'checked_released', 'checked_pressed', 'checked_disabled',
  ],
  cPrefix: 'LV_IMAGEBUTTON_STATE_',
} as const;

export const imagebuttonSpec: WidgetSpec = {
  type: 'imagebutton', xmlTag: 'lv_imagebutton', lvUseGuard: 'LV_USE_IMAGEBUTTON',
  cCreate: 'lv_imagebutton_create($parent)',
  props: [
    // lv_imagebutton_set_src(obj,state,left,mid,right) 一次收三段:
    // 同 state 三属性共用同一模板(不含 $v),emitter 去重后每 state 只发一次,缺段发 NULL
    {
      key: 'src_released_left', type: 'imageRef', channel: 'both',
      c: { setter: 'lv_imagebutton_set_src($obj, LV_IMAGEBUTTON_STATE_RELEASED, $src_released_left, $src_released_mid, $src_released_right)' },
      ui: { group: 'content', label: '释放·左', control: 'asset-picker' },
    },
    {
      key: 'src_released_mid', type: 'imageRef', channel: 'both',
      c: { setter: 'lv_imagebutton_set_src($obj, LV_IMAGEBUTTON_STATE_RELEASED, $src_released_left, $src_released_mid, $src_released_right)' },
      ui: { group: 'content', label: '释放·中', control: 'asset-picker' },
    },
    {
      key: 'src_released_right', type: 'imageRef', channel: 'both',
      c: { setter: 'lv_imagebutton_set_src($obj, LV_IMAGEBUTTON_STATE_RELEASED, $src_released_left, $src_released_mid, $src_released_right)' },
      ui: { group: 'content', label: '释放·右', control: 'asset-picker' },
    },
    {
      key: 'src_pressed_left', type: 'imageRef', channel: 'both',
      c: { setter: 'lv_imagebutton_set_src($obj, LV_IMAGEBUTTON_STATE_PRESSED, $src_pressed_left, $src_pressed_mid, $src_pressed_right)' },
      ui: { group: 'content', label: '按下·左', control: 'asset-picker' },
    },
    {
      key: 'src_pressed_mid', type: 'imageRef', channel: 'both',
      c: { setter: 'lv_imagebutton_set_src($obj, LV_IMAGEBUTTON_STATE_PRESSED, $src_pressed_left, $src_pressed_mid, $src_pressed_right)' },
      ui: { group: 'content', label: '按下·中', control: 'asset-picker' },
    },
    {
      key: 'src_pressed_right', type: 'imageRef', channel: 'both',
      c: { setter: 'lv_imagebutton_set_src($obj, LV_IMAGEBUTTON_STATE_PRESSED, $src_pressed_left, $src_pressed_mid, $src_pressed_right)' },
      ui: { group: 'content', label: '按下·右', control: 'asset-picker' },
    },
    {
      key: 'state', type: 'enum', default: 'released', channel: 'both',
      enum: IMAGEBUTTON_STATE_ENUM,
      c: { setter: 'lv_imagebutton_set_state($obj, $v)' },
      ui: { group: 'value', label: '状态', control: 'select' },
    },
  ],
  bindableProps: ['checked'],
  parts: ['main'],
  acceptsWidgetChildren: true,       // 惯用法:内放 label
  palette: { category: 'input', label: '图片按钮', icon: 'imagebutton' },
  defaultSize: { w: 'content', h: 'content' },
  notes: ['务实子集:仅暴露 RELEASED/PRESSED 两态源(左/中/右各三段)'],
};

/* ---------------------------------------------------------------- animimage */

export const animimageSpec: WidgetSpec = {
  type: 'animimage', xmlTag: 'lv_animimage', lvUseGuard: 'LV_USE_ANIMIMG',
  cCreate: 'lv_animimg_create($parent)',
  props: [
    {
      // JSON string[](imageRef 名);XML 空格分隔;C 发 static const void * 数组($imgarr/$n)
      key: 'srcs', type: 'stringList', channel: 'both',
      c: { setter: 'lv_animimg_set_src($obj, $imgarr, $n)' },
      ui: { group: 'content', label: '帧序列', control: 'text' },
      notes: ['上限 127 帧(pic_count 为 int8_t);C 侧随后自动补 lv_animimg_start'],
    },
    {
      key: 'duration', type: 'int', min: 1, default: 1000, channel: 'both',
      c: { setter: 'lv_animimg_set_duration($obj, $v)' },
      ui: { group: 'value', label: '时长(ms)', control: 'number' },
    },
    {
      key: 'repeat_count', type: 'int', min: 0, channel: 'both',
      c: { setter: 'lv_animimg_set_repeat_count($obj, $v)' },
      ui: { group: 'value', label: '重复次数(空=无限)', control: 'number' },
      notes: ['缺省即 LV_ANIM_REPEAT_INFINITE(parser/构造器默认);XML 侧另收 token "infinite"'],
    },
  ],
  bindableProps: [],
  parts: ['main'],
  acceptsWidgetChildren: false,
  palette: { category: 'media', label: '动画图片', icon: 'animimage' },
  defaultSize: { w: 'content', h: 'content' },
};

/* ------------------------------------------------------------------- msgbox */

export const msgboxSpec: WidgetSpec = {
  type: 'msgbox', xmlTag: 'lv_msgbox', lvUseGuard: 'LV_USE_MSGBOX',
  cCreate: 'lv_msgbox_create($parent)',
  props: [
    {
      key: 'title', type: 'string', channel: 'both',
      c: { setter: 'lv_msgbox_add_title($obj, $v)' },
      ui: { group: 'content', label: '标题', control: 'text' },
    },
    {
      key: 'text', type: 'string', channel: 'both',
      c: { setter: 'lv_msgbox_add_text($obj, $v)' },
      ui: { group: 'content', label: '正文', control: 'text' },
    },
    {
      key: 'close_button', type: 'bool', default: false, channel: 'both',
      c: { setter: 'lv_msgbox_add_close_button($obj)' },
      ui: { group: 'behavior', label: '关闭按钮', control: 'toggle' },
      notes: ['只加不减:false 不移除已有按钮(parser 同语义)'],
    },
  ],
  bindableProps: [],
  parts: ['main'],
  children: [
    {
      type: 'msgbox-button', xmlTag: 'lv_msgbox-button', kind: 'add', isObj: true,
      cCreate: 'lv_msgbox_add_footer_button($parent, $text)',
      createProps: [
        {
          key: 'text', type: 'string', default: '', channel: 'both',
          c: { setter: '' }, ui: { group: 'content', label: '按钮文本', control: 'text' },
        },
      ],
      props: [],
      acceptsWidgetChildren: false,
    },
  ],
  acceptsWidgetChildren: true,       // 普通子控件落在 msgbox 容器上(content 之外)
  palette: { category: 'container', label: '消息框', icon: 'msgbox' },
  defaultSize: { w: 200, h: 'content' },
};

/* --------------------------------------------------------------------- list */

export const listSpec: WidgetSpec = {
  type: 'list', xmlTag: 'lv_list', lvUseGuard: 'LV_USE_LIST',
  cCreate: 'lv_list_create($parent)',
  props: [],                          // lv_list 无专有 setter(样式化 lv_obj)
  bindableProps: [],
  parts: ['main', 'scrollbar'],
  children: [
    {
      type: 'list-text', xmlTag: 'lv_list-text', kind: 'add', isObj: true,
      cCreate: 'lv_list_add_text($parent, $text)',
      createProps: [
        {
          key: 'text', type: 'string', default: '', channel: 'both',
          c: { setter: '' }, ui: { group: 'content', label: '文本', control: 'text' },
        },
      ],
      props: [],
      acceptsWidgetChildren: false,
    },
    {
      type: 'list-button', xmlTag: 'lv_list-button', kind: 'add', isObj: true,
      cCreate: 'lv_list_add_button($parent, $icon, $text)',
      createProps: [
        {
          key: 'icon', type: 'imageRef', optional: true, channel: 'both',
          c: { setter: '' }, ui: { group: 'content', label: '图标', control: 'asset-picker' },
        },
        {
          key: 'text', type: 'string', default: '', channel: 'both',
          c: { setter: '' }, ui: { group: 'content', label: '文本', control: 'text' },
        },
      ],
      props: [],
      acceptsWidgetChildren: false,
      notes: ['icon 缺省 NULL(纯文本按钮)'],
    },
  ],
  acceptsWidgetChildren: true,
  palette: { category: 'container', label: '列表', icon: 'list' },
  defaultSize: { w: 200, h: 200 },
};

/* --------------------------------------------------------------------- menu */

export const menuSpec: WidgetSpec = {
  type: 'menu', xmlTag: 'lv_menu', lvUseGuard: 'LV_USE_MENU',
  cCreate: 'lv_menu_create($parent)',
  props: [
    {
      key: 'mode_header', type: 'enum', default: 'top_fixed', channel: 'both',
      enum: { tokens: ['top_fixed', 'top_unfixed', 'bottom_fixed'], cPrefix: 'LV_MENU_HEADER_' },
      c: { setter: 'lv_menu_set_mode_header($obj, $v)' },
      ui: { group: 'behavior', label: '头部模式', control: 'select' },
    },
    {
      key: 'mode_root_back_button', type: 'enum', default: 'disabled', channel: 'both',
      enum: { tokens: ['disabled', 'enabled'], cPrefix: 'LV_MENU_ROOT_BACK_BUTTON_' },
      c: { setter: 'lv_menu_set_mode_root_back_button($obj, $v)' },
      ui: { group: 'behavior', label: '根返回按钮', control: 'select' },
    },
  ],
  bindableProps: [],
  parts: ['main'],
  children: [
    {
      type: 'menu-page', xmlTag: 'lv_menu-page', kind: 'add', isObj: true,
      cCreate: 'lv_menu_page_create($parent, $title)',
      createProps: [
        {
          key: 'title', type: 'string', optional: true, channel: 'both',
          c: { setter: '' }, ui: { group: 'content', label: '页标题', control: 'text' },
        },
      ],
      props: [],
      acceptsWidgetChildren: true,     // page 是容器
      notes: ['首个 page 由 emitter 自动 lv_menu_set_page(与 parser 同语义,预览可见)'],
    },
  ],
  acceptsWidgetChildren: false,
  palette: { category: 'container', label: '菜单', icon: 'menu' },
  defaultSize: { w: 200, h: 200 },
  notes: ['简化模型:menu + pages,无 sidebar/section 子元素'],
};

/* ---------------------------------------------------------------------- win */

export const winSpec: WidgetSpec = {
  type: 'win', xmlTag: 'lv_win', lvUseGuard: 'LV_USE_WIN',
  cCreate: 'lv_win_create($parent)',
  props: [
    {
      key: 'title', type: 'string', channel: 'both',
      c: { setter: 'lv_win_add_title($obj, $v)' },
      ui: { group: 'content', label: '标题', control: 'text' },
    },
  ],
  bindableProps: [],
  parts: ['main'],
  children: [
    {
      type: 'win-button', xmlTag: 'lv_win-button', kind: 'add', isObj: true,
      cCreate: 'lv_win_add_button($parent, $icon, $width)',
      createProps: [
        {
          key: 'icon', type: 'imageRef', optional: true, channel: 'both',
          c: { setter: '' }, ui: { group: 'content', label: '图标', control: 'asset-picker' },
        },
        {
          key: 'width', type: 'int', min: 1, default: 40, channel: 'both',
          c: { setter: '' }, ui: { group: 'value', label: '宽度', control: 'number' },
        },
      ],
      props: [],
      acceptsWidgetChildren: false,
      notes: ['进 header 区'],
    },
  ],
  acceptsWidgetChildren: true,
  palette: { category: 'container', label: '窗口', icon: 'win' },
  defaultSize: { w: 240, h: 200 },
  notes: ['普通子控件落在 win 对象上(header+content 之下),不进 content 区(A 遗留 #1)'],
};

/* ----------------------------------------------------------------- tileview */

export const tileviewSpec: WidgetSpec = {
  type: 'tileview', xmlTag: 'lv_tileview', lvUseGuard: 'LV_USE_TILEVIEW',
  cCreate: 'lv_tileview_create($parent)',
  props: [],
  bindableProps: [],
  parts: ['main', 'scrollbar'],
  children: [
    {
      type: 'tileview-tile', xmlTag: 'lv_tileview-tile', kind: 'add', isObj: true,
      cCreate: 'lv_tileview_add_tile($parent, $col, $row, $dir)',
      createProps: [
        {
          key: 'col', type: 'int', min: 0, default: 0, channel: 'both',
          c: { setter: '' }, ui: { group: 'value', label: '列', control: 'number' },
        },
        {
          key: 'row', type: 'int', min: 0, default: 0, channel: 'both',
          c: { setter: '' }, ui: { group: 'value', label: '行', control: 'number' },
        },
        {
          // token 顺序照抄 manifest(parser 收 '|' 组合,设计器一期单选)
          key: 'dir', type: 'enum', default: 'all', channel: 'both',
          enum: {
            tokens: ['none', 'left', 'right', 'top', 'bottom', 'hor', 'ver', 'all'],
            cPrefix: 'LV_DIR_',
          },
          c: { setter: '' }, ui: { group: 'behavior', label: '允许方向', control: 'select' },
        },
      ],
      props: [],
      acceptsWidgetChildren: true,     // tile 是容器
    },
  ],
  acceptsWidgetChildren: false,
  palette: { category: 'container', label: '平铺视图', icon: 'tileview' },
  defaultSize: { w: '100%', h: '100%' },
};

/* ----------------------------------------------------------------- arclabel */

const ARCLABEL_TEXT_ALIGN_ENUM = {
  tokens: ['default', 'leading', 'center', 'trailing'],
  cPrefix: 'LV_ARCLABEL_TEXT_ALIGN_',
} as const;

export const arclabelSpec: WidgetSpec = {
  type: 'arclabel', xmlTag: 'lv_arclabel', lvUseGuard: 'LV_USE_ARCLABEL',
  cCreate: 'lv_arclabel_create($parent)',
  props: [
    {
      key: 'text', type: 'string', channel: 'both',
      c: { setter: 'lv_arclabel_set_text($obj, $v)' },
      ui: { group: 'content', label: '文本', control: 'text' },
    },
    {
      key: 'angle_start', type: 'int', default: 0, channel: 'both',
      c: { setter: 'lv_arclabel_set_angle_start($obj, $v)' },
      ui: { group: 'value', label: '起始角(°)', control: 'number' },
      notes: ['底层为 lv_value_precise_t(float),设计器按 int 处理(A 遗留 #3)'],
    },
    {
      key: 'angle_size', type: 'int', default: 360, channel: 'both',
      c: { setter: 'lv_arclabel_set_angle_size($obj, $v)' },
      ui: { group: 'value', label: '弧角(°)', control: 'number' },
    },
    {
      key: 'offset', type: 'int', default: 0, channel: 'both',
      c: { setter: 'lv_arclabel_set_offset($obj, $v)' },
      ui: { group: 'value', label: '偏移', control: 'number' },
    },
    {
      key: 'dir', type: 'enum', default: 'clockwise', channel: 'both',
      enum: { tokens: ['clockwise', 'counter_clockwise'], cPrefix: 'LV_ARCLABEL_DIR_' },
      c: { setter: 'lv_arclabel_set_dir($obj, $v)' },
      ui: { group: 'behavior', label: '方向', control: 'select' },
    },
    {
      key: 'recolor', type: 'bool', default: false, channel: 'both',
      c: { setter: 'lv_arclabel_set_recolor($obj, $v)' },
      ui: { group: 'behavior', label: '重着色指令', control: 'toggle' },
    },
    {
      key: 'radius', type: 'int', min: 0, channel: 'both',
      c: { setter: 'lv_arclabel_set_radius($obj, $v)' },
      ui: { group: 'value', label: '半径', control: 'number' },
    },
    {
      key: 'center_offset_x', type: 'int', default: 0, channel: 'both',
      c: { setter: 'lv_arclabel_set_center_offset_x($obj, $v)' },
      ui: { group: 'value', label: '圆心偏移 X', control: 'number' },
    },
    {
      key: 'center_offset_y', type: 'int', default: 0, channel: 'both',
      c: { setter: 'lv_arclabel_set_center_offset_y($obj, $v)' },
      ui: { group: 'value', label: '圆心偏移 Y', control: 'number' },
    },
    {
      key: 'text_vertical_align', type: 'enum', default: 'default', channel: 'both',
      enum: ARCLABEL_TEXT_ALIGN_ENUM,
      c: { setter: 'lv_arclabel_set_text_vertical_align($obj, $v)' },
      ui: { group: 'behavior', label: '文本纵向对齐', control: 'select' },
    },
    {
      key: 'text_horizontal_align', type: 'enum', default: 'default', channel: 'both',
      enum: ARCLABEL_TEXT_ALIGN_ENUM,
      c: { setter: 'lv_arclabel_set_text_horizontal_align($obj, $v)' },
      ui: { group: 'behavior', label: '文本横向对齐', control: 'select' },
    },
  ],
  bindableProps: [],
  parts: ['main'],
  acceptsWidgetChildren: false,
  palette: { category: 'basic', label: '弧形文本', icon: 'arclabel' },
  defaultSize: { w: 150, h: 150 },
};

/* ------------------------------------------------------------------- canvas */

export const canvasSpec: WidgetSpec = {
  type: 'canvas', xmlTag: 'lv_canvas', lvUseGuard: 'LV_USE_CANVAS',
  cCreate: 'lv_canvas_create($parent)',
  props: [
    {
      key: 'fill_color', type: 'color', default: '#ffffff', channel: 'both',
      c: { setter: 'lv_canvas_fill_bg($obj, $v, LV_OPA_COVER)' },
      ui: { group: 'content', label: '填充色', control: 'color' },
    },
  ],
  bindableProps: [],
  parts: ['main'],
  acceptsWidgetChildren: false,
  palette: { category: 'media', label: '画布', icon: 'canvas' },
  defaultSize: { w: 100, h: 100 },
  notes: [
    'width/height 只认纯 px(默认 100×100),决定绘制缓冲尺寸',
    'C 侧 emitter 自动生成 static 缓冲 + lv_canvas_set_buffer(ARGB8888)',
  ],
};

/* ------------------------------------------------------------------- lottie */

export const lottieSpec: WidgetSpec = {
  type: 'lottie', xmlTag: 'lv_lottie', lvUseGuard: 'LV_USE_LOTTIE',
  cCreate: 'lv_lottie_create($parent)',
  props: [
    {
      // 预览通道:imageRef → MEMFS json 路径(parser lv_lottie_set_src_file);
      // C 通道:emitter 特殊形态 lv_lottie_set_src_data(extern 数组),setter 置空
      key: 'src', type: 'imageRef', channel: 'both',
      c: { setter: '' },
      ui: { group: 'content', label: '动画(json)', control: 'asset-picker' },
      notes: ['C 侧符号约定 lottie_<name>[] / lottie_<name>_size(如 xxd -i 生成)'],
    },
  ],
  bindableProps: [],
  parts: ['main'],
  acceptsWidgetChildren: false,
  palette: { category: 'media', label: 'Lottie 动画', icon: 'lottie' },
  defaultSize: { w: 100, h: 100 },
  notes: [
    '依赖 LV_USE_LOTTIE + LV_USE_THORVG_INTERNAL + LV_USE_VECTOR_GRAPHIC + LV_USE_MATRIX',
    'width/height 只认纯 px(默认 100×100),决定渲染缓冲尺寸',
  ],
};
