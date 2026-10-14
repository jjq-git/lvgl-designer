import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { snapshotToEditorProject, type ProjectSnapshotV2 } from '@lvd/schema/v2';

const runE2e = process.env.LVD_AIR_COMFORT_E2E === '1' ? describe : describe.skip;
const fixtures = [
  {
    file: 'WF2D-1050-air-comfort.lvproj.json', size: [1024, 600], output: 'wf2d-1050',
    valueNode: 'air1050_fan_value', up: [283, 446], expectedScreens: 3,
  },
  {
    file: 'WF2D-8630-room-climate.lvproj.json', size: [480, 480], output: 'wf2d-8630',
    valueNode: 'room8630_target_value', up: [345, 277], expectedScreens: 3,
  },
] as const;

runE2e('air comfort project pair browser preview', () => {
  it('renders and interacts through the LVGL WASM runtime', async () => {
    const systemChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const browser = await chromium.launch(existsSync(systemChrome) ? { executablePath: systemChrome } : {});
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
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
      const outputRoot = process.env.LVD_AIR_COMFORT_SCREENSHOTS_DIR;

      for (const fixture of fixtures) {
        const path = new URL(`../../../examples/air-comfort/${fixture.file}`, import.meta.url);
        const snapshot = JSON.parse(readFileSync(path, 'utf8')) as ProjectSnapshotV2;
        const project = snapshotToEditorProject(snapshot);
        const outputDir = outputRoot ? join(outputRoot, fixture.output) : null;
        if (outputDir) mkdirSync(outputDir, { recursive: true });

        for (const screen of project.screens) {
          await page.evaluate(({ nextProject, screenId }) => {
            const lvd = (window as unknown as { __lvd: any }).__lvd;
            lvd.projectStore.getState().loadProject(nextProject);
            lvd.editorStore.getState().setActiveScreen(screenId);
          }, { nextProject: project, screenId: screen.id });
          await page.waitForTimeout(350);
          const rendered = await page.evaluate(() => {
            const lvd = (window as unknown as { __lvd: any }).__lvd;
            const runtime = lvd.getPipeline().runtime;
            runtime.tick();
            const canvas = document.querySelector('#lvgl-canvas') as HTMLCanvasElement;
            const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
            const colors = new Set<number>();
            for (let index = 0; index < pixels.length; index += 64) {
              colors.add(((pixels[index]! >> 4) << 8) | ((pixels[index + 1]! >> 4) << 4) | (pixels[index + 2]! >> 4));
            }
            return { size: [canvas.width, canvas.height], colorCount: colors.size,
              childCount: runtime.dumpTree()?.children?.length ?? 0,
              banner: lvd.editorStore.getState().banner };
          });
          expect(rendered.size).toEqual(fixture.size);
          expect(rendered.childCount).toBe(screen.root.children.length);
          expect(rendered.colorCount).toBeGreaterThan(8);
          expect(rendered.banner).toBeNull();
          if (screen.name === 'room8630_air') {
            const planNav = await page.evaluate(() => {
              const runtime = (window as unknown as { __lvd: any }).__lvd.getPipeline().runtime;
              const rect = runtime.getObjRect('room8630_air_nav_schedule_text');
              if (!rect) return { rect: null, colorCount: 0 };
              const canvas = document.querySelector('#lvgl-canvas') as HTMLCanvasElement;
              const pixels = canvas.getContext('2d')!.getImageData(rect.x, rect.y, rect.w, rect.h).data;
              const colors = new Set<number>();
              for (let index = 0; index < pixels.length; index += 4) {
                colors.add((pixels[index]! << 16) | (pixels[index + 1]! << 8) | pixels[index + 2]!);
              }
              return { rect, colorCount: colors.size };
            });
            expect(planNav.rect).toEqual({ x: 325, y: 442, w: 144, h: 22 });
            expect(planNav.colorCount).toBeGreaterThan(2);
          }
          if (outputDir) {
            const dataUrl = await page.locator('#lvgl-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL('image/png'));
            writeFileSync(join(outputDir, `${screen.name}.png`), Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
          }
        }

        const home = project.screens.find((screen) => screen.isHome)!;
        await page.evaluate(({ nextProject, screenId }) => {
          const lvd = (window as unknown as { __lvd: any }).__lvd;
          lvd.projectStore.getState().loadProject(nextProject);
          lvd.editorStore.getState().setActiveScreen(screenId);
          lvd.editorStore.getState().setMode('play');
        }, { nextProject: project, screenId: home.id });
        await page.waitForTimeout(250);
        const canvas = page.locator('#lvgl-canvas');
        const before = await canvas.evaluate((item: HTMLCanvasElement) => item.toDataURL('image/png'));
        const box = await canvas.boundingBox();
        expect(box).not.toBeNull();
        await canvas.click({ position: {
          x: box!.width * fixture.up[0] / fixture.size[0], y: box!.height * fixture.up[1] / fixture.size[1],
        } });
        await page.waitForTimeout(120);
        const valueColorCount = await page.evaluate((valueNode) => {
          const runtime = (window as unknown as { __lvd: any }).__lvd.getPipeline().runtime;
          runtime.tick();
          const rect = runtime.getObjRect(valueNode);
          if (!rect) return 0;
          const canvas = document.querySelector('#lvgl-canvas') as HTMLCanvasElement;
          const pixels = canvas.getContext('2d')!.getImageData(rect.x, rect.y, rect.w, rect.h).data;
          const colors = new Set<number>();
          for (let index = 0; index < pixels.length; index += 4) colors.add((pixels[index]! << 16) | (pixels[index + 1]! << 8) | pixels[index + 2]!);
          return colors.size;
        }, fixture.valueNode);
        expect(valueColorCount).toBeGreaterThan(2);
        const after = await canvas.evaluate((item: HTMLCanvasElement) => item.toDataURL('image/png'));
        expect(after).not.toBe(before);
        if (outputDir) writeFileSync(join(outputDir, 'interaction-increment.png'), Buffer.from(after.slice(after.indexOf(',') + 1), 'base64'));
        expect(project.screens).toHaveLength(fixture.expectedScreens);
      }
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
