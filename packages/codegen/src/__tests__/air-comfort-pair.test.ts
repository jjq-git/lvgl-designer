import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { snapshotToEditorProject, type ProjectSnapshotV2 } from '@lvd/schema/v2';
import { emitC95 } from '../index.js';

const fixtures = [
  { file: 'WF2D-1050-air-comfort.lvproj.json', screens: ['air1050_home', 'air1050_air_data', 'air1050_scenes'] },
  { file: 'WF2D-8630-room-climate.lvproj.json', screens: ['room8630_home', 'room8630_air', 'room8630_schedule'] },
] as const;

describe('air comfort project pair C export', () => {
  for (const fixture of fixtures) {
    it(`exports ${fixture.file} as an ESP-IDF LVGL 9.5 component`, () => {
      const path = new URL(`../../../../examples/air-comfort/${fixture.file}`, import.meta.url);
      const snapshot = JSON.parse(readFileSync(path, 'utf8')) as ProjectSnapshotV2;
      const result = emitC95(snapshotToEditorProject(snapshot), {
        target: 'esp-idf', colorFormat: snapshot.displayProfile.colorFormat,
        buildTarget: snapshot.buildTarget, displayProfileRef: snapshot.uiProject.designDisplayRef,
      });
      expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
      expect(result.files.map((file) => file.path)).toEqual(expect.arrayContaining([
        'CMakeLists.txt', 'build-manifest.json', 'ui.c', 'ui.h', 'subjects.c', 'INTEGRATION.md',
        ...fixture.screens.map((screen) => `screens/${screen}.c`),
      ]));
    });
  }
});
