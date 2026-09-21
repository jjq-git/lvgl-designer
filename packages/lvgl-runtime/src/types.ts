import type { PreviewProgram } from '@lvd/preview-compiler';

/**
 * @lvd/lvgl-runtime — 类型定义。
 * 契约来源:docs/design/02 §3.1 + ARCHITECTURE §3.3;桥硬约束见 m0/REPORT.md。
 */

export interface LvdRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LogLine {
  level: number;
  msg: string;
}

export type RuntimeMode = 'design' | 'play';

/** lvgl 日志级别:TRACE0 INFO1 WARN2 ERROR3 USER4 */
export const LV_LOG_WARN = 2;
export const LV_LOG_ERROR = 3;

/** attrs 打包所需的最小 Module 面(测试用 fake 实现这个) */
export interface AllocModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAP32: Int32Array;
  stringToNewUTF8(s: string): number;
}

/** Emscripten Module 最小类型面(只声明包装层用到的成员) */
export interface LvdModule extends AllocModule {
  HEAPU8: Uint8Array;
  cwrap(
    name: string,
    ret: string | null,
    args: readonly string[],
  ): (...args: (number | string)[]) => number;
  UTF8ToString(ptr: number, maxBytes?: number): string;
  stringToUTF8(s: string, ptr: number, maxBytes: number): void;
  lengthBytesUTF8(s: string): number;
  FS: {
    mkdir(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
  };
  /** Legacy 9.4 SDL runtime 的硬编码 '#canvas' 选择器映射。 */
  specialHTMLTargets?: Record<string, unknown>;
  __lvLogSink?: ((level: number, msg: number | string) => void) | null;
  __lvEventStub?: ((name: number | string, eventCode?: number, userData?: string) => void) | null;
  [key: string]: unknown;
}

/** dist/lvgl_runtime.mjs 的工厂签名 */
export type LvglModuleFactory = (opts: {
  canvas: HTMLCanvasElement;
  locateFile?: (path: string) => string;
}) => Promise<LvdModule>;

/**
 * 运行时公开接口 —— LvglRuntime 与 createMockRuntime 的共同契约
 * (跨包铁律,不得私改;方法集照 design/02 §3.1 + 任务契约)。
 */
export interface LvglRuntimeApi {
  /* 画布 / 主循环 */
  setResolution(hor: number, ver: number): void;
  setMode(mode: RuntimeMode): void;
  start(): void;
  stop(): void;
  destroy(): void;
  readonly running: boolean;
  tick(): number;

  /* XML / 热重载 */
  registerComponent(name: string, xml: string): void;
  unregisterComponent(name: string): void;
  reloadScreen(name: string, xml: string): void;
  loadScreen(name: string): void;
  updateAttrs(name: string, widgetClass: string, attrs: Record<string, string>): void;
  createChild(parentName: string | null, widget: string, attrs: Record<string, string>): void;
  deleteObj(name: string): void;
  reloadAll(globalsXml: string, screens: { name: string; xml: string }[]): void;
  registerEventStub(cbName: string): void;

  /* 9.5 IR Preview；当前为受控 P0 子集 */
  supportsPreviewProgram(): boolean;
  loadPreviewProgram(program: PreviewProgram): void;

  /* 资产 */
  writeFile(path: string, bytes: Uint8Array): void;
  registerImage(name: string, source: Uint8Array | string): void;
  dropImageCache(src: string): void;
  registerFontTinyTtf(name: string, bytes: Uint8Array, sizePx: number): void;

  /* 几何 / 命中 */
  hitTest(x: number, y: number): string | null;
  getObjRect(name: string, transformed?: boolean): LvdRect | null;
  getObjRects(names: string[]): Map<string, LvdRect>;
  dumpTree(): unknown;

  /* 输出 */
  snapshot(screenName?: string): ImageData;

  /* 订阅 */
  onLog(cb: (level: number, msg: string) => void): () => void;
  onEventStub(cb: (name: string, eventCode?: number, userData?: string) => void): () => void;
  takeLogs(): LogLine[];

  /* 确定性 tick(e2e) */
  setManualTick(on: boolean): void;
  advanceTick(ms: number): void;
}
