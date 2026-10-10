import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@lvd/schema';
import { isProjectSnapshotV2, migrateV1ToV2, snapshotToEditorProject } from '@lvd/schema/v2';
import { findBuiltInProject } from './builtInProjects';
import { removeScreenAndReferences } from './screenOperations';

describe('screen operations', () => {
  it('deletes a screen together with all inbound action events', () => {
    const migrated = migrateV1ToV2(createEmptyProject('screen-delete'));
    const home = migrated.uiProject.screens[0]!;
    home.isHome = true;
    const target = structuredClone(home);
    target.id = 'screen:menu';
    target.codeName = 'menu';
    target.isHome = false;
    target.root.id = 'menu-root';
    target.root.events = [];
    target.root.children = [];
    migrated.uiProject.screens.push(target);
    home.root.events.push({
      on: 'clicked', action: 'screen.open', args: { screen: target.id },
    });
    home.root.children.push({
      id: 'nested-button', type: 'button', props: {}, styleRefs: [], styles: [],
      events: [{ on: 'clicked', action: 'screen.create', args: { screen: target.id } }],
      bindings: [], children: [],
    });

    expect(removeScreenAndReferences(migrated.uiProject, target.id)).toBe(2);
    expect(migrated.uiProject.screens.map((screen) => screen.id)).toEqual([home.id]);
    expect(home.root.events).toEqual([]);
    expect(home.root.children[0]!.events).toEqual([]);
  });

  it('does not remove the final screen', () => {
    const migrated = migrateV1ToV2(createEmptyProject('final-screen'));
    const only = migrated.uiProject.screens[0]!;

    expect(removeScreenAndReferences(migrated.uiProject, only.id)).toBe(0);
    expect(migrated.uiProject.screens).toHaveLength(1);
  });

  it('can delete the heavily referenced WF3 menu without leaving an invalid snapshot', async () => {
    const document = await findBuiltInProject('builtin:wf3-firmware-284x76')!.load();
    expect(isProjectSnapshotV2(document)).toBe(true);
    if (!isProjectSnapshotV2(document)) return;
    const snapshot = structuredClone(document);
    const menu = snapshot.uiProject.screens.find((screen) => screen.codeName === 'wf3_menu')!;

    expect(removeScreenAndReferences(snapshot.uiProject, menu.id)).toBeGreaterThan(0);
    expect(snapshot.uiProject.screens.some((screen) => screen.id === menu.id)).toBe(false);
    expect(() => snapshotToEditorProject(snapshot)).not.toThrow();
  });
});
