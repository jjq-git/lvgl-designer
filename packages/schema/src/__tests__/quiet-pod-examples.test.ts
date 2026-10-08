import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateProject, type LvProject } from '../index.js';
import {
  isProjectSnapshotV2, loadStoredProjectDocument, validateCrossRefs, validateUiProjectV2,
  type ProjectSnapshotV2, type WidgetNodeV2,
} from '../v2/index.js';

const PRESETS = [
  { model: 'WF2D-8620', width: 240, height: 240, shape: 'round' },
  { model: 'WF2D-1040', width: 1080, height: 720, shape: 'rect' },
  { model: 'WF2D-1030', width: 1440, height: 720, shape: 'rect' },
  { model: 'WF2D-1050', width: 1024, height: 600, shape: 'rect' },
  { model: 'WF2D-8630', width: 480, height: 480, shape: 'rect' },
] as const;

function loadExample(model: string): { project: LvProject; snapshot: ProjectSnapshotV2 } {
  const url = new URL(`../../../../examples/quiet-pod/${model}-quiet-pod.lvproj.json`, import.meta.url);
  const raw: unknown = JSON.parse(readFileSync(url, 'utf8'));
  expect(isProjectSnapshotV2(raw)).toBe(true);
  const loaded = loadStoredProjectDocument(raw);
  expect(loaded.snapshot).not.toBeNull();
  return { project: loaded.project, snapshot: loaded.snapshot! };
}

function expectInsideCanvas(
  node: WidgetNodeV2,
  parentWidth: number,
  parentHeight: number,
  path: string,
): void {
  const x = typeof node.props.x === 'number' ? node.props.x : 0;
  const y = typeof node.props.y === 'number' ? node.props.y : 0;
  const width = typeof node.props.width === 'number' ? node.props.width : null;
  const height = typeof node.props.height === 'number' ? node.props.height : null;
  if (width !== null) {
    expect(x, `${path} x`).toBeGreaterThanOrEqual(0);
    expect(x + width, `${path} right edge`).toBeLessThanOrEqual(parentWidth);
  }
  if (height !== null) {
    expect(y, `${path} y`).toBeGreaterThanOrEqual(0);
    expect(y + height, `${path} bottom edge`).toBeLessThanOrEqual(parentHeight);
  }
  const childWidth = width ?? parentWidth;
  const childHeight = height ?? parentHeight;
  node.children.forEach((child, index) => {
    expectInsideCanvas(child, childWidth, childHeight, `${path}.children[${index}]`);
  });
}

function collectText(node: WidgetNodeV2): string[] {
  const own = typeof node.props.text === 'string' ? [node.props.text] : [];
  return [...own, ...node.children.flatMap(collectText)];
}

function collectTextFontSizes(node: WidgetNodeV2): Array<{ name: string; text: string; size: number }> {
  const text = typeof node.props.text === 'string' ? node.props.text : null;
  const font = node.styles
    .map((entry) => entry.props.text_font)
    .find((value): value is string => typeof value === 'string');
  const match = font ? /^montserrat_(\d+)$/.exec(font) : null;
  const own = text !== null && match
    ? [{ name: node.codeName ?? node.type, text, size: Number(match[1]) }]
    : [];
  return [...own, ...node.children.flatMap(collectTextFontSizes)];
}

function findNode(root: WidgetNodeV2, codeName: string): WidgetNodeV2 | undefined {
  if (root.codeName === codeName) return root;
  for (const child of root.children) {
    const found = findNode(child, codeName);
    if (found) return found;
  }
  return undefined;
}

describe('quiet pod example projects', () => {
  for (const preset of PRESETS) {
    it(`${preset.model} is a valid five-screen project for its exact display`, () => {
      const { project, snapshot } = loadExample(preset.model);
      expect(project.display).toMatchObject({
        width: preset.width,
        height: preset.height,
        shape: preset.shape,
      });
      expect(project.screens.map((screen) => screen.name)).toEqual([
        'home', 'air', 'light', 'focus', 'settings',
      ]);
      expect(project.screens.filter((screen) => screen.isHome)).toHaveLength(1);
      expect(validateProject(project).errors).toEqual([]);

      expect(snapshot.controllerProfile?.model).toBe(preset.model);
      expect(snapshot.colorFormatConfirmed).toBe(true);
      expect(validateUiProjectV2(snapshot.uiProject, { actions: snapshot.actionRegistry }).errors).toEqual([]);
      expect(snapshot.buildTarget.controllerProfileRef).toBeDefined();
      expect(validateCrossRefs({
        uiProject: snapshot.uiProject,
        display: snapshot.displayProfile,
        controller: snapshot.controllerProfile!,
        buildTarget: {
          ...snapshot.buildTarget,
          controllerProfileRef: snapshot.buildTarget.controllerProfileRef!,
        },
      }).errors).toEqual([]);
      expect(snapshot.migrationNotes.filter((note) => note.severity === 'must-confirm')).toEqual([]);
      snapshot.uiProject.screens.forEach((screen) => {
        screen.root.children.forEach((child, index) => {
          expectInsideCanvas(
            child,
            preset.width,
            preset.height,
            `${preset.model}.${screen.codeName}.root.children[${index}]`,
          );
        });
      });

      const minimumTextSize = preset.width <= 240 ? 14 : preset.width <= 480 ? 14 : 16;
      const textNodes = snapshot.uiProject.screens.flatMap((screen) => collectTextFontSizes(screen.root));
      expect(textNodes.length).toBeGreaterThan(0);
      expect(
        textNodes.filter((item) => item.size < minimumTextSize),
        `${preset.model} contains text smaller than ${minimumTextSize}px`,
      ).toEqual([]);

      const allText = snapshot.uiProject.screens.flatMap((screen) => collectText(screen.root));
      expect(allText).not.toContain('QUIET POD');
      expect(allText).not.toContain('QUIET\nPOD');
      if (preset.shape !== 'round') {
        expect(allText.filter((value) => value === 'BRAND A')).toHaveLength(5);
      }
    });
  }

  it('balances real LVGL action icons with readable labels on the round UI', () => {
    const { snapshot } = loadExample('WF2D-8620');
    const text = snapshot.uiProject.screens.flatMap((screen) => collectText(screen.root));

    expect(text).toEqual(expect.arrayContaining([
      '\uf054',
      '\uf015',
      '\uf00c GOOD',
      '\uf04b  START',
      'ppm',
      'MASTER',
      'HOME',
      'SELECT MODE',
      'DEEP',
      '\uf026  DND',
    ]));
    for (const placeholder of ['>', '<', 'H']) {
      expect(text).not.toContain(placeholder);
    }
  });

  it('keeps the round navigation and primary controls inside a consistent circular safe area', () => {
    const { snapshot } = loadExample('WF2D-8620');
    for (const screen of snapshot.uiProject.screens) {
      const title = findNode(screen.root, `${screen.codeName}_page_title`);
      expect(title?.props).toMatchObject({ x: 84, y: 24, width: 72 });

      for (const suffix of ['back', 'next', 'home']) {
        const nav = findNode(screen.root, `${screen.codeName}_${suffix}`);
        if (nav) expect(nav.props).toMatchObject({ y: 26, width: 38, height: 38 });
      }
    }

    const byName = new Map(snapshot.uiProject.screens.map((screen) => [screen.codeName, screen]));
    expect(findNode(byName.get('home')!.root, 'home_start')?.props).toMatchObject({ x: 72, y: 185, width: 96, height: 40 });
    expect(findNode(byName.get('air')!.root, 'air_speed')?.props).toMatchObject({ x: 54, y: 200, width: 132, height: 12 });
    expect(findNode(byName.get('light')!.root, 'light_master')?.props).toMatchObject({ x: 88, y: 195, width: 64, height: 30 });
    expect(findNode(byName.get('settings')!.root, 'settings_dnd')?.props).toMatchObject({ x: 142, width: 54, height: 28 });
  });
});
