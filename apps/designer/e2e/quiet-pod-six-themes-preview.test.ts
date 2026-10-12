import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { snapshotToEditorProject, type ProjectSnapshotV2 } from '@lvd/schema/v2';

const runE2e = process.env.LVD_SIX_QUIET_POD_E2E === '1' ? describe : describe.skip;
const files = [
  'WF2D-8620-quiet-focus',
  'WF2D-8630-quiet-acoustics',
  'WF2D-1050-quiet-lighting',
  'WF2D-1040-quiet-air',
  'WF2D-1030-quiet-booking',
  'WF3-284x76-quiet-dnd',
];

runE2e('six quiet-pod home previews', () => {
  it('renders every differentiated home through the real WASM runtime', async () => {
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
        const path = join(process.cwd(), '..', '..', 'examples', 'quiet-pod-six-themes', `${file}.lvproj.json`);
        const snapshot = JSON.parse(readFileSync(path, 'utf8')) as ProjectSnapshotV2;
        const project = snapshotToEditorProject(snapshot);
        const home = project.screens.find((screen) => screen.isHome)!;
        await page.evaluate(async ({ nextProject, screenId }) => {
          const lvd = (window as unknown as { __lvd: any }).__lvd;
          lvd.projectStore.getState().loadProject(nextProject);
          lvd.editorStore.getState().setActiveScreen(screenId);
        }, { nextProject: project, screenId: home.id });
        await page.waitForTimeout(250);
        const rendered = await page.evaluate(() => {
          const lvd = (window as unknown as { __lvd: any }).__lvd;
          const runtime = lvd.getPipeline().runtime;
          runtime.tick();
          const canvas = document.querySelector('#lvgl-canvas') as HTMLCanvasElement;
          const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
          const colors = new Set<number>();
          for (let index = 0; index < pixels.length; index += 64) {
            colors.add((pixels[index]! >> 4) << 8 | (pixels[index + 1]! >> 4) << 4 | (pixels[index + 2]! >> 4));
          }
          return {
            size: [canvas.width, canvas.height],
            childCount: runtime.dumpTree()?.children?.length ?? 0,
            colorCount: colors.size,
            banner: lvd.editorStore.getState().banner,
            logs: runtime.takeLogs(),
          };
        });
        expect(rendered.size).toEqual([project.display.width, project.display.height]);
        expect(rendered.childCount, `${file}: ${JSON.stringify(rendered)}`).toBe(home.root.children.length);
        expect(rendered.colorCount, `${file}: color variety`).toBeGreaterThan(4);
        expect(rendered.banner, `${file}: ${JSON.stringify(rendered)}`).toBeNull();

        const outputRoot = process.env.LVD_SIX_QUIET_POD_SCREENSHOTS_DIR;
        if (outputRoot) {
          mkdirSync(outputRoot, { recursive: true });
          const dataUrl = await page.locator('#lvgl-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL('image/png'));
          writeFileSync(join(outputRoot, `${file}.png`), Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
        }
      }
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
