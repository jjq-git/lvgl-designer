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
  await page.evaluate(() => {
    const projectStore = window.__lvd.projectStore.getState();
    const editorStore = window.__lvd.editorStore.getState();
    const screen = projectStore.uiProject.screens[0];
    const parentId = crypto.randomUUID();
    const childId = crypto.randomUUID();
    const siblingId = crypto.randomUUID();
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
      );
    });
    editorStore.setActiveScreen(screen.id);
    projectStore.markSaved(projectStore.revision);
    window.__interactionSmoke = { parentId, childId, siblingId };
  });
  await page.waitForTimeout(250);

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
  assert(errors.length === 0, `page errors: ${errors.join(' | ')}`);

  console.log(JSON.stringify({
    ok: true,
    parentChildMove: 'passed',
    selectionScopedUndo: 'passed',
    escapeCancellation: 'passed',
    pageErrors: errors,
  }, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
