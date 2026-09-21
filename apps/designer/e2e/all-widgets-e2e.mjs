/**
 * 全量控件 E2E(任务 D):vite preview dist + 真 WASM + playwright。
 * 运行:node e2e/all-widgets-e2e.mjs(需先构建 Designer dist)
 *
 * 阶段:
 *  P0 面板体检:6 分类 / 35 个 palette 项(34 控件 + obj 面板)
 *  P1 素材:上传 png + lottie json + ttf → IndexedDB + runtime 注册 + 工程 assets，字体可选
 *  P2 34+1 控件逐个拖上画布:模型入树 / 零新增 console error / snapshot 变化
 *  P3 UI 专项:chart 加系列、tabview 加页签+拖 button 入 tab、table 单元格、
 *     buttonmatrix map、msgbox/list/win/menu/tileview 子项、line points、
 *     image 设素材、animimage 帧序列、lottie 设 json
 *  P4 导出 zip → 解包 → host gcc 双配置(LV_USE_OBJ_NAME=0/1)逐文件编译 0 error
 *  P5 全家福:新工程一屏摆 12 控件截图
 *  P6 刷新恢复:素材经 IndexedDB 重灌,image.src 仍渲染
 *
 * 截图 → e2e/artifacts-all/;导出解包 → e2e/out-ui-all/。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import { unzipSync } from 'fflate';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const repoRoot = join(appDir, '../..');
const artDir = join(here, 'artifacts-all');
const outUiDir = join(here, 'out-ui-all');
const viteCli = join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');
rmSync(artDir, { recursive: true, force: true });
rmSync(outUiDir, { recursive: true, force: true });
mkdirSync(artDir, { recursive: true });
mkdirSync(outUiDir, { recursive: true });
const PORT = 4187;

/* ---------------- 固定资产:16x16 纯色 PNG + 最小 lottie json ---------------- */
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
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
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
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

/* ---------------- 35 控件(唯一排除 3dtexture)+ 拖后补属性(可见性/管线覆盖) ---------------- */
const WIDGETS = [
  // 基础
  'label', 'button', 'line', 'arclabel', 'spangroup',
  // 输入
  'slider', 'switch', 'checkbox', 'arc', 'dropdown', 'roller', 'textarea',
  'spinbox', 'buttonmatrix', 'keyboard', 'imagebutton',
  // 显示
  'bar', 'led', 'spinner', 'qrcode', 'scale', 'calendar', 'table',
  // 容器
  'obj', 'msgbox', 'list', 'menu', 'win', 'tileview', 'tabview',
  // 图表
  'chart',
  // 多媒体
  'image', 'animimage', 'canvas', 'lottie',
];
/* 拖上后额外设的 props/内联样式(裸控件不可见/需要素材的) */
const EXTRA_PROPS = {
  line: { props: { points: [0, 60, 40, 5, 80, 40, 120, 0] } },
  imagebutton: { props: { src_released_mid: 'img_red', width: 64, height: 16 } },
  animimage: { props: { srcs: ['img_red', 'img_green'], duration: 400 } },
  lottie: { props: { src: 'anim_move' } },
  qrcode: { props: { data: 'https://lvgl.io', size: 80 } },
  msgbox: { props: { title: 'Hi', text: 'msgbox body' } },
  win: { props: { title: 'Win' } },
  canvas: { props: { fill_color: '#ffcc00' } },
  tileview: { props: { width: 200, height: 200 }, style: { bg_color: '#cfe3ff', bg_opa: 255 } },
};

const results = [];
const pageErrors = [];
const assert = (cond, msg) => {
  if (!cond) throw new Error(`断言失败:${msg}`);
  results.push(msg);
};
const step = (name) => results.push(`--- ${name} ---`);

const server = spawn(process.execPath, [viteCli, 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: appDir, stdio: 'pipe',
});
server.stdout.on('data', (d) => process.stdout.write(d));
server.stderr.on('data', (d) => process.stderr.write(d));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/`);
      if (r.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('vite preview 未起来');
}

let browser = null;
try {
  await waitForServer();
  const systemChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  browser = await chromium.launch(
    process.platform === 'win32' && existsSync(systemChrome) ? { executablePath: systemChrome } : {},
  );
  const context = await browser.newContext({
    viewport: { width: 1600, height: 950 },
    deviceScaleFactor: 1,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`);
  });
  page.on('dialog', (d) => d.type() === 'prompt' ? d.accept('e2e-project') : d.accept());
  // 预览服务器没有登录会话；用确定性的同源 API 替身覆盖新建/保存与 CAS 上传。
  let mockProjectSeq = 0;
  let mockVersion = 0;
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ username: 'e2e', role: 'admin', permissions: [] }),
  }));
  await page.route('**/api/lvgl/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.includes('/api/lvgl/assets/')) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (path === '/api/lvgl/projects' && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [] }) });
      return;
    }
    if (path === '/api/lvgl/projects' && request.method() === 'POST') {
      const body = request.postDataJSON();
      mockProjectSeq++;
      mockVersion = 1;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: `e2e-${mockProjectSeq}`, name: body.name, version: mockVersion }),
      });
      return;
    }
    if (request.method() === 'PUT') {
      mockVersion++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: mockVersion }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'not mocked' }) });
  });

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.rt-badge.rt-wasm', { timeout: 30000 });
  await page.waitForTimeout(800);

  const canvas = page.locator('#lvgl-canvas');
  const shot = async (name, whole = false) => {
    writeFileSync(join(artDir, name), await (whole ? page.screenshot() : canvas.screenshot()));
  };
  const canvasInfo = async () => {
    const cbox = await canvas.boundingBox();
    const internal = await page.evaluate(() => {
      const c = document.getElementById('lvgl-canvas');
      return { w: c.width, h: c.height };
    });
    const scale = cbox.width / internal.w;
    return { cbox, scale, toPage: (lx, ly) => ({ x: cbox.x + lx * scale, y: cbox.y + ly * scale }) };
  };
  const dragMouse = async (from, to, steps = 8) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
  };
  const dropAt = async (widget, lx, ly) => {
    // .last():同一控件可能同时出现在「最近使用」组与其分类组;分类组恒在 recent 之后渲染,
    // 取最后一个可避开 strict-mode 二义(与面板改版无关的既有脆弱点,2026-07-04 修)。
    const item = page.locator(`[data-widget="${widget}"]`).last();
    await item.scrollIntoViewIfNeeded();
    const ibox = await item.boundingBox();
    if (!ibox) throw new Error(`palette 项 ${widget} 不可见`);
    const ci = await canvasInfo();
    await dragMouse({ x: ibox.x + ibox.width / 2, y: ibox.y + ibox.height / 2 }, ci.toPage(lx, ly));
    await page.waitForTimeout(350);
  };
  const model = () => page.evaluate(() => {
    const st = window.__lvd.projectStore.getState();
    const ed = window.__lvd.editorStore.getState();
    const scr = st.project.screens.find((s) => s.id === ed.activeScreenId) ?? st.project.screens[0];
    const flat = [];
    const walk = (n, parentType) => {
      flat.push({ id: n.id, type: n.type, name: n.name ?? null, props: n.props, parentType, nChildren: n.children.length });
      n.children.forEach((c) => walk(c, n.type));
    };
    scr.root.children.forEach((c) => walk(c, 'root'));
    return {
      assets: st.project.assets.images.map((a) => ({ name: a.name, kind: a.kind ?? 'image' })),
      fonts: st.project.assets.fonts.map((a) => ({ name: a.name, loader: a.loader, sizePx: a.sizePx })),
      nodes: flat,
    };
  });
  const setProps = (nodeId, props, style) => page.evaluate(({ nodeId, props, style }) => {
    window.__lvd.projectStore.getState().mutateV2('e2e 补属性', (draft) => {
      const find = (n) => {
        if (n.id === nodeId) return n;
        for (const c of n.children) {
          const hit = find(c);
          if (hit) return hit;
        }
        return null;
      };
      for (const s of draft.screens) {
        const n = find(s.root);
        if (n) {
          if (props) Object.assign(n.props, props);
          if (style) n.styles.push({ props: style });
          return;
        }
      }
    });
  }, { nodeId, props: props ?? null, style: style ?? null });
  const newProject = async () => {
    await page.locator('.toolbar button', { hasText: '新建' }).click();
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      window.__lvd.projectStore.getState().mutateDisplay('e2e 480 方屏', (display) => {
        display.width = 480;
        display.height = 480;
        display.shape = 'rect';
      });
      const ed = window.__lvd.editorStore.getState();
      ed.setZoom(0.9);
      ed.setPan({ x: 30, y: 20 });
    });
    await page.waitForTimeout(500);
  };
  const clickInspInput = (rowTitle) =>
    page.locator('.insp-body .prop-row', { has: page.locator(`label[title="${rowTitle}"]`) }).first();

  /* ================= P0 面板体检 ================= */
  step('P0 组件面板:6 分类 35 项');
  const catCount = await page.locator('.palette-group').count();
  const itemCount = await page.locator('.palette-item').count();
  const itemTypes = await page.locator('.palette-item').evaluateAll((els) => els.map((e) => e.dataset.widget));
  assert(catCount === 6, `P0 分类数 = 6(实际 ${catCount})`);
  assert(itemCount === 35, `P0 palette 共 35 项 = 34 控件 + obj 面板(实际 ${itemCount})`);
  for (const w of WIDGETS) assert(itemTypes.includes(w), `P0 palette 含 ${w}`);
  await shot('p0-palette.png', true);

  /* ================= P1 素材上传 ================= */
  step('P1 素材面板上传 png/lottie/ttf 与自定义字体预览');
  await newProject();
  await page.locator('.left-tab', { hasText: '素材' }).click();
  await page.setInputFiles('[data-testid="asset-upload"]', [
    { name: 'red.png', mimeType: 'image/png', buffer: solidPng(220, 30, 30) },
    { name: 'green.png', mimeType: 'image/png', buffer: solidPng(30, 200, 60) },
    { name: 'move.json', mimeType: 'application/json', buffer: Buffer.from(LOTTIE_JSON) },
    {
      name: 'Montserrat-Medium.ttf',
      mimeType: 'font/ttf',
      buffer: readFileSync(join(repoRoot, 'packages/asset-pipeline/spike/Montserrat-Medium.ttf')),
    },
  ]);
  await page.waitForTimeout(800);
  let m = await model();
  assert(m.assets.length === 3, `P1 工程 assets = 3(实际 ${JSON.stringify(m.assets)})`);
  assert(m.assets.some((a) => a.name === 'red' && a.kind === 'image'), 'P1 red.png → image 素材 "red"');
  assert(m.assets.some((a) => a.name === 'move' && a.kind === 'lottie'), 'P1 move.json → lottie 素材 "move"');
  assert(
    m.fonts.some((a) => a.name === 'montserrat_medium' && a.loader === 'tiny_ttf'),
    'P1 TTF → tiny_ttf 字体素材 "montserrat_medium"',
  );
  const rowCount = await page.locator('.asset-row').count();
  assert(rowCount === 4, `P1 素材面板 4 行(实际 ${rowCount})`);
  const thumbCount = await page.locator('.asset-row img').count();
  assert(thumbCount === 2, `P1 图片缩略图 2 张(实际 ${thumbCount})`);
  await page.locator('.asset-font-config input[placeholder*="OFL-1.1"]').fill('OFL-1.1');
  await shot('p1-assets.png', true);
  // EXTRA_PROPS 里引用的素材名对齐实际(sanitize 后 red/green/move)
  EXTRA_PROPS.imagebutton.props.src_released_mid = 'red';
  EXTRA_PROPS.animimage.props.srcs = ['red', 'green'];
  EXTRA_PROPS.lottie.props.src = 'move';
  await page.locator('.left-tab', { hasText: '组件' }).click();
  const fontErrBefore = pageErrors.length;
  await dropAt('label', 40, 40);
  await page.locator('.inspector .tabs button', { hasText: '样式' }).click();
  const fontSelect = page
    .locator('.insp-body .prop-row', { has: page.locator('label[title="style_text_font"]') })
    .locator('select');
  assert(await fontSelect.locator('option[value="montserrat_medium"]').count() === 1, 'P1 自定义字体出现在样式选择器');
  await fontSelect.selectOption('montserrat_medium');
  await page.waitForTimeout(500);
  assert(pageErrors.length === fontErrBefore, 'P1 自定义字体应用到标签后零 console error');
  await page.locator('.inspector .tabs button', { hasText: '属性' }).click();
  await page.evaluate(() => {
    const st = window.__lvd.projectStore.getState();
    const ed = window.__lvd.editorStore.getState();
    st.mutateV2('e2e 清理字体标签', (draft) => {
      const screen = draft.screens.find((item) => item.id === ed.activeScreenId) ?? draft.screens[0];
      screen.root.children = screen.root.children.filter((node) => node.type !== 'label');
    });
    ed.select([]);
  });

  /* ================= P2 35 控件逐拖 ================= */
  step('P2 35 控件逐个拖上画布(模型 / console / snapshot)');
  for (const w of WIDGETS) {
    const errBefore = pageErrors.length;
    const before = await canvas.screenshot();
    await dropAt(w, 220, 210);
    let mm = await model();
    const node = mm.nodes.find((n) => n.type === w && n.parentType === 'root');
    assert(node, `P2 [${w}] 入树`);
    const extra = EXTRA_PROPS[w];
    if (extra) {
      await setProps(node.id, extra.props, extra.style);
      await page.waitForTimeout(350);
    }
    if (w === 'qrcode') {
      const pixels = await page.evaluate((id) => {
        const pipeline = window.__lvd.getPipeline();
        const rect = pipeline.rectOf(id);
        const image = pipeline.runtime.snapshot();
        let dark = 0;
        let light = 0;
        for (let y = Math.max(0, Math.floor(rect.y)); y < Math.min(image.height, Math.ceil(rect.y + rect.h)); y++) {
          for (let x = Math.max(0, Math.floor(rect.x)); x < Math.min(image.width, Math.ceil(rect.x + rect.w)); x++) {
            const offset = (y * image.width + x) * 4;
            const sum = image.data[offset] + image.data[offset + 1] + image.data[offset + 2];
            if (sum < 180) dark++;
            if (sum > 700) light++;
          }
        }
        return { dark, light };
      }, node.id);
      assert(pixels.dark > 50 && pixels.light > 50, `P2 [qrcode] 区域含黑白码点(${JSON.stringify(pixels)})`);
    }
    await page.waitForTimeout(150);
    const after = await canvas.screenshot();
    assert(Buffer.compare(before, after) !== 0, `P2 [${w}] snapshot 变化`);
    const newErrs = pageErrors.slice(errBefore);
    assert(newErrs.length === 0, `P2 [${w}] 零 console error${newErrs.length ? `:${newErrs.join(' | ')}` : ''}`);
    writeFileSync(join(artDir, `p2-${w}.png`), after);
    // 清场:选中该节点删除(拖放后即选中;保险起见直接按模型删)
    await page.evaluate((id) => {
      window.__lvd.projectStore.getState().mutateV2('e2e 清场', (draft) => {
        const rm = (n) => {
          n.children = n.children.filter((c) => c.id !== id);
          n.children.forEach(rm);
        };
        draft.screens.forEach((s) => rm(s.root));
      });
      window.__lvd.editorStore.getState().select([]);
    }, node.id);
    await page.waitForTimeout(200);
  }
  results.push(`P2 完成:${WIDGETS.length} 控件(34 控件 + obj)全部通过`);

  /* ================= P3 UI 专项 ================= */
  step('P3.1 chart:检查器加 2 系列 + values');
  await dropAt('chart', 130, 100);
  m = await model();
  const chart = m.nodes.find((n) => n.type === 'chart');
  assert(chart, 'P3.1 chart 入树');
  const beforeSeries = await canvas.screenshot();
  await page.locator('[data-add-child="chart-series"]').click();
  await page.locator('[data-add-child="chart-series"]').click();
  await page.waitForTimeout(400);
  const seriesValues = page
    .locator('.child-item[data-child-type="chart-series"]').nth(1)
    .locator('.prop-row', { has: page.locator('label[title="values"]') })
    .locator('input');
  await seriesValues.fill('10 40 30 80 60');
  await seriesValues.press('Enter');
  await page.waitForTimeout(500);
  m = await model();
  const series = m.nodes.filter((n) => n.type === 'chart-series');
  assert(series.length === 2, `P3.1 chart-series ×2(实际 ${series.length})`);
  assert(
    JSON.stringify(series[1].props.values) === JSON.stringify([10, 40, 30, 80, 60]),
    `P3.1 系列 values=[10,40,30,80,60](实际 ${JSON.stringify(series[1].props.values)})`,
  );
  const afterSeries = await canvas.screenshot();
  assert(Buffer.compare(beforeSeries, afterSeries) !== 0, 'P3.1 加系列后 snapshot 变化');
  await shot('p3-chart-series.png');

  step('P3.2 tabview:加页签 + 拖 button 入 tab');
  await dropAt('tabview', 240, 300);
  m = await model();
  const tabview = m.nodes.find((n) => n.type === 'tabview');
  assert(tabview, 'P3.2 tabview 入树');
  await page.locator('[data-add-child="tabview-tab"]').click();
  await page.waitForTimeout(400);
  m = await model();
  let tab = m.nodes.find((n) => n.type === 'tabview-tab');
  assert(tab, 'P3.2 tabview-tab 入树');
  // 改页签文本
  const tabText = page
    .locator('.child-item[data-child-type="tabview-tab"]')
    .locator('.prop-row', { has: page.locator('label[title="text"]') })
    .locator('input');
  await tabText.fill('tab_a');
  await tabText.press('Enter');
  await page.waitForTimeout(400);
  // 拖 button 到 tab 内容区(tabview 位于 240,300 起 200×200,tab bar 高约 40)
  await dropAt('button', 320, 420);
  m = await model();
  tab = m.nodes.find((n) => n.type === 'tabview-tab');
  const btnInTab = m.nodes.find((n) => n.type === 'button' && n.parentType === 'tabview-tab');
  assert(tab.props.text === 'tab_a', `P3.2 页签改名 tab_a(实际 ${tab.props.text})`);
  assert(btnInTab, 'P3.2 button 落入 tabview-tab 容器');
  await shot('p3-tabview-tab.png');

  step('P3.3 table:2×2 + 单元格编辑');
  await dropAt('table', 20, 300);
  m = await model();
  const table = m.nodes.find((n) => n.type === 'table');
  assert(table, 'P3.3 table 入树');
  const rowInput = clickInspInput('row_count').locator('input');
  await rowInput.fill('2');
  const colInput = clickInspInput('column_count').locator('input');
  await colInput.fill('2');
  await page.waitForTimeout(400);
  await page.locator('[data-cell="0-0"]').fill('A1');
  await page.locator('[data-cell="0-0"]').press('Enter');
  await page.locator('[data-cell="1-1"]').fill('B2');
  await page.locator('[data-cell="1-1"]').press('Enter');
  await page.waitForTimeout(400);
  m = await model();
  const cells = m.nodes.filter((n) => n.type === 'table-cell');
  assert(cells.length === 2, `P3.3 table-cell ×2(实际 ${cells.length})`);
  assert(
    cells.some((c) => c.props.row === 0 && c.props.column === 0 && c.props.value === 'A1')
    && cells.some((c) => c.props.row === 1 && c.props.column === 1 && c.props.value === 'B2'),
    'P3.3 单元格 (0,0)=A1、(1,1)=B2',
  );
  await shot('p3-table.png');

  step('P3.4 buttonmatrix:map 编辑');
  await dropAt('buttonmatrix', 130, 20);
  m = await model();
  const bm = m.nodes.find((n) => n.type === 'buttonmatrix');
  assert(bm, 'P3.4 buttonmatrix 入树');
  const mapArea = page.locator('.insp-body .prop-row', { has: page.locator('label[title="map"]') }).locator('textarea');
  await mapArea.fill('OK | Cancel\nYes');
  await mapArea.blur();
  await page.waitForTimeout(400);
  m = await model();
  const bm2 = m.nodes.find((n) => n.type === 'buttonmatrix');
  assert(
    JSON.stringify(bm2.props.map) === JSON.stringify(['OK', 'Cancel', '\n', 'Yes']),
    `P3.4 map=['OK','Cancel','\\n','Yes'](实际 ${JSON.stringify(bm2.props.map)})`,
  );
  await shot('p3-buttonmatrix.png');

  step('P3.5 msgbox/list/win/menu/tileview 子项');
  const childCases = [
    ['msgbox', 'msgbox-button', 340, 30],
    ['list', 'list-text', 20, 100],
    ['win', 'win-button', 350, 150],
    ['menu', 'menu-page', 20, 180],
    ['tileview', 'tileview-tile', 350, 320],
  ];
  for (const [w, childType, x, y] of childCases) {
    await dropAt(w, x, y);
    await page.locator(`[data-add-child="${childType}"]`).click();
    await page.waitForTimeout(350);
    m = await model();
    const child = m.nodes.find((n) => n.type === childType);
    assert(child, `P3.5 ${w} → ${childType} 入树`);
  }
  // list 再加一个带文本的按钮
  m = await model();
  const listNode = m.nodes.find((n) => n.type === 'list');
  await page.evaluate((id) => {
    const ed = window.__lvd.editorStore.getState();
    ed.select([id]);
  }, listNode.id);
  await page.waitForTimeout(200);
  await page.locator('[data-add-child="list-button"]').click();
  await page.waitForTimeout(350);
  m = await model();
  assert(m.nodes.some((n) => n.type === 'list-button'), 'P3.5 list-button 入树');
  await shot('p3-children.png');

  step('P3.6 image 设素材(UI 选择器)+ line points + animimage 帧 + lottie json');
  // image
  await dropAt('image', 240, 100);
  m = await model();
  const img = m.nodes.find((n) => n.type === 'image');
  assert(img, 'P3.6 image 入树');
  const beforeImg = await canvas.screenshot();
  const srcRow = page.locator('.insp-body .prop-row', { has: page.locator('label[title="src"]') });
  await srcRow.locator('.asset-picker-btn').click();
  await page.locator('[data-asset-option="red"]').click();
  await page.waitForTimeout(500);
  m = await model();
  assert(m.nodes.find((n) => n.type === 'image').props.src === 'red', 'P3.6 image.src=red(素材选择器)');
  const afterImg = await canvas.screenshot();
  assert(Buffer.compare(beforeImg, afterImg) !== 0, 'P3.6 设图后 snapshot 变化');
  // line
  await dropAt('line', 400, 240);
  const ptsRow = page.locator('.insp-body .prop-row', { has: page.locator('label[title="points"]') }).locator('input');
  await ptsRow.fill('0,50 30,0 60,40');
  await ptsRow.press('Enter');
  await page.waitForTimeout(400);
  m = await model();
  assert(
    JSON.stringify(m.nodes.find((n) => n.type === 'line').props.points) === JSON.stringify([0, 50, 30, 0, 60, 40]),
    'P3.6 line.points 文本编辑生效',
  );
  // animimage:多选素材
  await dropAt('animimage', 420, 100);
  await page.locator('.asset-multi-item', { hasText: 'red' }).locator('input').check();
  await page.locator('.asset-multi-item', { hasText: 'green' }).locator('input').check();
  await page.waitForTimeout(400);
  m = await model();
  assert(
    JSON.stringify(m.nodes.find((n) => n.type === 'animimage').props.srcs) === JSON.stringify(['red', 'green']),
    'P3.6 animimage.srcs=[red,green](多选)',
  );
  // lottie
  const errBeforeLottie = pageErrors.length;
  await dropAt('lottie', 420, 380);
  const lotRow = page.locator('.insp-body .prop-row', { has: page.locator('label[title="src"]') });
  await lotRow.locator('.asset-picker-btn').click();
  await page.locator('[data-asset-option="move"]').click();
  await page.waitForTimeout(700);
  m = await model();
  assert(m.nodes.find((n) => n.type === 'lottie').props.src === 'move', 'P3.6 lottie.src=move');
  assert(pageErrors.length === errBeforeLottie, 'P3.6 lottie 全程零 console error');
  await shot('p3-media.png');
  await shot('p3-page-full.png', true);

  /* ================= P4 导出 zip → gcc 双配置编译 ================= */
  step('P4 导出 C 代码 zip + host gcc 双配置编译');
  await page.selectOption('[aria-label="目标颜色格式"]', 'RGB565');
  await page.selectOption('[aria-label="目标控制器"]', 'screen-only');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.locator('.toolbar button', { hasText: '导出 C 代码' }).click(),
  ]);
  const zipPath = join(artDir, 'ui-all.zip');
  await download.saveAs(zipPath);
  const unzipped = unzipSync(readFileSync(zipPath));
  const names = Object.keys(unzipped);
  for (const [p, data] of Object.entries(unzipped)) {
    const dst = join(outUiDir, p);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, data);
  }
  const dec = new TextDecoder();
  assert(names.includes('build-manifest.json'), 'P4 zip 含 build-manifest.json');
  assert(names.includes('fonts/montserrat_medium.c'), 'P4 zip 含自定义字体 C 源码');
  assert(names.includes('licenses/montserrat_medium.txt'), 'P4 zip 含字体许可证归档');
  const buildManifest = JSON.parse(dec.decode(unzipped['build-manifest.json']));
  assert(buildManifest.lvglVersion === '9.5.0', 'P4 正式导出精确钉死 LVGL 9.5.0');
  assert(buildManifest.profiles?.controllerProfileRef?.startsWith('controller:screen-only-'), 'P4 manifest 锁定 ControllerProfile revision');
  const mainC = dec.decode(unzipped['screens/main.c']);
  const mustCalls = [
    'lv_chart_add_series', 'lv_chart_set_next_value', 'lv_tabview_add_tab',
    'lv_table_set_cell_value', 'lv_buttonmatrix_set_map', 'lv_msgbox_add_footer_button',
    'lv_list_add_text', 'lv_list_add_button', 'lv_win_add_button', 'lv_menu_page_create',
    'lv_tileview_add_tile', 'lv_line_set_points', 'lv_animimg_set_src', 'lv_lottie',
    'lv_image_set_src',
  ];
  for (const call of mustCalls) assert(mainC.includes(call), `P4 screens/main.c 含 ${call}`);
  results.push(`P4 zip 共 ${names.length} 文件,解包到 e2e/out-ui-all/`);

  const lvConf = join(repoRoot, 'packages/codegen/ci/lv_conf_ci.h');
  const lvglDir = join(repoRoot, 'vendor/lvgl');
  let compiled = 0;
  for (const objname of ['1', '0']) {
    for (const p of names.filter((n) => n.endsWith('.c'))) {
      const src = join(outUiDir, p);
      const obj = join(outUiDir, `${p.replace(/\//g, '_')}.objname${objname}.o`);
      const r = spawnSync('gcc', [
        '-c', src, '-o', obj, '-std=c11', '-Wall', '-Wextra', '-Werror',
        '-I', outUiDir, '-I', lvglDir,
        '-DLV_LVGL_H_INCLUDE_SIMPLE', `-DLV_CONF_PATH="${lvConf}"`,
        `-DLV_USE_OBJ_NAME=${objname}`,
      ], { encoding: 'utf8' });
      if (r.status !== 0) {
        throw new Error(`P4 gcc 编译失败 [LV_USE_OBJ_NAME=${objname}] ${p}:\n${r.stderr.slice(0, 4000)}`);
      }
      compiled++;
    }
  }
  results.push(`P4 gcc 编译 ${compiled} 个目标文件(OBJ_NAME=1/0 双配置,-Wall -Wextra -Werror)全部 0 error`);

  /* ================= P5 全家福 ================= */
  step('P5 全家福:一屏 12 控件');
  await newProject();
  const family = [
    ['button', 40, 30], ['label', 200, 30], ['slider', 300, 40], ['switch', 40, 90],
    ['checkbox', 130, 90], ['bar', 300, 100], ['arc', 20, 150], ['led', 200, 150],
    ['spinner', 260, 150], ['chart', 20, 320], ['table', 240, 300], ['qrcode', 380, 150],
  ];
  for (const [w, x, y] of family) await dropAt(w, x, y);
  m = await model();
  const famQr = m.nodes.find((n) => n.type === 'qrcode');
  if (famQr) await setProps(famQr.id, { data: 'https://lvgl.io', size: 90 });
  assert(
    m.nodes.filter((n) => n.parentType === 'root').length === family.length,
    `P5 一屏 ${family.length} 控件全部入树`,
  );
  await page.waitForTimeout(600);
  await shot('family-canvas.png');
  await shot('family-page-full.png', true);

  /* ================= P6 刷新恢复(素材重灌) ================= */
  step('P6 刷新:IndexedDB 工程 + 素材重灌');
  // 回到 P3 工程?P5 已覆盖 autosave;此处验证:上传素材 + image 引用 → 刷新后仍渲染
  await dropAt('image', 200, 200);
  m = await model();
  const img2 = m.nodes.find((n) => n.type === 'image');
  await page.locator('.left-tab', { hasText: '素材' }).click();
  await page.setInputFiles('[data-testid="asset-upload"]', [
    { name: 'blue.png', mimeType: 'image/png', buffer: solidPng(30, 60, 220) },
  ]);
  await page.waitForTimeout(600);
  await page.evaluate((id) => {
    window.__lvd.projectStore.getState().mutateV2('e2e set src', (draft) => {
      const find = (n) => n.id === id ? n : n.children.map(find).find(Boolean);
      for (const s of draft.screens) {
        const n = find(s.root);
        if (n) { n.props.src = 'blue'; n.props.width = 64; n.props.height = 64; return; }
      }
    });
  }, img2.id);
  await page.waitForTimeout(2600); // autosave debounce
  const beforeReload = await canvas.screenshot();
  await page.reload();
  await page.waitForSelector('.rt-badge.rt-wasm', { timeout: 30000 });
  await page.waitForTimeout(1500);
  m = await model();
  assert(m.assets.some((a) => a.name === 'blue'), 'P6 刷新后工程 assets 含 blue');
  assert(m.nodes.find((n) => n.type === 'image')?.props.src === 'blue', 'P6 刷新后 image.src=blue');
  // 像素:image 区域应有蓝色(素材重灌成功才有)
  const px = await page.evaluate(() => {
    const st = window.__lvd.projectStore.getState();
    const node = (function find(n) {
      if (n.type === 'image') return n;
      for (const c of n.children) { const h = find(c); if (h) return h; }
      return null;
    })(st.project.screens[0].root);
    const r = window.__lvd.getPipeline().rectOf(node.id);
    const img = window.__lvd.getPipeline().runtime.snapshot();
    const cx = Math.round(r.x + r.w / 2);
    const cy = Math.round(r.y + r.h / 2);
    const o = (cy * img.width + cx) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2]];
  });
  assert(px[2] > 150 && px[2] - px[0] > 60, `P6 image 中心像素为蓝(rgba ${px.join(',')})——素材经 IndexedDB 重灌成功`);
  writeFileSync(join(artDir, 'p6-before-reload.png'), beforeReload);
  await shot('p6-after-reload.png');

  if (pageErrors.length > 0) {
    results.push(`警告:全程收集 ${pageErrors.length} 条页面错误:${pageErrors.slice(0, 8).join(' | ')}`);
  } else {
    results.push('全程 0 条 pageerror/console.error');
  }

  await browser.close();
  console.log('ALL-WIDGETS E2E PASS');
  for (const r of results) console.log(' -', r);
} catch (e) {
  console.error(`ALL-WIDGETS E2E FAIL: ${e.message}`);
  for (const r of results) console.log(' [ok]', r);
  if (pageErrors.length) console.log(' pageErrors:', pageErrors.join(' | '));
  try {
    if (browser) {
      for (const pg of (await browser.contexts()).flatMap((c) => c.pages())) {
        writeFileSync(join(artDir, 'FAIL-page.png'), await pg.screenshot());
        break;
      }
    }
  } catch { /* ignore */ }
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
  setTimeout(() => process.exit(process.exitCode ?? 0), 1000).unref();
}
