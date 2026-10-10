import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';

const runE2e = process.env.LVD_LIVE_EDITABILITY_E2E === '1' ? describe : describe.skip;

runE2e('live cloud project editability', () => {
  it('edits a geometry input and drags the selected node', async () => {
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
      await page.locator('.toolbar-spec-select').selectOption('WF2D-8630');
      await page.waitForFunction(() => [...document.querySelectorAll('.toolbar-ui-select option')]
        .some((option) => option.textContent?.includes('WF2D-8630')
          && option.textContent?.includes('自然舒适舱界面')
          && /· v\d+$/.test(option.textContent.trim())));
      const projectId = await page.locator('.toolbar-ui-select option').evaluateAll((options) => (
        (options as HTMLOptionElement[]).find((option) => option.textContent?.includes('WF2D-8630')
          && option.textContent?.includes('自然舒适舱界面')
          && /· v\d+$/.test(option.textContent.trim()))?.value
      ));
      expect(projectId).toBeTruthy();
      await page.locator('.toolbar-ui-select').selectOption(projectId);
      await page.waitForFunction(() => !(document.querySelector('.toolbar-ui-select') as HTMLSelectElement)?.disabled);
      await page.waitForTimeout(250);

      const before = await page.evaluate(() => {
        const lvd = (window as unknown as { __lvd: any }).__lvd;
        const home = lvd.projectStore.getState().uiProject.screens.find((screen: any) => screen.codeName === 'home');
        const findNode = (node: any): any => node.codeName === 'home_quiet_arc'
          ? node
          : node.children.map(findNode).find(Boolean);
        const arc = findNode(home.root);
        lvd.editorStore.getState().setActiveScreen(home.id);
        lvd.editorStore.getState().select([arc.id]);
        return { id: arc.id, x: arc.props.x, y: arc.props.y, runtimeRect: lvd.getPipeline().rectOf(arc.id) };
      });
      await page.waitForTimeout(100);

      const xInput = page.locator('.insp-body input.ed-num').first();
      expect(await xInput.inputValue()).toBe(String(before.x));
      await page.evaluate(() => (window as unknown as { __lvd: any }).__lvd.editorStore.getState().setMode('play'));
      await xInput.click();
      await page.waitForFunction(() => (
        (window as unknown as { __lvd: any }).__lvd.editorStore.getState().mode === 'design'
      ));
      const editedX = before.x + 25;
      await xInput.fill(String(editedX));
      expect(await xInput.inputValue()).toBe(String(editedX));
      await page.waitForTimeout(400);
      const afterInput = await page.evaluate((id) => {
        const lvd = (window as unknown as { __lvd: any }).__lvd;
        const findNode = (node: any): any => node.id === id ? node : node.children.map(findNode).find(Boolean);
        const home = lvd.projectStore.getState().uiProject.screens.find((screen: any) => screen.codeName === 'home');
        return { props: findNode(home.root).props, runtimeRect: lvd.getPipeline().rectOf(id) };
      }, before.id);
      expect(afterInput.props.x).toBe(editedX);
      expect(afterInput.runtimeRect.x).toBeGreaterThan(before.runtimeRect.x);
      await page.evaluate(() => (window as unknown as { __lvd: any }).__lvd.projectStore.getState().undo());
      await page.waitForTimeout(100);

      const selection = page.locator(`.overlay rect[data-selected-id="${before.id}"]`);
      const selectionBox = await selection.boundingBox();
      expect(selectionBox).not.toBeNull();
      await page.mouse.move(selectionBox!.x + selectionBox!.width / 2, selectionBox!.y + selectionBox!.height / 2);
      await page.mouse.down();
      // A short real-world gesture may deliver only one move event after pointerdown.
      // The first threshold-crossing frame must both enter drag mode and apply movement.
      await page.mouse.move(selectionBox!.x + selectionBox!.width / 2 + 40, selectionBox!.y + selectionBox!.height / 2 + 25);
      await page.mouse.up();
      await page.waitForTimeout(100);
      const afterDrag = await page.evaluate((id) => {
        const lvd = (window as unknown as { __lvd: any }).__lvd;
        const findNode = (node: any): any => node.id === id ? node : node.children.map(findNode).find(Boolean);
        const home = lvd.projectStore.getState().uiProject.screens.find((screen: any) => screen.codeName === 'home');
        return { props: findNode(home.root).props, runtimeRect: lvd.getPipeline().rectOf(id) };
      }, before.id);
      expect(afterDrag.props.x).toBeGreaterThan(before.x);
      expect(afterDrag.props.y).toBeGreaterThan(before.y);
      expect(afterDrag.runtimeRect.x).toBeGreaterThan(before.runtimeRect.x);
      expect(afterDrag.runtimeRect.y).toBeGreaterThan(before.runtimeRect.y);
      await page.evaluate(() => (window as unknown as { __lvd: any }).__lvd.projectStore.getState().undo());
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
