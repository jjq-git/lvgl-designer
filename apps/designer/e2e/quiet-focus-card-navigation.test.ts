import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { snapshotToEditorProject, type ProjectSnapshotV2 } from '@lvd/schema/v2';

const runE2e = process.env.LVD_QUIET_FOCUS_NAV_E2E === '1' ? describe : describe.skip;

runE2e('WF2D-8620 focus-card navigation', () => {
  it('opens the focus screen when the central dial is clicked', async () => {
    const systemChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const browser = await chromium.launch(existsSync(systemChrome) ? { executablePath: systemChrome } : {});
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
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

      const path = join(process.cwd(), '..', '..', 'examples', 'quiet-pod-six-themes', 'WF2D-8620-quiet-focus.lvproj.json');
      const snapshot = JSON.parse(readFileSync(path, 'utf8')) as ProjectSnapshotV2;
      const project = snapshotToEditorProject(snapshot);
      const home = project.screens.find((screen) => screen.isHome)!;
      await page.evaluate(({ nextProject, screenId }) => {
        const lvd = (window as unknown as { __lvd: any }).__lvd;
        lvd.projectStore.getState().loadProject(nextProject);
        lvd.editorStore.getState().setActiveScreen(screenId);
      }, { nextProject: project, screenId: home.id });
      await page.waitForTimeout(250);
      await page.getByRole('button', { name: '运行' }).click();
      await page.waitForTimeout(250);

      const canvas = page.locator('#lvgl-canvas');
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      const frameBox = await page.locator('.device-frame').boundingBox();
      expect(frameBox).not.toBeNull();
      expect(box!.width / frameBox!.width).toBeCloseTo(0.425116, 4);
      expect(box!.height / frameBox!.height).toBeCloseTo(0.425116, 4);
      const hitNodeId = await page.evaluate(() => (
        (window as unknown as { __lvd: any }).__lvd.getPipeline().runtime.hitTest(120, 104)
      ));
      expect(hitNodeId).toBe('home_focus_card');
      await page.mouse.move(
        box!.x + box!.width * 120 / 240,
        box!.y + box!.height * 104 / 240,
      );
      await page.mouse.down();
      await page.waitForTimeout(80);
      await page.mouse.up();
      await page.waitForTimeout(350);
      const renderedTarget = await page.evaluate(() => {
        const runtime = (window as unknown as { __lvd: any }).__lvd.getPipeline().runtime;
        runtime.tick();
        return runtime.hitTest(120, 104);
      });
      expect(renderedTarget).toMatch(/^focus(?:_|$)/);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
