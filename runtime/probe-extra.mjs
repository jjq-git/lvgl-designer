/**
 * runtime/probe-extra.mjs — browser smoke test for the 13 self-written XML
 * widget parsers (xml_parsers_extra/). For each widget: register+create a
 * screen containing it via lvd_reload_screen, advance virtual time, snapshot,
 * and require (a) rc==0, (b) no LVGL error log lines, (c) the snapshot is not
 * a single flat color.
 *
 * Usage: node runtime/probe-extra.mjs
 * Serves the repo root with deploy/serve.mjs on a temp port; cleans up the
 * temp HTML page and kills the server afterwards. Exit code 0 = 13/13 pass.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(RUNTIME_DIR);
const PORT = 8399;
const TMP_HTML = path.join(ROOT, '.probe-extra.tmp.html');

/* ---------- tiny solid-color PNG generator (16x16 truecolor) ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function solidPng(r, g, b, w = 16, h = 16) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; /* 8-bit truecolor */
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* minimal handwritten lottie: red 20x20 square moving over 2 keyframes */
const LOTTIE_JSON = JSON.stringify({
  v: '5.5.7', fr: 60, ip: 0, op: 60, w: 64, h: 64, layers: [{
    ddd: 0, ind: 1, ty: 4, ip: 0, op: 60, st: 0,
    ks: {
      o: { a: 0, k: 100 }, r: { a: 0, k: 0 },
      p: { a: 1, k: [{ t: 0, s: [12, 32], e: [52, 32], i: { x: 0.5, y: 0.5 }, o: { x: 0.5, y: 0.5 } }, { t: 60, s: [52, 32] }] },
      a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] },
    },
    shapes: [
      { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [20, 20] }, r: { a: 0, k: 0 } },
      { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
    ],
  }],
});

/* ---------- the 13 test cases ---------- */
const V = (inner) => `<component><view extends="lv_obj" width="300" height="300">${inner}</view></component>`;
const TESTS = [
  ['led', V('<lv_led x="20" y="20" color="0xff0000" brightness="255"/>')],
  ['line', V('<lv_line x="10" y="10" points="0,80 60,10 120,60 180,5" y_invert="false"/>')],
  ['spinner', V('<lv_spinner x="20" y="20" width="90" height="90" anim_duration="800" angle="200"/>')],
  ['imagebutton', V('<lv_imagebutton x="20" y="20" width="64" height="16" src_released_mid="img_red" src_pressed_mid="img_green" state="released"/>')],
  ['animimage', V('<lv_animimage x="20" y="20" width="16" height="16" srcs="img_red img_green" duration="400" repeat_count="infinite"/>')],
  ['msgbox', V('<lv_msgbox width="240" title="Title" text="Hello body" close_button="true"><lv_msgbox-button text="OK"/></lv_msgbox>')],
  ['list', V('<lv_list width="220" height="220"><lv_list-text text="Section"/><lv_list-button icon="img_red" text="Item 1"/><lv_list-button text="Item 2"/></lv_list>')],
  ['menu', V('<lv_menu width="280" height="280" mode_root_back_button="disabled"><lv_menu-page title="Page 1"><lv_label text="menu content"/></lv_menu-page></lv_menu>')],
  ['win', V('<lv_win width="280" height="200" title="Window Title"><lv_win-button icon="img_red" width="40"/></lv_win>')],
  ['tileview', V('<lv_tileview width="280" height="280"><lv_tileview-tile col="0" row="0" dir="all"><lv_label text="tile 0,0" align="center"/></lv_tileview-tile></lv_tileview>')],
  ['arclabel', V('<lv_arclabel x="30" y="30" width="220" height="220" text="Curved text goes around" radius="90" angle_start="0" angle_size="360" dir="clockwise" text_horizontal_align="center"/>')],
  ['canvas', V('<lv_canvas x="20" y="20" width="120" height="80" fill_color="0x00c040"/>')],
  ['lottie', V('<lv_lottie x="40" y="40" width="64" height="64" src="anim_json"/>')],
];

/* ---------- harness ---------- */
writeFileSync(TMP_HTML, '<!DOCTYPE html><html><body style="background:#111">'
  + '<canvas id="canvas" width="300" height="300"></canvas></body></html>');

const server = spawn(process.execPath, [path.join(ROOT, 'deploy/serve.mjs'), String(PORT), ROOT],
                     { stdio: ['ignore', 'pipe', 'pipe'] });

async function waitPort(url, timeoutMs = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('server not up: ' + url);
}

let browser, exitCode = 1;
try {
  const url = `http://localhost:${PORT}/.probe-extra.tmp.html`;
  await waitPort(url);
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('[pageerror]', e.message));
  await page.goto(url, { waitUntil: 'load' });

  const results = await page.evaluate(async (cfg) => {
    const logs = [];
    const { default: createLvglRuntime } = await import(location.origin + '/packages/lvgl-runtime/dist/lvgl_runtime.mjs');
    const canvas = document.getElementById('canvas');
    const mod = await createLvglRuntime({
      canvas,
      locateFile: p => p.endsWith('.wasm') ? '/packages/lvgl-runtime/dist/lvgl_runtime.wasm' : p,
    });
    if (mod.specialHTMLTargets) mod.specialHTMLTargets['#canvas'] = canvas;
    mod.__lvLogSink = (level, msg) => {
      logs.push({ level: Number(level), msg: typeof msg === 'number' ? mod.UTF8ToString(msg) : String(msg) });
    };
    const c = {
      init:     mod.cwrap('lvd_init', 'number', ['number', 'number']),
      reload:   mod.cwrap('lvd_reload_screen', 'number', ['string', 'string']),
      regimg:   mod.cwrap('lvd_register_image', 'number', ['string', 'string']),
      snap:     mod.cwrap('lvd_snapshot', 'number', ['number', 'number']),
      snapfree: mod.cwrap('lvd_snapshot_free', null, []),
      manual:   mod.cwrap('lvd_set_manual_tick', null, ['number']),
      adv:      mod.cwrap('lvd_advance_tick', 'number', ['number']),
    };
    if (c.init(300, 300) !== 0) throw new Error('lvd_init failed');
    c.manual(1);

    const b64 = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
    mod.FS.mkdir('/assets');
    mod.FS.writeFile('/assets/red.png', b64(cfg.redPng));
    mod.FS.writeFile('/assets/green.png', b64(cfg.greenPng));
    mod.FS.writeFile('/assets/anim.json', new TextEncoder().encode(cfg.lottieJson));
    c.regimg('img_red', 'A:assets/red.png');
    c.regimg('img_green', 'A:assets/green.png');
    c.regimg('anim_json', 'A:assets/anim.json');

    const takeSnap = () => {
      const meta = mod._malloc(12);
      const ptr = c.snap(0, meta);
      if (!ptr) { mod._free(meta); return null; }
      const w = mod.HEAP32[meta >> 2], h = mod.HEAP32[(meta >> 2) + 1], stride = mod.HEAP32[(meta >> 2) + 2];
      const pix = mod.HEAPU8.slice(ptr, ptr + stride * h);
      c.snapfree(); mod._free(meta);
      const colors = new Set();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = y * stride + x * 4;   /* ARGB8888 little-endian = B,G,R,A bytes */
          colors.add((pix[o + 2] << 16) | (pix[o + 1] << 8) | pix[o]);
        }
      }
      const sample = colors.size <= 8
        ? [...colors].map(v => '#' + v.toString(16).padStart(6, '0')).join(',')
        : '';
      return { w, h, unique: colors.size, sample };
    };

    const out = [];
    for (const [name, xml] of cfg.tests) {
      const logMark = logs.length;
      let rc = -99, snap = null, err = '';
      try {
        rc = c.reload('scr_' + name, xml);
        for (let i = 0; i < 40; i++) c.adv(16);   /* ~0.64 s of anim time */
        snap = takeSnap();
      } catch (e) {
        err = String(e && e.message || e);
      }
      const lvErrors = logs.slice(logMark).filter(l => l.level >= 3).map(l => l.msg);
      const pass = rc === 0 && !err && snap != null && snap.unique > 1 && lvErrors.length === 0;
      out.push({
        name, pass, rc,
        unique: snap ? snap.unique : -1,
        sample: snap ? snap.sample : '',
        detail: [err, ...lvErrors].filter(Boolean).join(' | ').slice(0, 300),
        warns: logs.slice(logMark).filter(l => l.level === 2).map(l => l.msg).slice(0, 4),
      });
    }

    /* extra: reload + L1-update stress for the parser-owned-buffer widgets
     * (line points array, animimg dsc array, canvas/lottie draw buf):
     * re-registering the same screen deletes the old instance (delete cbs
     * fire) and lvd_update_attrs re-applies on a live widget, exercising the
     * free-old-then-replace paths. */
    {
      const logMark = logs.length;
      let err = '';
      try {
        const updC = mod.cwrap('lvd_update_attrs', 'number', ['string', 'string', 'number']);
        const upd = (objName, cls, kv) => {
          const ptrs = kv.map(s => mod.stringToNewUTF8(s));
          ptrs.push(0);
          const arr = mod._malloc(ptrs.length * 4);
          ptrs.forEach((p, i) => { mod.HEAP32[(arr >> 2) + i] = p; });
          const rc = updC(objName, cls, arr);
          ptrs.forEach(p => p && mod._free(p));
          mod._free(arr);
          return rc;
        };
        const stressXml = '<component><view extends="lv_obj" width="300" height="300">'
          + '<lv_line name="w_line" points="0,50 40,0 80,50"/>'
          + '<lv_animimage name="w_anim" x="100" y="10" width="16" height="16" srcs="img_red img_green" duration="300"/>'
          + '<lv_canvas name="w_canvas" x="20" y="80" width="100" height="60" fill_color="0x00c040"/>'
          + '<lv_lottie name="w_lottie" x="150" y="80" width="64" height="64" src="anim_json"/>'
          + '</view></component>';
        for (let round = 0; round < 2; round++) {   /* round 2 deletes round 1's instances */
          if (c.reload('scr_stress', stressXml) !== 0) err += `stress reload#${round} failed; `;
          for (let i = 0; i < 10; i++) c.adv(16);
        }
        if (upd('w_line', 'lv_line', ['points', '0,10 90,10 0,60 90,60']) !== 0) err += 'line update failed; ';
        if (upd('w_anim', 'lv_animimage', ['srcs', 'img_green img_red', 'duration', '200']) !== 0) err += 'animimage update failed; ';
        if (upd('w_canvas', 'lv_canvas', ['fill_color', '0x2040ff']) !== 0) err += 'canvas refill failed; ';
        if (upd('w_canvas', 'lv_canvas', ['width', '140', 'height', '90', 'fill_color', '0xff8000']) !== 0) err += 'canvas resize failed; ';
        if (upd('w_lottie', 'lv_lottie', ['width', '80', 'height', '80', 'src', 'anim_json']) !== 0) err += 'lottie resize failed; ';
        for (let i = 0; i < 20; i++) c.adv(16);
        const s = takeSnap();
        if (!s || s.unique <= 1) err += 'stress snapshot flat; ';
      } catch (e) { err = String(e && e.message || e); }
      const lvErrors = logs.slice(logMark).filter(l => l.level >= 3).map(l => l.msg);
      out.push({
        name: 'reload-stress', pass: !err && lvErrors.length === 0, rc: 0, unique: 0, sample: '',
        detail: [err, ...lvErrors].filter(Boolean).join(' | ').slice(0, 300), warns: [],
      });
    }
    return out;
  }, { tests: TESTS, redPng: solidPng(220, 30, 30).toString('base64'), greenPng: solidPng(30, 200, 60).toString('base64'), lottieJson: LOTTIE_JSON });

  let passed = 0;
  for (const r of results) {
    if (r.pass) passed++;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(12)} rc=${r.rc} uniqueColors=${r.unique}`
      + (r.sample ? ` (${r.sample})` : '')
      + (r.detail ? `  !! ${r.detail}` : '')
      + (r.warns.length ? `  [warn] ${r.warns.join(' | ')}` : ''));
  }
  console.log(`probe-extra: ${passed}/${results.length} passed`);
  exitCode = passed === results.length ? 0 : 1;
} catch (e) {
  console.error('probe fatal:', e);
} finally {
  try { await browser?.close(); } catch { /* noop */ }
  server.kill();
  rmSync(TMP_HTML, { force: true });
}
process.exit(exitCode);
