import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateProject } from '../index.js';
import {
  isProjectSnapshotV2,
  loadStoredProjectDocument,
  validateCrossRefs,
  validateUiProjectV2,
  type ProjectSnapshotV2,
} from '../v2/index.js';

const CASES = [
  { file: 'WF2D-8620-quiet-focus', width: 240, height: 240, shape: 'round', feature: 'focus', theme: 'midnight-violet' },
  { file: 'WF2D-8630-quiet-acoustics', width: 480, height: 480, shape: 'rect', feature: 'acoustics', theme: 'glacier-blue' },
  { file: 'WF2D-1050-quiet-lighting', width: 1024, height: 600, shape: 'rect', feature: 'lighting', theme: 'amber-studio' },
  { file: 'WF2D-1040-quiet-air', width: 1080, height: 720, shape: 'rect', feature: 'air', theme: 'eco-mint' },
  { file: 'WF2D-1030-quiet-booking', width: 1440, height: 720, shape: 'rect', feature: 'booking', theme: 'coral-schedule' },
  { file: 'WF3-284x76-quiet-dnd', width: 284, height: 76, shape: 'rect', feature: 'dnd', theme: 'signal-red' },
] as const;

function load(file: string): ProjectSnapshotV2 {
  const url = new URL(`../../../../examples/quiet-pod-six-themes/${file}.lvproj.json`, import.meta.url);
  const raw: unknown = JSON.parse(readFileSync(url, 'utf8'));
  expect(isProjectSnapshotV2(raw)).toBe(true);
  return raw as ProjectSnapshotV2;
}

describe('six differentiated quiet-pod interfaces', () => {
  for (const item of CASES) {
    it(`${item.file} is valid and highlights ${item.feature}`, () => {
      const snapshot = load(item.file);
      const loaded = loadStoredProjectDocument(snapshot);
      expect(loaded.snapshot).not.toBeNull();
      expect(loaded.project.display).toMatchObject({ width: item.width, height: item.height, shape: item.shape });
      expect(validateProject(loaded.project).errors).toEqual([]);
      expect(validateUiProjectV2(snapshot.uiProject, { actions: snapshot.actionRegistry }).errors).toEqual([]);
      expect(snapshot.uiProject.editor).toMatchObject({
        example: 'quiet-pod-six-themes',
        homeFeature: item.feature,
      });
      expect(snapshot.buildTarget.themeRef).toMatch(new RegExp(`#theme:${item.theme}$`));
      expect(snapshot.uiProject.themes.map((theme) => theme.id)).toEqual([item.theme]);

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
    });
  }

  it('uses six different active color systems', () => {
    const backgrounds = CASES.map(({ file }) => {
      const snapshot = load(file);
      return snapshot.uiProject.themes[0]?.tokens.find((entry) => entry.id === 'color.background')?.value;
    });
    expect(new Set(backgrounds).size).toBe(CASES.length);
  });
});
