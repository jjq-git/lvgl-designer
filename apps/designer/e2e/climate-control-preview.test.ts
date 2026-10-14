import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { snapshotToEditorProject, type ProjectSnapshotV2 } from '@lvd/schema/v2';

const runE2e = process.env.LVD_CLIMATE_CONTROL_E2E === '1' ? describe : describe.skip;

runE2e('climate control browser preview', () => {
  it('renders all screens through the LVGL WASM runtime', async () => {
    const systemChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const browser = await chromium.launch(existsSync(systemChrome) ? { executablePath: systemChrome } : {});
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
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

      const path = new URL(
        '../../../examples/climate-control/WF2D-1030-climate-control.lvproj.json',
        import.meta.url,
      );
      const snapshot = JSON.parse(readFileSync(path, 'utf8')) as ProjectSnapshotV2;
      const project = snapshotToEditorProject(snapshot);
      const outputDir = process.env.LVD_CLIMATE_CONTROL_SCREENSHOTS_DIR;
      if (outputDir) mkdirSync(outputDir, { recursive: true });

      const cloudProjectId = await page.evaluate(async () => {
        const response = await fetch('/api/lvgl/projects');
        if (!response.ok) return null;
        const payload = await response.json() as { projects?: { id: string; name: string }[] };
        return payload.projects?.find((item) => item.name === 'WF2D-1030 Climate Control')?.id ?? null;
      });
      if (cloudProjectId !== null) {
        await page.locator('.toolbar-spec-select').selectOption('WF2D-1030');
        await page.waitForSelector(`.toolbar-ui-select option[value="${cloudProjectId}"]`, {
          state: 'attached', timeout: 10_000,
        });
        await page.locator('.toolbar-ui-select').selectOption(cloudProjectId);
        await page.waitForFunction(() => (
          (window as unknown as { __lvd: any }).__lvd.projectStore.getState().project.meta.name
            === 'WF2D-1030 Climate Control'
        ));
        await page.waitForFunction(() => {
          const runtime = (window as unknown as { __lvd: any }).__lvd.getPipeline().runtime;
          return runtime.getObjRect('climate_target_value') !== null
            && runtime.getObjRect('climate_scene_away')?.w === 156;
        });
        await page.waitForTimeout(250);
        const cloudRendered = await page.evaluate(() => {
          const lvd = (window as unknown as { __lvd: any }).__lvd;
          const runtime = lvd.getPipeline().runtime;
          runtime.tick();
          const rect = runtime.getObjRect('climate_target_value');
          if (rect === null) return { rect: null, colorCount: 0, sceneRects: [] };
          const canvas = document.querySelector('#lvgl-canvas') as HTMLCanvasElement;
          const pixels = canvas.getContext('2d')!.getImageData(rect.x, rect.y, rect.w, rect.h).data;
          const colors = new Set<number>();
          for (let index = 0; index < pixels.length; index += 4) {
            colors.add((pixels[index]! << 16) | (pixels[index + 1]! << 8) | pixels[index + 2]!);
          }
          return {
            rect, colorCount: colors.size,
            sceneRects: [...runtime.getObjRects([
              'climate_scene_comfort', 'climate_scene_eco', 'climate_scene_away',
            ]).values()],
          };
        });
        expect(cloudRendered.rect).not.toBeNull();
        expect(cloudRendered.colorCount).toBeGreaterThan(2);
        expect(cloudRendered.sceneRects).toEqual([
          { x: 893, y: 509, w: 156, h: 54 },
          { x: 1059, y: 509, w: 156, h: 54 },
          { x: 1225, y: 509, w: 156, h: 54 },
        ]);
        if (outputDir) {
          const dataUrl = await page.locator('#lvgl-canvas').evaluate(
            (canvas: HTMLCanvasElement) => canvas.toDataURL('image/png'),
          );
          writeFileSync(
            join(outputDir, 'cloud-loaded-climate-home.png'),
            Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'),
          );
        }
      }

      for (const screen of project.screens) {
        await page.evaluate(async ({ nextProject, screenId }) => {
          const lvd = (window as unknown as { __lvd: any }).__lvd;
          lvd.projectStore.getState().loadProject(nextProject);
          lvd.editorStore.getState().setActiveScreen(screenId);
        }, { nextProject: project, screenId: screen.id });
        await page.waitForTimeout(450);
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
            banner: lvd.editorStore.getState().banner,
            logs: lvd.getPipeline().runtime.takeLogs(),
          };
        });
        expect(rendered.size).toEqual([1440, 720]);
        expect(rendered.childCount, JSON.stringify(rendered)).toBe(screen.root.children.length);
        expect(rendered.colorCount).toBeGreaterThan(8);
        expect(rendered.banner).toBeNull();

        if (outputDir) {
          const dataUrl = await page.locator('#lvgl-canvas').evaluate(
            (canvas: HTMLCanvasElement) => canvas.toDataURL('image/png'),
          );
          writeFileSync(
            join(outputDir, `${screen.name}.png`),
            Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'),
          );
        }
      }

      const home = project.screens.find((screen) => screen.isHome)!;
      await page.evaluate(async ({ nextProject, screenId }) => {
        const lvd = (window as unknown as { __lvd: any }).__lvd;
        lvd.projectStore.getState().loadProject(nextProject);
        lvd.editorStore.getState().setActiveScreen(screenId);
        lvd.editorStore.getState().setMode('play');
      }, { nextProject: project, screenId: home.id });
      await page.waitForTimeout(300);
      const canvas = page.locator('#lvgl-canvas');
      const before = await canvas.evaluate((item: HTMLCanvasElement) => item.toDataURL('image/png'));
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      await canvas.click({ position: {
        x: box!.width * 503 / 1440,
        y: box!.height * 573 / 720,
      } });
      await page.waitForTimeout(120);
      const updatedTargetColorCount = await page.evaluate(() => {
        const lvd = (window as unknown as { __lvd: any }).__lvd;
        const runtime = lvd.getPipeline().runtime;
        runtime.tick();
        const rect = runtime.getObjRect('climate_target_value');
        if (rect === null) return 0;
        const canvas = document.querySelector('#lvgl-canvas') as HTMLCanvasElement;
        const pixels = canvas.getContext('2d')!.getImageData(rect.x, rect.y, rect.w, rect.h).data;
        const colors = new Set<number>();
        for (let index = 0; index < pixels.length; index += 4) {
          colors.add((pixels[index]! << 16) | (pixels[index + 1]! << 8) | pixels[index + 2]!);
        }
        return colors.size;
      });
      expect(updatedTargetColorCount).toBeGreaterThan(2);
      const afterTemperature = await canvas.evaluate((item: HTMLCanvasElement) => item.toDataURL('image/png'));
      expect(afterTemperature).not.toBe(before);
      if (outputDir) {
        writeFileSync(
          join(outputDir, 'interaction-temperature-plus.png'),
          Buffer.from(afterTemperature.slice(afterTemperature.indexOf(',') + 1), 'base64'),
        );
      }

      await canvas.click({ position: {
        x: box!.width * 1136 / 1440,
        y: box!.height * 535 / 720,
      } });
      await page.waitForTimeout(120);
      const afterScene = await canvas.evaluate((item: HTMLCanvasElement) => item.toDataURL('image/png'));
      expect(afterScene).not.toBe(afterTemperature);
      if (outputDir) {
        writeFileSync(
          join(outputDir, 'interaction-scene-eco.png'),
          Buffer.from(afterScene.slice(afterScene.indexOf(',') + 1), 'base64'),
        );
      }
      expect(pageErrors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 90_000);
});
