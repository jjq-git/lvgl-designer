import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { snapshotToEditorProject, type ProjectSnapshotV2 } from '@lvd/schema/v2';

const runE2e = process.env.LVD_SERENE_POD_E2E === '1' ? describe : describe.skip;
const models = ['WF2D-8620', 'WF2D-1040', 'WF2D-1030', 'WF2D-1050', 'WF2D-8630'];

runE2e('serene pod browser preview', () => {
  it('renders all five tailored projects and their five screens through WASM', async () => {
    const systemChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const browser = await chromium.launch(existsSync(systemChrome) ? { executablePath: systemChrome } : {});
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
        errors.push(message.text());
      }
    });

    try {
      await page.goto('http://127.0.0.1:8001/');
      if (page.url().endsWith('/login.html')) {
        await page.locator('#username').fill('admin');
        await page.locator('#password').fill('admin123');
        await page.locator('#login-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
        await page.waitForURL('http://127.0.0.1:8001/');
      }
      await page.waitForSelector('.rt-badge.rt-wasm', { timeout: 30_000 });

      for (const model of models) {
        const path = join(process.cwd(), '..', '..', 'examples', 'serene-pod', `${model}-serene-pod.lvproj.json`);
        const snapshot = JSON.parse(readFileSync(path, 'utf8')) as ProjectSnapshotV2;
        const project = snapshotToEditorProject(snapshot);
        const rendered = await page.evaluate(async (nextProject) => {
          const lvd = (window as unknown as { __lvd: any }).__lvd;
          lvd.projectStore.getState().loadProject(nextProject);
          const results = [];
          for (const screen of nextProject.screens) {
            lvd.editorStore.getState().setActiveScreen(screen.id);
            await new Promise((resolve) => setTimeout(resolve, 50));
            const runtime = lvd.getPipeline().runtime;
            runtime.tick();
            const canvas = document.querySelector('#lvgl-canvas') as HTMLCanvasElement;
            const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
            const colors = new Set<number>();
            for (let index = 0; index < pixels.length; index += 64) {
              colors.add((pixels[index]! >> 4) << 8 | (pixels[index + 1]! >> 4) << 4 | (pixels[index + 2]! >> 4));
            }
            results.push({
              name: screen.name,
              childCount: runtime.dumpTree()?.children?.length ?? 0,
              expectedChildren: screen.root.children.length,
              colorCount: colors.size,
              size: [canvas.width, canvas.height],
            });
          }
          return {
            results,
            banner: lvd.editorStore.getState().banner,
            logs: lvd.getPipeline().runtime.takeLogs(),
          };
        }, project);

        expect(rendered.banner, `${model}: ${JSON.stringify(rendered)}`).toBeNull();
        expect(rendered.results).toHaveLength(5);
        for (const screen of rendered.results) {
          expect(screen.childCount, `${model}/${screen.name}`).toBe(screen.expectedChildren);
          expect(screen.colorCount, `${model}/${screen.name} color variety`).toBeGreaterThan(5);
        }

        const outputRoot = process.env.LVD_SERENE_SCREENSHOTS_DIR;
        if (outputRoot) {
          const modelDir = join(outputRoot, model);
          mkdirSync(modelDir, { recursive: true });
          for (const screen of project.screens) {
            await page.evaluate((screenId) => {
              const lvd = (window as unknown as { __lvd: any }).__lvd;
              lvd.editorStore.getState().setActiveScreen(screenId);
            }, screen.id);
            await page.waitForTimeout(100);
            await page.evaluate(() => (window as unknown as { __lvd: any }).__lvd.getPipeline().runtime.tick());
            const dataUrl = await page.locator('#lvgl-canvas').evaluate(
              (canvas: HTMLCanvasElement) => canvas.toDataURL('image/png'),
            );
            writeFileSync(
              join(modelDir, `${screen.name}.png`),
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
