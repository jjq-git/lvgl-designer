import { describe, expect, it } from 'vitest';
import { createEmptyProject, createNode } from '../index.js';
import { migrateV1ToV2 } from '../v2/migrate.js';
import {
  loadStoredProjectDocument,
  snapshotToEditorProject,
  type ProjectSnapshotV2,
} from '../v2/projectSnapshot.js';
import { componentType } from '../v2/components.js';

function snapshotOf(name = 'snapshot-test'): { source: ReturnType<typeof createEmptyProject>; snapshot: ProjectSnapshotV2 } {
  const source = createEmptyProject(name);
  const migrated = migrateV1ToV2(source);
  return {
    source,
    snapshot: {
      kind: 'lvgl-project-snapshot',
      snapshotVersion: 1,
      uiProject: migrated.uiProject,
      displayProfile: migrated.displayProfile,
      controllerProfile: null,
      buildTarget: migrated.buildTargetDraft,
      actionRegistry: {},
      migrationNotes: migrated.notes,
      colorFormatConfirmed: false,
    },
  };
}

describe('ProjectSnapshot v2 persistence', () => {
  it('v1 → v2 snapshot → transient editor model is lossless for the current editable subset', () => {
    const { source, snapshot } = snapshotOf();
    source.subjects.push({ name: 'level', type: 'int', initial: 3, min: 0, max: 10 });
    const button = createNode('button');
    button.name = 'apply_button';
    button.events.push({
      kind: 'subject_set', trigger: 'clicked', subject: 'level', subjectType: 'int', value: '8',
    });
    source.screens[0]!.root.children.push(button);

    const migrated = migrateV1ToV2(source);
    snapshot.uiProject = migrated.uiProject;
    snapshot.displayProfile = migrated.displayProfile;
    snapshot.buildTarget = migrated.buildTargetDraft;

    expect(snapshotToEditorProject(snapshot)).toEqual(source);
  });

  it('reads legacy v1 but identifies it as compatibility input', () => {
    const source = createEmptyProject('legacy');
    const loaded = loadStoredProjectDocument(source);
    expect(loaded.project).toEqual(source);
    expect(loaded.snapshot).toBeNull();
  });

  it('rejects malformed snapshot envelopes before dereferencing nested fields', () => {
    expect(() => loadStoredProjectDocument({
      kind: 'lvgl-project-snapshot', snapshotVersion: 1,
    })).toThrow('快照缺少');
  });

  it('projects Theme Tokens for preview while keeping token and icon data in the v2 snapshot', () => {
    const { snapshot } = snapshotOf();
    snapshot.uiProject.themes[0]!.tokens.push({ id: 'color.text', type: 'color', value: '#ffffff' });
    snapshot.uiProject.screens[0]!.root.styles.push({
      props: { text_color: { $token: 'color.text' } },
    });
    snapshot.uiProject.assets.icons.push({
      id: 'icon:home', file: { fileName: 'home.svg', sha256: 'a'.repeat(64), byteSize: 12 },
    });

    const projected = snapshotToEditorProject(snapshot);
    expect(projected.screens[0]!.root.inlineStyles[0]!.props.text_color).toBe('#ffffff');
    expect(snapshot.uiProject.screens[0]!.root.styles[0]!.props.text_color)
      .toEqual({ $token: 'color.text' });
    expect(snapshot.uiProject.assets.icons).toHaveLength(1);
  });

  it('lowers linked reusable components for preview/codegen while preserving the v2 definition', () => {
    const { snapshot } = snapshotOf();
    snapshot.uiProject.components.push({
      id: 'cmp-card', codeName: 'status_card', displayName: '状态卡片',
      api: [{ name: 'caption', type: 'string', default: 'Ready' }], styles: [], consts: [],
      root: {
        id: 'cmp-root', type: 'button', codeName: 'root', props: { x: 0, y: 0, width: 120, height: 48 },
        styleRefs: [], styles: [], events: [], bindings: [],
        children: [{
          id: 'cmp-label', type: 'label', codeName: 'caption', props: { text: '$caption' },
          styleRefs: [], styles: [], events: [], bindings: [], children: [],
        }],
      },
    });
    snapshot.uiProject.screens[0]!.root.children.push({
      id: 'instance-1', type: componentType('cmp-card'), codeName: 'status_1',
      props: { x: 33, y: 44, caption: 'Online' },
      styleRefs: [], styles: [], events: [], bindings: [], children: [],
    });

    const projected = snapshotToEditorProject(snapshot);
    const instance = projected.screens[0]!.root.children[0]!;
    expect(projected.components).toEqual([]);
    expect(snapshot.uiProject.components).toHaveLength(1);
    expect(instance.type).toBe('button');
    expect(instance.id).toBe('instance-1');
    expect(instance.name).toBe('status_1');
    expect(instance.props).toMatchObject({ x: 33, y: 44, width: 120, height: 48 });
    expect(instance.props).not.toHaveProperty('caption');
    expect(instance.children[0]!.type).toBe('label');
    expect(instance.children[0]!.name).toMatch(/^status_1_caption_/);
    expect(instance.children[0]!.props.text).toBe('Online');
  });
});
