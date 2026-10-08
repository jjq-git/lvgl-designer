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
    });
  }
});
