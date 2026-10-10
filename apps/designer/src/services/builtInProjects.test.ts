import { describe, expect, it } from 'vitest';
import { isProjectSnapshotV2 } from '@lvd/schema/v2';
import { loadProjectDocument } from './projectPersistence';
import {
  BUILT_IN_PROJECTS,
  WF3_BUILT_IN_REVISION,
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
    expect(document.uiProject.editor?.builtInRevision).toBe(WF3_BUILT_IN_REVISION);
    expect(document.displayProfile.logicalSize).toEqual({ width: 284, height: 76 });
    expect(document.displayProfile.shape).toBe('rect');
    expect(document.uiProject.screens).toHaveLength(46);
    expect(document.uiProject.themes.map((theme) => theme.id)).toEqual([
      'industrial-base',
      'wf3-light',
    ]);
    expect(document.buildTarget.themeRef).toMatch(/#theme:wf3-light$/);
  });

  it('uses unique built-in project ids', () => {
    const ids = BUILT_IN_PROJECTS.map((project) => project.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the reference navigation and upgrades the semantic menu draft', async () => {
    const document = await BUILT_IN_PROJECTS[0]!.load();
    const project = loadProjectDocument(document).project;
    expect(isLegacyWf3NavigationProject(project)).toBe(false);

    const previousBuiltIn = structuredClone(project);
    delete previousBuiltIn.editor?.builtInRevision;
    expect(isLegacyWf3NavigationProject(previousBuiltIn)).toBe(true);

    const revisionTwo = structuredClone(project);
    revisionTwo.editor = { ...revisionTwo.editor, builtInRevision: 2 };
    expect(isLegacyWf3NavigationProject(revisionTwo)).toBe(true);

    const legacy = structuredClone(project);
    const home = legacy.screens.find((screen) => screen.name === 'wf3_home')!;
    home.root.children.find((node) => node.name === 'wf3_home_carousel_previous')!.name = 'wf3_home_menu_0';
    home.root.children.find((node) => node.name === 'wf3_home_carousel_next')!.name = 'wf3_home_menu_5';
    const title = home.root.children.find((node) => node.name === 'wf3_home_titlebar')!;
    title.children[0]!.props.text = '功能菜单';
    expect(isLegacyWf3NavigationProject(legacy)).toBe(true);
  });
});
