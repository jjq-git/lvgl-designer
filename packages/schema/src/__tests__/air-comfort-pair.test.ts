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

const fixtures = [
  {
    file: 'WF2D-1050-air-comfort.lvproj.json', size: { width: 1024, height: 600 },
    screens: ['air1050_home', 'air1050_air_data', 'air1050_scenes'],
    subject: 'subject:air1050-fan-speed', valueNode: 'air1050_fan_value', down: 'air1050_fan_down', up: 'air1050_fan_up',
    initial: 60, min: 0, max: 100, step: 5,
  },
  {
    file: 'WF2D-8630-room-climate.lvproj.json', size: { width: 480, height: 480 },
    screens: ['room8630_home', 'room8630_air', 'room8630_schedule'],
    subject: 'subject:room8630-temperature', valueNode: 'room8630_target_value', down: 'room8630_temp_down', up: 'room8630_temp_up',
    initial: 25, min: 16, max: 30, step: 1,
  },
] as const;

describe('air comfort project pair', () => {
  for (const fixture of fixtures) {
    it(`${fixture.file} is a valid interactive project`, () => {
      const path = new URL(`../../../../examples/air-comfort/${fixture.file}`, import.meta.url);
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
        buildTarget: { ...raw.buildTarget, controllerProfileRef: raw.buildTarget.controllerProfileRef! },
      }).errors).toEqual([]);

      expect(raw.displayProfile.logicalSize).toEqual(fixture.size);
      expect(raw.uiProject.screens.map((screen) => screen.codeName)).toEqual(fixture.screens);
      expect(raw.uiProject.subjects).toContainEqual(expect.objectContaining({
        id: fixture.subject, initial: fixture.initial, min: fixture.min, max: fixture.max,
      }));

      const homeNodes = nodes(raw.uiProject.screens[0]!.root);
      expect(homeNodes.find((item) => item.codeName === fixture.valueNode)?.bindings)
        .toContainEqual(expect.objectContaining({ kind: 'prop', prop: 'text', subject: fixture.subject }));
      expect(homeNodes.find((item) => item.codeName === fixture.down)?.events[0]).toMatchObject({
        action: 'subject.increment', args: { step: -fixture.step, min: fixture.min, max: fixture.max },
      });
      expect(homeNodes.find((item) => item.codeName === fixture.up)?.events[0]).toMatchObject({
        action: 'subject.increment', args: { step: fixture.step, min: fixture.min, max: fixture.max },
      });
    });
  }
});
