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

const PRESETS = [
  { model: 'WF2D-8620', width: 240, height: 240, shape: 'round' },
  { model: 'WF2D-1040', width: 1080, height: 720, shape: 'rect' },
  { model: 'WF2D-1030', width: 1440, height: 720, shape: 'rect' },
  { model: 'WF2D-1050', width: 1024, height: 600, shape: 'rect' },
  { model: 'WF2D-8630', width: 480, height: 480, shape: 'rect' },
] as const;

function loadExample(model: string): { project: LvProject; snapshot: ProjectSnapshotV2 } {
  const url = new URL(`../../../../examples/serene-pod/${model}-serene-pod.lvproj.json`, import.meta.url);
  const raw: unknown = JSON.parse(readFileSync(url, 'utf8'));
  expect(isProjectSnapshotV2(raw)).toBe(true);
  const loaded = loadStoredProjectDocument(raw);
  expect(loaded.snapshot).not.toBeNull();
  return { project: loaded.project, snapshot: loaded.snapshot! };
}

function findNode(root: WidgetNodeV2, codeName: string): WidgetNodeV2 | undefined {
  if (root.codeName === codeName) return root;
  for (const child of root.children) {
    const found = findNode(child, codeName);
    if (found) return found;
  }
  return undefined;
}

describe('serene pod example projects', () => {
  for (const preset of PRESETS) {
    it(`${preset.model} is a valid device-specific five-screen project`, () => {
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
      expect(validateUiProjectV2(snapshot.uiProject, { actions: snapshot.actionRegistry }).errors).toEqual([]);
      expect(validateCrossRefs({
        uiProject: snapshot.uiProject,
        display: snapshot.displayProfile,
        controller: snapshot.controllerProfile!,
        buildTarget: {
          ...snapshot.buildTarget,
          controllerProfileRef: snapshot.buildTarget.controllerProfileRef!,
        },
      }).errors).toEqual([]);
      expect(snapshot.uiProject.meta.id).toBe(`ui:${preset.model.toLowerCase()}-serene-pod`);
      expect(snapshot.uiProject.screens[0]?.root.styles[0]?.props.bg_color).toBe('#F4F1EA');
    });
  }

  it('moves wide navigation to the right and square navigation to the top', () => {
    for (const model of ['WF2D-1040', 'WF2D-1030', 'WF2D-1050']) {
      const { project, snapshot } = loadExample(model);
      const home = snapshot.uiProject.screens.find((screen) => screen.codeName === 'home')!;
      const rail = findNode(home.root, 'home_rail')!;
      expect(Number(rail.props.x)).toBeGreaterThan(project.display.width / 2);
    }

    const { snapshot } = loadExample('WF2D-8630');
    const home = snapshot.uiProject.screens.find((screen) => screen.codeName === 'home')!;
    expect(findNode(home.root, 'home_nav_home')?.props.y).toBe(14);
    expect(findNode(home.root, 'home_brand')?.props.y).toBe(447);
    expect(findNode(home.root, 'home_brand')?.props.text).toBe('BRAND B');
  });
});
