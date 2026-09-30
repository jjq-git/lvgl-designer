/** Browser regression for canvas selection normalization and cancelled interactions. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { get } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const viteCli = join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');
const port = 4190;
const url = `http://127.0.0.1:${port}/`;
const server = spawn(process.execPath, [
  viteCli, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort',
], {
  cwd: appDir,
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (chunk) => process.stdout.write(chunk));
server.stderr.on('data', (chunk) => process.stderr.write(chunk));

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await new Promise((resolve) => {
      const request = get(url, (response) => {
        response.resume();
        resolve((response.statusCode ?? 500) < 400);
      });
      request.on('error', () => resolve(false));
      request.setTimeout(500, () => {
        request.destroy();
        resolve(false);
      });
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Vite preview did not start');
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

let browser;
try {
  await waitForServer();
  const systemChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  browser = await chromium.launch(
    process.platform === 'win32' && existsSync(systemChrome) ? { executablePath: systemChrome } : {},
  );
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      errors.push(message.text());
    }
  });

  await page.goto(url);
  await page.waitForSelector('.rt-badge.rt-wasm', { timeout: 30_000 });
  assert(await page.locator('.ai-panel').isVisible(), 'AI panel is expanded by default');
  const paletteIconState = await page.locator('.palette-item').evaluateAll((items) => ({
    count: items.length,
    allSemanticSvg: items.every((item) => {
      const icon = item.querySelector('svg.wthumb');
      return icon !== null && icon.querySelector('path, rect, circle') !== null;
    }),
  }));
  assert(paletteIconState.count > 0, 'widget palette is populated');
  assert(paletteIconState.allSemanticSvg, 'every visible palette item uses a semantic SVG icon');
  const leftBox = await page.locator('.side-left').boundingBox();
  const treeBox = await page.locator('.tree-dock').boundingBox();
  const canvasBoxBeforeCollapse = await page.locator('.canvas-panel').boundingBox();
  assert(leftBox && treeBox && treeBox.x >= leftBox.x + leftBox.width,
    'object tree is docked between the palette and canvas');
  assert(await page.locator('.tree-dock-body').isVisible(), 'object tree dock is expanded by default');
  assert(await page.locator('.tree-search input').isVisible(), 'object tree search is available');
  await page.locator('.tree-dock-toggle').click();
  await page.waitForTimeout(250);
  const canvasBoxAfterCollapse = await page.locator('.canvas-panel').boundingBox();
  assert(await page.locator('.tree-dock').evaluate((element) => element.classList.contains('collapsed')),
    'object tree enters its collapsed state');
  assert(await page.locator('.tree-dock').evaluate((element) => element.getBoundingClientRect().width) < 1,
    'collapsed object tree does not keep an empty vertical rail');
  assert(await page.locator('.tree-canvas-resize-handle').evaluate(
    (element) => element.getBoundingClientRect().width,
  ) < 1, 'collapsed object tree hides its resize handle');
  assert(await page.locator('.tree-dock-collapsed-toggle').isVisible(),
    'collapsed object tree keeps only its expand button');
  assert(canvasBoxBeforeCollapse && canvasBoxAfterCollapse
    && canvasBoxAfterCollapse.width > canvasBoxBeforeCollapse.width,
  'canvas expands when the object tree is collapsed');
  await page.locator('.tree-dock-collapsed-toggle').click();
  await page.waitForSelector('.tree-dock-body');
  const rightWidthBeforeTreeResize = await page.locator('.side-right').evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  const paletteWidthBeforeTreeResize = await page.locator('.side-left').evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  const treeResizeHandle = await page.locator('.tree-canvas-resize-handle').boundingBox();
  if (!treeResizeHandle) throw new Error('Object tree resize handle is unavailable');
  await page.mouse.move(treeResizeHandle.x + treeResizeHandle.width / 2, treeResizeHandle.y + 180);
  await page.mouse.down();
  await page.mouse.move(treeResizeHandle.x + treeResizeHandle.width / 2 + 40, treeResizeHandle.y + 180, { steps: 6 });
  await page.mouse.up();
  const rightWidthAfterTreeResize = await page.locator('.side-right').evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  const paletteWidthAfterTreeResize = await page.locator('.side-left').evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  assert(Math.abs(rightWidthAfterTreeResize - rightWidthBeforeTreeResize) < 1,
    'resizing the object tree does not resize the inspector');
  assert(Math.abs(paletteWidthAfterTreeResize - paletteWidthBeforeTreeResize) < 1,
    'resizing the object tree does not resize the component palette');
  await page.evaluate(() => {
    const projectStore = window.__lvd.projectStore.getState();
    const editorStore = window.__lvd.editorStore.getState();
    const screen = projectStore.uiProject.screens[0];
    const parentId = crypto.randomUUID();
    const childId = crypto.randomUUID();
    const siblingId = crypto.randomUUID();
    const offscreenId = crypto.randomUUID();
    projectStore.mutateV2('interaction smoke fixture', (draft) => {
      draft.screens[0].root.children.push(
        {
          id: parentId,
          type: 'obj',
          codeName: 'smoke_parent',
          props: { x: 20, y: 20, width: 100, height: 100 },
          styleRefs: [],
          styles: [],
          events: [],
          bindings: [],
          children: [{
            id: childId,
            type: 'label',
            codeName: 'smoke_child',
            props: { x: 5, y: 5, text: 'child' },
            styleRefs: [],
            styles: [],
            events: [],
            bindings: [],
            children: [],
          }],
        },
        {
          id: siblingId,
          type: 'button',
          codeName: 'smoke_sibling',
          props: { x: 150, y: 20, width: 80, height: 40 },
          styleRefs: [],
          styles: [],
          events: [],
          bindings: [],
          children: [],
        },
        {
          id: offscreenId,
          type: 'obj',
          codeName: 'smoke_offscreen',
          props: { x: 260, y: -60, width: 80, height: 40 },
          styleRefs: [],
          styles: [],
          events: [],
          bindings: [],
          children: [],
        },
      );
    });
    editorStore.setActiveScreen(screen.id);
    projectStore.markSaved(projectStore.revision);
    window.__interactionSmoke = { parentId, childId, siblingId, offscreenId };
  });
  await page.waitForTimeout(250);
  await page.locator('.tree-search input').fill('smoke_child');
  assert(await page.getByText('smoke_child', { exact: true }).isVisible(),
    'object tree search keeps matching nodes visible');
  assert(await page.getByText('smoke_sibling', { exact: true }).count() === 0,
    'object tree search filters non-matching branches');
  await page.locator('.tree-search input').fill('');

  const stage = page.locator('.stage');
  const ids = await page.evaluate(() => window.__interactionSmoke);
  await page.evaluate(({ parentId, childId }) => {
    window.__lvd.editorStore.getState().select([parentId, childId]);
  }, ids);
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  let state = await page.evaluate(({ parentId, childId }) => {
    const store = window.__lvd.projectStore.getState();
    const find = (node, id) => node.id === id ? node : node.children.map((child) => find(child, id)).find(Boolean);
    const root = store.uiProject.screens[0].root;
    return { parentX: find(root, parentId).props.x, childX: find(root, childId).props.x };
  }, ids);
  assert(state.parentX === 21, 'selected parent moves once');
  assert(state.childX === 5, 'selected child is not double-moved with its parent');
  await page.keyboard.press('Control+z');

  await page.evaluate(({ parentId }) => window.__lvd.editorStore.getState().select([parentId]), ids);
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await page.evaluate(({ siblingId }) => window.__lvd.editorStore.getState().select([siblingId]), ids);
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+z');
  state = await page.evaluate(({ parentId, siblingId }) => {
    const root = window.__lvd.projectStore.getState().uiProject.screens[0].root;
    const find = (node, id) => node.id === id ? node : node.children.map((child) => find(child, id)).find(Boolean);
    return { parentX: find(root, parentId).props.x, siblingX: find(root, siblingId).props.x };
  }, ids);
  assert(state.parentX === 21 && state.siblingX === 150, 'nudge history does not merge across selections');
  await page.keyboard.press('Control+z');

  const undoCountBeforeDrag = await page.evaluate(({ parentId }) => {
    const projectStore = window.__lvd.projectStore.getState();
    projectStore.markSaved(projectStore.revision);
    window.__lvd.editorStore.getState().select([parentId]);
    return projectStore.undoStack.length;
  }, ids);
  await page.waitForTimeout(150);
  const rect = await page.evaluate(({ parentId }) => window.__lvd.getPipeline().rectOf(parentId), ids);
  const canvasBox = await page.locator('#lvgl-canvas').boundingBox();
  const canvasSize = await page.locator('#lvgl-canvas').evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
  }));
  if (!rect || !canvasBox) throw new Error('Canvas fixture rect is unavailable');
  const scaleX = canvasBox.width / canvasSize.width;
  const scaleY = canvasBox.height / canvasSize.height;
  const from = {
    x: canvasBox.x + (rect.x + rect.w - 10) * scaleX,
    y: canvasBox.y + (rect.y + rect.h - 10) * scaleY,
  };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 20, { steps: 6 });
  const duringDrag = await page.evaluate(() => window.__lvd.projectStore.getState().dirty);
  assert(duringDrag, 'drag creates a transient dirty state');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  state = await page.evaluate(({ parentId }) => {
    const projectStore = window.__lvd.projectStore.getState();
    const root = projectStore.uiProject.screens[0].root;
    const find = (node, id) => node.id === id ? node : node.children.map((child) => find(child, id)).find(Boolean);
    const editor = window.__lvd.editorStore.getState();
    return {
      parentX: find(root, parentId).props.x,
      parentY: find(root, parentId).props.y,
      dirty: projectStore.dirty,
      undoCount: projectStore.undoStack.length,
      guides: editor.guides,
      marquee: editor.marquee,
    };
  }, ids);
  assert(state.parentX === 20 && state.parentY === 20, 'Escape restores pre-drag geometry');
  assert(state.dirty === false, 'Escape restores the pre-drag dirty state');
  assert(state.undoCount === undoCountBeforeDrag, 'cancelled drag does not create undo history');
  assert(state.guides === null && state.marquee === null, 'cancelled interaction clears overlays');

  await page.evaluate(({ offscreenId }) => {
    window.__lvd.editorStore.getState().select([offscreenId]);
  }, ids);
  const overflowOutline = page.locator(`[data-selected-id="${ids.offscreenId}"]`);
  await overflowOutline.waitFor();
  const overflowBox = await overflowOutline.boundingBox();
  if (!overflowBox) throw new Error('Offscreen selection outline is unavailable');
  const overflowCenter = {
    x: overflowBox.x + overflowBox.width / 2,
    y: overflowBox.y + overflowBox.height / 2,
  };
  await page.mouse.move(overflowCenter.x, overflowCenter.y);
  await page.mouse.down();
  await page.mouse.move(overflowCenter.x, overflowCenter.y + 100, { steps: 8 });
  await page.mouse.up();
  const recoveredY = await page.evaluate(({ offscreenId }) => {
    const root = window.__lvd.projectStore.getState().uiProject.screens[0].root;
    const find = (node, id) => node.id === id ? node : node.children.map((child) => find(child, id)).find(Boolean);
    return find(root, offscreenId).props.y;
  }, ids);
  assert(recoveredY > -60, 'an offscreen selected widget can be dragged back toward the display');
  assert(errors.length === 0, `page errors: ${errors.join(' | ')}`);

  console.log(JSON.stringify({
    ok: true,
    parentChildMove: 'passed',
    selectionScopedUndo: 'passed',
    escapeCancellation: 'passed',
    offscreenDragRecovery: 'passed',
    aiDefaultOpen: 'passed',
    semanticPaletteIcons: 'passed',
    objectTreeDock: 'passed',
    objectTreeSearch: 'passed',
    objectTreeResizeIsolation: 'passed',
    pageErrors: errors,
  }, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
