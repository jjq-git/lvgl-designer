import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@lvd/schema';
import { migrateV1ToV2, snapshotToEditorProject, type ProjectSnapshotV2 } from '@lvd/schema/v2';
import { useBuildTargetStore } from './buildTargetStore';
import { findNodeByIdV2, useProjectStore } from './projectStore';
import { createStoredProjectDocument } from '../services/projectPersistence';
import { loadProjectDocument } from '../services/projectPersistence';
import { BUILT_IN_PROJECTS } from '../services/builtInProjects';

function loadTokenProject(): void {
  const source = createEmptyProject(`native-v2-${Math.random()}`);
  const migrated = migrateV1ToV2(source);
  migrated.uiProject.themes[0]!.tokens.push({
    id: 'color.text.primary', type: 'color', value: '#ffffff',
  });
  migrated.uiProject.screens[0]!.root.styles.push({
    props: { text_color: { $token: 'color.text.primary' } },
  });
  migrated.uiProject.assets.icons.push({
    id: 'icon:home', file: { fileName: 'home.svg', sha256: 'a'.repeat(64), byteSize: 12 },
  });
  const snapshot: ProjectSnapshotV2 = {
    kind: 'lvgl-project-snapshot',
    snapshotVersion: 1,
    uiProject: migrated.uiProject,
    displayProfile: migrated.displayProfile,
    controllerProfile: null,
    buildTarget: migrated.buildTargetDraft,
    actionRegistry: {},
    migrationNotes: migrated.notes,
    colorFormatConfirmed: false,
  };
  const project = snapshotToEditorProject(snapshot);
  useBuildTargetStore.getState().loadSnapshot(project, snapshot);
  useProjectStore.getState().loadProject(project);
}

describe('projectStore native UiProject edits', () => {
  beforeEach(loadTokenProject);

  it('writes canvas geometry to v2 and keeps v2-only assets', () => {
    const store = useProjectStore.getState();
    const rootId = store.uiProject.screens[0]!.root.id;
    store.mutateV2('move', (draft) => {
      const hit = findNodeByIdV2(draft, rootId);
      if (hit) hit.node.props.x = 24;
    });
    expect(useProjectStore.getState().uiProject.screens[0]!.root.props.x).toBe(24);
    expect(useProjectStore.getState().project.screens[0]!.root.props.x).toBe(24);
    expect(useProjectStore.getState().uiProject.assets.icons).toHaveLength(1);
    const stored = createStoredProjectDocument(useProjectStore.getState().project);
    expect(stored.uiProject.screens[0]!.root.styles[0]!.props.text_color)
      .toEqual({ $token: 'color.text.primary' });
    expect(stored.uiProject.assets.icons).toHaveLength(1);
  });

  it('undo and redo restore native token semantics', () => {
    const rootId = useProjectStore.getState().uiProject.screens[0]!.root.id;
    useProjectStore.getState().mutateV2('replace token', (draft) => {
      const hit = findNodeByIdV2(draft, rootId);
      if (hit) hit.node.styles[0]!.props.text_color = '#000000';
    });
    expect(useProjectStore.getState().uiProject.screens[0]!.root.styles[0]!.props.text_color)
      .toBe('#000000');
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().uiProject.screens[0]!.root.styles[0]!.props.text_color)
      .toEqual({ $token: 'color.text.primary' });
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().uiProject.screens[0]!.root.styles[0]!.props.text_color)
      .toBe('#000000');
  });

  it('switches the embedded theme and persists the selected BuildTarget theme', () => {
    useProjectStore.getState().mutateV2('add dark theme', (draft) => {
      draft.themes.push({
        id: 'dark',
        displayName: 'Dark',
        extends: 'default',
        tokens: [{ id: 'color.text.primary', type: 'color', value: '#101010' }],
      });
    });

    expect(useProjectStore.getState().selectTheme('missing')).toBe(false);
    expect(useProjectStore.getState().selectTheme('dark')).toBe(true);
    expect(useBuildTargetStore.getState().buildTargetDraft.themeRef).toMatch(/#theme:dark$/);
    expect(useProjectStore.getState().project.screens[0]!.root.inlineStyles[0]!.props.text_color)
      .toBe('#101010');
    expect(createStoredProjectDocument(useProjectStore.getState().project).buildTarget.themeRef)
      .toMatch(/#theme:dark$/);
  });

  it('reprojects the bundled WF3 UI when switching to the industrial base theme', async () => {
    const document = await BUILT_IN_PROJECTS[0]!.load();
    const loaded = loadProjectDocument(document);
    useProjectStore.getState().loadProject(loaded.project);

    expect(useProjectStore.getState().selectTheme('industrial-base')).toBe(true);

    const back = useProjectStore.getState().project.screens
      .find((screen) => screen.name === 'wf3_home')
      ?.root.children.find((node) => node.name === 'wf3_home_back');
    expect(useBuildTargetStore.getState().buildTargetDraft.themeRef)
      .toMatch(/#theme:industrial-base$/);
    expect(back?.inlineStyles[0]?.props.bg_color).toBe('#0F766E');
  });

  it('reprojects active token value edits for immediate canvas refresh', () => {
    useProjectStore.getState().mutateV2('change active theme color', (draft) => {
      const token = draft.themes[0]!.tokens.find((item) => item.id === 'color.text.primary');
      if (token) token.value = '#12AB34';
    });

    const state = useProjectStore.getState();
    expect(state.uiProject.themes[0]!.tokens[0]!.value).toBe('#12AB34');
    expect(state.project.screens[0]!.root.inlineStyles[0]!.props.text_color).toBe('#12AB34');
    expect(state.lastPatches.length).toBeGreaterThan(0);
  });

  it('persists custom device actions and includes them in undo/redo', () => {
    useProjectStore.getState().mutateActionRegistry('add device action', (draft) => {
      draft['custom.wifi_scan'] = {
        id: 'custom.wifi_scan',
        displayName: '扫描 Wi-Fi',
        params: [{ name: 'userData', type: 'string' }],
      };
    });

    expect(useBuildTargetStore.getState().actionRegistry['custom.wifi_scan']?.displayName)
      .toBe('扫描 Wi-Fi');
    expect(createStoredProjectDocument(useProjectStore.getState().project)
      .actionRegistry['custom.wifi_scan']?.id).toBe('custom.wifi_scan');

    useProjectStore.getState().undo();
    expect(useBuildTargetStore.getState().actionRegistry['custom.wifi_scan']).toBeUndefined();
    useProjectStore.getState().redo();
    expect(useBuildTargetStore.getState().actionRegistry['custom.wifi_scan']?.id)
      .toBe('custom.wifi_scan');
  });

  it('restores the previous dirty state when an interaction is cancelled', () => {
    const rootId = useProjectStore.getState().uiProject.screens[0]!.root.id;
    const store = useProjectStore.getState();
    expect(store.dirty).toBe(false);

    store.beginInteraction('drag', `drag:${rootId}`);
    store.mutateV2('drag', (draft) => {
      const hit = findNodeByIdV2(draft, rootId);
      if (hit) hit.node.props.x = 42;
    }, { transient: true });
    expect(useProjectStore.getState().dirty).toBe(true);

    useProjectStore.getState().abortInteraction();
    const after = useProjectStore.getState();
    expect(after.uiProject.screens[0]!.root.props.x).toBeUndefined();
    expect(after.dirty).toBe(false);
    expect(after.undoStack).toHaveLength(0);
  });

  it('commits an active interaction before redo and invalidates stale redo history', () => {
    const rootId = useProjectStore.getState().uiProject.screens[0]!.root.id;
    useProjectStore.getState().mutateV2('first edit', (draft) => {
      const hit = findNodeByIdV2(draft, rootId);
      if (hit) hit.node.props.x = 10;
    });
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().redoStack).toHaveLength(1);

    useProjectStore.getState().beginInteraction('drag', `drag:${rootId}`);
    useProjectStore.getState().mutateV2('drag', (draft) => {
      const hit = findNodeByIdV2(draft, rootId);
      if (hit) hit.node.props.y = 20;
    }, { transient: true });
    useProjectStore.getState().redo();

    const after = useProjectStore.getState();
    expect(after.uiProject.screens[0]!.root.props.x).toBeUndefined();
    expect(after.uiProject.screens[0]!.root.props.y).toBe(20);
    expect(after.undoStack.at(-1)?.label).toBe('drag');
    expect(after.redoStack).toHaveLength(0);
  });

  it('does not clear dirty when an older async save finishes after a newer edit', () => {
    const rootId = useProjectStore.getState().uiProject.screens[0]!.root.id;
    useProjectStore.getState().mutateV2('first edit', (draft) => {
      const hit = findNodeByIdV2(draft, rootId);
      if (hit) hit.node.props.x = 10;
    });
    const savingRevision = useProjectStore.getState().revision;
    useProjectStore.getState().mutateV2('newer edit', (draft) => {
      const hit = findNodeByIdV2(draft, rootId);
      if (hit) hit.node.props.y = 20;
    });

    useProjectStore.getState().markSaved(savingRevision);
    expect(useProjectStore.getState().dirty).toBe(true);

    useProjectStore.getState().markSaved(useProjectStore.getState().revision);
    expect(useProjectStore.getState().dirty).toBe(false);
  });
});
