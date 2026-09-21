/**
 * Widget 描述表(registry)类型。依据 docs/design/01 §3.1。
 */
import type { BindableProp, ObjFlagKey, ObjStateKey, PartToken, PropValue, Size } from './project.js';

export type PropTypeName =
  | 'int' | 'size' | 'bool' | 'string' | 'color' | 'opa'      // opa: 0-255 或 'n%'
  | 'enum' | 'orFlags'
  | 'subject' | 'imageRef' | 'fontRef' | 'styleRef'
  | 'intList'
  | 'stringList'                      // 空格分隔字符串列表(animimage srcs:imageRef 名列表)
  | 'pointList'                       // 坐标对列表,JSON 平铺 [x1,y1,x2,y2,…],XML "x1,y1 x2,y2"(line points)
  | 'stringQuotedList'
  | 'gridTemplate';

export interface EnumSpec {
  tokens: readonly string[];          // == XML token,亦是 JSON 存储值
  cPrefix: string;                    // C 生成:token.toUpperCase() 拼到 cPrefix 后
  cOverride?: Record<string, string>; // 不规则映射
}

export interface CompanionSpec {
  key: string;                        // JSON 键(下划线风格)
  type: PropTypeName;
  xmlAttr: string;                    // 实际 XML 属性名(可含连字符,如 value-animated)
  enum?: EnumSpec;                    // 伴生属性自己的枚举(如 options-mode)
}

export type UiGroup = 'content' | 'value' | 'behavior' | 'geometry';
export type UiControl =
  | 'text' | 'number' | 'select' | 'toggle' | 'color' | 'subject-picker' | 'asset-picker';

export interface PropSpec {
  key: string;                        // JSON 键 == XML 属性名
  type: PropTypeName;
  enum?: EnumSpec;
  min?: number;
  max?: number;
  default?: PropValue;                // LVGL 运行时默认;等于默认值时不输出
  optional?: boolean;                 // createProps 用:无 default 亦非必填,缺省 C 发 NULL
                                      // (menu-page.title / list-button.icon / win-button.icon)
  companions?: CompanionSpec[];
  channel: 'both' | 'c-only';         // c-only = XML parser 未实现但 C API 有
  c: { setter: string };              // 模板:'lv_slider_set_value($obj, $v, $anim)'
  ui: { group: UiGroup; label: string; control: UiControl };
  notes?: string[];
}

export interface ChildSpec {
  type: string;                       // registry key,如 'dropdown-list'
  xmlTag: string;                     // 子元素必须发全名
  kind: 'add' | 'getter' | 'virtual';
  cCreate?: string;                   // add/getter:'lv_chart_add_series($parent, $color, $axis)'
  cHandleType?: string;               // add/getter 句柄类型,默认 'lv_obj_t *'
                                      // (如 'lv_chart_series_t *' / 'lv_span_t *')
  createProps?: PropSpec[];           // 进构造实参的属性;XML 里同为开标签属性
  props: PropSpec[];
  acceptsWidgetChildren: boolean;
  isObj: boolean;                     // true 则同时接受全部 obj 基类属性/样式
  notes?: string[];
}

export type PaletteCategory = 'basic' | 'input' | 'display' | 'container' | 'chart' | 'media';

export interface PaletteMeta {
  category: PaletteCategory;
  label: string;                      // 中文
  icon: string;
}

export interface WidgetSpec {
  type: string;                       // 'slider'
  xmlTag: string;                     // 'lv_slider'
  lvUseGuard: string;                 // 'LV_USE_SLIDER'
  cCreate: string;                    // 'lv_slider_create($parent)'
  props: PropSpec[];                  // 专有属性;obj 基类属性由 OBJ_BASE 统一注入
  bindableProps: BindableProp[];
  parts: PartToken[];
  children?: ChildSpec[];
  acceptsWidgetChildren: boolean;
  palette?: PaletteMeta;
  defaultSize?: { w: Size; h: Size };
  notes?: string[];
}

export interface ObjBase {
  props: PropSpec[];                  // x/y/width/height/align/... 全 widget 共享
  flags: readonly ObjFlagKey[];       // 25 项
  states: readonly ObjStateKey[];     // 8 项
}
