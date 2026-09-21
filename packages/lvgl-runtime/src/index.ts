/**
 * @lvd/lvgl-runtime — WASM 运行时 TS 封装。
 *
 * dist/ 下 lvgl_runtime.mjs / lvgl_runtime.wasm 是已构建产物,不重编。
 * 契约:docs/design/02 §3.1 + ARCHITECTURE §3.3;桥硬约束见 m0/REPORT.md。
 */
export const PKG_NAME = '@lvd/lvgl-runtime';

export { LvglRuntime } from './LvglRuntime';
export { executePreviewProgram, validatePreviewProgramSupport } from './preview';
export type { PreviewBridge, PreviewSupportIssue } from './preview';
export { LvglError } from './errors';
export { createMockRuntime } from './mock';
export { packAttrs, packStrArray, type PackedStrArray } from './attrs';
export { bgraToRgba } from './pixels';
export {
  LV_LOG_WARN,
  type AllocModule,
  type LogLine,
  type LvdModule,
  type LvdRect,
  type LvglModuleFactory,
  type LvglRuntimeApi,
  type RuntimeMode,
} from './types';
