/**
 * Schema v2 —— UiProject 本体(方案 §4.5、§4.6、§5.3)。
 *
 * 与 v1 的关键差异:
 *  1. meta 不再保存 lvglVersion —— 发布版本以 BuildTarget.lvglVersion 为准(§4.2)。
 *  2. 不保存 display 副本,只留 designDisplayRef(§4.2)。
 *  3. 节点标识三职责分离:id(业务)/ displayName(展示)/ codeName(C 符号)(§4.6)。
 *  4. 新增 themes[](Theme Token),样式值可用 { $token: ... } 引用。
 *  5. **移除 cPatch** —— 任意 C 片段进独立 trusted extension(§8)。
 *  6. Event(LVGL 事件)与 Action(业务命令)分离,Action 只能引用 Action Registry(§5.3)。
 */
import type {
  BindableProp, CmpOp, ConstDef, ObjFlagKey, ObjStateKey, Scalar, Selector,
  TranslationPack, TriggerToken,
} from '../project.js';
import type { DisplayRef } from './refs.js';
import type { ThemeDef, TokenRef } from './theme.js';

export const SCHEMA_VERSION_V2 = 2;

/** 业务 ID:URI 风格或 UUID,稳定、不直接输出到 C(§4.6) */
export type BizId = string;

/** C 标识符约束,仅需要导出符号的节点才有 */
export type CodeName = string;

export type ConstRefV2 = { $const: string };

/** v2 值:字面量 | 常量引用 | Theme Token 引用 */
export type PropValueV2 = Scalar | number[] | string[] | ConstRefV2 | TokenRef;

/* ---------------------------------------------------------------- 顶层 */

export interface UiProject {
  schemaVersion: 2;
  kind: 'lvgl-ui-project';
  meta: UiProjectMeta;
  /** 设计时所针对的 DisplayProfile。ControllerProfile.displayRef 必须与之一致(BuildTarget 校验) */
  designDisplayRef: DisplayRef;
  themes: ThemeDef[];
  subjects: SubjectDefV2[];
  screens: ScreenDefV2[];
  components: ComponentDefV2[];
  /** 全局命名样式 */
  styles: NamedStyleV2[];
  consts: ConstDef[];
  assets: UiAssets;
  translations: TranslationPack | null;
  /** 读取方必须容忍缺失 */
  editor?: Record<string, unknown>;
}

export interface UiProjectMeta {
  /** `ui:<slug>`;BuildTarget.uiProjectRef 拼上 @revision 后引用它 */
  id: BizId;
  revision: number;
  name: string;
  appVersion: string;
  createdAt: string;
  modifiedAt: string;
  // 注意:此处刻意没有 lvglVersion —— 见文件头 §4.2
}

export interface UiAssets {
  fonts: AssetEntry[];
  images: AssetEntry[];
  icons: AssetEntry[];
}

export interface AssetEntry {
  id: BizId;
  codeName?: CodeName;
  displayName?: string;
  file: { fileName: string; sha256: string; byteSize: number };
  /** 转换参数;其哈希进构建 manifest(§6.2) */
  conv?: Record<string, string | number | boolean>;
}

/* ---------------------------------------------------------------- 树 */

export interface ScreenDefV2 {
  id: BizId;
  codeName: CodeName;          // screen 必然导出 <name>_create()
  displayName?: string;
  isHome?: boolean;
  styles: NamedStyleV2[];
  consts: ConstDef[];
  root: WidgetNodeV2;          // type 恒为 'obj'
}

export interface WidgetNodeV2 {
  id: BizId;
  type: string;                // registry key
  codeName?: CodeName;         // 只有需要 C 指针变量的节点才有
  displayName?: string;        // 允许中文,仅 UI
  props: Record<string, PropValueV2>;
  flags?: Partial<Record<ObjFlagKey, boolean>>;
  states?: Partial<Record<ObjStateKey, boolean>>;
  /** 引用命名样式 */
  styleRefs: StyleUsageV2[];
  /** 局部样式,按 selector 分组 */
  styles: LocalStyleGroup[];
  events: UiEvent[];
  bindings: BindingV2[];
  children: WidgetNodeV2[];
  editor?: { locked?: boolean; collapsed?: boolean };
  // 注意:此处刻意没有 cPatch —— 见文件头 §8
}

export interface NamedStyleV2 {
  id: BizId;
  codeName?: CodeName;
  displayName?: string;
  props: Record<string, PropValueV2>;
}

export interface StyleUsageV2 { styleId: BizId; selector?: Selector }

export interface LocalStyleGroup { selector?: Selector; props: Record<string, PropValueV2> }

/* ---------------------------------------------------------------- Binding */

/**
 * 与 v1 的 Binding 同构,但引用一律用业务 id(BizId),不用 CName —— 与 §4.6 的标识符分离一致。
 * Lowering 阶段再解析成 subject/style 的 C 符号。
 */
export type BindingV2 =
  | { kind: 'prop'; prop: BindableProp; subject: BizId; fmt?: string }
  | { kind: 'flag'; flag: ObjFlagKey; op: CmpOp; subject: BizId; refValue: number }
  | { kind: 'state'; state: ObjStateKey; op: CmpOp; subject: BizId; refValue: number }
  | { kind: 'style'; styleId: BizId; selector?: Selector; subject: BizId; refValue: number };

/* ------------------------------------------------------- Event / Action */

/**
 * Event 是 LVGL 事件,Action 是业务命令,两者必须分离(§5.3):
 *   clicked       → light.toggle
 *   value_changed → fan.setSpeed(value)
 *   clicked       → screen.open(screen:settings)
 */
export interface UiEvent {
  /** 只能选当前 Widget/版本支持的 LVGL 事件 */
  on: TriggerToken;
  /** 必须存在于 Action Registry */
  action: string;
  args?: Record<string, Scalar | TokenRef>;
}

export interface ActionParamSpec {
  name: string;
  type: 'int' | 'float' | 'bool' | 'string' | 'color' | 'screenRef' | 'subjectRef';
  required?: boolean;
  default?: Scalar;
  /** 取值白名单。给出后,校验器拒绝不在表内的值(用于 pod 设置字段这类受控枚举) */
  enum?: readonly string[];
  min?: number;
  max?: number;
}

export interface ActionSpec {
  /** 点分命名,例如 `light.toggle`、`screen.open` */
  id: string;
  displayName?: string;
  description?: string;
  params: ActionParamSpec[];
}

/**
 * Action Registry —— 强类型业务命令契约(§5.3)。
 * Widget 不直接保存 CANopen index/subIndex、MQTT topic 或数据库字段;
 * 目标固件在 UI 集成层通过 Binding Adapter 把语义 Action 映射到具体设备能力。
 */
export type ActionRegistry = Record<string, ActionSpec>;

/** 内置导航 Action:与设备无关,任何 BuildTarget 都可用 */
export const BUILTIN_ACTIONS: ActionRegistry = {
  'screen.open': {
    id: 'screen.open',
    displayName: '打开屏幕',
    params: [
      { name: 'screen', type: 'screenRef', required: true },
      { name: 'anim', type: 'string' },
      { name: 'duration', type: 'int' },
      { name: 'delay', type: 'int' },
    ],
  },
  'screen.create': {
    id: 'screen.create',
    displayName: '创建并打开屏幕',
    description: '对应 v1 的 screen_create:目标屏未创建时先创建再加载',
    params: [
      { name: 'screen', type: 'screenRef', required: true },
      { name: 'anim', type: 'string' },
      { name: 'duration', type: 'int' },
      { name: 'delay', type: 'int' },
    ],
  },
  'screen.back': { id: 'screen.back', displayName: '返回上一屏', params: [] },
  'subject.set': {
    id: 'subject.set',
    displayName: '设置 Subject',
    params: [
      { name: 'subject', type: 'subjectRef', required: true },
      { name: 'value', type: 'string', required: true },
    ],
  },
  'subject.toggle': {
    id: 'subject.toggle',
    displayName: '翻转 Subject',
    params: [{ name: 'subject', type: 'subjectRef', required: true }],
  },
  'subject.increment': {
    id: 'subject.increment',
    displayName: '递增 Subject',
    params: [
      { name: 'subject', type: 'subjectRef', required: true },
      { name: 'step', type: 'int' },
      { name: 'min', type: 'int' },
      { name: 'max', type: 'int' },
      { name: 'rollover', type: 'bool' },
    ],
  },
};

/* ---------------------------------------------------------------- Subject */

export type SubjectDefV2 =
  | { id: BizId; codeName: CodeName; displayName?: string; type: 'int'; initial: number; min?: number; max?: number }
  | { id: BizId; codeName: CodeName; displayName?: string; type: 'float'; initial: number; min?: number; max?: number }
  | { id: BizId; codeName: CodeName; displayName?: string; type: 'string'; initial: string }
  | { id: BizId; codeName: CodeName; displayName?: string; type: 'color'; initial: string };

/* -------------------------------------------------------------- Component */

export interface ComponentApiPropV2 {
  name: string;
  type: 'int' | 'float' | 'bool' | 'string' | 'color' | 'size' | 'imageRef';
  default?: Scalar;
}

export interface ComponentDefV2 {
  id: BizId;
  codeName: CodeName;
  displayName?: string;
  api: ComponentApiPropV2[];
  styles: NamedStyleV2[];
  consts: ConstDef[];
  root: WidgetNodeV2;
}
