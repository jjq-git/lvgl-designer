我已通读全部 24 个 parser(23 widget + obj 基类)、`lv_xml_style.c`、`lv_xml_base_types.c`、`lv_xml_utils.c`、`lv_xml.c`、`lv_xml_component.c`、`lv_xml_widget.c`、`lv_xml_parser.c` 及 tests/examples 下全部 XML 样例。以下为可直接并入架构文档的设计。

# 子系统设计:工程 JSON Schema + Widget 描述表(单一事实源)

## 0. 定位与代码落点

工程 JSON 是**唯一事实源**;LVGL XML 只是两个下游产物之一(内部预览通道 + 可选导出),C 代码是另一个。三者关系:

```
.lvproj.json ──(registry 驱动)──┬── XML emitter ──> lv_xml_register_component_from_data() → WASM 画布
                                └── IR ──> C emitter (9.4) ──> src/ui/*.c/h
```

源码依据:预览通道 API 为 `lv_xml_register_component_from_data(name, xml_def)` / `lv_xml_component_unregister(name)`(vendor/lvgl/src/others/xml/lv_xml_component.h:42,64)与 `lv_xml_create_screen(name)`(lv_xml.c:388)。`lv_xml_update_from_data()`(lv_xml_update.h:34)可作二期增量热更新扩展点,一期统一"全量重注册"。

文件落点:

```
src/model/schema.ts            // 本文 §1 全部类型
src/model/validate.ts          // zod schema(外壳)+ registry 驱动的 props 校验
src/model/migrations/index.ts  // §2 迁移框架
src/registry/types.ts          // §3 WidgetSpec/PropSpec
src/registry/objBase.ts        // obj 基类属性(全 widget 共享)
src/registry/styleProps.ts     // §4 样式属性全集(一张表,XML/C/检查器共用)
src/registry/enums.ts          // 所有枚举 token 表(与 lv_xml_base_types.c 一一对应)
src/registry/widgets/<type>.ts // 23 个 widget 各一文件
src/registry/index.ts          // Map<string, WidgetSpec> + 校验入口
```

---

## 1. 工程文件 JSON Schema(`.lvproj.json`)

### 1.1 顶层与基础类型

```ts
// src/model/schema.ts
export const SCHEMA_VERSION = 1;

export type Uuid = string;              // crypto.randomUUID(),编辑器内部引用,永不导出到 XML/C
export type CName = string;             // /^[a-z][a-z0-9_]*$/,同时用作 XML name 与 C 标识符
export type ColorHex = `#${string}`;    // JSON 存 "#RRGGBB";发 XML 时转 "0xRRGGBB"(见 §4.4)
export type Size = number | 'content' | `${number}%`;   // 对应 lv_xml_to_size():
                                        // "content"→LV_SIZE_CONTENT,"n%"→lv_pct(n)(lv_xml_base_types.c:62-69)
export type ConstRef = { $const: CName };               // 值级引用,XML 发 "#name",C 发宏
export type Scalar = string | number | boolean | ColorHex;
export type PropValue = Scalar | number[] | string[] | ConstRef;

export interface LvProject {
  schemaVersion: number;                // 整数,只前进
  meta: ProjectMeta;
  display: DisplayConfig;
  screens: ScreenDef[];
  components: ComponentDef[];           // schema 一期即定型;编辑 UI 二期(见 §1.8)
  styles: NamedStyle[];                 // 全局命名样式(映射 globals.xml 的 <styles>)
  consts: ConstDef[];                   // 映射 <consts>
  subjects: SubjectDef[];               // 映射 <subjects>
  assets: { fonts: FontAsset[]; images: ImageAsset[] };
  translations: TranslationPack | null; // 映射 translations.xml
  codegen: CodegenOptions;
  editor?: Record<string, unknown>;     // 画布缩放/面板布局等,读取方必须容忍缺失
}

export interface ProjectMeta {
  name: string;                         // 任意 UTF-8
  lvglVersion: '9.4';                   // 8.4 是二期扩展点:此处放宽为联合类型即可,不做实现
  appVersion: string;                   // 写入时的 designer 版本,便于排障
  createdAt: string; modifiedAt: string;// ISO 8601
}

export interface DisplayConfig {
  width: number; height: number;        // 主力 240x240 / 466x466
  shape: 'rect' | 'round';              // round → 画布圆形遮罩预览(designer 侧特性,不进 XML)
  colorDepth: 16 | 24 | 32;             // 决定 lv_conf、图片默认转换格式
  dpi?: number;                         // 默认 130
}
```

**取舍:`id`(Uuid)与 `name`(CName)分离。** 拖拽/undo/剪贴板/属性面板全部走 `id`;`name` 只服务导出。这样重命名是纯数据字段修改,不会破坏树内引用(事件里引用别的 widget、timeline target 都存 `id`,导出时解析成 name)。

### 1.2 Screen 与 Widget 树

```ts
export interface ScreenDef {
  id: Uuid;
  name: CName;                 // 导出为 XML component 名(即 lv_xml_create(name) 的 name)
                               // 及 C 函数 <name>_create()。LVGL 会把 screen 根对象命名为
                               // 组件名(lv_xml.c:300-302 is_screen 分支)
  displayName?: string;        // 允许中文,仅 UI
  isHome?: boolean;            // 生成 lv_screen_load 的默认首屏
  styles: NamedStyle[];        // screen 作用域样式 → 该 screen XML 的 <styles> 段
  consts: ConstDef[];          //                  → <consts> 段
  root: WidgetNode;            // type 恒为 'obj';导出为 <view extends="lv_obj" ...>
}

export interface WidgetNode {
  id: Uuid;
  type: string;                // registry key:'obj'|'button'|...|'chart-series'(结构子元素同树存放)
  name?: CName;                // 有名字才导出 XML name=、才生成 C 指针变量
  displayName?: string;        // 中文昵称,仅 UI(见 §5)
  props: Record<string, PropValue>;    // 键 == registry PropSpec.key == XML 属性名(刻意三者同名)
  flags?: Partial<Record<ObjFlagKey, boolean>>;   // hidden/clickable/... 见 §1.3
  states?: Partial<Record<ObjStateKey, boolean>>; // checked/disabled/... 见 §1.3
  styles: StyleUsage[];        // 命名样式引用,见 §4.2
  inlineStyles: InlineStyleGroup[];   // 内联样式,见 §4.2
  events: EventAction[];       // 见 §1.4
  bindings: Binding[];         // 见 §1.5
  children: WidgetNode[];      // 普通子 widget 与结构子元素(series/tab/cell)统一存这里,
                               // 顺序即 XML/C 顺序(chart series 顺序有语义)
  cPatch?: CPatch;             // C 补丁段,见 §6 对策
  editor?: { locked?: boolean; collapsed?: boolean };
}

export interface CPatch {
  post?: string;               // 该对象创建+属性设置完后逐字插入的 C 片段,可用 $obj 占位符
                               // 只进 C 产物;XML/画布忽略并在画布上打"含代码补丁"角标
}
```

### 1.3 obj 基类:flags / states 键(全部 widget 共享)

与 `lv_xml_obj_parser.c` 完全对齐(逐项核对自 lv_xml_obj_parser.c:92-154):

```ts
export type ObjFlagKey =                    // 每项 = lv_obj_set_flag(obj, LV_OBJ_FLAG_*, bool)
  | 'hidden' | 'clickable' | 'click_focusable' | 'checkable' | 'scrollable'
  | 'scroll_elastic' | 'scroll_momentum' | 'scroll_one' | 'scroll_chain_hor'
  | 'scroll_chain_ver' | 'scroll_chain' | 'scroll_on_focus' | 'scroll_with_arrow'
  | 'snappable' | 'press_lock' | 'event_bubble' | 'event_trickle' | 'state_trickle'
  | 'gesture_bubble' | 'adv_hittest' | 'ignore_layout' | 'floating'
  | 'send_draw_task_events' | 'overflow_visible' | 'flex_in_new_track';

export type ObjStateKey =                   // lv_obj_set_state(obj, LV_STATE_*, bool)
  | 'checked' | 'focused' | 'focus_key' | 'edited' | 'hovered'
  | 'pressed' | 'scrolled' | 'disabled';
```

obj 基类**普通属性**(所有 widget 检查器"布局"组,lv_xml_obj_parser.c:92-102):`x`/`y`(Size)、`width`/`height`(Size)、`align`(枚举 9 值,base_types.c:71)、`flex_flow`(8 值)、`flex_grow`(int)、`ext_click_area`(int)、`scroll_snap_x`/`scroll_snap_y`(none|start|center|end)、`scrollbar_mode`(off|on|active|auto)。

### 1.4 事件模型

XML 里事件是 widget 的**子元素**(注册名带 `lv_obj-` 前缀,但书写可省略前缀——`lv_xml_widget_get_processor` 有 fallback,lv_xml_widget.c:69-76)。JSON 按动作种类建模,一一对应 lv_xml_obj_parser.c 中的 7 类处理器:

```ts
export type TriggerToken = 'clicked' | 'pressed' | 'released' | 'value_changed'
  | 'long_pressed' | 'long_pressed_repeat' | 'short_clicked' | 'double_clicked'
  | 'focused' | 'defocused' | 'ready' | 'cancel' | /* 全集 69 个,见 registry/enums.ts,
     与 lv_xml_trigger_text_to_enum_value 对齐(lv_xml_base_types.c:241-312)*/ string;

export type EventAction =
  | { kind: 'callback'; trigger: TriggerToken; callback: CName; userData?: string }
      // <event_cb trigger= callback= user_data=>;回调需运行时先 lv_xml_register_event_cb
      // (lv_xml.c:655)。预览通道注册同名 stub(console.log);C 侧生成 extern 声明。
  | { kind: 'subject_set'; trigger: TriggerToken; subject: CName;
      subjectType: 'int' | 'float' | 'string'; value: string }
      // <subject_set_int_event value=...> 三个 tag 按 subjectType 选
  | { kind: 'subject_toggle'; trigger: TriggerToken; subject: CName }
  | { kind: 'subject_increment'; trigger: TriggerToken; subject: CName;
      step?: number /*默认1*/; min?: number; max?: number; rollover?: boolean }
  | { kind: 'screen_load'; trigger: TriggerToken; screenId: Uuid;   // 导出解析为 screen name
      animType?: ScreenLoadAnim; duration?: number; delay?: number }
  | { kind: 'screen_create'; trigger: TriggerToken; screenId: Uuid;
      animType?: ScreenLoadAnim; duration?: number; delay?: number }
  | { kind: 'play_timeline'; trigger: TriggerToken; target: Uuid | 'self';
      timeline: CName; delay?: number; reverse?: boolean };

export type ScreenLoadAnim = 'none' | 'over_left' | 'over_right' | 'over_top'
  | 'over_bottom' | 'move_left' | 'move_right' | 'move_top' | 'move_bottom'
  | 'fade_in' | 'fade_on' | 'fade_out' | 'out_left' | 'out_right' | 'out_top' | 'out_bottom';
  // lv_xml_screen_load_anim_text_to_enum_value(lv_xml_base_types.c:315-336)
```

### 1.5 数据绑定(observer/subject)

```ts
export type CmpOp = 'eq' | 'not_eq' | 'gt' | 'ge' | 'lt' | 'le';

export type Binding =
  | { kind: 'prop'; prop: 'value' | 'checked' | 'text' | 'src' | 'min_value' | 'max_value';
      subject: CName; fmt?: string }
      // 落到 widget 专有 bind_* 属性:bind_value(slider/bar/arc/dropdown/roller/spinbox)、
      // bind_checked(obj)、bind_text(label/span,fmt→伴生属性 bind_text-fmt,
      // lv_xml_label_parser.c:63-75)、bind_src(image)。registry 声明各 widget 支持哪些。
  | { kind: 'flag'; flag: ObjFlagKey; op: CmpOp; subject: CName; refValue: number }
      // <bind_flag_if_eq subject= flag= ref_value=>(lv_xml_obj_parser.c:502-546)
  | { kind: 'state'; state: ObjStateKey; op: CmpOp; subject: CName; refValue: number }
  | { kind: 'style'; styleRef: CName; selector?: Selector; subject: CName; refValue: number };
      // <bind_style name= subject= ref_value= selector=>(lv_xml_obj_parser.c:454-493)

export type SubjectDef =                     // process_subject_element 支持 4 型
  | { name: CName; type: 'int';    initial: number }   // (lv_xml_component.c:474-513)
  | { name: CName; type: 'float';  initial: number }   // 依赖 LV_USE_FLOAT
  | { name: CName; type: 'string'; initial: string }
  | { name: CName; type: 'color';  initial: ColorHex };
```

### 1.6 consts / assets / 翻译

```ts
export interface ConstDef {
  name: CName;
  type: 'int' | 'px' | 'color' | 'string' | 'percent';  // XML 元素名即类型(globals.xml 实例:
  value: string;              // <int>/<px>/<color>);运行时统一按字符串存(lv_xml_register_const,
}                             // lv_xml.c:545-568),所以 JSON 也存字符串,类型只约束编辑器输入

export interface AssetFileRef { fileName: string; sha256: string; byteSize: number }
// 二进制不进 JSON:IndexedDB 存 blob(key=sha256);下载工程时打包为 zip
// (project.lvproj.json + assets/**);预览时写入 Emscripten MEMFS 并以
// lv_xml_set_default_asset_path 前缀解析(lv_xml.c:394)

export interface FontAsset {
  name: CName;                    // 样式里 text_font="name" 引用
  file: AssetFileRef;             // .ttf 或 lv_font_conv 产物 .fnt/.bin
  loader: 'tiny_ttf' | 'bin';     // 预览通道映射 <fonts><tiny_ttf|bin name src_path size as_file="true">
                                  // (lv_xml_component.c:359-449;非 as_file 会被忽略,必须发 true)
  sizePx?: number;                // tiny_ttf 必填(size 属性)
  conv?: { bpp: 1|2|4|8; ranges: string; symbols?: string };  // C 导出走 lv_font_conv 的参数
}

export interface ImageAsset {
  name: CName;                    // src="name" / bg_image_src="name" 引用
  file: AssetFileRef;             // png/jpg 原图
  conv: { colorFormat: 'RGB565'|'RGB565A8'|'ARGB8888'|'I1'|'I2'|'I4'|'I8'|'A8';
          stride?: number };      // C 导出转 .c 数组;预览通道用 <images><file name src_path>
}                                 // (lv_xml_component.c:451-472)

export interface TranslationPack {           // 结构照抄 examples/others/xml/translations.xml
  languages: string[];                       // <translations languages="en de hu">
  entries: { tag: string; texts: Record<string, string> }[];  // <translation tag= en= de=/>
}
```

### 1.7 codegen 选项

```ts
export interface CodegenOptions {
  outputDirName: string;          // 默认 'ui' → 导出 zip 的 src/ui/
  filePrefix: string;             // 默认 'ui_'
  exportXml: boolean;             // 是否在导出物中附带 XML(默认 false;许可约束:
                                  // 该开关只影响"把 XML 写进导出包",预览通道恒在内存中使用)
  userIncludes: string[];         // 注入 ui.h 的额外 #include
}
```

### 1.8 components(扩展点,一期不做 UI)

`ComponentDef` 与 `ScreenDef` 同构(多 `api: {name, type, default?}[]` 字段,对应 `<api><prop>`,lv_xml_component.c:845 process_prop_element;参数在 XML 里以 `$name` 引用,lv_xml.c:728 resolve_params)。schema 一期就带上此类型定义并在校验器中接受空数组,保证二期加 UI 不动格式。

---

## 2. 版本化 / 向前兼容

- `schemaVersion` 为**整数**,任何不向后兼容的结构变化 +1。
- 迁移框架:

```ts
// src/model/migrations/index.ts
export interface Migration { from: number; migrate(doc: any): any }  // to = from+1
const MIGRATIONS: Migration[] = [/* {from:1, migrate:v1_to_v2}, ... */];

export function loadProject(raw: unknown): LvProject {
  let doc: any = raw;
  const v = doc?.schemaVersion;
  if (typeof v !== 'number') throw new ProjectFormatError('missing schemaVersion');
  if (v > SCHEMA_VERSION) throw new ProjectTooNewError(v);   // 明确拒绝,提示升级 App
  for (let i = v; i < SCHEMA_VERSION; i++) doc = MIGRATIONS[i - 1].migrate(doc);
  return validateProject(doc);   // zod 外壳 + registry 校验 props/枚举值
}
```

- **未知字段策略**:校验器对 `editor`、以 `x-` 开头的键、以及 `props` 里 registry 不认识的键采取"保留但告警"(不删除),保证老版本 App 打开新工程降级可用(前提 schemaVersion 相同)。
- IndexedDB 自动保存与手动下载共用同一序列化函数;自动保存额外套 `{savedAt, doc}` 信封,不影响格式。

---

## 3. Widget 描述表(registry)

### 3.1 类型定义

```ts
// src/registry/types.ts
export type PropTypeName =
  | 'int' | 'size' | 'bool' | 'string' | 'color' | 'opa'      // opa: 0-255 或 'n%'(lv_xml_to_opa)
  | 'enum' | 'orFlags'                                        // orFlags: 'a|b|c'(buttonmatrix ctrl 等)
  | 'subject' | 'imageRef' | 'fontRef' | 'styleRef'           // 名字引用,校验存在性
  | 'intList'                                                 // 空格分隔 int(chart values)
  | 'stringQuotedList'                                        // buttonmatrix map:'A' 'B' '\n'
  | 'gridTemplate';                                           // "fr(1) 100 fr(2)"(lv_xml_style.c:286-321)

export interface EnumSpec {
  tokens: readonly string[];        // == XML token,亦是 JSON 存储值(三层同词)
  cPrefix: string;                  // C 生成:token.toUpperCase() 拼到 cPrefix 后
  cOverride?: Record<string, string>; // 不规则映射,如 scroll_circular→LV_LABEL_LONG_MODE_SCROLL_CIRCULAR
}

export interface PropSpec {
  key: string;                      // JSON 键 == XML 属性名(单一命名,杜绝映射表漂移)
  type: PropTypeName;
  enum?: EnumSpec;
  min?: number; max?: number;
  default?: PropValue;              // LVGL 运行时默认;检查器置灰显示,等于默认值时不输出
  companions?: { key: string; type: PropTypeName; xmlAttr: string }[];
                                    // 伴生属性:如 value 的 value-animated(slider/bar),
                                    // options 的 options-mode(roller),bind_text 的 bind_text-fmt
  channel: 'both' | 'c-only';       // c-only = 9.4 XML parser 没实现但 C API 有;画布跳过并计数角标
  c: { setter: string };            // 模板:'lv_slider_set_value($obj, $v, $anim)';$v 按 type 格式化
  ui: { group: 'content'|'value'|'behavior'|'geometry'; label: string;
        control: 'text'|'number'|'select'|'toggle'|'color'|'subject-picker'|'asset-picker' };
}

export interface ChildSpec {
  type: string;                     // registry key,如 'chart-series'
  xmlTag: string;                   // 'lv_chart-series'(子元素必须发全名;省前缀 fallback 只对
                                    //  lv_obj- 生效,lv_xml_widget.c:69-76)
  kind: 'add' | 'getter' | 'virtual';
      // add: C 调 cCreate 得新句柄(series/cursor/tab/section/span/header_*)
      // getter: 取既有部件(tabview-tab_bar/tab_button、dropdown-list)
      // virtual: 无对象,属性是"(行,列)=值"式调用(table-column/cell、chart-axis)
  cCreate?: string;                 // 'lv_chart_add_series($parent, $color, $axis)'
  createProps?: PropSpec[];         // 进构造实参的属性(XML 里同为属性,create_cb 阶段读取)
  props: PropSpec[];
  acceptsWidgetChildren: boolean;   // tabview-tab、dropdown-list 为 true
  isObj: boolean;                   // true 则同时接受全部 obj 基类属性/样式(tab、tab_bar 等)
}

export interface WidgetSpec {
  type: string;                     // 'slider'
  xmlTag: string;                   // 'lv_slider'(lv_xml.c:102-209 的注册名)
  lvUseGuard: string;               // 'LV_USE_SLIDER'(编译 WASM 与生成 lv_conf 检查用)
  cCreate: string;                  // 'lv_slider_create($parent)'
  props: PropSpec[];                // 专有属性;obj 基类属性由 objBase.ts 统一注入
  bindableProps: Binding['prop'][]; // 该 widget 支持的 bind_*(见 §1.5)
  parts: PartToken[];               // 检查器 selector 下拉可选 part
  children?: ChildSpec[];
  acceptsWidgetChildren: boolean;
  palette?: { category: 'basic'|'input'|'display'|'container'; label: string; icon: string };
  defaultSize?: { w: Size; h: Size };
  notes?: string[];                 // 上游坑位备注,渲染进属性面板 tooltip
}
```

### 3.2 四个完整示例条目

```ts
// src/registry/widgets/button.ts —— 依据 lv_xml_button_parser.c(无专有属性,仅 obj 基类)
export const buttonSpec: WidgetSpec = {
  type: 'button', xmlTag: 'lv_button', lvUseGuard: 'LV_USE_BUTTON',
  cCreate: 'lv_button_create($parent)',
  props: [], bindableProps: ['checked'],           // bind_checked 来自 obj 基类
  parts: ['main'], acceptsWidgetChildren: true,    // 惯用法:内放 label
  palette: { category: 'basic', label: 'Button', icon: 'button' },
  defaultSize: { w: 100, h: 40 },
};
```

```ts
// src/registry/widgets/label.ts —— 依据 lv_xml_label_parser.c:54-76
export const labelSpec: WidgetSpec = {
  type: 'label', xmlTag: 'lv_label', lvUseGuard: 'LV_USE_LABEL',
  cCreate: 'lv_label_create($parent)',
  props: [
    { key: 'text', type: 'string', default: 'Text', channel: 'both',
      c: { setter: 'lv_label_set_text($obj, $v)' },
      ui: { group: 'content', label: '文本', control: 'text' } },
    { key: 'long_mode', type: 'enum', channel: 'both',
      enum: { tokens: ['wrap','scroll','scroll_circular','dots','clip'],
              cPrefix: 'LV_LABEL_LONG_MODE_' },     // 枚举表来自 label parser :83-93
      default: 'wrap',
      c: { setter: 'lv_label_set_long_mode($obj, $v)' },
      ui: { group: 'behavior', label: '超长处理', control: 'select' } },
    { key: 'translation_tag', type: 'string', channel: 'both',   // 依赖 LV_USE_TRANSLATION
      c: { setter: 'lv_label_set_translation_tag($obj, $v)' },
      ui: { group: 'content', label: '翻译标签', control: 'text' } },
  ],
  bindableProps: ['text'],   // bind_text + 伴生 bind_text-fmt(parser :69-74)
  parts: ['main', 'scrollbar', 'selected'],
  acceptsWidgetChildren: true,
  defaultSize: { w: 'content', h: 'content' },
};
```

```ts
// src/registry/widgets/slider.ts —— 依据 lv_xml_slider_parser.c:54-107
export const sliderSpec: WidgetSpec = {
  type: 'slider', xmlTag: 'lv_slider', lvUseGuard: 'LV_USE_SLIDER',
  cCreate: 'lv_slider_create($parent)',
  props: [
    { key: 'min_value', type: 'int', default: 0, channel: 'both',
      c: { setter: 'lv_slider_set_min_value($obj, $v)' },
      ui: { group: 'value', label: '最小值', control: 'number' } },
    { key: 'max_value', type: 'int', default: 100, channel: 'both',
      c: { setter: 'lv_slider_set_max_value($obj, $v)' },
      ui: { group: 'value', label: '最大值', control: 'number' } },
    { key: 'value', type: 'int', default: 0, channel: 'both',
      companions: [{ key: 'value_animated', type: 'bool', xmlAttr: 'value-animated' }],
      c: { setter: 'lv_slider_set_value($obj, $v, $value_animated:LV_ANIM_ON:LV_ANIM_OFF)' },
      ui: { group: 'value', label: '当前值', control: 'number' } },
    { key: 'start_value', type: 'int', channel: 'both',           // range 模式左端
      companions: [{ key: 'start_value_animated', type: 'bool', xmlAttr: 'start_value-animated' }],
      c: { setter: 'lv_slider_set_start_value($obj, $v, $start_value_animated:LV_ANIM_ON:LV_ANIM_OFF)' },
      ui: { group: 'value', label: '起始值', control: 'number' } },
    { key: 'orientation', type: 'enum', default: 'auto', channel: 'both',
      enum: { tokens: ['auto','horizontal','vertical'], cPrefix: 'LV_SLIDER_ORIENTATION_' },
      c: { setter: 'lv_slider_set_orientation($obj, $v)' },
      ui: { group: 'behavior', label: '方向', control: 'select' } },
    { key: 'mode', type: 'enum', default: 'normal', channel: 'both',
      enum: { tokens: ['normal','range','symmetrical'], cPrefix: 'LV_SLIDER_MODE_' },
      c: { setter: 'lv_slider_set_mode($obj, $v)' },
      ui: { group: 'behavior', label: '模式', control: 'select' } },
  ],
  bindableProps: ['value'],          // lv_slider_bind_value(parser :70-78)
  parts: ['main', 'indicator', 'knob'],
  acceptsWidgetChildren: false,
  defaultSize: { w: 150, h: 10 },
};
```

```ts
// src/registry/widgets/chart.ts —— 依据 lv_xml_chart_parser.c 全文
export const chartSpec: WidgetSpec = {
  type: 'chart', xmlTag: 'lv_chart', lvUseGuard: 'LV_USE_CHART',
  cCreate: 'lv_chart_create($parent)',
  props: [
    { key: 'type', type: 'enum', default: 'line', channel: 'both',
      enum: { tokens: ['none','line','bar','stacked','scatter'], cPrefix: 'LV_CHART_TYPE_' },
      c: { setter: 'lv_chart_set_type($obj, $v)' },
      ui: { group: 'behavior', label: '图表类型', control: 'select' } },
    { key: 'point_count', type: 'int', min: 0, default: 10, channel: 'both',
      c: { setter: 'lv_chart_set_point_count($obj, $v)' },
      ui: { group: 'value', label: '数据点数', control: 'number' } },
    { key: 'update_mode', type: 'enum', default: 'shift', channel: 'both',
      enum: { tokens: ['shift','circular'], cPrefix: 'LV_CHART_UPDATE_MODE_' },
      c: { setter: 'lv_chart_set_update_mode($obj, $v)' },
      ui: { group: 'behavior', label: '更新模式', control: 'select' } },
    { key: 'hor_div_line_count', type: 'int', default: 3, channel: 'both',
      c: { setter: 'lv_chart_set_hor_div_line_count($obj, $v)' },
      ui: { group: 'behavior', label: '横分割线', control: 'number' } },
    { key: 'ver_div_line_count', type: 'int', default: 5, channel: 'both',
      c: { setter: 'lv_chart_set_ver_div_line_count($obj, $v)' },
      ui: { group: 'behavior', label: '纵分割线', control: 'number' } },
  ],
  bindableProps: [],
  parts: ['main', 'items', 'indicator', 'scrollbar', 'cursor'],
  acceptsWidgetChildren: false,
  children: [
    { type: 'chart-series', xmlTag: 'lv_chart-series', kind: 'add', isObj: false,
      cCreate: 'lv_chart_add_series($parent, $color, $axis)',
      createProps: [
        { key: 'color', type: 'color', default: '#ff0000', channel: 'both',   // parser :84 默认 0xff0000
          c: { setter: '' }, ui: { group: 'content', label: '颜色', control: 'color' } },
        { key: 'axis', type: 'enum', default: 'primary_y', channel: 'both',
          enum: { tokens: ['primary_x','primary_y','secondary_x','secondary_y'],
                  cPrefix: 'LV_CHART_AXIS_' },
          c: { setter: '' }, ui: { group: 'content', label: '轴', control: 'select' } },
      ],
      props: [
        { key: 'values', type: 'intList', channel: 'both',   // 空格分隔,逐点 set_next_value(:104-109)
          c: { setter: 'lv_chart_set_next_value($parent, $obj, $each)' },
          ui: { group: 'value', label: '数据', control: 'text' } },
      ],
      acceptsWidgetChildren: false },
    { type: 'chart-cursor', xmlTag: 'lv_chart-cursor', kind: 'add', isObj: false,
      cCreate: 'lv_chart_add_cursor($parent, $color, $dir)',
      createProps: [
        { key: 'color', type: 'color', default: '#0000ff', channel: 'both',
          c: { setter: '' }, ui: { group: 'content', label: '颜色', control: 'color' } },
        { key: 'dir', type: 'enum', default: 'all', channel: 'both',
          enum: { tokens: ['none','top','bottom','left','right','hor','ver','all'],
                  cPrefix: 'LV_DIR_' },
          c: { setter: '' }, ui: { group: 'content', label: '方向', control: 'select' } },
      ],
      props: [
        { key: 'pos_x', type: 'int', channel: 'both',
          c: { setter: 'lv_chart_set_cursor_pos_x($parent, $obj, $v)' },
          ui: { group: 'value', label: 'X', control: 'number' } },
        { key: 'pos_y', type: 'int', channel: 'both',
          c: { setter: 'lv_chart_set_cursor_pos_y($parent, $obj, $v)' },
          ui: { group: 'value', label: 'Y', control: 'number' } },
      ],
      acceptsWidgetChildren: false },
    { type: 'chart-axis', xmlTag: 'lv_chart-axis', kind: 'virtual', isObj: false,
      createProps: [
        { key: 'axis', type: 'enum', default: 'primary_y', channel: 'both',
          enum: { tokens: ['primary_x','primary_y','secondary_x','secondary_y'],
                  cPrefix: 'LV_CHART_AXIS_' },
          c: { setter: '' }, ui: { group: 'content', label: '轴', control: 'select' } },
      ],
      props: [
        { key: 'min_value', type: 'int', channel: 'both',
          c: { setter: 'lv_chart_set_axis_min_value($parent, $axis, $v)' },
          ui: { group: 'value', label: '最小', control: 'number' } },
        { key: 'max_value', type: 'int', channel: 'both',
          c: { setter: 'lv_chart_set_axis_max_value($parent, $axis, $v)' },
          ui: { group: 'value', label: '最大', control: 'number' } },
      ],
      acceptsWidgetChildren: false },
  ],
  notes: ['scatter X/Y 需新增 typed point-series property,普通工程不得用 cPatch 绕过'],
  defaultSize: { w: 200, h: 150 },
};
```

### 3.3 23 widget 属性总表(逐 parser 提炼,均在 vendor/lvgl/src/others/xml/parsers/)

| widget | 专有属性(→ C setter) | 子元素 | bind_* | 缺口/备注 |
|---|---|---|---|---|
| obj | §1.3 全部 | style/event/bind 系列 | bind_checked | 基类;无 `align_to` |
| arc | start_angle, end_angle, bg_start_angle, bg_end_angle, rotation, value, min_value, max_value, mode(normal\|symmetrical\|reverse), change_rate, knob_offset | — | bind_value | change_rate/knob_offset 为 c-only typed property |
| bar | value(+value-animated), start_value(+start_value-animated), min_value, max_value, orientation(auto\|horizontal\|vertical), mode(normal\|range\|symmetrical) | — | bind_value | |
| button | (无) | — | (基类 bind_checked) | |
| buttonmatrix | map(引号串列表), ctrl_map(空格分组、\|或), selected_button, one_checked | — | — | ctrl_map 解析缓冲 512B(parser:108);ctrl 枚举 28 token |
| calendar | today_year/month/day, shown_year/month | calendar-header_arrow, calendar-header_dropdown(各仅 obj 属性) | — | 无高亮日期;header 受 LV_USE_CALENDAR_HEADER_* 宏 |
| canvas | (无,仅 obj) | — | — | 绘图 API 完全未暴露 → 一期禁用 |
| chart | §3.2 | series/cursor/axis | — | scatter X 值缺 |
| checkbox | text | — | (基类 bind_checked) | |
| dropdown | options, text, selected, symbol(imageRef), | dropdown-list(getter,仅 obj 属性) | bind_value | 无 dir/max_height/selected_highlight |
| image | src(imageRef), inner_align(11 token), rotation, scale_x, scale_y, pivot_x, pivot_y(Size) | — | bind_src | |
| keyboard | mode(text_upper/text_lower/text_arabic/number/special/user_1..4), popovers | — | — | **无法关联 textarea**(parser:58 被注释) |
| label | text, long_mode, translation_tag | — | bind_text(+fmt) | |
| qrcode | size, dark_color, light_color, data, quiet_zone | — | — | |
| roller | options(+options-mode: normal\|infinite), selected, visible_row_count | — | bind_value | selected 的动画伴生属性名实为 `value-animated`(parser:59,上游笔误,emitter 照发) |
| scale | mode(6 token), total_tick_count, major_tick_every, label_show, post_draw, draw_ticks_on_top, min_value, max_value, angle_range, rotation | scale-section(min/max_value, style_main/style_indicator/style_items=styleRef, bind_min_value, bind_max_value) | (section 上) | text_src 未实现(parser:56 注释) |
| slider | §3.2 | — | bind_value | |
| spangroup | overflow(clip\|ellipsis), max_lines, indent | spangroup-span(text, style=styleRef, bind_text+fmt) | (span 上) | span 样式只能引用命名 style |
| spinbox | value, rollover, digit_count, dec_point_pos, min_value, max_value, step | — | bind_value | |
| switch | orientation(auto\|horizontal\|vertical) | — | (基类 bind_checked) | |
| table | column_count, row_count | table-column(virtual: column, width)、table-cell(virtual: row, column, value, ctrl=\|或 7 token) | — | |
| tabview | active, tab_bar_position(LV_DIR token) | tabview-tab(text, 收 widget 子)、tabview-tab_bar(getter)、tabview-tab_button(getter: index) | — | set_active 动画时长写死 0(parser:58) |
| textarea | text, placeholder_text, one_line, password_mode, password_show_time, text_selection, cursor_pos | — | — | 无 accepted_chars/max_length/password_bullet |

---

## 4. 样式模型

### 4.1 XML 支持的样式属性全集

`lv_xml_style.c:158-321`(命名样式)与 `lv_xml_obj_parser.c:808-972`(内联 `style_` 前缀)是**同一份 101 个属性的两份拷贝**,取值转换器一致。全集(按组,括号内为 registry 值类型):

- **尺寸/位置**:width, min_width, max_width, height, min_height, max_height, length, radius(以上 size)|radial_offset, align(enum)
- **pad**:pad_left/right/top/bottom/hor/ver/all/row/column/gap/radial(int)
- **margin**:margin_left/right/top/bottom/hor/ver/all(int)
- **杂项**:base_dir(auto|ltr|rtl), clip_corner(bool)
- **背景**:bg_opa(opa), bg_color(color), bg_grad_dir(none|hor|ver), bg_grad_color, bg_main_stop, bg_grad_stop, bg_grad(gradientRef), bg_image_src(imageRef), bg_image_tiled(bool), bg_image_recolor(color), bg_image_recolor_opa(opa)
- **border**:border_color, border_width, border_opa, border_side(none|top|bottom|left|right|full), border_post(bool)
- **outline**:outline_color/width/opa/pad
- **shadow**:shadow_width/color/offset_x/offset_y/spread/opa
- **text**:text_color, text_font(fontRef), text_opa, text_align(left|right|center|auto), text_letter_space, text_line_space, text_decor(none|underline|strikethrough)
- **image**:image_opa, image_recolor, image_recolor_opa
- **line**:line_color/opa/width/dash_width/dash_gap/rounded
- **arc**:arc_color/opa/width/rounded/image_src(imageRef)
- **混合/变换**:opa, opa_layered, color_filter_opa, anim_duration, blend_mode(normal|additive|subtractive|multiply|difference), transform_width/height, translate_x/y/radial, transform_scale_x/y, transform_rotation, transform_pivot_x/y, transform_skew_x/y, bitmap_mask_src(imageRef), rotary_sensitivity, recolor, recolor_opa
- **布局**:layout(none|flex|grid), flex_flow, flex_grow, flex_main_place/cross_place/track_place(6 token), grid_column_align, grid_row_align, grid_cell_column_pos/span, grid_cell_x_align, grid_cell_row_pos/span, grid_cell_y_align, grid_column_dsc_array, grid_row_dsc_array(gridTemplate,"fr(1) 100" 语法,lv_xml_style.c:286-321)

特殊值:命名样式里属性值 `"remove"` 表示删除该属性(仅命名样式支持,lv_xml_style.c:122-157);值以 `#` 开头解析为 const 引用(:93-120)。

`src/registry/styleProps.ts` 用一张 `STYLE_PROPS: Record<string, {type, enum?, cSuffix}>` 表承载,同时驱动:检查器分组、XML 属性输出、C 的 `lv_style_set_<prop>()` / `lv_obj_set_style_<prop>()` 输出。

### 4.2 state/part 组合(selector)

```ts
export type StateToken = 'default'|'pressed'|'checked'|'scrolled'|'focused'
  |'focus_key'|'edited'|'hovered'|'disabled'|'user_1'|'user_2'|'user_3'|'user_4';
  // lv_xml_style_state_to_enum(lv_xml_base_types.c:465-482)
export type PartToken = 'main'|'scrollbar'|'indicator'|'knob'|'selected'|'items'|'cursor';
  // lv_xml_style_part_to_enum(:484-495)。注意:LV_PART_ANY 无 token,不可表达。
export interface Selector { states?: StateToken[]; part?: PartToken }
```

XML 有**两种分隔符,不可混用**(生成器必须区分):
- 命名样式挂接子元素:`<style name="s1" selector="pressed|knob"/>` —— `|` 分隔(`lv_xml_style_selector_text_to_enum`,base_types.c:497-517;lv_obj_xml_style_apply,obj_parser.c:179-198)。
- 内联样式属性:`style_bg_opa:pressed:knob="120"` —— `:` 后缀(`lv_xml_style_string_process`,lv_xml_style.c:331-347)。

**重要事实**:widget 上的 `styles="name"` 属性在 9.4 运行时**没有任何 apply 实现**(全仓只有 resolve_consts 的跳过分支 lv_xml.c:778 和 section 名解析 lv_xml_parser.c:68,examples/others/xml/my_card.xml:27 的用法是残留)。挂接命名样式**只能走 `<style>` 子元素**。

### 4.3 JSON 存储(内联 + 命名引用双轨)

```ts
export interface NamedStyle {
  id: Uuid; name: CName;
  props: Record<string, PropValue>;    // 键 ∈ STYLE_PROPS
}
export interface StyleUsage { styleId: Uuid; selector?: Selector }   // 存 id,导出解析为 name
export interface InlineStyleGroup { selector?: Selector; props: Record<string, PropValue> }
```

映射规则:
- `NamedStyle` → screen/globals 的 `<styles><style name=... 各属性/></styles>`;C 侧 → `static lv_style_t style_<name>;` + `lv_style_set_*` 初始化函数(生成到 `ui_styles.c`)。
- `StyleUsage` → `<style name="..." selector="a|b"/>` 子元素;C 侧 → `lv_obj_add_style(obj, &style_x, LV_PART_KNOB|LV_STATE_PRESSED)`。
- `InlineStyleGroup` → `style_<prop>` 或 `style_<prop>:<state...>:<part>` 属性;C 侧 → `lv_obj_set_style_<prop>(obj, v, selector)`。
- **检查器交互约定**:直接改属性 = 写入 inline(selector 取当前编辑的 state/part);"提取为样式"命令把 inline group 提升为 NamedStyle + StyleUsage。这是对 SquareLine 用户最不意外的心智模型,且两条通道到 XML/C 都无损。

### 4.4 值格式化(emitters 共用,src/model/format.ts)

| JSON | → XML | → C | 依据 |
|---|---|---|---|
| `'#1A2B3C'` | `0x1A2B3C` | `lv_color_hex(0x1A2B3C)` | `#` 在 XML 属性值里触发 const 解析(lv_xml.c:779, lv_xml_style.c:93),必须转 0x;`lv_xml_to_color` 按长度分 hex3/hex6(lv_xml_utils.c:55-61) |
| `'content'` | `content` | `LV_SIZE_CONTENT` | lv_xml_base_types.c:62-69 |
| `'50%'` | `50%` | `lv_pct(50)` | 同上;opa 的 `%` → `v*255/100`(lv_xml_utils.c:63-73) |
| `true/false` | `"true"/"false"` | `true/false` | 注意 `lv_xml_to_bool` 只认 `"false"` 为假、其余全真(lv_xml_utils.c:75-78),emitter 只发这两个词 |
| `{$const:'gap'}` | `#gap` | `UI_CONST_GAP` 宏 | lv_xml.c:772-793 |

---

## 5. ID / 命名策略

三层标识:

| 层 | 字段 | 规则 | 用途 |
|---|---|---|---|
| 编辑器 | `WidgetNode.id` (Uuid) | 全局唯一,创建即定,永不变 | 树操作、undo、事件/绑定内部引用 |
| XML | `name` 属性 | = JSON `name` | `lv_obj_set_name`(obj_parser.c:87-91)→ `lv_obj_find_by_name` 供 timeline/screen 事件寻址 |
| C | 变量/函数名 | 由 `name` 派生 | `ui->home.btn_start` 等 |

规则:
1. **合法性**:`name` 强制 `/^[a-z][a-z0-9_]*$/` 且 ≤ 63 字符,输入框实时校验;同时拉黑 C 关键字与 `lv_`/`ui_` 前缀。**中文不做拼音转写**(不可预测),中文/emoji 一律放 `displayName`,`name` 由自动命名器给 `<type>_<n>`(`btn_1`、`label_3`,n 为该 screen 内同类型计数)。图层面板显示 `displayName ?? name`。
2. **唯一性作用域**:`name` 在**所属 screen 内唯一**(校验器强制)。因为 `lv_obj_find_by_name` 从 view 根向下找,跨 screen 同名无冲突;screen 名、全局 style/const/subject/asset 名则在**工程内唯一**,且共享同一命名空间校验(XML 的 globals scope 是平的,lv_xml.c:402-704 各 register 函数均按名查重)。
3. **重命名** = 改 `name` 字段一处;所有引用都走 `id`,导出时统一解析,不存在悬空引用。若用户在 `cPatch` 文本里手写了旧名,diff 提示但不阻断。
4. **匿名节点**:无 `name` 的 widget 不发 XML `name` 属性(LVGL 会给组件实例自动起 `<type>_#` 索引名,lv_xml.c:370-377),C 侧用局部临时变量 `lv_obj_t * o` 链式创建,不进导出的 `ui_t` 结构体——控制符号表膨胀。
5. **screen 根**:XML 里 screen 组件创建后根对象自动命名为组件名(lv_xml.c:299-302),因此 screen `name` 同时就是运行时 `lv_display_get_screen_by_name` 的键(screen_load 事件依赖它,obj_parser.c:996)。

---

## 6. 一期"做不了 / 不做"清单与对策

### 6.1 无 parser 的 widget(画板一期不提供)

对照 `vendor/lvgl/src/widgets/`(35 个)与 `parsers/`(23 个),**没有** XML parser 的:`led、line、spinner、imagebutton、msgbox、list、menu、win、tileview、animimage、arclabel、lottie、3dtexture`。另 `canvas` 虽有 parser 但只暴露 obj 基类属性(lv_xml_canvas_parser.c:49-53),等同不可用。

**对策**:
- **禁用为主**:组件面板不出现;registry 里根本没有条目(而不是灰名单),杜绝下游 emitter 出现半支持路径。
- **替代话术**(面板空态提示):spinner ≈ arc + typed animation property;led ≈ obj 圆角+bg_color;line/list/msgbox 用 obj 组合;imagebutton 用 button+image。
- **信任边界(2026-09-04 修订)**:`cPatch.post` 仅为 v1 存量迁移保留字段。普通工程/导入由 Validator 拒绝,9.5 emitter 也不会将其写入 C;若未来确有任意 C 需求,必须走独立的 trusted extension 权限、哈希和人工审批链。

### 6.2 有 parser 但属性缺失(§3.3 表"缺口"列汇总)

统一策略:registry `channel:'c-only'` 机制。属性检查器照常提供(如 textarea 的 `max_length`),XML emitter 跳过,C emitter 照发;画布在该 widget 上累计"仅代码属性 N 项"角标。现已建模 `keyboard→textarea 关联`、`textarea.max_length`、`arc.change_rate`、`arc.knob_offset`;chart scatter X/Y 待 typed point-series property,不得回退到 `cPatch`。

### 6.3 引擎级限制(设计时就规避)

- 事件回调:XML 只能引用**运行时已注册**的回调名(lv_xml.c:655-704)。预览通道在 WASM 侧提供 `registerStubCallback(name)`(打日志+高亮触发),C 侧生成 `extern void <name>(lv_event_t * e);` 由用户实现。
- selector 表达力:无 `LV_PART_ANY`/`LV_PART_TICKS` token(base_types.c:484-495);检查器 part 下拉按 registry `parts` 白名单给。
- tabview 切页动画、roller `value-animated` 笔误、buttonmatrix `ctrl_map` 512B 上限:emitter 按源码实际行为输出并在 registry `notes` 里挂 tooltip;超限校验(ctrl_map 长度)进 validate.ts。
- 翻译:`<translations>` 是独立注册物(lv_xml_translation.c:94-165),预览通道单独 `lv_xml_register_translation_from_data`;C 侧一期直接生成同构的 `lv_translation_add_dynamic()` 初始化代码。
- 渐变(`<gradients>` linear/radial/conical,lv_xml_component.c:689-843):schema 预留 `NamedStyle.props.bg_grad = {$grad:name}` 扩展位,一期 UI 不做,属 P2。

### 6.4 明确不做(架构只留缝)

- LVGL 8.4:仅 `meta.lvglVersion` 联合类型 + `PropSpec` 可选 `lv84` 字段位,无任何实现。
- 用户自定义 component 编辑 UI(schema 已定型,§1.8)。
- `lv_xml_update_from_data` 增量热更新:一期全量 `unregister → register_from_data → create_screen`,接口签名已兼容后换。

---

### 关键取舍汇总

1. **JSON 键名 = XML 属性名 = registry key**(单一命名),消灭三方映射表,parser 源码即是 registry 的对账单;唯一的例外(`value-animated` 连字符)用 `companions[].xmlAttr` 显式记录。
2. **结构子元素进同一棵 children 树**而非旁挂集合:保序(chart series)、树操作/undo 复用、XML 生成天然同构;用 `ChildSpec.kind(add/getter/virtual)` 区分 C 生成形态。
3. **样式双轨(inline + 命名引用)**:精确对应 9.4 XML 的两条真实通道(`style_*` 属性 / `<style>` 子元素),不发明第三种抽象;`styles="..."` 属性因运行时无实现而明确弃用。
4. **id/name 分离**:重命名零成本、引用永不悬空,同时让导出物(XML name、C 变量)保持人类可读。
5. **c-only typed property + trusted extension 隔离**:承认当前"XML 支持面 < C API 面"的偏差并显式打角标;普通工程不开放任意 C,信任扩展必须独立审批。
