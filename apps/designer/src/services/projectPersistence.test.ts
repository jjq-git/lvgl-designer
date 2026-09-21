import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject, createNode } from '@lvd/schema';
import { useBuildTargetStore } from '../stores/buildTargetStore';
import {
  createNewStoredProjectDocument,
  createStoredProjectDocument,
  loadProjectDocument,
} from './projectPersistence';

describe('projectPersistence', () => {
  beforeEach(() => {
    const reset = createEmptyProject(`reset-${Math.random()}`);
    useBuildTargetStore.getState().syncProject(reset);
    useBuildTargetStore.getState().selectController(null);
  });

  it('writes UiProject v2 snapshots and never persists a duplicate v1 tree', () => {
    const project = createEmptyProject('persist-v2');
    const button = createNode('button');
    button.name = 'save_button';
    button.events.push({ kind: 'callback', trigger: 'clicked', callback: 'save_settings' });
    project.screens[0]!.root.children.push(button);

    const stored = createStoredProjectDocument(project);

    expect(stored.kind).toBe('lvgl-project-snapshot');
    expect(stored.uiProject.schemaVersion).toBe(2);
    expect(stored.uiProject.meta).not.toHaveProperty('lvglVersion');
    expect(stored).not.toHaveProperty('legacyProject');
    expect(stored.actionRegistry['custom.save_settings']?.id).toBe('custom.save_settings');
    expect(stored.colorFormatConfirmed).toBe(false);
  });

  it('assigns independent identities to new projects with the same name', () => {
    const currentBefore = useBuildTargetStore.getState();
    const first = createNewStoredProjectDocument(createEmptyProject('同名工程'));
    const second = createNewStoredProjectDocument(createEmptyProject('同名工程'));

    expect(first.uiProject.meta.id).not.toBe(second.uiProject.meta.id);
    expect(first.buildTarget.uiProjectRef).toBe(
      `${first.uiProject.meta.id}@${first.uiProject.meta.revision}`,
    );
    expect(second.buildTarget.uiProjectRef).toBe(
      `${second.uiProject.meta.id}@${second.uiProject.meta.revision}`,
    );
    expect(first.buildTarget.themeRef).toContain(`${first.buildTarget.uiProjectRef}#theme:`);
    expect(second.buildTarget.themeRef).toContain(`${second.buildTarget.uiProjectRef}#theme:`);
    expect(useBuildTargetStore.getState()).toBe(currentBefore);
  });

  it('preserves an unresolved 16bpp byte-order gate across reopen', () => {
    const project = createEmptyProject('unconfirmed-rgb565');
    useBuildTargetStore.getState().syncProject(project);
    useBuildTargetStore.getState().clearColorFormatConfirmation();
    const stored = createStoredProjectDocument(project);

    loadProjectDocument(JSON.parse(JSON.stringify(stored)));

    expect(useBuildTargetStore.getState().colorFormatConfirmed).toBe(false);
    expect(useBuildTargetStore.getState().migrationNotes)
      .toContainEqual(expect.objectContaining({ code: 'color-format-ambiguous' }));
  });

  it('loads its own snapshot without losing the current editable subset', () => {
    const project = createEmptyProject('roundtrip');
    project.display.colorDepth = 32;
    project.screens[0]!.root.props.x = 12;
    const stored = createStoredProjectDocument(project);

    const loaded = loadProjectDocument(JSON.parse(JSON.stringify(stored)));

    expect(loaded.snapshot?.kind).toBe('lvgl-project-snapshot');
    expect(loaded.project).toEqual(project);
    expect(useBuildTargetStore.getState().uiProject.meta.id).toBe(stored.uiProject.meta.id);
    expect(useBuildTargetStore.getState().colorFormatConfirmed).toBe(true);
  });

  it('opens v1 as compatibility input but rewrites it as v2 on the next save', () => {
    const legacy = createEmptyProject('legacy-input');
    const loaded = loadProjectDocument(legacy);
    expect(loaded.snapshot).toBeNull();
    expect(createStoredProjectDocument(loaded.project).uiProject.schemaVersion).toBe(2);
  });
});
