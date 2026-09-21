/**
 * Schema v2 —— Display / Controller / Input / Firmware Profile 与 BuildTarget(方案 §4.1–§4.4)。
 *
 * 单一事实源规则(§4.2):
 *  - UiProject 只存 designDisplayRef,ControllerProfile 也引用同一个 DisplayProfile;
 *    **不持久化由 Controller 推导出的 display 副本**。
 *  - UiProject 不重复保存目标 LVGL 版本;发布构建以 BuildTarget.lvglVersion 为准。
 *  - orientation 是派生值,不持久化(见 deriveOrientation)。
 */
import type { ControllerRef, DisplayRef, FirmwareRef, InputRef, ThemeRef, UiRef } from './refs.js';

/* ------------------------------------------------------------------ 公共 */

export interface Rect { x: number; y: number; width: number; height: number }
export interface SizePx { width: number; height: number }

/** 资源引用带内容哈希:发布构建要把资源哈希写进 manifest(§4.4) */
export type AssetRef = `asset:${string}@sha256:${string}`;

/* ---------------------------------------------------------- DisplayProfile */

/**
 * 使用 LVGL 语义枚举,不存 16/24/32。
 * RGB565 与 RGB565_SWAPPED 都是 16bpp 但驱动含义不同(§4.3)。
 * 取值范围 = LVGL 软件渲染器可渲染的格式(lv_color.h `LV_COLOR_FORMAT_NATIVE` 分支 + SWAPPED 变体)。
 */
export type ColorFormat =
  | 'RGB565' | 'RGB565_SWAPPED' | 'RGB888' | 'XRGB8888' | 'ARGB8888' | 'L8' | 'I1';

export type DisplayShape = 'rect' | 'round';

export interface DisplayProfile {
  schemaVersion: 1;
  kind: 'display-profile';
  /** `display:<slug>`(不含 @revision;引用方拼上 revision) */
  id: string;
  revision: number;
  displayName?: string;
  /** 逻辑分辨率 = LVGL 的 hor_res/ver_res */
  logicalSize: SizePx;
  shape: DisplayShape;
  colorFormat: ColorFormat;
  dpi?: number;
  /**
   * 从逻辑 framebuffer 中实际显示的区域。
   * 条屏用例:TXW620002B0 逻辑 480×960、物理可视仅中间 360 列 →
   *   { x: 60, y: 0, width: 360, height: 960 }
   * 缺省视为全屏。Validator 保证它位于 logicalSize 内。
   */
  visibleRect?: Rect;
  /** 安装旋转(面板相对外壳),影响 orientation 派生与 viewport 映射 */
  installRotation?: 0 | 90 | 180 | 270;
}

/**
 * 派生展示用朝向。**不持久化**(§4.2)。
 * 必须考虑安装旋转,不能只判断 width > height。
 */
export function deriveOrientation(p: DisplayProfile): 'landscape' | 'portrait' | 'square' {
  const rotated = p.installRotation === 90 || p.installRotation === 270;
  const w = rotated ? p.logicalSize.height : p.logicalSize.width;
  const h = rotated ? p.logicalSize.width : p.logicalSize.height;
  if (w === h) return 'square';
  return w > h ? 'landscape' : 'portrait';
}

/** visibleRect 缺省即全屏 */
export function effectiveVisibleRect(p: DisplayProfile): Rect {
  return p.visibleRect ?? { x: 0, y: 0, width: p.logicalSize.width, height: p.logicalSize.height };
}

/* ------------------------------------------------------- ControllerProfile */

export type ViewportClip =
  | { type: 'none' }
  | { type: 'rect' }
  | { type: 'roundedRect'; radius: number }
  | { type: 'circle' };

export interface ScreenViewport extends Rect {
  /** 单位是 SVG viewBox 单位,不是屏幕像素(§4.4) */
  rotation: 0 | 90 | 180 | 270;
  clip?: ViewportClip;
}

export interface ControllerFrame {
  /** 外壳 SVG;上传时必须清洗 script/事件属性/外部资源/危险 URL/foreignObject(§6.1) */
  assetRef: AssetRef;
  viewBox: Rect;
  screenViewport: ScreenViewport;
}

export interface ControllerProfile {
  schemaVersion: 1;
  kind: 'controller-profile';
  id: string;
  revision: number;
  model: string;
  displayName?: string;
  /** 与 UiProject.designDisplayRef 必须指向同一个 DisplayProfile(BuildTarget 校验) */
  displayRef: DisplayRef;
  frame: ControllerFrame;
  /** 只有需要仿真原始触摸时才引用(§4.4) */
  inputProfileRef?: InputRef;
  /** 外壳上的物理控件(旋钮/按键),仅用于预览交互,不进 LVGL 坐标系 */
  physicalControls?: PhysicalControl[];
}

export interface PhysicalControl {
  id: string;
  kind: 'knob' | 'button' | 'switch';
  displayName?: string;
  /** viewBox 单位 */
  hitArea: Rect;
  /** 触发的 Action id(必须在 Action Registry 中) */
  action?: string;
}

/* ------------------------------------------------------------ InputProfile */

/**
 * 原始触摸面板坐标校准。属于硬件输入配置,**不进 DisplayProfile**(§4.3/§4.4)。
 * 已知用例:MX039/ST7102 圆屏显示 480×480,触摸坐标系 480×854 经 touch_map 映射。
 *
 * 普通鼠标/触摸的客户预览应直接映射到 LVGL 逻辑坐标,不套用本变换;
 * 只有「原始触摸仿真模式」才应用(§6.1)。
 */
export interface InputProfile {
  schemaVersion: 1;
  kind: 'input-profile';
  id: string;
  revision: number;
  displayName?: string;
  /** 触摸 IC 原始坐标系尺寸(可能与显示分辨率不同) */
  rawSize: SizePx;
  swapXy?: boolean;
  invertX?: boolean;
  invertY?: boolean;
  /** 原始坐标 → 逻辑坐标的仿射矩阵 [a,b,c,d,e,f];缺省即按 rawSize→logicalSize 线性缩放 */
  affine?: [number, number, number, number, number, number];
}

/* --------------------------------------------------------- FirmwareProfile */

export interface FirmwareProfile {
  schemaVersion: 1;
  kind: 'firmware-profile';
  id: string;
  revision: number;
  displayName?: string;
  /** 目标芯片/板级标识,例如 'esp32s3' */
  target: string;
  /** UI-to-firmware ABI understood by the target runtime. */
  uiAbiVersion: string;
  /** Monotonic revision of this target's advertised capability set. */
  capabilityRevision: number;
  /** Stable widget registry keys implemented by the firmware runtime. */
  supportedWidgets: string[];
  /** Stable subject identifiers/types accepted by the firmware bridge. */
  supportedSubjects: string[];
  /** Stable action identifiers accepted by the firmware bridge. */
  supportedActions: string[];
  /** 该固件要求的 lv_conf.h 开关(目标能力校验第 3 层用) */
  lvConf?: Record<string, string | number | boolean>;
  /** 可用内存预算(字节),用于资源体积门禁 */
  memoryBudgetBytes?: number;
}

/* -------------------------------------------------------------- BuildTarget */

/** 目标 LVGL 版本。9.4 只用于读旧工程与迁移(§3.3)。 */
export type LvglVersion = '9.4.0' | '9.5.0';

/**
 * 构建与发布的不可变输入快照(§4.4)。
 * Validator 解析引用后必须验证 UI 与 Controller 指向同一 DisplayProfile,
 * 并把所有 Profile revision、资源哈希、LVGL commit 写入构建 lock/manifest。
 */
export interface BuildTarget {
  schemaVersion: 1;
  kind: 'lvgl-build-target';
  id: string;
  revision: number;
  displayName?: string;
  uiProjectRef: UiRef;
  controllerProfileRef: ControllerRef;
  /** 工程内 Theme 或独立不可变 Theme revision。 */
  themeRef: ThemeRef;
  firmwareProfileRef?: FirmwareRef;
  /** 发布构建所用 LVGL 版本的唯一权威;UiProject 不重复保存(§4.2) */
  lvglVersion: LvglVersion;
}

/* ------------------------------------------------------------ 能力包接口 */

/**
 * 版本能力包(§3.3)。此处只定型「目标能力校验」需要的部分;
 * previewAdapter / cEmitter 由各自的包提供实现,不进 schema 包(避免 schema 依赖 runtime/codegen)。
 */
export interface LvglCapabilitySummary {
  version: LvglVersion;
  supportedColorFormats: readonly ColorFormat[];
  /** registry key 集合 */
  supportedWidgets: readonly string[];
  /** 该版本是否提供 XML 引擎。9.5.0 = false(XML 引擎已移出开源仓库,见 docs/lvgl-version-baseline.md §2.2) */
  hasXmlEngine: boolean;
}

/** LVGL 软件渲染器在两个目标版本上均支持这些格式(LV_DRAW_SW_SUPPORT_* 默认全开) */
export const SW_COLOR_FORMATS: readonly ColorFormat[] =
  ['RGB565', 'RGB565_SWAPPED', 'RGB888', 'XRGB8888', 'ARGB8888', 'L8', 'I1'];
