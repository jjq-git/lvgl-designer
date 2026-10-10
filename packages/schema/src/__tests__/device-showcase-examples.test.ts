import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateProject, type LvProject } from '../index.js';
import {
  isProjectSnapshotV2,
  loadStoredProjectDocument,
  validateCrossRefs,
  validateUiProjectV2,
  type ProjectSnapshotV2,
  type WidgetNodeV2,
} from '../v2/index.js';

const SHOWCASES = [
  { model: 'WF3-284x76', file: 'WF3-284x76-uart-grid', width: 284, height: 76, design: 'uart-grid', title: 'UART 总线工具台', screenCount: 46, screenName: 'wf3_home', minTouchWidth: 40, minTouchHeight: 38 },
  { model: 'WF2D-8620', file: 'WF2D-8620-focus-orbit', width: 240, height: 240, design: 'focus-orbit', title: '专注节奏计时器', screenCount: 3, screenName: 'focus_home' },
  { model: 'WF2D-8630', file: 'WF2D-8630-greenhouse', width: 480, height: 480, design: 'greenhouse', title: '智慧温室控制台', screenCount: 4, screenName: 'greenhouse_home' },
  { model: 'WF2D-1050', file: 'WF2D-1050-ev-charge', width: 1024, height: 600, design: 'ev-charge', title: '电动车充电终端', screenCount: 3, screenName: 'ev_charge' },
  { model: 'WF2D-1040', file: 'WF2D-1040-factory-energy', width: 1080, height: 720, design: 'factory-energy', title: '工厂能源中心', screenCount: 4, screenName: 'factory_energy' },
  { model: 'WF2D-1030', file: 'WF2D-1030-harbor-dispatch', width: 1440, height: 720, design: 'harbor-dispatch', title: '港口调度台', screenCount: 4, screenName: 'harbor_home' },
] as const;

function loadShowcase(file: string): { project: LvProject; snapshot: ProjectSnapshotV2 } {
  const url = new URL(`../../../../examples/device-showcase/${file}.lvproj.json`, import.meta.url);
  const raw: unknown = JSON.parse(readFileSync(url, 'utf8'));
  expect(isProjectSnapshotV2(raw)).toBe(true);
  const loaded = loadStoredProjectDocument(raw);
  expect(loaded.snapshot).not.toBeNull();
  return { project: loaded.project, snapshot: loaded.snapshot! };
}

function allNodes(root: WidgetNodeV2): WidgetNodeV2[] {
  return [root, ...root.children.flatMap(allNodes)];
}

function expectChildrenInside(node: WidgetNodeV2, width: number, height: number): void {
  for (const child of node.children) {
    const x = typeof child.props.x === 'number' ? child.props.x : 0;
    const y = typeof child.props.y === 'number' ? child.props.y : 0;
    const w = typeof child.props.width === 'number' ? child.props.width : null;
    const h = typeof child.props.height === 'number' ? child.props.height : null;
    expect(x, `${child.codeName}.x`).toBeGreaterThanOrEqual(0);
    expect(y, `${child.codeName}.y`).toBeGreaterThanOrEqual(0);
    if (w !== null) expect(x + w, `${child.codeName}.right`).toBeLessThanOrEqual(width);
    if (h !== null) expect(y + h, `${child.codeName}.bottom`).toBeLessThanOrEqual(height);
    if (w !== null && h !== null) expectChildrenInside(child, w, h);
  }
}

describe('device showcase projects', () => {
  for (const showcase of SHOWCASES) {
    it(`${showcase.model} provides a valid ${showcase.design} interface`, () => {
      const { project, snapshot } = loadShowcase(showcase.file);
      expect(project.meta.name).toBe(`${showcase.model} ${showcase.title}`);
      expect(project.display).toMatchObject({ width: showcase.width, height: showcase.height });
      expect(project.screens).toHaveLength('screenCount' in showcase ? showcase.screenCount : 1);
      expect(project.screens[0]?.name).toBe('screenName' in showcase ? showcase.screenName : 'dashboard');
      expect(snapshot.uiProject.editor).toMatchObject({
        deviceModel: showcase.model,
        example: 'device-showcase-suite-v1',
        showcase: showcase.design,
      });
      expect(validateProject(project).errors).toEqual([]);
      expect(validateUiProjectV2(snapshot.uiProject, { actions: snapshot.actionRegistry }).errors).toEqual([]);
      if (snapshot.controllerProfile) {
        expect(validateCrossRefs({
          uiProject: snapshot.uiProject,
          display: snapshot.displayProfile,
          controller: snapshot.controllerProfile,
          buildTarget: {
            ...snapshot.buildTarget,
            controllerProfileRef: snapshot.buildTarget.controllerProfileRef!,
          },
        }).errors).toEqual([]);
      }
      const root = snapshot.uiProject.screens[0]!.root;
      expect(root.children.length).toBeGreaterThanOrEqual(6);
      const checkedScreens = showcase.model === 'WF3-284x76'
        ? [snapshot.uiProject.screens[0]!]
        : snapshot.uiProject.screens;
      for (const screen of checkedScreens) {
        expectChildrenInside(screen.root, showcase.width, showcase.height);
        expect(
          allNodes(screen.root).some((item) => (
            typeof item.props.text === 'string' && /[\uF000-\uF8FF]/u.test(item.props.text)
          )),
          `${screen.codeName} should use verified LVGL icons`,
        ).toBe(true);
        for (const control of allNodes(screen.root).filter((item) => item.type === 'button')) {
          expect(Number(control.props.width), control.codeName).toBeGreaterThanOrEqual(
            'minTouchWidth' in showcase ? showcase.minTouchWidth : 44,
          );
          expect(Number(control.props.height), control.codeName).toBeGreaterThanOrEqual(
            'minTouchHeight' in showcase ? showcase.minTouchHeight : 40,
          );
        }
      }
    });
  }

  it('uses six different content vocabularies and visual palettes', () => {
    const projects = SHOWCASES.map((showcase) => loadShowcase(showcase.file).snapshot);
    expect(new Set(projects.map((snapshot) => snapshot.uiProject.meta.name)).size).toBe(6);
    expect(new Set(projects.map((snapshot) => snapshot.uiProject.editor?.showcase)).size).toBe(6);
    expect(new Set(projects.map((snapshot) => (
      snapshot.uiProject.themes[0]?.tokens.find((token) => token.id === 'color.background')?.value
    ))).size).toBe(6);
  });
});
