import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject, createNode } from '@lvd/schema';
import { emitC95 } from '@lvd/codegen';
import {
  componentIdFromType,
  migrateV1ToV2,
  snapshotToEditorProject,
  type ProjectSnapshotV2,
} from '@lvd/schema/v2';
import { useBuildTargetStore } from '../stores/buildTargetStore';
import { useProjectStore } from '../stores/projectStore';
import { createComponentFromNode, detachComponentInstance } from './components';
import { duplicateSelection } from './clipboard';

let sourceNodeId = '';

function loadProject(): void {
  const source = createEmptyProject(`components-${Math.random()}`);
  source.display.colorDepth = 32;
  const button = createNode('button');
  button.name = 'status_button';
  button.props.x = 20;
  button.props.y = 30;
  const label = createNode('label');
  label.name = 'status_text';
  label.props.text = 'Ready';
  button.children.push(label);
  source.screens[0]!.root.children.push(button);
  sourceNodeId = button.id;

  const migrated = migrateV1ToV2(source);
  const snapshot: ProjectSnapshotV2 = {
    kind: 'lvgl-project-snapshot', snapshotVersion: 1,
    uiProject: migrated.uiProject,
    displayProfile: migrated.displayProfile,
    controllerProfile: null,
    buildTarget: migrated.buildTargetDraft,
    actionRegistry: {}, migrationNotes: migrated.notes, colorFormatConfirmed: false,
  };
  const projected = snapshotToEditorProject(snapshot);
  useBuildTargetStore.getState().loadSnapshot(projected, snapshot);
  useProjectStore.getState().loadProject(projected);
}

describe('reusable component workflow', () => {
  beforeEach(loadProject);

  it('creates a linked instance and refreshes preview projection when its definition changes', () => {
    const componentId = createComponentFromNode(sourceNodeId, '状态按钮');
    expect(componentId).not.toBeNull();

    const afterCreate = useProjectStore.getState();
    const instance = afterCreate.uiProject.screens[0]!.root.children[0]!;
    expect(componentIdFromType(instance.type)).toBe(componentId);
    expect(instance.props).toMatchObject({ x: 20, y: 30 });
    expect(instance.children).toEqual([]);
    expect(afterCreate.project.components).toEqual([]);
    expect(afterCreate.project.screens[0]!.root.children[0]!.type).toBe('button');
    expect(afterCreate.project.screens[0]!.root.children[0]!.children[0]!.props.text).toBe('Ready');
    const generated = emitC95(afterCreate.project);
    expect(generated.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(generated.files.find((file) => file.path === 'screens/main.c')?.content)
      .toContain('lv_button_create');

    useProjectStore.getState().mutateV2('修改组件定义', (draft) => {
      draft.components[0]!.root.children[0]!.props.text = 'Updated';
    });
    expect(useProjectStore.getState().project.screens[0]!.root.children[0]!.children[0]!.props.text)
      .toBe('Updated');
  });

  it('detaches an instance into an independent ordinary subtree', () => {
    createComponentFromNode(sourceNodeId, '状态按钮');
    expect(detachComponentInstance(sourceNodeId)).toBe(true);
    const detached = useProjectStore.getState().uiProject.screens[0]!.root.children[0]!;
    expect(detached.type).toBe('button');
    expect(detached.children[0]!.type).toBe('label');
  });

  it('duplicates a linked instance with a valid component-based C name', () => {
    createComponentFromNode(sourceNodeId, '状态按钮');
    duplicateSelection();
    const children = useProjectStore.getState().uiProject.screens[0]!.root.children;
    expect(children).toHaveLength(2);
    expect(children[1]!.codeName).toMatch(/^component_1_/);
    expect(useProjectStore.getState().project.screens[0]!.root.children).toHaveLength(2);
  });
});
