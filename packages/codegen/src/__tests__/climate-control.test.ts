import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatThemeRef, snapshotToEditorProject, type ProjectSnapshotV2 } from '@lvd/schema/v2';
import { emitC95 } from '../index.js';

describe('climate control C export', () => {
  it('exports as an ESP-IDF LVGL 9.5 component', () => {
    const path = new URL(
      '../../../../examples/climate-control/WF2D-1030-climate-control.lvproj.json',
      import.meta.url,
    );
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as ProjectSnapshotV2;
    const controllerProfileRef = snapshot.buildTarget.controllerProfileRef;
    if (!controllerProfileRef) throw new Error('The ESP-IDF example must include a controller profile');
    const themeRef = formatThemeRef(snapshot.buildTarget.uiProjectRef, snapshot.uiProject.themes[0]!.id);
    expect(snapshot.buildTarget.themeRef).toBe(themeRef);
    const result = emitC95(snapshotToEditorProject(snapshot), {
      target: 'esp-idf',
      colorFormat: snapshot.displayProfile.colorFormat,
      buildTarget: { ...snapshot.buildTarget, controllerProfileRef, themeRef },
      displayProfileRef: snapshot.uiProject.designDisplayRef,
    });

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(result.files.map((file) => file.path)).toEqual(expect.arrayContaining([
      'CMakeLists.txt',
      'build-manifest.json',
      'ui.c',
      'ui.h',
      'subjects.c',
      'screens/climate_home.c',
      'screens/climate_zones.c',
      'screens/climate_system.c',
      'INTEGRATION.md',
    ]));
    expect(result.files.find((file) => file.path === 'CMakeLists.txt')?.content)
      .toContain('idf_component_register');
  });
});
