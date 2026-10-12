import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { snapshotToEditorProject, type ProjectSnapshotV2 } from '@lvd/schema/v2';

const runE2e = process.env.LVD_QUIET_LIGHT_NAV_E2E === '1' ? describe : describe.skip;

runE2e('WF2D-1050 light-card navigation', () => {
  it('opens the light screen when the main lighting card is clicked', async () => {
    const systemChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const browser = await chromium.launch(existsSync(systemChrome) ? { executablePath: systemChrome } : {});
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    try {
      const designerUrl = process.env.LVD_DESIGNER_URL ?? 'http://127.0.0.1:8001/lvgl-designer/';
      const cloudProjectPrefix = process.env.LVD_CLOUD_PROJECT_PREFIX;
      const cloudApiBase = process.env.LVD_CLOUD_API_BASE;
      const cloudProjectId = process.env.LVD_CLOUD_PROJECT_ID;
      await page.goto(designerUrl);
      if (new URL(page.url()).pathname.startsWith('/login')) {
        await page.locator('#username').fill('admin');
        await page.locator('#password').fill('admin123');
        await page.locator('#login-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
        await page.waitForURL(designerUrl);
      }
      await page.waitForSelector('.rt-badge.rt-wasm', { timeout: 30_000 });

      if (cloudProjectPrefix) {
        await page.getByLabel('屏幕规格', { exact: true }).selectOption({ label: 'WF2D-1050 · 1024×600' });
        const projectSelect = page.getByLabel('界面 UI', { exact: true });
        const projectLabel = (await projectSelect.locator('option').allTextContents())
          .find((label) => label.startsWith(cloudProjectPrefix));
        expect(projectLabel).toBeTruthy();
        await projectSelect.selectOption({ label: projectLabel! });
      } else {
        let snapshot: ProjectSnapshotV2;
        if (cloudApiBase && cloudProjectId) {
          const login = await fetch(`${cloudApiBase}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin123' }),
          });
          const cookie = login.headers.get('set-cookie')?.split(';')[0];
          expect(cookie).toBeTruthy();
          const response = await fetch(`${cloudApiBase}/api/lvgl/projects/${cloudProjectId}`, {
            headers: { cookie: cookie! },
          });
          const envelope = await response.json() as { doc: ProjectSnapshotV2 };
          snapshot = envelope.doc;
        } else {
          const path = join(process.cwd(), '..', '..', 'examples', 'quiet-pod-six-themes', 'WF2D-1050-quiet-lighting.lvproj.json');
          snapshot = JSON.parse(readFileSync(path, 'utf8')) as ProjectSnapshotV2;
        }
        const project = snapshotToEditorProject(snapshot);
        const home = project.screens.find((screen) => screen.isHome)!;
        await page.evaluate(({ nextProject, screenId }) => {
          const lvd = (window as unknown as { __lvd: any }).__lvd;
          lvd.projectStore.getState().loadProject(nextProject);
          lvd.editorStore.getState().setActiveScreen(screenId);
        }, { nextProject: project, screenId: home.id });
      }
      await page.waitForTimeout(250);
      await page.getByRole('button', { name: '运行' }).click();
      await page.waitForTimeout(250);

      const canvas = page.locator('#lvgl-canvas');
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      if (!cloudProjectPrefix) {
        const hitNodeId = await page.evaluate(() => (
          (window as unknown as { __lvd: any }).__lvd.getPipeline().runtime.hitTest(300, 254)
        ));
        expect(hitNodeId).toBe('home_light_card');
      }
      const beforeClick = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
      const clickPoint = {
        x: box!.x + box!.width * 300 / 1024,
        y: box!.y + box!.height * 254 / 600,
      };
      const pointStack = await page.evaluate(({ x, y }) => document.elementsFromPoint(x, y)
        .slice(0, 5)
        .map((element) => ({ tag: element.tagName, id: element.id, className: element.className })), clickPoint);
      await page.mouse.move(clickPoint.x, clickPoint.y);
      await page.mouse.down();
      await page.waitForTimeout(80);
      const duringClick = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
      await page.mouse.up();
      await page.waitForTimeout(350);
      if (cloudProjectPrefix) {
        const afterClick = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
        expect(afterClick).not.toBe(beforeClick);
      } else {
        const rendered = await page.evaluate(() => {
          const lvd = (window as unknown as { __lvd: any }).__lvd;
          const runtime = lvd.getPipeline().runtime;
          runtime.tick();
          const project = lvd.projectStore.getState().project;
          const home = project.screens.find((screen: any) => screen.isHome);
          const card = home?.root.children.find((node: any) => node.name === 'home_light_card');
          return {
            target: runtime.hitTest(300, 254),
            events: card?.events,
            screens: project.screens.map((screen: any) => ({ id: screen.id, name: screen.name })),
            banner: lvd.editorStore.getState().banner,
            logs: runtime.takeLogs(),
          };
        });
        expect(rendered.target, JSON.stringify({ ...rendered, pressedPainted: duringClick !== beforeClick, clickPoint, pointStack })).toMatch(/^light(?:_|$)/);
      }
    } finally {
      await browser.close();
    }
  }, 60_000);
});
