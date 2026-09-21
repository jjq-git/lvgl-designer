/**
 * m0/runtime-wrapper.mjs — 最小 LvglRuntime 包装(M0 测试台专用,无框架)
 *
 * 契约来源:docs/design/02 §3.1 LvglRuntime + ARCHITECTURE §3.3 桥函数总表。
 * WASM 未就绪阶段按契约先行编写;集成阶段对表修正(见文件尾 BRIDGE_ASSUMPTIONS)。
 */

const RUNTIME_MJS = '/packages/lvgl-runtime/dist/lvgl_runtime.mjs';
const RUNTIME_WASM = '/packages/lvgl-runtime/dist/lvgl_runtime.wasm';

export const LV_LOG_WARN = 2; // lvgl: TRACE0 INFO1 WARN2 ERROR3 USER4

export class LvglError extends Error {
  /** @param {string} message @param {{level:number,msg:string}[]} logLines */
  constructor(message, logLines = []) {
    const tail = logLines.length
      ? '\n' + logLines.map(l => `  [lv:${l.level}] ${l.msg}`).join('\n')
      : '';
    super(message + tail);
    this.name = 'LvglError';
    this.logLines = logLines;
  }
}

/** sha256 hex of a Uint8Array / ArrayBuffer */
export async function sha256Hex(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** sha256 hex of an ImageData's pixel bytes */
export async function imageDataHash(imgData) {
  return sha256Hex(new Uint8Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength));
}

/* cwrap 签名表:name -> [ret, args];'str' = cwrap 自动封送(恒非空),
 * 'number' = 指针/整型手动管理(可空指针、char**、out 缓冲) */
const SIGS = {
  lvd_init:                 ['number', ['number', 'number']],
  lvd_tick:                 ['number', []],
  lvd_set_resolution:       [null,     ['number', 'number']],
  lvd_register_component:   ['number', ['string', 'string']],
  lvd_unregister_component: ['number', ['string']],
  lvd_reload_screen:        ['number', ['string', 'string']],
  lvd_create_child:         ['number', ['number', 'string', 'number']], // parent 可空 → 手动指针
  lvd_delete_obj:           ['number', ['string']],
  lvd_update_attrs:         ['number', ['string', 'string', 'number']], // attrs = char**
  lvd_obj_at_point:         ['number', ['number', 'number']],           // 返回 char*(静态缓冲)
  lvd_get_obj_rect:         ['number', ['string', 'number', 'number']], // out = int32[4]
  lvd_get_obj_rects:        ['number', ['string', 'number']],
  lvd_dump_tree:            ['number', ['number', 'number']],
  lvd_snapshot:             ['number', ['number', 'number']],           // name 可空 → 手动指针
  lvd_snapshot_free:        [null,     []],
  lvd_set_interactive:      [null,     ['number']],
  lvd_pause_anims:          [null,     ['number']],
  lvd_register_image:       ['number', ['string', 'string']],
  lvd_register_font_tiny_ttf: ['number', ['string', 'number', 'number', 'number']],
  lvd_set_asset_prefix:     [null,     ['string']],
  lvd_reload_all:           ['number', ['number', 'number', 'number', 'number']], // (globals_xml, names char**, xmls char**, n)
  lvd_register_event_stub:  ['number', ['string']],
  lvd_load_screen:          ['number', ['string']],
  lvd_drop_image_cache:     ['number', ['string']],
  lvd_set_manual_tick:      [null,     ['number']],
  lvd_advance_tick:         [null,     ['number']],
};

export class LvglRuntime {
  /** @type {import('emscripten').Module|any} */
  mod = null;
  c = {};                 // cwrap 后的 lvd_* 集合
  missingExports = [];    // 集成对表用:wasm 里缺哪些导出
  eventStubCalls = [];    // Module.__lvEventStub 收到的回调名
  #logBuf = [];           // Module.__lvLogSink 聚合
  #logSubs = new Set();
  #running = false;
  #raf = 0;

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number} hor @param {number} ver
   */
  static async create(canvas, hor = 240, ver = 240) {
    const { default: createLvglRuntime } = await import(RUNTIME_MJS);
    const mod = await createLvglRuntime({
      canvas,
      locateFile: (p) => (p.endsWith('.wasm') ? RUNTIME_WASM : p),
    });
    const rt = new LvglRuntime();
    rt.mod = mod;
    // SDL2 port 在 SDL_CreateWindow(lvd_init 内)把鼠标监听挂到写死的选择器
    // "#canvas"(document.querySelector);把它映射到真实 canvas,id 任意。
    if (mod.specialHTMLTargets) mod.specialHTMLTargets['#canvas'] = canvas;
    rt.#installHooks();
    rt.#wrapAll();
    rt.#clearLog();
    const rc = rt.c.lvd_init(hor, ver);
    if (rc !== 0) throw new LvglError(`lvd_init(${hor},${ver}) rc=${rc}`, rt.takeLogs());
    return rt;
  }

  #installHooks() {
    const mod = this.mod;
    mod.__lvLogSink = (level, msg) => {
      const m = typeof msg === 'number' ? mod.UTF8ToString(msg) : String(msg);
      const entry = { level: Number(level), msg: m };
      this.#logBuf.push(entry);
      for (const cb of this.#logSubs) { try { cb(entry.level, entry.msg); } catch { /* noop */ } }
    };
    // 事件打桩上报:bridge EM_JS 可能传 JS string 或 char*(集成时二选一)
    mod.__lvEventStub = (name) => {
      const n = typeof name === 'number' ? mod.UTF8ToString(name) : String(name);
      this.eventStubCalls.push(n);
    };
  }

  #wrapAll() {
    for (const [name, [ret, args]] of Object.entries(SIGS)) {
      if (typeof this.mod['_' + name] === 'function') {
        this.c[name] = this.mod.cwrap(name, ret, args);
      } else {
        this.missingExports.push(name);
        this.c[name] = () => { throw new LvglError(`bridge export missing: ${name}`); };
      }
    }
  }

  has(name) { return !this.missingExports.includes(name); }

  /* ---------- 日志 ---------- */
  #clearLog() { this.#logBuf = []; }
  /** 取走并清空当前日志缓冲 */
  takeLogs() { const l = this.#logBuf; this.#logBuf = []; return l; }
  onLog(cb) { this.#logSubs.add(cb); return () => this.#logSubs.delete(cb); }
  #check(rc, what) {
    if (rc !== 0) throw new LvglError(`${what} rc=${rc}`, this.takeLogs().filter(l => l.level >= LV_LOG_WARN));
  }

  /* ---------- 字符串/char** 打包(design/02 §3.2) ---------- */
  #newStr(s) { return this.mod.stringToNewUTF8(s); }
  /** 扁平字符串数组 → NULL 结尾 char**;返回 {table, free} */
  packStrArray(list) {
    const mod = this.mod;
    const ptrs = list.map(s => this.#newStr(String(s)));
    const table = mod._malloc((ptrs.length + 2) * 4);
    for (let i = 0; i < ptrs.length; i++) mod.HEAP32[(table >> 2) + i] = ptrs[i];
    mod.HEAP32[(table >> 2) + ptrs.length] = 0;
    mod.HEAP32[(table >> 2) + ptrs.length + 1] = 0;
    return { table, free: () => { ptrs.forEach(p => mod._free(p)); mod._free(table); } };
  }
  /** Record<string,string> → k,v 交替 char**(attrs 不得含 name 键,§5.3 不变式 3) */
  packAttrs(attrs) {
    const flat = [];
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'name') throw new LvglError('attrs must not contain "name" key');
      flat.push(k, String(v));
    }
    return this.packStrArray(flat);
  }

  /* ---------- 画布 / 主循环 ---------- */
  setResolution(hor, ver) { this.c.lvd_set_resolution(hor, ver); }
  /** @param {'design'|'play'} mode */
  setMode(mode) {
    const play = mode === 'play';
    this.c.lvd_set_interactive(play ? 1 : 0);
    if (this.has('lvd_pause_anims')) this.c.lvd_pause_anims(play ? 0 : 1);
  }
  tick() { return this.c.lvd_tick(); }
  start() {
    if (this.#running) return;
    this.#running = true;
    const loop = () => {
      if (!this.#running || !this.mod) return;
      this.c.lvd_tick();
      this.#raf = requestAnimationFrame(loop);
    };
    this.#raf = requestAnimationFrame(loop);
  }
  stop() { this.#running = false; if (this.#raf) cancelAnimationFrame(this.#raf); this.#raf = 0; }
  get running() { return this.#running; }
  /** stop + 丢 Module 引用(emscripten 不支持干净重初始化,重建 = 重新 create) */
  destroy() {
    this.stop();
    if (this.mod) {
      try { if (typeof this.mod._lvd_deinit === 'function') this.mod._lvd_deinit(); } catch { /* optional */ }
      this.mod.__lvLogSink = null;
      this.mod.__lvEventStub = null;
    }
    this.mod = null;
    this.c = {};
  }

  /* ---------- 确定性 tick(e2e) ---------- */
  setManualTick(on) { if (this.has('lvd_set_manual_tick')) this.c.lvd_set_manual_tick(on ? 1 : 0); }
  advanceTick(ms) {
    if (this.has('lvd_advance_tick')) this.c.lvd_advance_tick(ms);
    else this.c.lvd_tick(); // 降级:普通 tick
  }

  /* ---------- XML / 热重载 ---------- */
  registerComponent(name, xml) { this.#clearLog(); this.#check(this.c.lvd_register_component(name, xml), `registerComponent(${name})`); }
  unregisterComponent(name) { this.#clearLog(); this.#check(this.c.lvd_unregister_component(name), `unregisterComponent(${name})`); }
  reloadScreen(name, xml) { this.#clearLog(); this.#check(this.c.lvd_reload_screen(name, xml), `reloadScreen(${name})`); }
  loadScreen(name) { this.#clearLog(); this.#check(this.c.lvd_load_screen(name), `loadScreen(${name})`); }
  updateAttrs(name, widgetClass, attrs) {
    this.#clearLog();
    const p = this.packAttrs(attrs);
    try { this.#check(this.c.lvd_update_attrs(name, widgetClass, p.table), `updateAttrs(${name})`); }
    finally { p.free(); }
  }
  createChild(parentName, widget, attrs) {
    this.#clearLog();
    const p = this.packAttrs(attrs);
    const parentPtr = parentName ? this.#newStr(parentName) : 0;
    try { this.#check(this.c.lvd_create_child(parentPtr, widget, p.table), `createChild(${widget})`); }
    finally { p.free(); if (parentPtr) this.mod._free(parentPtr); }
  }
  deleteObj(name) { this.#clearLog(); this.#check(this.c.lvd_delete_obj(name), `deleteObj(${name})`); }
  /**
   * L4 全工程重载。实际桥签名(集成核对过 bridge.c:452):
   * lvd_reload_all(globals_xml, screen_names char**, screen_xmls char**, n)。
   * @param {string} globalsXml @param {{name:string, xml:string}[]} screens
   */
  reloadAll(globalsXml, screens) {
    this.#clearLog();
    const gp = this.#newStr(globalsXml);
    const pn = this.packStrArray(screens.map(s => s.name));
    const px = this.packStrArray(screens.map(s => s.xml));
    try { this.#check(this.c.lvd_reload_all(gp, pn.table, px.table, screens.length), 'reloadAll'); }
    finally { pn.free(); px.free(); this.mod._free(gp); }
  }
  registerEventStub(cbName) { this.#clearLog(); this.#check(this.c.lvd_register_event_stub(cbName), `registerEventStub(${cbName})`); }

  /* ---------- 资产 ---------- */
  writeFile(path, bytes) {
    const FS = this.mod.FS;
    const dir = path.slice(0, path.lastIndexOf('/')) || '/';
    const parts = dir.split('/').filter(Boolean);
    let cur = '';
    for (const seg of parts) {
      cur += '/' + seg;
      try { FS.mkdir(cur); } catch { /* exists */ }
    }
    FS.writeFile(path, bytes);
  }
  /** memfsPath 形如 'A:assets/x.png'(LVGL 侧路径,FS.writeFile 用 '/assets/x.png') */
  registerImage(name, memfsPath) { this.#clearLog(); this.#check(this.c.lvd_register_image(name, memfsPath), `registerImage(${name})`); }
  dropImageCache(src) { this.#clearLog(); this.c.lvd_drop_image_cache(src); } // void 返回(bridge.c:368)
  registerFontTinyTtf(name, bytes, sizePx) {
    this.#clearLog();
    const p = this.mod._malloc(bytes.length);
    this.mod.HEAPU8.set(bytes, p);
    // data 由 C 侧持有(design/02 §2.9),JS 不 free
    this.#check(this.c.lvd_register_font_tiny_ttf(name, p, bytes.length, sizePx), `registerFontTinyTtf(${name})`);
  }

  /* ---------- 几何 / 命中 ---------- */
  hitTest(x, y) {
    const ptr = this.c.lvd_obj_at_point(x, y);
    return ptr ? this.mod.UTF8ToString(ptr) : null; // 静态缓冲,立即拷成 JS string
  }
  getObjRect(name, transformed = false) {
    const out = this.mod._malloc(16);
    try {
      const rc = this.c.lvd_get_obj_rect(name, out, transformed ? 1 : 0);
      if (rc !== 0) return null;
      const i = out >> 2;
      const h = this.mod.HEAP32;
      return { x: h[i], y: h[i + 1], w: h[i + 2], h: h[i + 3] };
    } finally { this.mod._free(out); }
  }
  getObjRects(names) {
    const out = this.mod._malloc(16 * names.length);
    const joined = this.#newStr(names.join('\n'));
    const map = new Map();
    try {
      const n = this.c.lvd_get_obj_rects(joined, out);
      const h = this.mod.HEAP32;
      for (let k = 0; k < Math.min(n, names.length); k++) {
        const i = (out >> 2) + k * 4;
        map.set(names[k], { x: h[i], y: h[i + 1], w: h[i + 2], h: h[i + 3] });
      }
      return map;
    } finally { this.mod._free(out); this.mod._free(joined); }
  }
  dumpTree() {
    const cap = 1 << 20;
    const buf = this.mod._malloc(cap);
    try {
      const n = this.c.lvd_dump_tree(buf, cap);
      if (n < 0) throw new LvglError(`dumpTree rc=${n}`);
      return JSON.parse(this.mod.UTF8ToString(buf, n));
    } finally { this.mod._free(buf); }
  }

  /* ---------- 截图 ---------- */
  /** @returns {ImageData} BGRA→RGBA 交换后的像素 */
  snapshot(screenName) {
    this.#clearLog();
    const mod = this.mod;
    const meta = mod._malloc(12);
    const namePtr = screenName ? this.#newStr(screenName) : 0;
    try {
      const ptr = this.c.lvd_snapshot(namePtr, meta);
      if (!ptr) throw new LvglError(`snapshot(${screenName || '<active>'}) returned NULL`, this.takeLogs());
      const mi = meta >> 2;
      const w = mod.HEAP32[mi], h = mod.HEAP32[mi + 1], stride = mod.HEAP32[mi + 2];
      const out = new Uint8ClampedArray(w * h * 4);
      const heap = mod.HEAPU8;
      for (let y = 0; y < h; y++) {
        const src = ptr + y * stride;
        const dst = y * w * 4;
        for (let x = 0; x < w; x++) {
          const s = src + x * 4, d = dst + x * 4;
          out[d]     = heap[s + 2]; // R ← B 位
          out[d + 1] = heap[s + 1]; // G
          out[d + 2] = heap[s];     // B ← R 位
          out[d + 3] = 255;         // 预乘 alpha 不还原,截图当不透明用
        }
      }
      this.c.lvd_snapshot_free();
      return new ImageData(out, w, h);
    } finally { mod._free(meta); if (namePtr) mod._free(namePtr); }
  }
}

/**
 * BRIDGE_ASSUMPTIONS — 集成阶段逐条核对:
 * 1. 工厂:default export = createLvglRuntime({canvas, locateFile}),双文件产物路径见文件头常量。
 * 2. lvd_reload_all(globals_xml, screens, n):screens 为 [name,xml,...] 交替 NULL 结尾 char**。
 * 3. Module.__lvEventStub(cb_name):EM_JS 上报,参数 JS string 或 char* 均兼容。
 * 4. Module.__lvLogSink(level, msg):msg 为 JS string(EM_JS 已 UTF8ToString)或 char* 均兼容。
 * 5. lvd_snapshot meta_out = int32[3]{w,h,stride},像素 ARGB8888 小端字节序 = B,G,R,A。
 * 6. lvd_get_obj_rects:names '\n' 分隔,out 每对象 int32[4],返回成功个数。
 * 7. lvd_drop_image_cache(src):src = 注册时的 memfs 路径字符串(如 'A:assets/t7.png')。
 * 8. lvd_advance_tick(ms) 需配合 lvd_set_manual_tick(1);无该导出时降级为 lvd_tick。
 * 9. lvd_deinit 不在桥表中;destroy = stop + 丢引用(若集成后新增则自动调用)。
 * 10. attrs char** 布局:k,v 交替、双 NULL 结尾(多留一个 slot 兼容成对判空写法)。
 */
