import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@lvd/schema';
import { createFreshProjectSnapshot, useBuildTargetStore } from '../stores/buildTargetStore';
import {
  loadProjectDocument,
  parseProjectDocument,
  repairStoredProjectDocument,
} from './projectPersistence';

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

  it('repairs the obsolete ne binding operator before validation and preview', () => {
    const stored = createFreshProjectSnapshot(createEmptyProject('repair-binding-op'));
    stored.uiProject.subjects.push({
      id: 'subject:page', codeName: 'page', type: 'int', initial: 0,
    });
    stored.uiProject.screens[0]!.root.bindings.push({
      kind: 'flag', flag: 'hidden', op: 'ne', subject: 'subject:page', refValue: 0,
    } as never);

    const repaired = repairStoredProjectDocument(stored);
    const snapshot = repaired.document as typeof stored;

    expect(repaired.repairs).toContainEqual({
      code: 'binding-comparison-operator-repaired', path: 'uiProject', count: 1,
    });
    expect(snapshot.uiProject.screens[0]!.root.bindings[0]).toMatchObject({
      op: 'not_eq',
    });
    expect(loadProjectDocument(stored).snapshot).not.toBeNull();
    expect((stored.uiProject.screens[0]!.root.bindings[0] as { op?: string }).op).toBe('ne');
  });

  it('repairs stale display references and generates a theme for existing projects', () => {
    const stored = createFreshProjectSnapshot(createEmptyProject('WF2D-8630 自然舒适舱界面'));
    stored.uiProject.designDisplayRef = 'display:obsolete-480x480@1';
    stored.buildTarget.uiProjectRef = 'ui:obsolete@1';
    stored.buildTarget.themeRef = 'ui:obsolete@1#theme:default';
    stored.uiProject.screens[0]!.root.styles.push({
      props: { bg_color: '#EAF4FA' },
    });
    stored.uiProject.screens[0]!.root.children.push({
      id: 'serene-title',
      type: 'label',
      props: { text: 'BRAND A' },
      styleRefs: [],
      styles: [{ props: { text_color: '#397FA8', text_font: 'montserrat_20' } }],
      events: [],
      bindings: [],
      children: [],
    });

    const repaired = repairStoredProjectDocument(stored);
    const snapshot = repaired.document as typeof stored;
    const expectedDisplayRef = `${snapshot.displayProfile.id}@${snapshot.displayProfile.revision}`;
    const expectedUiRef = `${snapshot.uiProject.meta.id}@${snapshot.uiProject.meta.revision}`;

    expect(repaired.repairs).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'editable-theme-generated', count: 3 }),
      expect.objectContaining({ code: 'snapshot-references-repaired' }),
    ]));
    expect(snapshot.uiProject.designDisplayRef).toBe(expectedDisplayRef);
    expect(snapshot.buildTarget.uiProjectRef).toBe(expectedUiRef);
    expect(snapshot.buildTarget.themeRef).toBe(`${expectedUiRef}#theme:default`);
    expect(snapshot.uiProject.themes[0]?.tokens).toHaveLength(3);
    expect(snapshot.uiProject.screens[0]!.root.styles[0]!.props.bg_color)
      .toEqual({ $token: 'color.background' });
    expect(loadProjectDocument(stored).snapshot).not.toBeNull();
    expect(stored.uiProject.designDisplayRef).toBe('display:obsolete-480x480@1');
  });

  it('updates the old Serene brand on every screen while loading saved projects', () => {
    const stored = createFreshProjectSnapshot(createEmptyProject('Serene legacy project'));
    stored.uiProject.editor = {
      ...stored.uiProject.editor,
      example: 'serene-pod-control-suite',
    };
    stored.uiProject.screens[0]!.root.children.push(
      {
        id: 'brand-1', type: 'label', props: { text: 'SERENE' }, styleRefs: [], styles: [],
        events: [], bindings: [], children: [],
      },
      {
        id: 'brand-2', type: 'label', props: { text: 'SERENE' }, styleRefs: [], styles: [],
        events: [], bindings: [], children: [],
      },
    );

    const repaired = repairStoredProjectDocument(stored);
    const snapshot = repaired.document as typeof stored;

    expect(repaired.repairs).toContainEqual({
      code: 'serene-brand-repaired', path: 'uiProject.screens', count: 2,
    });
    expect(snapshot.uiProject.screens[0]!.root.children.map((node) => node.props.text))
      .toEqual(['BRAND A', 'BRAND A']);
    expect(loadProjectDocument(stored).snapshot).not.toBeNull();
    expect(stored.uiProject.screens[0]!.root.children[0]!.props.text).toBe('SERENE');
  });

  it('parses a cached project without replacing the active BuildTarget session', () => {
    const active = createFreshProjectSnapshot(createEmptyProject('active-cloud-project'));
    active.buildTarget.themeRef = `${active.buildTarget.uiProjectRef}#theme:${active.uiProject.themes[0]!.id}`;
    loadProjectDocument(active);
    const before = useBuildTargetStore.getState();

    const cached = createFreshProjectSnapshot(createEmptyProject('cached-local-project'));
    cached.uiProject.meta.id = 'ui:cached-local-project';
    cached.buildTarget.uiProjectRef = 'ui:cached-local-project@1';
    cached.buildTarget.themeRef = `ui:cached-local-project@1#theme:${cached.uiProject.themes[0]!.id}`;
    const parsed = parseProjectDocument(cached);
    const after = useBuildTargetStore.getState();

    expect(parsed.project.meta.name).toBe('cached-local-project');
    expect(after.sourceProject).toBe(before.sourceProject);
    expect(after.uiProject).toBe(before.uiProject);
    expect(after.buildTargetDraft).toBe(before.buildTargetDraft);
  });
});
