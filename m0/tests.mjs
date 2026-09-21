/**
 * m0/tests.mjs — M0 技术验证 T1~T8(ARCHITECTURE §5 R1~R10 子集)
 * 每个测试返回 {id, name, pass, ms, detail};XML 语法按 docs/design/03 §2.1 事实表。
 */
import { LvglRuntime, imageDataHash, LV_LOG_WARN } from './runtime-wrapper.mjs';

/* ---------------- 工具 ---------------- */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitFor(cond, timeoutMs = 2000, stepMs = 30) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    if (cond()) return true;
    await sleep(stepMs);
  }
  return cond();
}

function pixelAt(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}
function colorNear(px, rgb, tol = 28) {
  return Math.abs(px[0] - rgb[0]) <= tol && Math.abs(px[1] - rgb[1]) <= tol && Math.abs(px[2] - rgb[2]) <= tol;
}
function isNonBlack(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8) return true;
  return false;
}
function tickN(rt, n) { for (let i = 0; i < n; i++) rt.tick(); }

function screenXml(viewAttrs, inner) {
  return `<screen><view ${viewAttrs}>${inner}</view></screen>`;
}

/** OffscreenCanvas 生成纯色 PNG(T7) */
async function makePng(cssColor, w = 64, h = 64) {
  const oc = new OffscreenCanvas(w, h);
  const g = oc.getContext('2d');
  g.fillStyle = cssColor;
  g.fillRect(0, 0, w, h);
  const blob = await oc.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

function fmtRect(r) { return r ? `(${r.x},${r.y} ${r.w}x${r.h})` : 'null'; }

/* ---------------- T1 (R1) 生命周期 ---------------- */
async function t1(canvas) {
  const details = [];
  for (let round = 1; round <= 3; round++) {
    const rt = await LvglRuntime.create(canvas, 240, 240);
    try {
      rt.reloadScreen('t1_screen', screenXml('style_bg_color="0x3355ff"',
        '<lv_label name="t1_label" text="round" align="center"/>'));
      tickN(rt, 3);
      const img = rt.snapshot();
      if (!isNonBlack(img)) return { pass: false, detail: `round ${round}: snapshot 全黑` };
      const c = pixelAt(img, 8, 8);
      details.push(`r${round} bg=[${c}] miss=${rt.missingExports.length}`);
    } finally {
      rt.destroy();
    }
  }
  if (typeof window.Module !== 'undefined') {
    return { pass: false, detail: 'window.Module 全局泄漏(MODULARIZE 失效)' };
  }
  return { pass: true, detail: `3 轮 create/destroy 正常,无全局 Module 泄漏;${details.join('; ')}` };
}
t1.id = 'T1'; Object.defineProperty(t1, 'name', { value: 'R1 生命周期 create/destroy x3' });

/* ---------------- T2 (R2) SDL 事件入队 ---------------- */
async function t2(canvas) {
  const rt = await LvglRuntime.create(canvas, 240, 240);
  try {
    rt.registerEventStub('t2_cb'); // 必须先于建屏,create 时解析 callback 名
    rt.reloadScreen('t2_screen', screenXml('style_bg_color="0x202020"', `
      <lv_button name="t2_btn" x="70" y="90" width="100" height="60">
        <lv_label text="OK" align="center"/>
        <lv_obj-event_cb trigger="clicked" callback="t2_cb"/>
      </lv_button>`));
    rt.setMode('play');
    rt.start();
    await sleep(80); // 让 rAF 循环与 SDL 事件泵 timer 跑起来

    const r = rt.getObjRect('t2_btn');
    if (!r) return { pass: false, detail: 'getObjRect(t2_btn) 为 null' };
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    // 逻辑坐标 → 页面坐标(canvas 可能被 CSS 缩放)
    const box = canvas.getBoundingClientRect();
    const clientX = box.left + cx * (box.width / canvas.width);
    const clientY = box.top + cy * (box.height / canvas.height);
    const common = { bubbles: true, cancelable: true, clientX, clientY, button: 0 };
    const fire = (types, buttons) => {
      for (const t of types) {
        const Ctor = t.startsWith('pointer') ? PointerEvent : MouseEvent;
        canvas.dispatchEvent(new Ctor(t, { ...common, buttons, pointerId: 1, isPrimary: true }));
      }
    };
    // SDL2 emscripten port 可能监听 mouse 或 pointer,两种都发
    fire(['pointermove', 'mousemove'], 0);
    await sleep(60);
    fire(['pointerdown', 'mousedown'], 1);
    await sleep(120); // 按压期间保持数帧,让 5ms 事件泵 timer 消化
    fire(['pointerup', 'mouseup'], 0);

    const got = await waitFor(() => rt.eventStubCalls.includes('t2_cb'), 2500);
    return {
      pass: got,
      detail: got
        ? `stub 收到 t2_cb,click@逻辑(${cx},${cy});calls=${JSON.stringify(rt.eventStubCalls)}`
        : `2.5s 内未收到 t2_cb;stub calls=${JSON.stringify(rt.eventStubCalls)},btn=${fmtRect(r)}`,
    };
  } finally {
    rt.stop(); rt.destroy();
  }
}
t2.id = 'T2'; Object.defineProperty(t2, 'name', { value: 'R2 SDL 鼠标事件驱动 clicked 回调' });

/* ---------------- T3 热重载 L3 ---------------- */
async function t3(canvas) {
  const rt = await LvglRuntime.create(canvas, 240, 240);
  try {
    rt.reloadScreen('t3_screen', screenXml('style_bg_color="0x0000cc"', '<lv_label text="blue"/>'));
    tickN(rt, 3);
    const hashA = await imageDataHash(rt.snapshot());
    const t0 = performance.now();
    rt.reloadScreen('t3_screen', screenXml('style_bg_color="0xcc0000"', '<lv_label text="red"/>'));
    const reloadMs = performance.now() - t0;
    tickN(rt, 3);
    const imgB = rt.snapshot();
    const hashB = await imageDataHash(imgB);
    const px = pixelAt(imgB, 120, 200); // 避开 label 的位置采底色
    const redOk = colorNear(px, [0xcc, 0, 0]);
    const pass = hashA !== hashB && redOk;
    return {
      pass,
      detail: `L3 reload=${reloadMs.toFixed(2)}ms;hashA=${hashA.slice(0, 12)} hashB=${hashB.slice(0, 12)} ` +
              `${hashA !== hashB ? '≠' : '== 未变化!'};重载后底色=[${px}]${redOk ? '' : ' 非红!'}`,
    };
  } finally { rt.destroy(); }
}
t3.id = 'T3'; Object.defineProperty(t3, 'name', { value: 'L3 屏级热重载 蓝→红 + 计时' });

/* ---------------- T4 (R3/G1) L4 globals/subject 重载 ---------------- */
async function t4(canvas) {
  const rt = await LvglRuntime.create(canvas, 240, 240);
  try {
    const heaps = [];
    for (let round = 1; round <= 5; round++) {
      const v = 20 + round * 10;
      const bg = ['0x102030', '0x203040', '0x304050', '0x405060', '0x506070'][round - 1];
      const globals = `<globals><subjects><int name="t4_val" value="${v}" min_value="0" max_value="100"/></subjects></globals>`;
      const scr = screenXml(`style_bg_color="${bg}"`, `
        <lv_slider name="t4_slider" x="20" y="110" width="200" bind_value="t4_val"/>
        <lv_label name="t4_label" align="top_mid" y="30" bind_text="t4_val" bind_text-fmt="v=%d"/>`);
      rt.reloadAll(globals, [{ name: 't4_screen', xml: scr }]);
      try { rt.loadScreen('t4_screen'); } catch { /* reload_all 可能已自动 load,容忍 */ }
      // 200 次 advance_tick(观察 subject 绑定野指针/崩溃)
      rt.setManualTick(true);
      for (let i = 0; i < 200; i++) rt.advanceTick(16);
      rt.setManualTick(false);
      const img = rt.snapshot();
      if (!isNonBlack(img)) return { pass: false, detail: `round ${round}: L4 后 snapshot 全黑` };
      const bad = rt.takeLogs().filter(l => l.level >= LV_LOG_WARN);
      if (bad.length) return { pass: false, detail: `round ${round}: tick 期间出现 WARN/ERROR: ${bad.map(l => l.msg).join(' | ')}` };
      heaps.push(rt.mod.HEAPU8.length);
    }
    const growth = heaps[heaps.length - 1] - heaps[0];
    return {
      pass: true,
      detail: `5 轮 lvd_reload_all + 每轮 200 tick 无异常;HEAP=${heaps.map(h => (h / 1048576).toFixed(1)).join('→')}MB(增长 ${(growth / 1024).toFixed(0)}KB)`,
    };
  } finally { rt.destroy(); }
}
t4.id = 'T4'; Object.defineProperty(t4, 'name', { value: 'R3/G1 L4 全工程重载 subject 绑定 x5 轮' });

/* ---------------- T5 (R4) L1 快路径 updateAttrs ---------------- */
async function t5(canvas) {
  const rt = await LvglRuntime.create(canvas, 240, 240);
  try {
    const globals = `<globals><consts><color name="accent" value="0xff8800"/></consts></globals>`;
    const scr = screenXml('style_bg_color="0x000000"', `
      <lv_obj name="t5_box" x="20" y="20" width="200" height="200"
              style_bg_color="0x0000ff" style_radius="0" style_border_width="0"/>`);
    rt.reloadAll(globals, [{ name: 't5_screen', xml: scr }]);
    try { rt.loadScreen('t5_screen'); } catch { /* 容忍 */ }
    tickN(rt, 3);
    const p0 = pixelAt(rt.snapshot(), 120, 120);
    if (!colorNear(p0, [0, 0, 255])) return { pass: false, detail: `初始底色非蓝 [${p0}]` };

    // 直接字面量
    rt.updateAttrs('t5_box', 'lv_obj', { style_bg_color: '0xff0000' });
    tickN(rt, 2);
    const p1 = pixelAt(rt.snapshot(), 120, 120);
    let logs = rt.takeLogs().filter(l => l.level >= LV_LOG_WARN);
    if (logs.length) return { pass: false, detail: `字面量更新产生 WARN/ERROR: ${logs.map(l => l.msg).join(' | ')}` };
    if (!colorNear(p1, [255, 0, 0])) return { pass: false, detail: `updateAttrs 0xff0000 后像素 [${p1}] 非红` };

    // #const 引用(R4 核心:空 scope 下 #accent 应落 globals 解析)
    rt.updateAttrs('t5_box', 'lv_obj', { style_bg_color: '#accent' });
    tickN(rt, 2);
    const p2 = pixelAt(rt.snapshot(), 120, 120);
    logs = rt.takeLogs().filter(l => l.level >= LV_LOG_WARN);
    if (logs.length) return { pass: false, detail: `#const 更新产生 WARN/ERROR: ${logs.map(l => l.msg).join(' | ')}` };
    const constOk = colorNear(p2, [0xff, 0x88, 0x00]);
    return {
      pass: constOk,
      detail: constOk
        ? `L1 字面量红 [${p1}] + #accent 橙 [${p2}] 均正确,无 error 日志`
        : `#accent 期望 [255,136,0] 实际 [${p2}](R4 空 scope const 解析失败?)`,
    };
  } finally { rt.destroy(); }
}
t5.id = 'T5'; Object.defineProperty(t5, 'name', { value: 'R4 L1 updateAttrs 字面量 + #const' });

/* ---------------- T6 命中测试 + 包围盒 ---------------- */
async function t6(canvas) {
  const rt = await LvglRuntime.create(canvas, 240, 240);
  try {
    // 期望布局(pad/border 全 0):outer(10,10) → flex column →
    // inner(10,10)180x80 内 label(15,15);slider 第二子 → (10, 90) 180x20
    rt.reloadScreen('t6_screen', screenXml('style_bg_color="0x101010" style_pad_all="0"', `
      <lv_obj name="t6_outer" x="10" y="10" width="220" height="200"
              style_pad_all="0" style_border_width="0" style_radius="0"
              style_layout="flex" style_flex_flow="column" style_pad_row="0">
        <lv_obj name="t6_inner" width="180" height="80"
                style_pad_all="0" style_border_width="0" style_radius="0">
          <lv_label name="t6_label" x="5" y="5" text="hit me"/>
        </lv_obj>
        <lv_slider name="t6_slider" width="180" height="20"/>
      </lv_obj>`));
    tickN(rt, 3);

    const rects = rt.getObjRects(['t6_outer', 't6_inner', 't6_label', 't6_slider']);
    const lbl = rects.get('t6_label'), sld = rects.get('t6_slider'), inn = rects.get('t6_inner');
    if (!lbl || !sld || !inn) {
      // 批量接口可能未导出/失败,回退单查
      const l2 = rt.getObjRect('t6_label');
      if (!l2) return { pass: false, detail: 'getObjRect(s) 拿不到 t6_label' };
    }
    const L = lbl || rt.getObjRect('t6_label');
    const S = sld || rt.getObjRect('t6_slider');
    const I = inn || rt.getObjRect('t6_inner');
    const TOL = 2;
    const errs = [];
    if (Math.abs(I.x - 10) > TOL || Math.abs(I.y - 10) > TOL) errs.push(`inner 期望(10,10) 实际${fmtRect(I)}`);
    if (Math.abs(L.x - 15) > TOL || Math.abs(L.y - 15) > TOL) errs.push(`label 期望(15,15) 实际${fmtRect(L)}`);
    if (Math.abs(S.x - 10) > TOL || Math.abs(S.y - 90) > TOL || Math.abs(S.w - 180) > TOL)
      errs.push(`slider 期望(10,90 w180) 实际${fmtRect(S)}`);

    const hitL = rt.hitTest(Math.round(L.x + L.w / 2), Math.round(L.y + L.h / 2));
    const hitS = rt.hitTest(Math.round(S.x + S.w / 2), Math.round(S.y + S.h / 2));
    if (hitL !== 't6_label') errs.push(`hitTest(label 中心)=${JSON.stringify(hitL)} ≠ t6_label`);
    if (hitS !== 't6_slider') errs.push(`hitTest(slider 中心)=${JSON.stringify(hitS)} ≠ t6_slider`);

    return {
      pass: errs.length === 0,
      detail: errs.length ? errs.join('; ')
        : `flex 布局 rect 全部 ±${TOL}px 吻合(label${fmtRect(L)} slider${fmtRect(S)});hitTest 命中 label/slider`,
    };
  } finally { rt.destroy(); }
}
t6.id = 'T6'; Object.defineProperty(t6, 'name', { value: '命中测试 + getObjRect(嵌套 flex)' });

/* ---------------- T7 (R7) 图片同名替换 ---------------- */
async function t7(canvas) {
  const rt = await LvglRuntime.create(canvas, 240, 240);
  try {
    const redPng = await makePng('#ff0000');
    const greenPng = await makePng('#00ff00');
    const fsPath = '/assets/t7.png';       // MEMFS 路径
    const lvPath = 'A:assets/t7.png';      // LVGL FS_STDIO letter 'A' 路径(集成核对)

    rt.writeFile(fsPath, redPng);
    rt.registerImage('t7_img', lvPath);
    const scr = screenXml('style_bg_color="0x000000"',
      '<lv_image name="t7_image" src="t7_img" x="10" y="10"/>');
    rt.reloadScreen('t7_screen', scr);
    tickN(rt, 3);
    const p1 = pixelAt(rt.snapshot(), 42, 42); // 图片中心 (10+32, 10+32)
    if (!colorNear(p1, [255, 0, 0])) return { pass: false, detail: `红图未显示,像素(42,42)=[${p1}]` };

    rt.writeFile(fsPath, greenPng);            // 同路径覆写
    rt.dropImageCache(lvPath);                 // 失效缓存
    rt.reloadScreen('t7_screen', scr);         // L3 重载
    tickN(rt, 3);
    const p2 = pixelAt(rt.snapshot(), 42, 42);
    const ok = colorNear(p2, [0, 255, 0]);
    return {
      pass: ok,
      detail: ok ? `覆写+drop_image_cache+L3 后 红[${p1}]→绿[${p2}]`
                 : `缓存未失效?覆写后像素(42,42)=[${p2}] 期望绿(红=[${p1}])`,
    };
  } finally { rt.destroy(); }
}
t7.id = 'T7'; Object.defineProperty(t7, 'name', { value: 'R7 MEMFS 覆写 + drop_image_cache 图片替换' });

/* ---------------- T8 (R10) 466x466 + 多控件内存观测 ---------------- */
async function t8(canvas) {
  const rt = await LvglRuntime.create(canvas, 240, 240);
  try {
    const h0 = rt.mod.HEAPU8.length;
    rt.setResolution(466, 466);
    const h1 = rt.mod.HEAPU8.length;
    rt.reloadScreen('t8_screen', screenXml('style_bg_color="0x181c22"', `
      <lv_label name="t8_title" text="M0 heap probe" align="top_mid" y="16"/>
      <lv_slider name="t8_s1" x="40" y="60" width="380"/>
      <lv_slider name="t8_s2" x="40" y="100" width="380"/>
      <lv_bar name="t8_bar" x="40" y="140" width="380" value="66"/>
      <lv_arc name="t8_arc" x="40" y="180" width="120" height="120"/>
      <lv_switch name="t8_sw" x="200" y="200"/>
      <lv_checkbox name="t8_chk" x="200" y="250" text="check"/>
      <lv_dropdown name="t8_dd" x="40" y="320" width="160"/>
      <lv_roller name="t8_roller" x="240" y="300"/>
      <lv_button name="t8_btn" x="40" y="400" width="160" height="48">
        <lv_label text="button" align="center"/>
      </lv_button>`));
    tickN(rt, 5);
    const h2 = rt.mod.HEAPU8.length;
    const img = rt.snapshot();
    const h3 = rt.mod.HEAPU8.length;
    const ok = img.width === 466 && img.height === 466 && isNonBlack(img);
    const mb = (n) => (n / 1048576).toFixed(2) + 'MB';
    return {
      pass: ok,
      detail: `snapshot=${img.width}x${img.height};HEAP init=${mb(h0)} → setRes466=${mb(h1)} → 多控件屏=${mb(h2)} → snapshot 后=${mb(h3)}(增长 ${mb(h3 - h0)})`,
    };
  } finally { rt.destroy(); }
}
t8.id = 'T8'; Object.defineProperty(t8, 'name', { value: 'R10 466x466 多控件 HEAP 观测' });

/* ---------------- 驱动 ---------------- */
export const ALL_TESTS = [t1, t2, t3, t4, t5, t6, t7, t8];

/**
 * @param {HTMLCanvasElement} canvas
 * @param {(r:object)=>void} [onProgress]
 * @returns {Promise<{id:string,name:string,pass:boolean,ms:number,detail:string}[]>}
 */
export async function runAllTests(canvas, onProgress) {
  const results = [];
  for (const t of ALL_TESTS) {
    const t0 = performance.now();
    let r;
    try {
      r = await t(canvas);
    } catch (e) {
      r = { pass: false, detail: 'EXCEPTION: ' + (e && (e.stack || e.message) || String(e)) };
    }
    const rec = {
      id: t.id, name: t.name, pass: !!r.pass,
      ms: Math.round(performance.now() - t0),
      detail: String(r.detail ?? ''),
    };
    results.push(rec);
    try { onProgress?.(rec); } catch { /* UI 错误不影响测试 */ }
    await sleep(30); // 轮间隙,让上一实例的 rAF/事件完全静默
  }
  return results;
}
