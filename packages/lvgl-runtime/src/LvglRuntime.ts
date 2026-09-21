/**
 * LvglRuntime — dist/lvgl_runtime.{mjs,wasm} 的 TS 包装。
 *
 * 契约:docs/design/02 §3.1 + ARCHITECTURE §3.3;m0/runtime-wrapper.mjs 产品化。
 * 桥硬约束(m0/REPORT.md,不得删):
 * - legacy 9.4 runtime 在 init 前映射 SDL canvas；9.5 host 直接使用 Module.canvas
 * - lvd_reload_all 4 参:(globals_xml, names char**, xmls char**, n)
 * - snapshot 像素 BGRA,meta = int32[3]{w,h,stride}
 */
/// <reference path="./dist-modules.d.ts" />

import { packAttrs, packStrArray } from './attrs';
import { LvglError } from './errors';
import { bgraToRgba } from './pixels';
import { executePreviewProgram, type PreviewBridge } from './preview';
import type { PreviewProgram } from '@lvd/preview-compiler';
import {
  LV_LOG_ERROR,
  LV_LOG_WARN,
  type LogLine,
  type LvdModule,
  type LvdRect,
  type LvglRuntimeApi,
  type RuntimeMode,
} from './types';

/* cwrap 签名表:name -> [ret, args];'string' = cwrap 自动封送(恒非空),
 * 'number' = 指针/整型手动管理(可空指针、char**、out 缓冲) */
const SIGS: Record<string, [string | null, string[]]> = {
  lvd_init: ['number', ['number', 'number']],
  lvd_tick: ['number', []],
  lvd_set_resolution: [null, ['number', 'number']],
  lvd_register_component: ['number', ['string', 'string']],
  lvd_unregister_component: ['number', ['string']],
  lvd_reload_screen: ['number', ['string', 'string']],
  lvd_create_child: ['number', ['number', 'string', 'number']], // parent 可空 → 手动指针
  lvd_delete_obj: ['number', ['string']],
  lvd_update_attrs: ['number', ['string', 'string', 'number']], // attrs = char**
  lvd_obj_at_point: ['number', ['number', 'number']], // 返回 char*(静态缓冲)
  lvd_get_obj_rect: ['number', ['string', 'number', 'number']], // out = int32[4]
  lvd_get_obj_rects: ['number', ['number', 'number']], // (names char* 手动, out) — 高频,预分配缓冲
  lvd_dump_tree: ['number', ['number', 'number']],
  lvd_snapshot: ['number', ['number', 'number']], // name 可空 → 手动指针
  lvd_snapshot_free: [null, []],
  lvd_set_interactive: [null, ['number']],
  lvd_pause_anims: [null, ['number']],
  lvd_register_image: ['number', ['string', 'string']],
  lvd_register_font_tiny_ttf: ['number', ['string', 'number', 'number', 'number']],
  lvd_set_asset_prefix: [null, ['string']],
  lvd_reload_all: ['number', ['number', 'number', 'number', 'number']],
  lvd_register_event_stub: ['number', ['string']],
  lvd_load_screen: ['number', ['string']],
  lvd_drop_image_cache: ['number', ['string']],
  lvd_set_manual_tick: [null, ['number']],
  lvd_advance_tick: [null, ['number']],
  lvd_preview_begin: ['number', ['number', 'number', 'number', 'string']],
  lvd_preview_create_subject_i32: ['number', ['string', 'number', 'number', 'number', 'number', 'number']],
  lvd_preview_create_subject_float: ['number', ['string', 'number', 'number', 'number', 'number', 'number']],
  lvd_preview_create_subject_string: ['number', ['string', 'string', 'number']],
  lvd_preview_create_subject_color: ['number', ['string', 'string']],
  lvd_preview_create_style: ['number', ['string']],
  lvd_preview_set_named_style_i32: ['number', ['string', 'string', 'number']],
  lvd_preview_set_named_style_string: ['number', ['string', 'string', 'string']],
  lvd_preview_create_screen: ['number', ['string']],
  lvd_preview_create_node: ['number', ['string', 'string', 'string']],
  lvd_preview_create_structural: ['number', ['string', 'string', 'string', 'string']],
  lvd_preview_create_list_item: ['number', ['string', 'string', 'string', 'string', 'string']],
  lvd_preview_set_table_column: ['number', ['string', 'number', 'number']],
  lvd_preview_set_table_cell_value: ['number', ['string', 'number', 'number', 'string']],
  lvd_preview_set_table_cell_ctrl: ['number', ['string', 'number', 'number', 'string']],
  lvd_preview_set_i32: ['number', ['string', 'string', 'number']],
  lvd_preview_set_string: ['number', ['string', 'string', 'string']],
  lvd_preview_set_point_list: ['number', ['string', 'string', 'string']],
  lvd_preview_set_string_list: ['number', ['string', 'string', 'string']],
  lvd_preview_set_i32_list: ['number', ['string', 'string', 'string']],
  lvd_preview_set_chart_axis: ['number', ['string', 'string', 'string', 'number']],
  lvd_preview_set_flag: ['number', ['string', 'string', 'number']],
  lvd_preview_set_state: ['number', ['string', 'string', 'number']],
  lvd_preview_set_style_i32: ['number', ['string', 'string', 'number', 'string', 'string']],
  lvd_preview_set_style_string: ['number', ['string', 'string', 'string', 'string', 'string']],
  lvd_preview_add_style: ['number', ['string', 'string', 'string', 'string']],
  lvd_preview_bind_prop: ['number', ['string', 'string', 'string', 'string']],
  lvd_preview_bind_flag: ['number', ['string', 'string', 'string', 'string', 'number']],
  lvd_preview_bind_state: ['number', ['string', 'string', 'string', 'string', 'number']],
  lvd_preview_add_callback_event: ['number', ['string', 'string', 'string', 'string', 'number']],
  lvd_preview_add_subject_set_event: ['number', ['string', 'string', 'string', 'string', 'string']],
  lvd_preview_add_subject_toggle_event: ['number', ['string', 'string', 'string']],
  lvd_preview_add_subject_increment_event: [
    'number', ['string', 'string', 'string', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
  ],
  lvd_preview_add_screen_event: [
    'number', ['string', 'string', 'string', 'string', 'string', 'number', 'number'],
  ],
  lvd_preview_finish: ['number', ['string']],
};

const PREVIEW_EXPORTS = [
  'lvd_preview_begin', 'lvd_preview_create_subject_i32', 'lvd_preview_create_subject_float',
  'lvd_preview_create_subject_string', 'lvd_preview_create_subject_color',
  'lvd_preview_create_style',
  'lvd_preview_set_named_style_i32', 'lvd_preview_set_named_style_string',
  'lvd_preview_create_screen', 'lvd_preview_create_node', 'lvd_preview_create_structural',
  'lvd_preview_create_list_item',
  'lvd_preview_set_table_column', 'lvd_preview_set_table_cell_value',
  'lvd_preview_set_table_cell_ctrl',
  'lvd_preview_set_i32', 'lvd_preview_set_string', 'lvd_preview_set_point_list',
  'lvd_preview_set_string_list', 'lvd_preview_set_i32_list', 'lvd_preview_set_chart_axis',
  'lvd_preview_set_flag',
  'lvd_preview_set_state', 'lvd_preview_set_style_i32', 'lvd_preview_set_style_string',
  'lvd_preview_add_style', 'lvd_preview_bind_prop', 'lvd_preview_bind_flag',
  'lvd_preview_bind_state', 'lvd_preview_add_callback_event',
  'lvd_preview_add_subject_set_event', 'lvd_preview_add_subject_toggle_event',
  'lvd_preview_add_subject_increment_event', 'lvd_preview_add_screen_event',
  'lvd_preview_finish',
] as const;

/** 预分配缓冲尺寸(design/02 §3.2:高频路径避免每帧 malloc/free 抖动) */
const STR_BUF_CAP = 4096;
const RECT_BUF_RECTS = 64; // int32[4] × 64

type BridgeFn = (...args: (number | string)[]) => number;

export class LvglRuntime implements LvglRuntimeApi {
  private mod: LvdModule | null = null;
  private c: Record<string, BridgeFn> = {};
  /** 集成对表用:wasm 里缺哪些导出 */
  missingExports: string[] = [];

  private logBuf: LogLine[] = [];
  private logSubs = new Set<(level: number, msg: string) => void>();
  private stubSubs = new Set<(name: string, eventCode?: number, userData?: string) => void>();
  private _running = false;
  private raf = 0;

  /** 预分配缓冲(destroy 时随 Module 一起丢) */
  private strBuf = 0;
  private rectBuf = 0;

  private constructor() {}

  static async create(canvas: HTMLCanvasElement, hor = 240, ver = 240): Promise<LvglRuntime> {
    const [{ default: createLvglRuntime }, { default: wasmUrl }] = await Promise.all([
      import('../dist/lvgl_runtime.mjs'),
      import('../dist/lvgl_runtime.wasm?url'),
    ]);
    const mod = await createLvglRuntime({
      canvas,
      locateFile: (p: string) => (p.endsWith('.wasm') ? wasmUrl : p),
    });
    // Legacy 9.4 SDL runtime only. The 9.5 PreviewProgram host uses Module.canvas directly.
    if (mod.specialHTMLTargets) mod.specialHTMLTargets['#canvas'] = canvas;

    const rt = new LvglRuntime();
    rt.mod = mod;
    rt.installHooks(mod);
    rt.wrapAll(mod);
    rt.strBuf = mod._malloc(STR_BUF_CAP);
    rt.rectBuf = mod._malloc(4 * 4 * RECT_BUF_RECTS);
    rt.clearLog();
    const rc = rt.bridge('lvd_init')(hor, ver);
    if (rc !== 0) throw new LvglError(`lvd_init(${hor},${ver}) rc=${rc}`, rt.takeLogs());
    return rt;
  }

  /* ---------- 内部 ---------- */

  private get m(): LvdModule {
    if (!this.mod) throw new LvglError('runtime destroyed');
    return this.mod;
  }

  private bridge(name: string): BridgeFn {
    const fn = this.c[name];
    if (!fn) throw new LvglError(`bridge export missing: ${name}`);
    return fn;
  }

  private installHooks(mod: LvdModule): void {
    mod.__lvLogSink = (level, msg) => {
      const m = typeof msg === 'number' ? mod.UTF8ToString(msg) : String(msg);
      const entry: LogLine = { level: Number(level), msg: m };
      this.logBuf.push(entry);
      for (const cb of this.logSubs) {
        try {
          cb(entry.level, entry.msg);
        } catch {
          /* 订阅方异常不打断日志链 */
        }
      }
    };
    // 事件打桩上报:EM_JS 可能传 JS string 或 char*(两者兼容)
    mod.__lvEventStub = (name, eventCode, userData) => {
      const n = typeof name === 'number' ? mod.UTF8ToString(name) : String(name);
      for (const cb of this.stubSubs) {
        try {
          cb(n, eventCode, userData);
        } catch {
          /* noop */
        }
      }
    };
  }

  private wrapAll(mod: LvdModule): void {
    for (const [name, [ret, args]] of Object.entries(SIGS)) {
      if (typeof mod['_' + name] === 'function') {
        this.c[name] = mod.cwrap(name, ret, args) as BridgeFn;
      } else {
        this.missingExports.push(name);
      }
    }
  }

  has(name: string): boolean {
    return name in this.c;
  }

  private clearLog(): void {
    this.logBuf = [];
  }

  private check(rc: number, what: string): void {
    if (rc !== 0) {
      throw new LvglError(
        `${what} rc=${rc}`,
        this.takeLogs().filter((l) => l.level >= LV_LOG_WARN),
      );
    }
  }

  private newStr(s: string): number {
    return this.m.stringToNewUTF8(s);
  }

  /** 高频路径:字符串写进预分配 strBuf(超长降级 malloc);返回 [ptr, free|null] */
  private strIntoBuf(s: string): [number, (() => void) | null] {
    const mod = this.m;
    const need = mod.lengthBytesUTF8(s) + 1;
    if (need <= STR_BUF_CAP && this.strBuf) {
      mod.stringToUTF8(s, this.strBuf, STR_BUF_CAP);
      return [this.strBuf, null];
    }
    const p = mod.stringToNewUTF8(s);
    return [p, () => mod._free(p)];
  }

  /* ---------- 日志 / 事件订阅 ---------- */

  /** 取走并清空当前日志缓冲 */
  takeLogs(): LogLine[] {
    const l = this.logBuf;
    this.logBuf = [];
    return l;
  }

  onLog(cb: (level: number, msg: string) => void): () => void {
    this.logSubs.add(cb);
    return () => this.logSubs.delete(cb);
  }

  onEventStub(cb: (name: string, eventCode?: number, userData?: string) => void): () => void {
    this.stubSubs.add(cb);
    return () => this.stubSubs.delete(cb);
  }

  /* ---------- 画布 / 主循环 ---------- */

  setResolution(hor: number, ver: number): void {
    this.bridge('lvd_set_resolution')(hor, ver);
  }

  /** design: indev off + anim 暂停;play: 反之 */
  setMode(mode: RuntimeMode): void {
    const play = mode === 'play';
    this.bridge('lvd_set_interactive')(play ? 1 : 0);
    if (this.has('lvd_pause_anims')) this.bridge('lvd_pause_anims')(play ? 0 : 1);
  }

  tick(): number {
    return this.bridge('lvd_tick')();
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    const loop = (): void => {
      if (!this._running || !this.mod) return;
      try {
        this.bridge('lvd_tick')();
      } catch (e) {
        // 单次 tick 异常:停掉循环(否则一次异常会每帧刷屏)并经日志通道上报,
        // 不静默、不让整个渲染循环因一次异常永久黑屏。
        this._running = false;
        this.raf = 0;
        const msg = `lvd_tick 异常,已停止渲染循环:${(e as Error).message ?? String(e)}`;
        // 走 __lvLogSink(installHooks 已把它扇出到 logSubs 订阅者),
        // 无 sink 时兜底 console.error,总之不静默。
        const sink = this.mod?.__lvLogSink;
        if (sink) sink(LV_LOG_ERROR, msg);
        else console.error('[LvglRuntime]', msg, e);
        return;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this._running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  get running(): boolean {
    return this._running;
  }

  /** stop + 丢 Module 引用(emscripten 不支持干净重初始化,重建 = 重新 create) */
  destroy(): void {
    this.stop();
    const mod = this.mod;
    if (mod) {
      try {
        const deinit = mod['_lvd_deinit'];
        if (typeof deinit === 'function') (deinit as () => void)();
      } catch {
        /* optional */
      }
      mod.__lvLogSink = null;
      mod.__lvEventStub = null;
      // strBuf/rectBuf 不 free:整个堆随 Module 引用一起被 GC
    }
    this.mod = null;
    this.c = {};
    this.strBuf = 0;
    this.rectBuf = 0;
    this.logSubs.clear();
    this.stubSubs.clear();
  }

  /* ---------- 确定性 tick(e2e) ---------- */

  setManualTick(on: boolean): void {
    if (this.has('lvd_set_manual_tick')) this.bridge('lvd_set_manual_tick')(on ? 1 : 0);
  }

  advanceTick(ms: number): void {
    if (this.has('lvd_advance_tick')) this.bridge('lvd_advance_tick')(ms);
    else this.bridge('lvd_tick')(); // 降级:普通 tick
  }

  /* ---------- XML / 热重载 ---------- */

  registerComponent(name: string, xml: string): void {
    this.clearLog();
    this.check(this.bridge('lvd_register_component')(name, xml), `registerComponent(${name})`);
  }

  unregisterComponent(name: string): void {
    this.clearLog();
    this.check(this.bridge('lvd_unregister_component')(name), `unregisterComponent(${name})`);
  }

  reloadScreen(name: string, xml: string): void {
    this.clearLog();
    this.check(this.bridge('lvd_reload_screen')(name, xml), `reloadScreen(${name})`);
  }

  loadScreen(name: string): void {
    this.clearLog();
    this.check(this.bridge('lvd_load_screen')(name), `loadScreen(${name})`);
  }

  updateAttrs(name: string, widgetClass: string, attrs: Record<string, string>): void {
    this.clearLog();
    const p = packAttrs(this.m, attrs);
    try {
      this.check(this.bridge('lvd_update_attrs')(name, widgetClass, p.table), `updateAttrs(${name})`);
    } finally {
      p.free();
    }
  }

  createChild(parentName: string | null, widget: string, attrs: Record<string, string>): void {
    this.clearLog();
    const mod = this.m;
    const p = packAttrs(mod, attrs);
    const parentPtr = parentName ? this.newStr(parentName) : 0;
    try {
      this.check(this.bridge('lvd_create_child')(parentPtr, widget, p.table), `createChild(${widget})`);
    } finally {
      p.free();
      if (parentPtr) mod._free(parentPtr);
    }
  }

  deleteObj(name: string): void {
    this.clearLog();
    this.check(this.bridge('lvd_delete_obj')(name), `deleteObj(${name})`);
  }

  /**
   * L4 全工程重载。桥签名(m0 集成核对过 bridge.c:452):
   * lvd_reload_all(globals_xml, screen_names char**, screen_xmls char**, n)
   */
  reloadAll(globalsXml: string, screens: { name: string; xml: string }[]): void {
    this.clearLog();
    const mod = this.m;
    const gp = this.newStr(globalsXml);
    const pn = packStrArray(mod, screens.map((s) => s.name));
    const px = packStrArray(mod, screens.map((s) => s.xml));
    try {
      this.check(this.bridge('lvd_reload_all')(gp, pn.table, px.table, screens.length), 'reloadAll');
    } finally {
      pn.free();
      px.free();
      mod._free(gp);
    }
  }

  registerEventStub(cbName: string): void {
    this.clearLog();
    this.check(this.bridge('lvd_register_event_stub')(cbName), `registerEventStub(${cbName})`);
  }

  /**
   * 9.5 Preview Program 入口。执行器会先完整 preflight，
   * 不支持的能力不会造成半成品画面。
   */
  supportsPreviewProgram(): boolean {
    return PREVIEW_EXPORTS.every((name) => this.has(name));
  }

  loadPreviewProgram(program: PreviewProgram): void {
    this.clearLog();
    const call = (name: string, ...args: (number | string)[]): number =>
      this.bridge(name)(...args);
    const bridge: PreviewBridge = {
      begin: (version, width, height, colorFormat) =>
        call('lvd_preview_begin', version, width, height, colorFormat),
      createSubjectI32: (name, initial, min, hasMin, max, hasMax) =>
        call('lvd_preview_create_subject_i32', name, initial, min, Number(hasMin), max, Number(hasMax)),
      createSubjectFloat: (name, initial, min, hasMin, max, hasMax) =>
        call('lvd_preview_create_subject_float', name, initial, min, Number(hasMin), max, Number(hasMax)),
      createSubjectString: (name, initial, capacity) =>
        call('lvd_preview_create_subject_string', name, initial, capacity),
      createSubjectColor: (name, initial) =>
        call('lvd_preview_create_subject_color', name, initial),
      createStyle: (name) => call('lvd_preview_create_style', name),
      setNamedStyleI32: (name, key, value) =>
        call('lvd_preview_set_named_style_i32', name, key, value),
      setNamedStyleString: (name, key, value) =>
        call('lvd_preview_set_named_style_string', name, key, value),
      createScreen: (name) => call('lvd_preview_create_screen', name),
      createNode: (parent, name, type) => call('lvd_preview_create_node', parent, name, type),
      createStructural: (parent, name, type, arg) =>
        call('lvd_preview_create_structural', parent, name, type, arg),
      createListItem: (parent, name, type, icon, text) =>
        call('lvd_preview_create_list_item', parent, name, type, icon, text),
      setTableColumn: (parent, column, width) =>
        call('lvd_preview_set_table_column', parent, column, width),
      setTableCellValue: (parent, row, column, value) =>
        call('lvd_preview_set_table_cell_value', parent, row, column, value),
      setTableCellCtrl: (parent, row, column, ctrl) =>
        call('lvd_preview_set_table_cell_ctrl', parent, row, column, ctrl),
      setI32: (name, key, value) => call('lvd_preview_set_i32', name, key, value),
      setString: (name, key, value) => call('lvd_preview_set_string', name, key, value),
      setPointList: (name, key, value) => call('lvd_preview_set_point_list', name, key, value),
      setStringList: (name, key, value) => call('lvd_preview_set_string_list', name, key, value),
      setI32List: (name, key, value) => call('lvd_preview_set_i32_list', name, key, value),
      setChartAxis: (parent, axis, key, value) =>
        call('lvd_preview_set_chart_axis', parent, axis, key, value),
      setFlag: (name, flag, enabled) => call('lvd_preview_set_flag', name, flag, enabled ? 1 : 0),
      setState: (name, state, enabled) => call('lvd_preview_set_state', name, state, enabled ? 1 : 0),
      setStyleI32: (name, key, value, part, states) =>
        call('lvd_preview_set_style_i32', name, key, value, part, states),
      setStyleString: (name, key, value, part, states) =>
        call('lvd_preview_set_style_string', name, key, value, part, states),
      addStyle: (name, styleName, part, states) =>
        call('lvd_preview_add_style', name, styleName, part, states),
      bindProp: (name, prop, subjectName, format) =>
        call('lvd_preview_bind_prop', name, prop, subjectName, format),
      bindFlag: (name, flag, op, subjectName, refValue) =>
        call('lvd_preview_bind_flag', name, flag, op, subjectName, refValue),
      bindState: (name, state, op, subjectName, refValue) =>
        call('lvd_preview_bind_state', name, state, op, subjectName, refValue),
      addCallbackEvent: (name, trigger, callback, userData, hasUserData) =>
        call('lvd_preview_add_callback_event', name, trigger, callback, userData, Number(hasUserData)),
      addSubjectSetEvent: (name, trigger, subjectName, subjectType, value) =>
        call('lvd_preview_add_subject_set_event', name, trigger, subjectName, subjectType, value),
      addSubjectToggleEvent: (name, trigger, subjectName) =>
        call('lvd_preview_add_subject_toggle_event', name, trigger, subjectName),
      addSubjectIncrementEvent: (
        name, trigger, subjectName, step, min, hasMin, max, hasMax, rollover, hasRollover,
      ) => call(
        'lvd_preview_add_subject_increment_event', name, trigger, subjectName, step,
        min, Number(hasMin), max, Number(hasMax), Number(rollover), Number(hasRollover),
      ),
      addScreenEvent: (name, trigger, action, screenName, animType, duration, delay) =>
        call('lvd_preview_add_screen_event', name, trigger, action, screenName, animType, duration, delay),
      finish: (home) => call('lvd_preview_finish', home),
    };
    executePreviewProgram(program, bridge, (rc, op) => this.check(rc, op));
  }

  /* ---------- 资产 ---------- */

  writeFile(path: string, bytes: Uint8Array): void {
    const FS = this.m.FS;
    const dir = path.slice(0, path.lastIndexOf('/')) || '/';
    let cur = '';
    for (const seg of dir.split('/').filter(Boolean)) {
      cur += '/' + seg;
      try {
        FS.mkdir(cur);
      } catch {
        /* exists */
      }
    }
    FS.writeFile(path, bytes);
  }

  /**
   * 注册图片。
   * - source 为 Uint8Array:写入 MEMFS '/assets/<name>'(name 需带扩展名,解码器按后缀分发),
   *   注册 src 'A:assets/<name>'(FS_STDIO letter 'A' ↔ '/…',m0 T7 实测)。
   * - source 为 string:视作现成 memfs src 路径(如 'A:assets/x.png'),文件须已 writeFile。
   */
  registerImage(name: string, source: Uint8Array | string): void {
    this.clearLog();
    let src: string;
    if (typeof source === 'string') {
      src = source;
    } else {
      this.writeFile(`/assets/${name}`, source);
      src = `A:assets/${name}`;
    }
    this.check(this.bridge('lvd_register_image')(name, src), `registerImage(${name})`);
  }

  /** src = 注册时的 memfs 路径(如 'A:assets/x.png') */
  dropImageCache(src: string): void {
    this.clearLog();
    this.bridge('lvd_drop_image_cache')(src);
  }

  registerFontTinyTtf(name: string, bytes: Uint8Array, sizePx: number): void {
    this.clearLog();
    const mod = this.m;
    const p = mod._malloc(bytes.length);
    mod.HEAPU8.set(bytes, p);
    // data 由 C 侧持有(design/02 §2.9),JS 不 free
    this.check(
      this.bridge('lvd_register_font_tiny_ttf')(name, p, bytes.length, sizePx),
      `registerFontTinyTtf(${name})`,
    );
  }

  /* ---------- 几何 / 命中(高频,预分配缓冲,不 malloc) ---------- */

  hitTest(x: number, y: number): string | null {
    const ptr = this.bridge('lvd_obj_at_point')(x, y);
    // 静态缓冲,下一次桥调用前有效 → 立即拷成 JS string
    return ptr ? this.m.UTF8ToString(ptr) : null;
  }

  getObjRect(name: string, transformed = false): LvdRect | null {
    const mod = this.m;
    const out = this.rectBuf || mod._malloc(16);
    try {
      const rc = this.bridge('lvd_get_obj_rect')(name, out, transformed ? 1 : 0);
      if (rc !== 0) return null;
      const h = mod.HEAP32;
      const i = out >> 2;
      return { x: h[i]!, y: h[i + 1]!, w: h[i + 2]!, h: h[i + 3]! };
    } finally {
      if (out !== this.rectBuf) mod._free(out);
    }
  }

  getObjRects(names: string[]): Map<string, LvdRect> {
    const mod = this.m;
    const map = new Map<string, LvdRect>();
    if (names.length === 0) return map;
    const usePrealloc = names.length <= RECT_BUF_RECTS && this.rectBuf !== 0;
    const out = usePrealloc ? this.rectBuf : mod._malloc(16 * names.length);
    const [joined, freeJoined] = this.strIntoBuf(names.join('\n'));
    try {
      // bridge 按输入顺序逐槽写 4 个 int32;缺失对象写 w=h=-1 但仍占槽位。
      // 返回值是命中计数,不能当循环上界(否则某控件缺失会截断丢掉其后所有 rect)。
      this.bridge('lvd_get_obj_rects')(joined, out);
      const h = mod.HEAP32;
      for (let k = 0; k < names.length; k++) {
        const i = (out >> 2) + k * 4;
        const w = h[i + 2]!;
        const ht = h[i + 3]!;
        if (w < 0 || ht < 0) continue; // 缺失对象:跳过,不进 map
        map.set(names[k]!, { x: h[i]!, y: h[i + 1]!, w, h: ht });
      }
      return map;
    } finally {
      if (!usePrealloc) mod._free(out);
      freeJoined?.();
    }
  }

  dumpTree(): unknown {
    const mod = this.m;
    const cap = 1 << 20;
    const buf = mod._malloc(cap);
    try {
      const n = this.bridge('lvd_dump_tree')(buf, cap);
      if (n < 0) throw new LvglError(`dumpTree rc=${n}`);
      return JSON.parse(mod.UTF8ToString(buf, n));
    } finally {
      mod._free(buf);
    }
  }

  /* ---------- 截图 ---------- */

  /** BGRA→RGBA 交换后的像素;meta = int32[3]{w,h,stride}(m0 定案) */
  snapshot(screenName?: string): ImageData {
    this.clearLog();
    const mod = this.m;
    const meta = mod._malloc(12);
    const namePtr = screenName ? this.newStr(screenName) : 0;
    try {
      const ptr = this.bridge('lvd_snapshot')(namePtr, meta);
      if (!ptr) {
        throw new LvglError(`snapshot(${screenName ?? '<active>'}) returned NULL`, this.takeLogs());
      }
      const mi = meta >> 2;
      const w = mod.HEAP32[mi]!;
      const h = mod.HEAP32[mi + 1]!;
      const stride = mod.HEAP32[mi + 2]!;
      const out = bgraToRgba(mod.HEAPU8, ptr, w, h, stride);
      this.bridge('lvd_snapshot_free')();
      return new ImageData(out, w, h);
    } finally {
      mod._free(meta);
      if (namePtr) mod._free(namePtr);
    }
  }
}
