import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { snapshotToEditorProject, type ProjectSnapshotV2 } from '@lvd/schema/v2';

const runE2e = process.env.LVD_DEVICE_SHOWCASE_E2E === '1' ? describe : describe.skip;
const files = [
  'WF3-284x76-uart-grid',
  'WF2D-8620-focus-orbit',
  'WF2D-8630-greenhouse',
  'WF2D-1050-ev-charge',
  'WF2D-1040-factory-energy',
  'WF2D-1030-harbor-dispatch',
];

runE2e('device showcase browser preview', () => {
  it('renders all six different interfaces through WASM', async () => {
    const systemChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const browser = await chromium.launch(existsSync(systemChrome) ? { executablePath: systemChrome } : {});
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      const designerUrl = 'http://127.0.0.1:8001/lvgl-designer/';
      await page.goto(designerUrl);
      if (new URL(page.url()).pathname.startsWith('/login')) {
        await page.locator('#username').fill('admin');
        await page.locator('#password').fill('admin123');
        await page.locator('#login-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
        await page.waitForURL(designerUrl);
      }
      await page.waitForSelector('.rt-badge.rt-wasm', { timeout: 30_000 });

      for (const file of files) {
        const path = join(process.cwd(), '..', '..', 'examples', 'device-showcase', `${file}.lvproj.json`);
        const snapshot = JSON.parse(readFileSync(path, 'utf8')) as ProjectSnapshotV2;
        const project = snapshotToEditorProject(snapshot);
        for (const font of project.assets.fonts) {
          const fontPath = join(process.cwd(), '..', '..', 'examples', 'wf3-firmware', 'assets', font.file.fileName);
          if (!existsSync(fontPath)) continue;
          const base64 = readFileSync(fontPath).toString('base64');
          await page.evaluate(({ name, sizePx, encoded }) => {
            const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
            const lvd = (window as unknown as { __lvd: any }).__lvd;
            lvd.getPipeline().runtime.registerFontTinyTtf(name, bytes, sizePx);
          }, { name: font.name, sizePx: font.sizePx ?? 16, encoded: base64 });
        }
        const screens = project.display.width === 284
          ? [project.screens[0]!, project.screens[1]!, project.screens[3]!, project.screens[13]!, project.screens.at(-1)!]
          : project.screens;
        for (const screen of screens) {
          const expectedChildren = screen.root.children.length;
          await page.evaluate(async ({ nextProject, screenId }) => {
            const lvd = (window as unknown as { __lvd: any }).__lvd;
            lvd.projectStore.getState().loadProject(nextProject);
            lvd.editorStore.getState().setActiveScreen(screenId);
          }, { nextProject: project, screenId: screen.id });
          await page.waitForTimeout(500);
          const rendered = await page.evaluate(() => {
            const lvd = (window as unknown as { __lvd: any }).__lvd;
            lvd.getPipeline().runtime.tick();
            const canvas = document.querySelector('#lvgl-canvas') as HTMLCanvasElement;
            const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
            const colors = new Set<number>();
            for (let index = 0; index < pixels.length; index += 64) {
              colors.add((pixels[index]! >> 4) << 8 | (pixels[index + 1]! >> 4) << 4 | (pixels[index + 2]! >> 4));
            }
            return {
              size: [canvas.width, canvas.height],
              childCount: lvd.getPipeline().runtime.dumpTree()?.children?.length ?? 0,
              colorCount: colors.size,
              activeScreenId: lvd.editorStore.getState().activeScreenId,
              projectName: lvd.projectStore.getState().project.meta.name,
              logs: lvd.getPipeline().runtime.takeLogs(),
              banner: lvd.editorStore.getState().banner,
            };
          });
          expect(rendered.size).toEqual([project.display.width, project.display.height]);
          expect(rendered.activeScreenId).toBe(screen.id);
          expect(rendered.childCount, `${file}/${screen.name}: ${JSON.stringify(rendered)}`).toBe(expectedChildren);
          expect(rendered.colorCount, `${file}/${screen.name} color variety`).toBeGreaterThan(5);

          const outputRoot = process.env.LVD_DEVICE_SHOWCASE_SCREENSHOTS_DIR;
          if (outputRoot) {
            mkdirSync(outputRoot, { recursive: true });
            const dataUrl = await page.locator('#lvgl-canvas').evaluate(
              (canvas: HTMLCanvasElement) => canvas.toDataURL('image/png'),
            );
            writeFileSync(
              join(outputRoot, `${file}-${screen.name}.png`),
              Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'),
            );
          }
        }
      }
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
