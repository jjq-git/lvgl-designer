/** Browser smoke test for the built LVGL 9.5 PreviewProgram runtime. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const viteCli = join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');
const port = 4188;
const url = `http://localhost:${port}/`;
const server = spawn(process.execPath, [viteCli, 'preview', '--port', String(port), '--strictPort'], {
  cwd: appDir,
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (chunk) => process.stdout.write(chunk));
server.stderr.on('data', (chunk) => process.stderr.write(chunk));

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Retry while Vite starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Vite preview did not start');
}

let browser;
try {
  await waitForServer();
  const systemChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  browser = await chromium.launch(
    process.platform === 'win32' && existsSync(systemChrome) ? { executablePath: systemChrome } : {},
  );
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      errors.push(message.text());
    }
  });

  await page.goto(url);
  await page.waitForSelector('.rt-badge.rt-wasm', { timeout: 30_000 });
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    const pipeline = window.__lvd.getPipeline();
    const runtime = pipeline.runtime;
    return {
      badge: document.querySelector('.rt-badge')?.textContent ?? '',
      previewProgram: runtime.supportsPreviewProgram(),
      missingPreviewExports: (runtime.missingExports ?? []).filter((name) => name.startsWith('lvd_preview_')),
      tree: runtime.dumpTree(),
      display: window.__lvd.projectStore.getState().project.display,
    };
  });

  const paletteButton = page.locator('[data-widget="button"]').last();
  await paletteButton.scrollIntoViewIfNeeded();
  const paletteBox = await paletteButton.boundingBox();
  const canvasBox = await page.locator('#lvgl-canvas').boundingBox();
  if (!paletteBox || !canvasBox) throw new Error('palette button or LVGL canvas is not visible');
  await page.mouse.move(paletteBox.x + paletteBox.width / 2, paletteBox.y + paletteBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const afterDrop = await page.evaluate(() => {
    const state = window.__lvd.projectStore.getState();
    return {
      childTypes: state.project.screens[0].root.children.map((node) => node.type),
      tree: window.__lvd.getPipeline().runtime.dumpTree(),
    };
  });

  await page.evaluate(() => {
    window.__lvd.projectStore.getState().mutateV2('target-format-smoke', (draft) => {
      draft.screens[0].root.styles = [{ props: { bg_color: '#123456', bg_opa: 255 } }];
    });
  });
  if (!await page.evaluate(() => Boolean(window.__lvd?.buildTargetStore))) {
    throw new Error(`toolbar disappeared after v2 edit: ${errors.join(' | ') || 'no captured page error'}`);
  }
  await page.evaluate(() => {
    window.__lvd.buildTargetStore.getState().confirmColorFormat('RGB565_SWAPPED');
    window.__lvd.getPipeline().refreshTarget();
  });
  await page.selectOption('[aria-label="目标控制器"]', 'screen-only');
  await page.waitForTimeout(100);
  const targetPreview = await page.evaluate(() => {
    window.__lvd.getPipeline().runtime.tick();
    const canvas = document.querySelector('#lvgl-canvas');
    return {
      selection: window.__lvd.buildTargetStore.getState().displayProfile.colorFormat,
      controller: document.querySelector('[aria-label="目标控制器"]')?.value,
      badge: document.querySelector('.rt-badge')?.textContent ?? '',
      pixel: [...canvas.getContext('2d').getImageData(10, 10, 1, 1).data],
    };
  });

  const pixelFormats = {};
  for (const colorFormat of [
    'RGB565', 'RGB565_SWAPPED', 'RGB888', 'XRGB8888', 'ARGB8888',
  ]) {
    await page.evaluate((format) => {
      const runtime = window.__lvd.getPipeline().runtime;
      const root = {
        id: 'format-root',
        type: 'obj',
        runtimeName: 'format_screen',
        named: true,
        kind: 'widget',
        useObjBase: false,
        createProps: {},
        props: {},
        flags: [],
        states: [],
        inlineStyles: [{ props: { bg_color: '#123456', bg_opa: 255 } }],
        styleUses: [],
        bindings: [],
        events: [],
        children: [],
      };
      runtime.loadPreviewProgram({
        protocolVersion: 1,
        display: { width: 64, height: 64, colorFormat: format },
        globals: { consts: [], styles: [], subjects: [], fonts: [], images: [] },
        screens: [{
          id: 'format-screen', name: 'format_screen', consts: [], styles: [], root,
        }],
        homeScreenName: 'format_screen',
        runtimeNameToNodeId: { format_screen: { format_screen: 'format-root' } },
      });
    }, colorFormat);
    await page.waitForTimeout(50);
    pixelFormats[colorFormat] = await page.evaluate(() => {
      const runtime = window.__lvd.getPipeline().runtime;
      runtime.tick();
      const canvas = document.querySelector('#lvgl-canvas');
      const pixel = canvas.getContext('2d').getImageData(32, 32, 1, 1).data;
      return { pixel: [...pixel], size: [canvas.width, canvas.height] };
    });
  }

  const p0Interaction = await page.evaluate(async () => {
    const runtime = window.__lvd.getPipeline().runtime;
    const node = (id, type, props = {}, events = []) => ({
      id,
      type,
      runtimeName: id,
      named: true,
      kind: 'widget',
      useObjBase: false,
      createProps: {},
      props,
      flags: [],
      states: [],
      inlineStyles: [],
      styleUses: [],
      bindings: [],
      events,
      children: [],
    });
    const root = node('p0_screen', 'obj');
    root.children.push(
      node('p0_button', 'button', { x: 8, y: 8, width: 48, height: 48 }, [
        { kind: 'callback', trigger: 'clicked', callback: 'smoke_click' },
      ]),
      node('p0_label', 'label', { x: 64, y: 8, text: 'P0' }),
      node('p0_slider', 'slider', {
        x: 64, y: 48, width: 48, min_value: 0, max_value: 100, value: 30,
      }),
    );
    const events = [];
    const unsubscribe = runtime.onEventStub((name, code) => events.push([name, code]));
    runtime.loadPreviewProgram({
      protocolVersion: 1,
      display: { width: 120, height: 80, colorFormat: 'XRGB8888' },
      globals: { consts: [], styles: [], subjects: [], fonts: [], images: [] },
      screens: [{ id: 'p0-screen-id', name: 'p0_screen', consts: [], styles: [], root }],
      homeScreenName: 'p0_screen',
      runtimeNameToNodeId: {
        p0_screen: {
          p0_screen: 'p0_screen', p0_button: 'p0_button',
          p0_label: 'p0_label', p0_slider: 'p0_slider',
        },
      },
    });
    runtime.setMode('play');
    await new Promise((resolve) => setTimeout(resolve, 40));
    runtime.tick();
    const canvas = document.querySelector('#lvgl-canvas');
    const rect = canvas.getBoundingClientRect();
    const clientX = rect.left + 24 * rect.width / canvas.width;
    const clientY = rect.top + 24 * rect.height / canvas.height;
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: false, pointerId: 41, button: 0, clientX, clientY,
    }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    runtime.tick();
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: false, pointerId: 41, button: 0, clientX, clientY,
    }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    runtime.tick();
    unsubscribe();
    return { tree: runtime.dumpTree(), events };
  });

  const migratedWidgets = await page.evaluate(() => {
    const runtime = window.__lvd.getPipeline().runtime;
    const png = Uint8Array.from(atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    ), (char) => char.charCodeAt(0));
    runtime.registerImage('preview-button.png', png);
    const node = (id, type, kind = 'widget', createProps = {}, props = {}) => ({
      id, type, runtimeName: id, named: true, kind, useObjBase: kind !== 'widget',
      createProps, props, flags: [], states: [], inlineStyles: [], styleUses: [],
      bindings: [], events: [], children: [],
    });
    const root = node('migrated_screen', 'obj');
    const list = node('migrated_list', 'list', 'widget', {}, {
      x: 4, y: 4, width: 120, height: 100,
    });
    list.children.push(
      node('migrated_list_title', 'list-text', 'add', { text: 'Network' }),
      node('migrated_list_wifi', 'list-button', 'add', {
        icon: 'preview-button.png', text: 'Wi-Fi',
      }),
    );
    const imagebutton = node('migrated_imagebutton', 'imagebutton', 'widget', {}, {
      x: 140, y: 16, src_released_left: 'preview-button.png',
      src_pressed_left: 'preview-button.png', state: 'released',
    });
    root.children.push(list, imagebutton);
    runtime.loadPreviewProgram({
      protocolVersion: 1,
      display: { width: 200, height: 120, colorFormat: 'XRGB8888' },
      globals: { consts: [], styles: [], subjects: [], fonts: [], images: [] },
      screens: [{ id: 'migrated-screen-id', name: 'migrated_screen', consts: [], styles: [], root }],
      homeScreenName: 'migrated_screen',
      runtimeNameToNodeId: {
        migrated_screen: {
          migrated_screen: 'migrated_screen', migrated_list: 'migrated_list',
          migrated_list_title: 'migrated_list_title', migrated_list_wifi: 'migrated_list_wifi',
          migrated_imagebutton: 'migrated_imagebutton',
        },
      },
    });
    runtime.tick();
    return runtime.dumpTree();
  });

  if (!result.previewProgram) throw new Error('runtime did not select PreviewProgram');
  if (result.missingPreviewExports.length > 0) {
    throw new Error(`missing PreviewProgram exports: ${result.missingPreviewExports.join(', ')}`);
  }
  if (!result.tree || typeof result.tree !== 'object') throw new Error('PreviewProgram did not create an LVGL tree');
  if (!afterDrop.childTypes.includes('button')) throw new Error('palette drop did not update the project');
  if (!JSON.stringify(afterDrop.tree).includes('lv_button')) {
    throw new Error('PreviewProgram reload did not create an LVGL button');
  }
  if (targetPreview.selection !== 'RGB565_SWAPPED'
    || targetPreview.badge !== 'LVGL 9.5 · WASM 编辑预览') {
    throw new Error(`DisplayProfile selection or preview badge is incorrect: ${JSON.stringify(targetPreview)}`);
  }
  if (targetPreview.controller !== 'screen-only') {
    throw new Error(`ControllerProfile selection did not reach target sidecar: ${JSON.stringify(targetPreview)}`);
  }
  if (targetPreview.pixel.some((value, index) => Math.abs(value - [16, 53, 82, 255][index]) > 1)) {
    throw new Error(`DisplayProfile did not drive RGB565_SWAPPED framebuffer: ${targetPreview.pixel.join(',')}`);
  }
  const target = [0x12, 0x34, 0x56, 0xff];
  for (const [format, sample] of Object.entries(pixelFormats)) {
    if (sample.size[0] !== 64 || sample.size[1] !== 64) {
      throw new Error(`${format} did not resize Module.canvas: ${sample.size.join('x')}`);
    }
    const tolerance = format.startsWith('RGB565') ? 8 : 1;
    if (sample.pixel.some((value, index) => Math.abs(value - target[index]) > tolerance)) {
      throw new Error(`${format} Canvas pixel mismatch: ${sample.pixel.join(',')}`);
    }
  }
  const p0Tree = JSON.stringify(p0Interaction.tree);
  for (const widgetClass of ['lv_button', 'lv_label', 'lv_slider']) {
    if (!p0Tree.includes(widgetClass)) throw new Error(`P0 smoke missing ${widgetClass}`);
  }
  if (!p0Interaction.events.some(([name]) => name === 'smoke_click')) {
    throw new Error(`custom pointer indev did not dispatch click: ${JSON.stringify(p0Interaction.events)}`);
  }
  const migratedTree = JSON.stringify(migratedWidgets);
  for (const widgetClass of ['lv_list', 'lv_imagebutton']) {
    if (!migratedTree.includes(widgetClass)) throw new Error(`migrated widget smoke missing ${widgetClass}`);
  }
  if (errors.length > 0) throw new Error(`browser errors: ${errors.join(' | ')}`);
  console.log(JSON.stringify({
    ...result, afterDrop, targetPreview, pixelFormats, p0Interaction, migratedWidgets,
  }, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
