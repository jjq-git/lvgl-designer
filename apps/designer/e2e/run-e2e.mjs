/**
 * M1 集成验收 E1~E7(vite preview dist 产物 + 真 WASM + playwright)。
 * 运行:node e2e/run-e2e.mjs(需先构建 Designer dist)
 * 截图 → e2e/artifacts/;E6 导出的 zip 内容 → e2e/out-ui/。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { unzipSync } from 'fflate';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const artDir = join(here, 'artifacts');
const outUiDir = join(here, 'out-ui');
const viteCli = join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');
mkdirSync(artDir, { recursive: true });
const PORT = 4185;

const server = spawn(process.execPath, [viteCli, 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: appDir,
  stdio: 'pipe',
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

const results = [];
const pageErrors = [];
const assert = (cond, msg) => {
  if (!cond) throw new Error(`断言失败:${msg}`);
  results.push(msg);
};
const step = (name) => results.push(`--- ${name} ---`);

let browser = null;
try {
  await waitForServer();
  const systemChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  browser = await chromium.launch(
    process.platform === 'win32' && existsSync(systemChrome) ? { executablePath: systemChrome } : {},
  );
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`);
  });
  page.on('dialog', (d) => d.type() === 'prompt' ? d.accept('e2e-project') : d.accept());

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.rt-badge.rt-wasm', { timeout: 30000 });
  await page.waitForTimeout(800);

  const canvas = page.locator('#lvgl-canvas');
  const shotArt = async (name, whole = false) => {
    writeFileSync(join(artDir, name), await (whole ? page.screenshot() : canvas.screenshot()));
  };

  /* ============ 工具:页内像素采样(runtime.snapshot → ImageData RGBA) ============ */
  const samplePixels = (pts) =>
    page.evaluate((points) => {
      const img = window.__lvd.getPipeline().runtime.snapshot();
      return points.map(([x, y]) => {
        const o = (y * img.width + x) * 4;
        return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
      });
    }, pts);

  const canvasInfo = async () => {
    const cbox = await canvas.boundingBox();
    const internal = await page.evaluate(() => {
      const c = document.getElementById('lvgl-canvas');
      return { w: c.width, h: c.height };
    });
    const scale = cbox.width / internal.w;
    return { cbox, internal, scale, toPage: (lx, ly) => ({ x: cbox.x + lx * scale, y: cbox.y + ly * scale }) };
  };

  const dragMouse = async (from, to, steps = 10) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
      await page.waitForTimeout(25);
    }
    await page.mouse.up();
  };

  const model = () => page.evaluate(() => {
    const st = window.__lvd.projectStore.getState();
    const scr = st.project.screens.find((s) => s.id === window.__lvd.editorStore.getState().activeScreenId)
      ?? st.project.screens[0];
    return {
      display: st.project.display,
      screens: st.project.screens.length,
      children: scr.root.children.map((c) => ({
        id: c.id, type: c.type, name: c.name ?? null,
        props: c.props, inlineStyles: c.inlineStyles,
      })),
    };
  });
  const rectOfType = (type) => page.evaluate((t) => {
    const st = window.__lvd.projectStore.getState();
    const scr = st.project.screens[0];
    const node = scr.root.children.find((c) => c.type === t);
    if (!node) return null;
    return { id: node.id, rect: window.__lvd.getPipeline().rectOf(node.id) };
  }, type);

  /* ================= E1 新建工程(240 圆屏) ================= */
  step('E1 新建工程(240 圆屏)');
  await page.getByRole('button', { name: '新建项目' }).click(); // confirm 已被 dialog handler 接受
  await page.waitForTimeout(800);
  let m = await model();
  assert(
    m.display.width === 240 && m.display.height === 240 && m.display.shape === 'round',
    `E1 新建工程 display=240×240 round(实际 ${m.display.width}×${m.display.height} ${m.display.shape})`,
  );
  assert(m.screens === 1 && m.children.length === 0, 'E1 新工程只有 1 屏 0 子节点');
  const maskCount = await page.locator('svg path[fill-rule="evenodd"]').count();
  assert(maskCount >= 1, `E1 画布出现圆屏 evenodd 遮罩(path 数=${maskCount})`);
  await shotArt('e1-new-project-round.png');
  await shotArt('e1-page-full.png', true);

  /* ================= E2 拖 button+label+slider 入画布 ================= */
  step('E2 palette 拖 button/label/slider');
  let ci = await canvasInfo();
  const dropAt = async (widget, lx, ly) => {
    // .last():避开「最近使用」组可能出现的同名项(分类组恒在其后),防 strict-mode 二义
    const item = page.locator(`[data-widget="${widget}"]`).last();
    await item.scrollIntoViewIfNeeded(); // 大卡片面板项可能在滚动区外,先滚到可视再取坐标
    const ibox = await item.boundingBox();
    if (!ibox) throw new Error(`palette 项 ${widget} 不可见`);
    await dragMouse(
      { x: ibox.x + ibox.width / 2, y: ibox.y + ibox.height / 2 },
      ci.toPage(lx, ly),
      8,
    );
    await page.waitForTimeout(400);
  };
  await dropAt('button', 85, 70);
  await dropAt('label', 120, 40); // label 放上方,避免与 slider/button 重叠
  await dropAt('slider', 60, 150);
  m = await model();
  assert(
    m.children.length === 3 &&
      ['button', 'label', 'slider'].every((t) => m.children.some((c) => c.type === t)),
    `E2 工程模型 3 节点:${m.children.map((c) => `${c.type}:${c.name}`).join(', ')}`,
  );
  const treeRows = await page.locator('.tree-row').count();
  assert(treeRows === 4, `E2 对象树 = 屏根 + 3 节点(行数=${treeRows})`);
  // 像素:三个 widget 中心颜色 vs 空白底色点(120,225)→ 画布非默认底色
  const buttonTreeRow = page.locator('.tree-row', { hasText: 'button_1' });
  await buttonTreeRow.hover();
  await buttonTreeRow.locator('.tree-action').click();
  await page.waitForTimeout(300);
  m = await model();
  assert(
    m.children.filter((child) => child.type === 'button').length === 2,
    'E2 对象树复刻按钮可复制完整组件子树',
  );
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  m = await model();
  assert(m.children.length === 3, 'E2 复刻操作可单步撤销');
  const centers = [];
  for (const t of ['button', 'label', 'slider']) {
    const r = await rectOfType(t);
    centers.push([Math.round(r.rect.x + r.rect.w / 2), Math.round(r.rect.y + r.rect.h / 2)]);
  }
  const px = await samplePixels([...centers, [120, 225]]);
  const bg = px[3];
  const nonBg = px.slice(0, 3).filter((p) => p.join(',') !== bg.join(','));
  assert(
    nonBg.length >= 2,
    `E2 canvas 像素非默认底色(3 个 widget 中心 ${nonBg.length} 个 ≠ 底色 rgba(${bg.join(',')}))`,
  );
  await shotArt('e2-three-widgets.png');
  await shotArt('e2-page-full.png', true);

  /* ================= E2.1 按钮文字快捷编辑 ================= */
  step('E2.1 按钮文字直接编辑');
  await page.locator('.tree-row', { hasText: 'button_1' }).click();
  const buttonTextInput = page
    .locator('.prop-row', { has: page.locator('label', { hasText: '按钮文字' }) })
    .locator('input.ed-text');
  await buttonTextInput.fill('确定');
  await page.waitForTimeout(400);
  const buttonText = await page.evaluate(() => {
    const button = window.__lvd.projectStore.getState().project.screens[0].root.children
      .find((node) => node.type === 'button');
    const label = button?.children.find((node) => node.type === 'label');
    return label ? { text: label.props.text, align: label.props.align } : null;
  });
  assert(
    buttonText?.text === '确定' && buttonText.align === 'center',
    `E2.1 输入按钮文字自动创建居中 label(实际 ${JSON.stringify(buttonText)})`,
  );
  assert(await page.locator('.tree-row').count() === 5, 'E2.1 对象树同步出现按钮内部标签');
  await shotArt('e2-button-text.png');

  /* ================= E2.2 关联可复用组件 ================= */
  step('E2.2 创建、复用并选择关联组件');
  const reusableButtonRow = page.locator('.tree-row', { hasText: 'button_1' }).first();
  await reusableButtonRow.click({ button: 'right' });
  await page.locator('.ctx-menu button', { hasText: '创建可复用组件' }).click();
  await page.waitForTimeout(500);
  let componentState = await page.evaluate(() => {
    const state = window.__lvd.projectStore.getState();
    return {
      definitions: state.uiProject.components.length,
      linked: state.uiProject.screens[0].root.children.filter((node) => node.type.startsWith('component:')).length,
      projectedButtons: state.project.screens[0].root.children.filter((node) => node.type === 'button').length,
    };
  });
  assert(
    componentState.definitions === 1 && componentState.linked === 1 && componentState.projectedButtons === 1,
    `E2.2 子树转关联组件且预览投影保持 button(实际 ${JSON.stringify(componentState)})`,
  );
  const componentCard = page.locator('.palette-component').first();
  assert(await componentCard.count() === 1, 'E2.2 可复用组件出现在组件面板');
  await componentCard.scrollIntoViewIfNeeded();
  const componentBox = await componentCard.boundingBox();
  ci = await canvasInfo();
  await dragMouse(
    { x: componentBox.x + componentBox.width / 2, y: componentBox.y + componentBox.height / 2 },
    ci.toPage(185, 185),
  );
  await page.waitForTimeout(600);
  componentState = await page.evaluate(() => {
    const state = window.__lvd.projectStore.getState();
    return {
      linked: state.uiProject.screens[0].root.children.filter((node) => node.type.startsWith('component:')).length,
      projectedButtons: state.project.screens[0].root.children.filter((node) => node.type === 'button').length,
    };
  });
  assert(
    componentState.linked === 2 && componentState.projectedButtons === 2,
    `E2.2 面板拖放创建第二个关联实例(实际 ${JSON.stringify(componentState)})`,
  );
  await page.getByRole('button', { name: '撤销' }).click();
  await page.waitForTimeout(500);
  const buttonRect = await rectOfType('button');
  ci = await canvasInfo();
  const buttonCenter = ci.toPage(buttonRect.rect.x + buttonRect.rect.w / 2, buttonRect.rect.y + buttonRect.rect.h / 2);
  await page.mouse.click(buttonCenter.x, buttonCenter.y);
  await page.waitForTimeout(250);
  const linkedSelection = await page.evaluate(() => {
    const state = window.__lvd.projectStore.getState();
    const selected = window.__lvd.editorStore.getState().selectedIds[0];
    return state.uiProject.screens[0].root.children.some(
      (node) => node.id === selected && node.type.startsWith('component:'),
    );
  });
  assert(linkedSelection, 'E2.2 点击组件内部文字仍选中可编辑的关联实例根');
  await shotArt('e2-linked-component.png', true);

  /* ================= E3 Inspector 改 width/value + 拖动移动 ================= */
  step('E3 检查器改 width/value + 画布拖动');
  // 选中 slider:点它中心
  let sl = await rectOfType('slider');
  ci = await canvasInfo();
  let center = ci.toPage(sl.rect.x + sl.rect.w / 2, sl.rect.y + sl.rect.h / 2);
  await page.mouse.click(center.x, center.y);
  await page.waitForTimeout(300);
  const selType = await page.evaluate(() => {
    const id = window.__lvd.editorStore.getState().selectedIds[0];
    const st = window.__lvd.projectStore.getState();
    return st.project.screens[0].root.children.find((c) => c.id === id)?.type ?? null;
  });
  assert(selType === 'slider', `E3 点击画布选中 slider(实际 ${selType})`);

  const widthInput = page
    .locator('.prop-row', { has: page.locator('label[title="width"]') })
    .locator('input.ed-num');
  await widthInput.fill('200');
  await page.waitForTimeout(500);
  sl = await rectOfType('slider');
  assert(sl.rect && sl.rect.w === 200, `E3 width=200 → getObjRect w=${sl.rect?.w}`);

  const shotBeforeValue = await canvas.screenshot();
  const valueInput = page
    .locator('.prop-row', { has: page.locator('label[title="value"]') })
    .locator('input');
  await valueInput.fill('60');
  await page.waitForTimeout(900); // slider 值动画收敛
  const shotAfterValue = await canvas.screenshot();
  assert(Buffer.compare(shotBeforeValue, shotAfterValue) !== 0, 'E3 value=60 → 画布像素变化');
  m = await model();
  const slNode = m.children.find((c) => c.type === 'slider');
  assert(slNode.props.value === 60 && slNode.props.width === 200, 'E3 模型 props: width=200, value=60');
  await shotArt('e3-width200-value60.png');

  /* ================= E3.1 伴生属性 / 事件 / 数据绑定 ================= */
  step('E3.1 组件完整交互配置');
  const animatedRow = page.locator('.prop-row', { has: page.locator('label[title="value-animated"]') });
  assert(await animatedRow.count() === 1, 'E3.1 slider 的“当前值动画”伴生属性可编辑');
  await page.locator('.tabs button', { hasText: '交互' }).click();
  const sourceSection = page.locator('.insp-group', { has: page.locator('.panel-subtitle', { hasText: '数据源' }) });
  await sourceSection.locator('button', { hasText: '+ 新建' }).click();
  const bindingSection = page.locator('.insp-group', { has: page.locator('.panel-subtitle', { hasText: '数据绑定' }) });
  await bindingSection.locator('select').first().selectOption('prop:value');
  const eventSection = page.locator('.insp-group', { has: page.locator('.panel-subtitle', { hasText: '事件' }) });
  await eventSection.locator('button', { hasText: '+ 添加' }).click();
  await page.waitForTimeout(500);
  const interactionModel = await page.evaluate(() => {
    const st = window.__lvd.projectStore.getState();
    const slider = st.uiProject.screens[0].root.children.find((item) => item.type === 'slider');
    return {
      subjects: st.uiProject.subjects.map((subject) => ({ id: subject.id, codeName: subject.codeName })),
      bindings: slider?.bindings ?? [],
      events: slider?.events ?? [],
      firstScreenId: st.uiProject.screens[0].id,
    };
  });
  assert(interactionModel.subjects.length === 1, 'E3.1 可在检查器新建工程数据源');
  assert(
    interactionModel.bindings[0]?.kind === 'prop' && interactionModel.bindings[0]?.prop === 'value'
      && interactionModel.bindings[0]?.subject === interactionModel.subjects[0].id,
    'E3.1 slider.value 已绑定到新数据源',
  );
  assert(
    interactionModel.events[0]?.on === 'value_changed' && interactionModel.events[0]?.action === 'screen.open'
      && interactionModel.events[0]?.args?.screen === interactionModel.firstScreenId,
    'E3.1 slider 默认事件为“值变化 → 打开屏幕”，目标屏幕有效',
  );
  step('E3.2 设备业务 Action 配置');
  const actionRegistrySection = page.locator('[data-section="action-registry"]');
  await actionRegistrySection.locator('.panel-subtitle .clickable').click();
  await actionRegistrySection.locator('.action-create-row input').nth(0).fill('wifi_scan');
  await actionRegistrySection.locator('.action-create-row input').nth(1).fill('扫描 Wi-Fi');
  await actionRegistrySection.locator('.action-create-row button').click();
  assert(
    await actionRegistrySection.locator('[data-action-id="custom.wifi_scan"]').count() === 1,
    'E3.2 可在交互页新建设备业务动作 custom.wifi_scan',
  );
  await eventSection.locator('button', { hasText: '+ 添加' }).click();
  await eventSection.locator('[data-event-index="1"] select').nth(1).selectOption('custom.wifi_scan');
  const customEvent = await page.evaluate(() => {
    const st = window.__lvd.projectStore.getState();
    const slider = st.uiProject.screens[0].root.children.find((item) => item.type === 'slider');
    return slider?.events[1] ?? null;
  });
  assert(
    customEvent?.action === 'custom.wifi_scan' && customEvent?.on === 'value_changed',
    'E3.2 组件事件可直接选择设备业务动作',
  );
  await shotArt('e3-interaction.png', true);
  await page.locator('.tabs button', { hasText: '属性' }).click();

  // 画布拖动移动 → 松手后位置持久
  const rectBeforeDrag = sl.rect;
  ci = await canvasInfo();
  center = ci.toPage(rectBeforeDrag.x + rectBeforeDrag.w / 2, rectBeforeDrag.y + rectBeforeDrag.h / 2);
  await dragMouse(center, { x: center.x - 25 * ci.scale, y: center.y - 40 * ci.scale }, 8);
  await page.waitForTimeout(400);
  sl = await rectOfType('slider');
  assert(
    sl.rect.x !== rectBeforeDrag.x || sl.rect.y !== rectBeforeDrag.y,
    `E3 拖动生效:rect (${rectBeforeDrag.x},${rectBeforeDrag.y}) → (${sl.rect.x},${sl.rect.y})`,
  );
  const posAfterDrag = { x: sl.rect.x, y: sl.rect.y };
  await page.waitForTimeout(600);
  sl = await rectOfType('slider');
  m = await model();
  const slNode2 = m.children.find((c) => c.type === 'slider');
  assert(
    sl.rect.x === posAfterDrag.x && sl.rect.y === posAfterDrag.y &&
      slNode2.props.x === posAfterDrag.x && slNode2.props.y === posAfterDrag.y,
    `E3 松手后位置持久:模型 x/y=(${slNode2.props.x},${slNode2.props.y}) = rect(${sl.rect.x},${sl.rect.y})`,
  );
  await shotArt('e3-after-drag.png');

  /* ================= E4 样式 bg_color + undo/redo ================= */
  step('E4 样式 bg_color + undo×2/redo');
  await page.locator('.tabs button', { hasText: '样式' }).click();
  const shotBeforeStyle = await canvas.screenshot();
  const colorRow = page.locator('.prop-row', { has: page.locator('label[title="style_bg_color"]') });
  await colorRow.locator('input[type="color"]').evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '#ff3300');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  m = await model();
  let slN = m.children.find((c) => c.type === 'slider');
  assert(slN.inlineStyles[0]?.props?.bg_color === '#ff3300', 'E4 模型写入 style bg_color=#ff3300');
  const shotAfterStyle = await canvas.screenshot();
  assert(Buffer.compare(shotBeforeStyle, shotAfterStyle) !== 0, 'E4 bg_color=#ff3300 → 画布像素变化');
  // 像素:track 右端(value=60,右侧为 bg 区)应为红系
  sl = await rectOfType('slider');
  const [trackPx] = await samplePixels([
    [Math.round(sl.rect.x + sl.rect.w - 6), Math.round(sl.rect.y + sl.rect.h / 2)],
  ]);
  // 默认主题 track bg_opa 非满,红色按 opa 混入底色 → 断言红通道显著占优即可
  assert(
    trackPx[0] - trackPx[1] > 25 && trackPx[0] - trackPx[2] > 25,
    `E4 track 右端像素红通道占优 rgba(${trackPx.join(',')})`,
  );
  await shotArt('e4-bgcolor.png');

  // undo ×2:退掉 bg_color → 退掉拖动位移
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  m = await model();
  slN = m.children.find((c) => c.type === 'slider');
  assert(slN.inlineStyles.length === 0, 'E4 undo#1 → inlineStyles 清空(bg_color 回退)');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  m = await model();
  slN = m.children.find((c) => c.type === 'slider');
  assert(
    slN.props.x === rectBeforeDrag.x && slN.props.y === rectBeforeDrag.y,
    `E4 undo#2 → 位置回退到拖动前 (${slN.props.x},${slN.props.y})`,
  );
  await shotArt('e4-after-undo2.png');
  // redo ×2 恢复
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(400);
  m = await model();
  slN = m.children.find((c) => c.type === 'slider');
  assert(
    slN.props.x === posAfterDrag.x && slN.props.y === posAfterDrag.y &&
      slN.inlineStyles[0]?.props?.bg_color === '#ff3300',
    'E4 redo×2 → 位置 + bg_color 全部恢复',
  );
  await shotArt('e4-after-redo.png');

  /* ================= E5 刷新恢复(IndexedDB) ================= */
  step('E5 刷新 → IndexedDB 恢复');
  await page.waitForTimeout(2600); // autosave debounce 2s
  await page.reload();
  await page.waitForSelector('.rt-badge.rt-wasm', { timeout: 30000 });
  await page.waitForTimeout(800);
  m = await model();
  slN = m.children.find((c) => c.type === 'slider');
  assert(
    m.children.length === 3 && slN &&
      slN.props.width === 200 && slN.props.value === 60 &&
      slN.inlineStyles[0]?.props?.bg_color === '#ff3300',
    `E5 刷新后恢复:3 节点 + slider(width=200,value=60,bg_color=#ff3300)`,
  );
  assert(
    m.display.width === 240 && m.display.shape === 'round',
    'E5 display 240 round 一并恢复',
  );
  await shotArt('e5-restored.png');
  await shotArt('e5-page-full.png', true);

  /* ================= E5.1 复用样式 + 条件绑定 ================= */
  step('E5.1 局部样式提取为复用样式并绑定数据源');
  await page.locator('.tree-row', { hasText: 'slider_1' }).click();
  await page.locator('.tabs button', { hasText: '样式' }).click();
  await page.locator('.named-style-actions button', { hasText: '提取当前样式' }).click();
  await page.waitForTimeout(500);
  const extractedStyle = await page.evaluate(() => {
    const st = window.__lvd.projectStore.getState();
    const slider = st.uiProject.screens[0].root.children.find((item) => item.type === 'slider');
    return { style: st.uiProject.styles[0], local: slider?.styles ?? [], refs: slider?.styleRefs ?? [] };
  });
  assert(
    extractedStyle.style?.props?.bg_color === '#ff3300'
      && extractedStyle.local.length === 0 && extractedStyle.refs.length === 1,
    'E5.1 提取后局部样式迁入全局复用样式，并保持当前组件挂载',
  );
  await page.locator('.named-style-usage .icon-btn').click();
  await page.locator('.tabs button', { hasText: '交互' }).click();
  const styleBindingSection = page.locator('.insp-group', { has: page.locator('.panel-subtitle', { hasText: '数据绑定' }) });
  await styleBindingSection.locator('.binding-add-row select').selectOption(`style:${extractedStyle.style.id}`);
  await page.waitForTimeout(500);
  const styleBindingModel = await page.evaluate(() => {
    const st = window.__lvd.projectStore.getState();
    const slider = st.uiProject.screens[0].root.children.find((item) => item.type === 'slider');
    return { refs: slider?.styleRefs ?? [], bindings: slider?.bindings ?? [] };
  });
  assert(
    styleBindingModel.refs.length === 0
      && styleBindingModel.bindings.some((binding) => binding.kind === 'style'
        && binding.styleId === extractedStyle.style.id && binding.refValue === 1),
    'E5.1 复用样式可按整数数据源条件启用，且不依赖静态样式挂载',
  );
  await shotArt('e5-style-binding.png', true);

  /* ================= E6 导出 zip ================= */
  step('E6 导出 C 代码 zip');
  await page.evaluate(() => window.__lvd.buildTargetStore.getState().confirmColorFormat('RGB565'));
  await page.selectOption('[aria-label="目标控制器"]', 'screen-only');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.getByRole('button', { name: '导出 C 代码' }).click(),
  ]);
  const zipPath = join(artDir, 'ui.zip');
  await download.saveAs(zipPath);
  const unzipped = unzipSync(readFileSync(zipPath));
  const names = Object.keys(unzipped);
  const dec = new TextDecoder();
  const mustHave = ['ui.h', 'ui.c', 'CMakeLists.txt', 'build-manifest.json', 'actions.h', 'actions.c', 'actions_default.c', 'screens/main.h', 'screens/main.c'];
  for (const f of mustHave) assert(names.includes(f), `E6 zip 含 ${f}`);
  const buildManifest = JSON.parse(dec.decode(unzipped['build-manifest.json']));
  assert(buildManifest.lvglVersion === '9.5.0', 'E6 正式导出精确钉死 LVGL 9.5.0');
  assert(buildManifest.profiles?.controllerProfileRef?.startsWith('controller:screen-only-'), 'E6 manifest 锁定 ControllerProfile revision');
  assert(buildManifest.profiles?.displayProfileRef?.startsWith('display:'), 'E6 manifest 锁定 DisplayProfile revision');
  const mainC = dec.decode(unzipped['screens/main.c']);
  assert(mainC.includes('lv_slider_create'), 'E6 screens/main.c 含 lv_slider_create');
  assert(mainC.includes('lv_button_create') && mainC.includes('lv_label_create'), 'E6 screens/main.c 含 button/label create');
  assert(mainC.includes('lv_slider_set_value'), 'E6 screens/main.c 含 lv_slider_set_value(value=60)');
  assert(mainC.includes('lv_slider_bind_value'), 'E6 数据绑定生成 lv_slider_bind_value');
  assert(mainC.includes('lv_obj_bind_style') && mainC.includes('&style_style_1'), 'E6 条件样式绑定生成 lv_obj_bind_style');
  assert(mainC.includes('LV_EVENT_VALUE_CHANGED') && mainC.includes('lv_screen_load_anim'), 'E6 事件生成值变化回调与屏幕动作');
  const actionsH = dec.decode(unzipped['actions.h']);
  const actionsC = dec.decode(unzipped['actions.c']);
  assert(actionsH.includes('void wifi_scan(lv_event_t * e);'), 'E6 actions.h 声明设备业务回调 wifi_scan');
  assert(actionsC.includes('void wifi_scan(lv_event_t * e)'), 'E6 actions.c 生成且保留业务回调实现骨架');
  assert(mainC.includes('lv_obj_add_event_cb') && mainC.includes('wifi_scan'), 'E6 组件事件连接到 wifi_scan 回调');
  const subjectsC = dec.decode(unzipped['subjects.c']);
  assert(subjectsC.includes('lv_subject_init_int'), 'E6 新建数据源生成 Subject 初始化代码');
  // 落地 zip 内容供 EspIdf 阶段用
  for (const [p, data] of Object.entries(unzipped)) {
    const dst = join(outUiDir, p);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, data);
  }
  results.push(`E6 zip 共 ${names.length} 文件,已解压到 e2e/out-ui/:${names.join(', ')}`);
  await shotArt('e6-after-export.png', true);

  /* ================= E7 运行模式 ================= */
  step('E7 运行模式点击 button');
  const errBefore = pageErrors.length;
  await page.locator('.toolbar button', { hasText: '运行' }).click();
  await page.waitForTimeout(400);
  const handlesInPlay = await page.locator('[data-handle]').count();
  assert(handlesInPlay === 0, 'E7 运行态 overlay 手柄隐藏');
  const btn = await rectOfType('button');
  ci = await canvasInfo();
  const btnCenter = ci.toPage(btn.rect.x + btn.rect.w / 2, btn.rect.y + btn.rect.h / 2);
  await page.mouse.click(btnCenter.x, btnCenter.y);
  await page.waitForTimeout(500);
  assert(pageErrors.length === errBefore, `E7 运行态点击 button 无 JS error(errors=${pageErrors.length - errBefore})`);
  await shotArt('e7-play-mode.png', true);
  await page.locator('.toolbar button', { hasText: '停止' }).click();
  await page.waitForTimeout(500);
  const modeAfter = await page.evaluate(() => window.__lvd.editorStore.getState().mode);
  assert(modeAfter === 'design', 'E7 切回设计态');
  // 设计态选中 button → 8 手柄回来(复位可编辑)
  await page.mouse.click(btnCenter.x, btnCenter.y);
  await page.waitForTimeout(300);
  const handlesBack = await page.locator('[data-handle]').count();
  assert(handlesBack === 8, `E7 设计态选中出 8 手柄(实际 ${handlesBack})`);
  m = await model();
  assert(m.children.length === 3, 'E7 运行往返后模型无损(仍 3 节点)');
  await shotArt('e7-back-design.png', true);

  if (pageErrors.length > 0) {
    results.push(`警告:全程收集到 ${pageErrors.length} 条页面错误:${pageErrors.slice(0, 5).join(' | ')}`);
  } else {
    results.push('全程 0 条 pageerror/console.error');
  }

  await browser.close();
  console.log('E2E PASS');
  for (const r of results) console.log(' -', r);
} catch (e) {
  console.error(`E2E FAIL: ${e.message}`);
  for (const r of results) console.log(' [ok]', r);
  if (pageErrors.length) console.log(' pageErrors:', pageErrors.join(' | '));
  try {
    if (browser) {
      // 失败现场截图
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
