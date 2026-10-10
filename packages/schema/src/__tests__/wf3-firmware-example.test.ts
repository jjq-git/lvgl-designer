import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateProject } from '../index.js';
import {
  isProjectSnapshotV2,
  loadStoredProjectDocument,
  validateUiProjectV2,
  type ProjectSnapshotV2,
} from '../v2/index.js';

function loadExample(): ProjectSnapshotV2 {
  const url = new URL(
    '../../../../examples/wf3-firmware/WF3-284x76-firmware-ui.lvproj.json',
    import.meta.url,
  );
  const raw: unknown = JSON.parse(readFileSync(url, 'utf8'));
  expect(isProjectSnapshotV2(raw)).toBe(true);
  return raw as ProjectSnapshotV2;
}

describe('WF3 firmware UI import', () => {
  it('is a valid editable 284x76 project with all firmware page states', () => {
    const snapshot = loadExample();
    const loaded = loadStoredProjectDocument(snapshot);

    expect(loaded.project.display).toMatchObject({ width: 284, height: 76, shape: 'rect' });
    expect(snapshot.uiProject.screens).toHaveLength(46);
    expect(snapshot.uiProject.screens.filter((screen) => screen.isHome)).toHaveLength(1);
    expect(snapshot.uiProject.screens.map((screen) => screen.codeName)).toEqual(expect.arrayContaining([
      'wf3_home', 'wf3_menu', 'wf3_uart', 'wf3_i2c', 'wf3_spi', 'wf3_can',
      'wf3_rs485', 'wf3_ws2812', 'wf3_onewire', 'wf3_blockly', 'wf3_wf31',
    ]));
    expect(snapshot.uiProject.assets.fonts.map((font) => font.codeName)).toEqual([
      'wf3_cn_12', 'wf3_cn_14', 'wf3_cn_16', 'wf3_cn_20',
    ]);
    const menu = snapshot.uiProject.screens.find((screen) => screen.codeName === 'wf3_menu');
    const backButton = menu?.root.children.find((node) => node.codeName === 'wf3_menu_back');
    expect(backButton?.children[0]?.props.text).toBe('\uf053');
    expect(backButton?.styles[0]?.props).toMatchObject({
      bg_color: '#0B8583', border_width: 0, radius: 0,
    });
    const home = snapshot.uiProject.screens.find((screen) => screen.codeName === 'wf3_home');
    const voltage = home?.root.children.find((node) => node.codeName === 'wf3_home_voltage');
    const title = home?.root.children.find((node) => node.codeName === 'wf3_home_titlebar');
    expect(voltage?.styles[0]?.props.bg_color).toBe('#FF3540');
    expect(voltage?.children[0]?.props.text).toBe('5V3');
    expect(title?.children[0]?.props.text).toBe('功能菜单');
    expect(snapshot.uiProject.assets.fonts[0]?.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(validateProject(loaded.project).errors).toEqual([]);
    expect(validateUiProjectV2(snapshot.uiProject, { actions: snapshot.actionRegistry }).errors).toEqual([]);
  });

  it('records the immutable firmware source and migration boundaries', () => {
    const snapshot = loadExample();
    expect(snapshot.uiProject.editor?.source).toMatchObject({
      branch: 'cheng-wf3-code-cleanup-20261008',
      commit: 'a64842b8b9ea2425f235531658e31fe48635ff62',
      path: 'firmware/main/ui',
      lvglVersion: '9.4.x',
    });
    expect(snapshot.migrationNotes.map((note) => note.code)).toEqual(expect.arrayContaining([
      'wf3-source', 'lvgl-version-upgrade', 'firmware-logic-external',
    ]));
  });
});
