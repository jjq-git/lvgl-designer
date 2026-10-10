import { describe, expect, it } from 'vitest';
import { isProjectSnapshotV2 } from '@lvd/schema/v2';
import { loadProjectDocument } from './projectPersistence';
import {
  BUILT_IN_PROJECTS,
  findBuiltInProject,
  isLegacyWf3NavigationProject,
} from './builtInProjects';

describe('built-in projects', () => {
  it('registers the complete WF3 firmware UI for the 284×76 preset', async () => {
    const descriptor = findBuiltInProject('builtin:wf3-firmware-284x76');

    expect(descriptor).toMatchObject({
      name: 'WF3 固件界面 · 284×76',
      width: 284,
      height: 76,
      shape: 'rect',
    });

    const document = await descriptor!.load();
    expect(isProjectSnapshotV2(document)).toBe(true);
    if (!isProjectSnapshotV2(document)) return;
    expect(document.displayProfile.logicalSize).toEqual({ width: 284, height: 76 });
    expect(document.displayProfile.shape).toBe('rect');
    expect(document.uiProject.screens).toHaveLength(46);
  });

  it('uses unique built-in project ids', () => {
    const ids = BUILT_IN_PROJECTS.map((project) => project.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not treat the current semantic function menu as the legacy icon draft', async () => {
    const document = await BUILT_IN_PROJECTS[0]!.load();
    const project = loadProjectDocument(document).project;
    expect(isLegacyWf3NavigationProject(project)).toBe(false);

    const legacy = structuredClone(project);
    const home = legacy.screens.find((screen) => screen.name === 'wf3_home')!;
    home.root.children.find((node) => node.name === 'wf3_home_menu_0')!.name = 'wf3_home_nav_0';
    home.root.children.find((node) => node.name === 'wf3_home_menu_5')!.name = 'wf3_home_nav_6';
    const title = home.root.children.find((node) => node.name === 'wf3_home_titlebar')!;
    title.children[0]!.props.text = 'UART';
    expect(isLegacyWf3NavigationProject(legacy)).toBe(true);
  });
});
