import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@lvd/schema';
import { createFreshProjectSnapshot, useBuildTargetStore } from '../stores/buildTargetStore';
import { loadProjectDocument, repairStoredProjectDocument } from './projectPersistence';

describe('projectPersistence structure repair', () => {
  beforeEach(() => {
    useBuildTargetStore.getState().syncProject(createEmptyProject('reset'));
  });

  it('moves ordinary widgets stored directly under tileview into a tile', () => {
    const stored = createFreshProjectSnapshot(createEmptyProject('repair-tileview'));
    stored.uiProject.screens[0]!.root.children.push({
      id: 'tileview-1',
      type: 'tileview',
      props: {},
      styleRefs: [],
      styles: [],
      events: [],
      bindings: [],
      children: [
        {
          id: 'obj-1', type: 'obj', props: {}, styleRefs: [], styles: [],
          events: [], bindings: [], children: [],
        },
        {
          id: 'obj-2', type: 'obj', props: {}, styleRefs: [], styles: [],
          events: [], bindings: [], children: [],
        },
      ],
    });

    const repaired = repairStoredProjectDocument(stored);

    expect(repaired.repairs).toEqual([
      expect.objectContaining({ code: 'tileview-direct-children-repaired', count: 2 }),
    ]);
    const snapshot = repaired.document as typeof stored;
    const repairedTileview = snapshot.uiProject.screens[0]!.root.children[0]!;
    expect(repairedTileview.children).toHaveLength(1);
    expect(repairedTileview.children[0]!.type).toBe('tileview-tile');
    expect(repairedTileview.children[0]!.children.map((child) => child.id))
      .toEqual(['obj-1', 'obj-2']);

    // The loader repair must not mutate the cloud/IndexedDB source object.
    expect(stored.uiProject.screens[0]!.root.children[0]!.children.map((child) => child.id))
      .toEqual(['obj-1', 'obj-2']);

    const loaded = loadProjectDocument(stored);
    expect(loaded.repairs).toHaveLength(1);
    expect(loaded.snapshot?.migrationNotes).toContainEqual(expect.objectContaining({
      code: 'tileview-direct-children-repaired',
    }));
  });
});
