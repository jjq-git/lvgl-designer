import { describe, expect, it } from 'vitest';
import { createEmptyProject, createNode } from '../index.js';
import { migrateV1ToV2 } from '../v2/migrate.js';
import {
  loadStoredProjectDocument,
  snapshotToEditorProject,
  type ProjectSnapshotV2,
} from '../v2/projectSnapshot.js';

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
});
