/**
 * IR:已完全解析(引用→名字)、默认值已消除、命名已定死的树。
 * 下游的 Preview 与 C emitter 不再查 registry 引用、不再判默认值。
 */
import type {
  BindableProp, CPatch, CmpOp, CName, ConstDef, DisplayConfig, FontAsset,
  ImageAsset, InlineStyleGroup, ObjFlagKey, ObjStateKey, PropSpec, PropValue,
  Selector, SubjectDef, Uuid,
} from '@lvd/schema';

export interface IRProject {
  name: string;
  display: DisplayConfig;
  consts: ConstDef[];                    // 全局 consts
  styles: IRNamedStyle[];                // 全局命名样式
  subjects: SubjectDef[];
  fonts: FontAsset[];
  images: ImageAsset[];
  screens: IRScreen[];
  homeScreenName: CName;
  userIncludes: string[];
}

export interface IRNamedStyle {
  name: CName;
  props: Record<string, PropValue>;      // 键 ∈ STYLE_PROPS(未知键已剔除)
}

export interface IRScreen {
  id: Uuid;
  name: CName;
  consts: ConstDef[];
  styles: IRNamedStyle[];
  root: IRNode;                          // type 'obj';name == screen name
}

export interface IRNode {
  id: Uuid;
  type: string;                          // registry key 或 ChildSpec.type(如 'chart-series')
  xmlTag: string;                        // 'lv_slider' / 'lv_chart-series'
  cCreate: string;                       // 'lv_slider_create($parent)' / add/getter 模板
  ownPropSpecs: readonly PropSpec[];     // 专有属性描述(不含 obj 基类、不含 createProps)
  createPropSpecs: readonly PropSpec[];  // 构造实参属性(ChildSpec.createProps;widget 为空)
  childKind?: 'add' | 'getter' | 'virtual';  // 结构子元素形态;widget 为 undefined
  cHandleType?: string;                  // add/getter 句柄类型,缺省 'lv_obj_t *'
  emitName: boolean;                     // XML 通道是否发 name 属性(非 obj 系子元素不发)
  useObjBase: boolean;                   // true 则 obj 基类 props/flags/states 可用
  name: string;                          // 去重后的用户名;匿名为 ''
  named: boolean;
  previewName: string;                   // name || '_x'+id8;XML 预览通道强制输出
  props: Record<string, PropValue>;      // 已消除默认值(companion 键也在此)
  flags: [ObjFlagKey, boolean][];        // OBJ_BASE 顺序
  states: [ObjStateKey, boolean][];
  inlineStyles: InlineStyleGroup[];
  styleUses: { styleName: CName; selector?: Selector }[];  // styleId 已解析为 name
  bindings: IRBinding[];
  events: IREvent[];
  cPatch?: CPatch;
  children: IRNode[];
}

export type IRBinding =
  | { kind: 'prop'; prop: BindableProp; subject: CName; fmt?: string }
  | { kind: 'flag'; flag: ObjFlagKey; op: CmpOp; subject: CName; refValue: number }
  | { kind: 'state'; state: ObjStateKey; op: CmpOp; subject: CName; refValue: number };

export type IREvent =
  | { kind: 'callback'; trigger: string; callback: CName; userData?: string }
  | { kind: 'subject_set'; trigger: string; subject: CName;
      subjectType: 'int' | 'float' | 'string'; value: string }
  | { kind: 'subject_toggle'; trigger: string; subject: CName }
  | { kind: 'subject_increment'; trigger: string; subject: CName;
      step?: number; min?: number; max?: number; rollover?: boolean }
  | { kind: 'screen_load' | 'screen_create'; trigger: string; screenName: CName;
      animType?: string; duration?: number; delay?: number };
