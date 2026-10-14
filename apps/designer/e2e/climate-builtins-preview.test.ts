import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';

const runE2e = process.env.LVD_CLIMATE_BUILTINS_E2E === '1' ? describe : describe.skip;
const cases = [
  {
    device: 'WF2D-1030', name: 'WF2D-1030 Climate Control', size: [1440, 720],
    value: 'climate_target_value', up: 'climate_temp_up', nav: 'climate_nav_zones',
    nextScreen: 'climate_zones', screenshot: 'wf2d-1030.png',
  },
  {
    device: 'WF2D-1050', name: 'WF2D-1050 Air & Comfort', size: [1024, 600],
    value: 'air1050_fan_value', up: 'air1050_fan_up', nav: 'air1050_home_nav_air',
    nextScreen: 'air1050_air_data', screenshot: 'wf2d-1050.png',
  },
  {
    device: 'WF2D-8630', name: 'WF2D-8630 Room Climate', size: [480, 480],
    value: 'room8630_target_value', up: 'room8630_temp_up', nav: 'room8630_home_nav_air',
    nextScreen: 'room8630_air', screenshot: 'wf2d-8630.png',
  },
] as const;

runE2e('deployed climate project picker', () => {
  it('opens all three projects from the toolbar and supports numeric controls and navigation', async () => {
    const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const browser = await chromium.launch(existsSync(chrome) ? { executablePath: chrome } : {});
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      const url = process.env.LVD_CLIMATE_BUILTINS_URL ?? 'http://127.0.0.1:8001/lvgl-designer/';
      await page.goto(url);
      if (new URL(page.url()).pathname.startsWith('/login')) {
        await page.locator('#username').fill(process.env.LVD_E2E_USERNAME ?? 'admin');
        await page.locator('#password').fill(process.env.LVD_E2E_PASSWORD ?? 'admin123');
        await page.locator('#login-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
        await page.waitForURL(url);
      }
      await page.waitForSelector('.rt-badge.rt-wasm', { timeout: 30_000 });
      const output = process.env.LVD_CLIMATE_BUILTINS_SCREENSHOTS_DIR;
      if (output) mkdirSync(output, { recursive: true });

      for (const fixture of cases) {
        await page.locator('.toolbar-spec-select').selectOption(fixture.device);
        await page.waitForFunction((name) => {
          const picker = document.querySelector('.toolbar-ui-select') as HTMLSelectElement;
          return !picker.disabled && [...picker.options].some((option) => option.text.startsWith(name));
        }, fixture.name);
        const option = await page.locator('.toolbar-ui-select').evaluate((picker: HTMLSelectElement, name) =>
          [...picker.options].find((item) => item.text.startsWith(name))!.value, fixture.name);
        await page.locator('.toolbar-ui-select').selectOption(option);
        await page.waitForFunction(({ name, value }) => {
          const lvd = (window as unknown as { __lvd: any }).__lvd;
          return lvd.projectStore.getState().project.meta.name === name
            && lvd.getPipeline().runtime.getObjRect(value) !== null;
        }, fixture);
        await page.waitForTimeout(250);
        const canvas = page.locator('#lvgl-canvas');
        const size = await canvas.evaluate((item: HTMLCanvasElement) => [item.width, item.height]);
        expect(size).toEqual(fixture.size);

        const readNumberPixels = () => page.evaluate((name) => {
          const runtime = (window as unknown as { __lvd: any }).__lvd.getPipeline().runtime;
          runtime.tick();
          const rect = runtime.getObjRect(name);
          if (!rect) throw new Error(`Missing value label: ${name}`);
          const canvas = document.querySelector('#lvgl-canvas') as HTMLCanvasElement;
          return Array.from(canvas.getContext('2d')!.getImageData(rect.x, rect.y, rect.w, rect.h).data);
        }, fixture.value);
        const before = await readNumberPixels();
        await page.evaluate(() => (window as unknown as { __lvd: any }).__lvd.editorStore.getState().setMode('play'));
        const clickObject = async (name: string) => {
          const rect = await page.evaluate((objName) =>
            (window as unknown as { __lvd: any }).__lvd.getPipeline().runtime.getObjRect(objName), name);
          expect(rect, name).not.toBeNull();
          const box = await canvas.boundingBox();
          expect(box).not.toBeNull();
          await canvas.click({ position: {
            x: box!.width * (rect.x + rect.w / 2) / fixture.size[0],
            y: box!.height * (rect.y + rect.h / 2) / fixture.size[1],
          } });
          await page.waitForTimeout(180);
        };
        await clickObject(fixture.up);
        const after = await readNumberPixels();
        expect(after).not.toEqual(before);
        expect(new Set(after).size).toBeGreaterThan(2);
        if (output) {
          const dataUrl = await canvas.evaluate((item: HTMLCanvasElement) => item.toDataURL('image/png'));
          writeFileSync(join(output, fixture.screenshot), Buffer.from(dataUrl.split(',')[1]!, 'base64'));
        }
        await clickObject(fixture.nav);
        await page.waitForFunction((name) => {
          const runtime = (window as unknown as { __lvd: any }).__lvd.getPipeline().runtime;
          runtime.tick();
          return runtime.dumpTree()?.name?.startsWith(name);
        }, fixture.nextScreen);
        expect(await page.evaluate(() => (window as unknown as { __lvd: any }).__lvd.editorStore.getState().banner))
          .toBeNull();
      }
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
