import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@lvd/schema';
import { migrateV1ToV2, snapshotToEditorProject, type ProjectSnapshotV2 } from '@lvd/schema/v2';
import { useBuildTargetStore } from './buildTargetStore';
import { findNodeByIdV2, useProjectStore } from './projectStore';
import { createStoredProjectDocument } from '../services/projectPersistence';

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
});
