/**
 * 工程 JSON Schema(.lvproj.json)全部类型。
 * 依据 docs/design/01 §1,含 ARCHITECTURE §0 修正:
 * - SubjectDef 带 min/max
 * - EventAction 无 play_timeline
 * - CodegenOptions 无 filePrefix
 */

export const SCHEMA_VERSION = 1;

export type Uuid = string;              // crypto.randomUUID(),编辑器内部引用,永不导出到 XML/C
export type CName = string;             // /^[a-z][a-z0-9_]*$/,同时用作 XML name 与 C 标识符
export type ColorHex = `#${string}`;    // JSON 存 "#RRGGBB";发 XML 时转 "0xRRGGBB"
export type Size = number | 'content' | `${number}%`;
export type ConstRef = { $const: CName };  // 值级引用,XML 发 "#name",C 发宏
export type Scalar = string | number | boolean | ColorHex;
export type PropValue = Scalar | number[] | string[] | ConstRef;

/* ---------------------------------------------------------------- 顶层 */

export interface LvProject {
  schemaVersion: number;                // 整数,只前进
  meta: ProjectMeta;
  display: DisplayConfig;
  screens: ScreenDef[];
  components: ComponentDef[];           // schema 一期定型;编辑 UI 二期
  styles: NamedStyle[];                 // 全局命名样式(globals.xml <styles>)
  consts: ConstDef[];                   // <consts>
  subjects: SubjectDef[];               // <subjects>
  assets: { fonts: FontAsset[]; images: ImageAsset[] };
  translations: TranslationPack | null;
  codegen: CodegenOptions;
  editor?: Record<string, unknown>;     // 读取方必须容忍缺失
}

export interface ProjectMeta {
  name: string;                         // 任意 UTF-8
  lvglVersion: '9.4';                   // 8.4 为二期扩展点(联合类型即可)
  appVersion: string;
  createdAt: string;
  modifiedAt: string;                   // ISO 8601
}

export interface DisplayConfig {
  width: number;
  height: number;                       // 主力 240x240 圆 / 480x480(圆:MX039-ST7102;方:YDP395等)
  shape: 'rect' | 'round';              // round → 画布圆形遮罩(designer 侧,不进 XML)
  colorDepth: 16 | 24 | 32;
  dpi?: number;                         // 默认 130
}

/* ---------------------------------------------------------------- 树 */

export interface ScreenDef {
  id: Uuid;
  name: CName;                 // XML component 名 / C <name>_create()
  displayName?: string;        // 允许中文,仅 UI
  isHome?: boolean;
  styles: NamedStyle[];        // screen 作用域样式
  consts: ConstDef[];
  root: WidgetNode;            // type 恒为 'obj'
}

export interface WidgetNode {
  id: Uuid;
  type: string;                // registry key
  name?: CName;                // 有名字才导出 XML name= / C 指针变量
  displayName?: string;
  props: Record<string, PropValue>;    // 键 == registry PropSpec.key == XML 属性名
  flags?: Partial<Record<ObjFlagKey, boolean>>;
  states?: Partial<Record<ObjStateKey, boolean>>;
  styles: StyleUsage[];
  inlineStyles: InlineStyleGroup[];
  events: EventAction[];
  bindings: Binding[];
  children: WidgetNode[];      // 顺序即 XML/C 顺序
  cPatch?: CPatch;
  editor?: { locked?: boolean; collapsed?: boolean };
}

export interface CPatch {
  post?: string;               // 对象创建+属性设置完后逐字插入的 C 片段,$obj 占位
}

/* --------------------------------------------------- obj 基类 flags/states */

export type ObjFlagKey =
  | 'hidden' | 'clickable' | 'click_focusable' | 'checkable' | 'scrollable'
  | 'scroll_elastic' | 'scroll_momentum' | 'scroll_one' | 'scroll_chain_hor'
  | 'scroll_chain_ver' | 'scroll_chain' | 'scroll_on_focus' | 'scroll_with_arrow'
  | 'snappable' | 'press_lock' | 'event_bubble' | 'event_trickle' | 'state_trickle'
  | 'gesture_bubble' | 'adv_hittest' | 'ignore_layout' | 'floating'
  | 'send_draw_task_events' | 'overflow_visible' | 'flex_in_new_track';

export type ObjStateKey =
  | 'checked' | 'focused' | 'focus_key' | 'edited' | 'hovered'
  | 'pressed' | 'scrolled' | 'disabled';

/* ---------------------------------------------------------------- 事件 */

export type TriggerToken = string;   // 全集见 enums.ts TRIGGER_TOKENS

export type ScreenLoadAnim =
  | 'none' | 'over_left' | 'over_right' | 'over_top' | 'over_bottom'
  | 'move_left' | 'move_right' | 'move_top' | 'move_bottom'
  | 'fade_in' | 'fade_on' | 'fade_out'
  | 'out_left' | 'out_right' | 'out_top' | 'out_bottom';

export type EventAction =
  | { kind: 'callback'; trigger: TriggerToken; callback: CName; userData?: string }
  | { kind: 'subject_set'; trigger: TriggerToken; subject: CName;
      subjectType: 'int' | 'float' | 'string'; value: string }
  | { kind: 'subject_toggle'; trigger: TriggerToken; subject: CName }
  | { kind: 'subject_increment'; trigger: TriggerToken; subject: CName;
      step?: number; min?: number; max?: number; rollover?: boolean }
  | { kind: 'screen_load'; trigger: TriggerToken; screenId: Uuid;
      animType?: ScreenLoadAnim; duration?: number; delay?: number }
  | { kind: 'screen_create'; trigger: TriggerToken; screenId: Uuid;
      animType?: ScreenLoadAnim; duration?: number; delay?: number };
// 注:play_timeline 经评审删除(timelines 一期不做)。

/* ---------------------------------------------------------------- 绑定 */

export type CmpOp = 'eq' | 'not_eq' | 'gt' | 'ge' | 'lt' | 'le';

export type BindableProp = 'value' | 'checked' | 'text' | 'src' | 'min_value' | 'max_value';

export type Binding =
  | { kind: 'prop'; prop: BindableProp; subject: CName; fmt?: string }
  | { kind: 'flag'; flag: ObjFlagKey; op: CmpOp; subject: CName; refValue: number }
  | { kind: 'state'; state: ObjStateKey; op: CmpOp; subject: CName; refValue: number }
  | { kind: 'style'; styleRef: CName; selector?: Selector; subject: CName; refValue: number };

/** SubjectDef:按 ARCHITECTURE §0 修正,int/float 带可选 min/max */
export type SubjectDef =
  | { name: CName; type: 'int'; initial: number; min?: number; max?: number }
  | { name: CName; type: 'float'; initial: number; min?: number; max?: number }
  | { name: CName; type: 'string'; initial: string }
  | { name: CName; type: 'color'; initial: ColorHex };

/* -------------------------------------------------- consts / assets / 翻译 */

export interface ConstDef {
  name: CName;
  type: 'int' | 'px' | 'color' | 'string' | 'percent';
  value: string;               // 运行时统一按字符串存
}

export interface AssetFileRef { fileName: string; sha256: string; byteSize: number }

export interface FontAsset {
  name: CName;
  file: AssetFileRef;
  loader: 'tiny_ttf' | 'bin';
  sizePx?: number;             // tiny_ttf 必填
  conv?: {
    bpp: 1 | 2 | 4 | 8;
    ranges: string;
    symbols?: string;
    autoCollect?: boolean;
    license?: string;
    /** 可选完整许可证正文；正式构建会连同 SPDX/来源信息归档到 licenses/。 */
    licenseText?: string;
    licenseUrl?: string;
    copyright?: string;
  };
}

export interface ImageAsset {
  name: CName;
  file: AssetFileRef;
  /** 缺省 'image';lottie = 动画 json(imageRef 解析为 MEMFS 路径,预览走 set_src_file) */
  kind?: 'image' | 'lottie';
  conv: {
    colorFormat: 'RGB565' | 'RGB565A8' | 'ARGB8888' | 'I1' | 'I2' | 'I4' | 'I8' | 'A8';
    stride?: number;
  };
}

export interface TranslationPack {
  languages: string[];
  entries: { tag: string; texts: Record<string, string> }[];
}

/* ---------------------------------------------------------------- codegen */

/** CodegenOptions:按 ARCHITECTURE §0 修正,无 filePrefix */
export interface CodegenOptions {
  outputDirName: string;       // 默认 'ui' → 导出 zip 的 src/ui/
  exportXml: boolean;          // 默认 false(许可红线)
  userIncludes: string[];
}

/* ---------------------------------------------------------------- 样式 */

export type StateToken =
  | 'default' | 'pressed' | 'checked' | 'scrolled' | 'focused'
  | 'focus_key' | 'edited' | 'hovered' | 'disabled'
  | 'user_1' | 'user_2' | 'user_3' | 'user_4';

export type PartToken =
  | 'main' | 'scrollbar' | 'indicator' | 'knob' | 'selected' | 'items' | 'cursor';

export interface Selector { states?: StateToken[]; part?: PartToken }

export interface NamedStyle {
  id: Uuid;
  name: CName;
  props: Record<string, PropValue>;    // 键 ∈ STYLE_PROPS
}

export interface StyleUsage { styleId: Uuid; selector?: Selector }

export interface InlineStyleGroup { selector?: Selector; props: Record<string, PropValue> }

/* -------------------------------------------------------------- component */

export interface ComponentApiProp {
  name: CName;
  type: string;
  default?: string;
}

/** 与 ScreenDef 同构 + api;一期只定型不做 UI */
export interface ComponentDef {
  id: Uuid;
  name: CName;
  displayName?: string;
  api: ComponentApiProp[];
  styles: NamedStyle[];
  consts: ConstDef[];
  root: WidgetNode;
}
