import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateProject } from '../index.js';
import {
  createPodscStaticWebUiDocument,
  isProjectSnapshotV2,
  loadStoredProjectDocument,
  validateCrossRefs,
  validateUiProjectV2,
  type WidgetNodeV2,
} from '../v2/index.js';

function nodes(root: WidgetNodeV2): WidgetNodeV2[] {
  return [root, ...root.children.flatMap(nodes)];
}

describe('climate control example', () => {
  it('is a valid interactive WF2D-1030 project', () => {
    const path = new URL(
      '../../../../examples/climate-control/WF2D-1030-climate-control.lvproj.json',
      import.meta.url,
    );
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    expect(isProjectSnapshotV2(raw)).toBe(true);
    if (!isProjectSnapshotV2(raw)) return;

    const loaded = loadStoredProjectDocument(raw);
    expect(loaded.snapshot).not.toBeNull();
    expect(validateProject(loaded.project).errors).toEqual([]);
    expect(validateUiProjectV2(raw.uiProject, { actions: raw.actionRegistry }).errors).toEqual([]);
    expect(createPodscStaticWebUiDocument(raw).uiProject.screens).toHaveLength(3);
    expect(validateCrossRefs({
      uiProject: raw.uiProject,
      display: raw.displayProfile,
      controller: raw.controllerProfile!,
      buildTarget: {
        ...raw.buildTarget,
        controllerProfileRef: raw.buildTarget.controllerProfileRef!,
      },
    }).errors).toEqual([]);

    expect(raw.displayProfile.logicalSize).toEqual({ width: 1440, height: 720 });
    expect(raw.uiProject.screens.map((screen) => screen.codeName)).toEqual([
      'climate_home', 'climate_zones', 'climate_system',
    ]);
    expect(raw.uiProject.subjects).toContainEqual(expect.objectContaining({
      id: 'subject:climate-target-temperature', initial: 22, min: 16, max: 30,
    }));

    const homeNodes = nodes(raw.uiProject.screens[0]!.root);
    const temperature = homeNodes.find((item) => item.codeName === 'climate_target_value');
    const down = homeNodes.find((item) => item.codeName === 'climate_temp_down');
    const up = homeNodes.find((item) => item.codeName === 'climate_temp_up');
    expect(temperature?.bindings).toContainEqual(expect.objectContaining({
      kind: 'prop', prop: 'text', subject: 'subject:climate-target-temperature',
    }));
    expect(down?.events[0]).toMatchObject({
      action: 'subject.increment', args: { step: -1, min: 16, max: 30 },
    });
    expect(up?.events[0]).toMatchObject({
      action: 'subject.increment', args: { step: 1, min: 16, max: 30 },
    });
  });
});
