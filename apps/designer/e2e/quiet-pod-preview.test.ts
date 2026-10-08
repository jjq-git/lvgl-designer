import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { snapshotToEditorProject, type ProjectSnapshotV2 } from '@lvd/schema/v2';

const runE2e = process.env.LVD_QUIET_POD_E2E === '1' ? describe : describe.skip;
const models = ['WF2D-8620', 'WF2D-1040', 'WF2D-1030', 'WF2D-1050', 'WF2D-8630'];

runE2e('quiet-pod browser preview', () => {
  it('renders every generated screen through the real WASM canvas', async () => {
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
        await page.getByLabel('用户名').fill('admin');
        await page.getByLabel('密码').fill('admin123');
        await page.getByRole('button', { name: '登录' }).click();
        await page.waitForURL('http://127.0.0.1:8001/');
      }
      try {
        await page.waitForSelector('.rt-badge.rt-wasm', { timeout: 30_000 });
      } catch (error) {
        throw new Error(`${String(error)}\nurl=${page.url()}\nbody=${(await page.locator('body').innerText()).slice(0, 1000)}\nconsole=${errors.join(' | ')}`);
      }

      await page.getByRole('button', { name: '我的工程' }).click();
      for (const model of models) {
        const expectedName = `${model} 静音仓操作界面`;
        expect(await page.locator('.cloud-item-name', { hasText: expectedName }).count(), expectedName).toBe(1);
      }
      const roundProject = page.locator('.cloud-item').filter({ hasText: 'WF2D-8620' }).first();
      await roundProject.locator('.cloud-item-main').click();
      await page.locator('.cloud-modal').waitFor({ state: 'hidden' });
      await page.waitForTimeout(100);
      const cloudRound = await page.evaluate(() => {
        const lvd = (window as unknown as { __lvd: any }).__lvd;
        const runtime = lvd.getPipeline().runtime;
        const collectText = (node: any): string[] => [
          ...(typeof node.props?.text === 'string' ? [node.props.text] : []),
          ...node.children.flatMap(collectText),
        ];
        runtime.tick();
        const canvas = document.querySelector('#lvgl-canvas') as HTMLCanvasElement;
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        let nonWhite = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] < 245 || pixels[i + 1] < 245 || pixels[i + 2] < 245) nonWhite += 1;
        }
        return {
          display: lvd.projectStore.getState().project.display,
          texts: lvd.projectStore.getState().project.screens.flatMap((screen: any) => collectText(screen.root)),
          tree: runtime.dumpTree(),
          nonWhite,
          banner: lvd.editorStore.getState().banner,
        };
      });
      expect(cloudRound.display).toMatchObject({ width: 240, height: 240, shape: 'round' });
      expect(cloudRound.texts).toEqual(expect.arrayContaining([
        'HOME',
        '\uf00c  AIR GOOD',
        '\uf04b  START',
        'SELECT MODE',
        'DEEP',
        '\uf026  DND',
      ]));
      expect(cloudRound.tree?.children?.length).toBeGreaterThan(0);
      expect(cloudRound.nonWhite).toBeGreaterThan(100);
      expect(cloudRound.banner).toBeNull();
      if (process.env.LVD_QUIET_POD_SCREENSHOT) {
        await page.locator('#lvgl-canvas').screenshot({ path: process.env.LVD_QUIET_POD_SCREENSHOT });
      }
      if (process.env.LVD_QUIET_POD_SETTINGS_SCREENSHOT) {
        await page.evaluate(() => {
          const lvd = (window as unknown as { __lvd: any }).__lvd;
          const settings = lvd.projectStore.getState().project.screens.find((screen: any) => screen.name === 'settings');
          if (!settings) throw new Error('settings screen not found');
          lvd.editorStore.getState().setActiveScreen(settings.id);
        });
        await page.waitForTimeout(100);
        await page.evaluate(() => (window as unknown as { __lvd: any }).__lvd.getPipeline().runtime.tick());
        await page.locator('#lvgl-canvas').screenshot({ path: process.env.LVD_QUIET_POD_SETTINGS_SCREENSHOT });
        await page.evaluate(() => {
          const lvd = (window as unknown as { __lvd: any }).__lvd;
          const home = lvd.projectStore.getState().project.screens.find((screen: any) => screen.isHome);
          if (!home) throw new Error('home screen not found');
          lvd.editorStore.getState().setActiveScreen(home.id);
        });
        await page.waitForTimeout(100);
      }

      const aiPanel = page.locator('.ai-panel');
      if (await aiPanel.isVisible()) await aiPanel.getByTitle('收起').click();
      await page.evaluate(() => {
        const lvd = (window as unknown as { __lvd: any }).__lvd;
        const screens = lvd.projectStore.getState().uiProject.screens;
        const find = (node: any): any => node.codeName === 'home_next_text'
          ? node
          : node.children.map(find).find(Boolean);
        const target = screens.map((screen: any) => find(screen.root)).find(Boolean);
        if (!target) throw new Error('home_next_text not found');
        lvd.editorStore.getState().select([target.id]);
      });
      await page.getByRole('button', { name: '选择 LVGL 图标' }).click();
      const symbolPicker = page.getByRole('dialog', { name: 'LVGL 图标选择器' });
      await symbolPicker.waitFor({ state: 'visible' });
      expect(await symbolPicker.getByRole('option').count()).toBeGreaterThan(30);
      const symbolGrid = symbolPicker.getByRole('listbox', { name: '可用的 LVGL 图标' });
      await symbolGrid.hover();
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(50);
      const scrollState = await symbolGrid.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
      }));
      expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
      expect(scrollState.scrollTop).toBeGreaterThan(0);
      expect(await symbolPicker.isVisible()).toBe(true);
      await symbolPicker.getByLabel('搜索 LVGL 图标').fill('播放');
      expect(await symbolPicker.getByRole('option').count()).toBe(1);
      if (process.env.LVD_ICON_PICKER_SCREENSHOT) {
        await page.screenshot({ path: process.env.LVD_ICON_PICKER_SCREENSHOT });
      }
      await page.keyboard.press('Escape');

      for (const model of models) {
        const path = join(process.cwd(), '..', '..', 'examples', 'quiet-pod', `${model}-quiet-pod.lvproj.json`);
        const snapshot = JSON.parse(readFileSync(path, 'utf8')) as ProjectSnapshotV2;
        const project = snapshotToEditorProject(snapshot);

        const state = await page.evaluate(async (nextProject) => {
          const lvd = (window as unknown as { __lvd: any }).__lvd;
          const editor = lvd.editorStore.getState();
          const home = nextProject.screens.find((screen: any) => screen.isHome) ?? nextProject.screens[0];
          editor.setActiveScreen(home.id);
          lvd.projectStore.getState().loadProject(nextProject);
          const rendered = [];

          for (const screen of nextProject.screens) {
            editor.setActiveScreen(screen.id);
            await new Promise((resolve) => setTimeout(resolve, 30));
            const runtime = lvd.getPipeline().runtime;
            runtime.tick();
            const canvas = document.querySelector('#lvgl-canvas') as HTMLCanvasElement;
            const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
            let nonWhite = 0;
            for (let i = 0; i < pixels.length; i += 4) {
              if (pixels[i] < 245 || pixels[i + 1] < 245 || pixels[i + 2] < 245) nonWhite += 1;
            }
            rendered.push({
              name: screen.name,
              nonWhite,
              childCount: runtime.dumpTree()?.children?.length ?? 0,
              size: [canvas.width, canvas.height],
            });
          }
          return {
            rendered,
            banner: lvd.editorStore.getState().banner,
            projectChildren: lvd.projectStore.getState().project.screens.map((screen: any) => ({
              name: screen.name,
              children: screen.root.children.length,
            })),
            logs: lvd.getPipeline().runtime.takeLogs(),
          };
        }, project);

        expect(state.banner, `${model} state=${JSON.stringify(state)} console=${errors.join(' | ')}`).toBeNull();
        expect(state.rendered, `${model} screens`).toHaveLength(5);
        for (const screen of state.rendered) {
          const sourceScreen = state.projectChildren.find((item) => item.name === screen.name);
          expect(screen.childCount, `${model}/${screen.name} runtime tree`).toBeGreaterThan(0);
          expect(screen.childCount, `${model}/${screen.name} complete runtime tree`).toBe(sourceScreen?.children);
          expect(screen.nonWhite, `${model}/${screen.name} visible pixels`).toBeGreaterThan(100);
        }
        if (model === 'WF2D-8620' && process.env.LVD_QUIET_POD_ROUND_SCREENSHOTS_DIR) {
          const outputDir = process.env.LVD_QUIET_POD_ROUND_SCREENSHOTS_DIR;
          mkdirSync(outputDir, { recursive: true });
          for (const screen of project.screens) {
            await page.evaluate((screenId) => {
              const lvd = (window as unknown as { __lvd: any }).__lvd;
              lvd.editorStore.getState().setActiveScreen(screenId);
            }, screen.id);
            await page.waitForTimeout(150);
            await page.evaluate(() => (window as unknown as { __lvd: any }).__lvd.getPipeline().runtime.tick());
            await page.locator('#lvgl-canvas').screenshot({ path: join(outputDir, `${screen.name}.png`) });
          }
        }
        if (model === 'WF2D-8630' && process.env.LVD_QUIET_POD_SQUARE_SCREENSHOT) {
          await page.locator('#lvgl-canvas').screenshot({ path: process.env.LVD_QUIET_POD_SQUARE_SCREENSHOT });
        }
        if (model === 'WF2D-1040' && process.env.LVD_QUIET_POD_LANDSCAPE_SCREENSHOT) {
          await page.locator('#lvgl-canvas').screenshot({ path: process.env.LVD_QUIET_POD_LANDSCAPE_SCREENSHOT });
        }
      }

      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
