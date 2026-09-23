import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@lvd/schema';
import { migrateV1ToV2, type ProjectSnapshotV2 } from '@lvd/schema/v2';
import { executeSitePublication } from './sitePublication.js';

function snapshot(): ProjectSnapshotV2 {
  const migrated = migrateV1ToV2(createEmptyProject('podsc-worker'));
  return {
    kind: 'lvgl-project-snapshot', snapshotVersion: 1,
    uiProject: migrated.uiProject, displayProfile: migrated.displayProfile,
    controllerProfile: null, buildTarget: migrated.buildTargetDraft,
    actionRegistry: {}, migrationNotes: migrated.notes, colorFormatConfirmed: true,
  };
}

describe('podsc-static publication worker', () => {
  it('creates a canonical asset-free WebUiDocumentV1', async () => {
    const result = await executeSitePublication({ protocolVersion: 1, command: 'project-podsc-static', snapshot: snapshot() });
    expect(result.diagnostics).toEqual([]);
    expect(result.document?.kind).toBe('wf2-web-ui');
    expect(result.document?.assetManifest).toEqual([]);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('blocks remote references with their exact property path', async () => {
    const input = snapshot();
    input.uiProject.screens[0]!.root.children.push({
      id: 'node:remote-image', type: 'image', props: { src: 'https://example.test/private.png' },
      styleRefs: [], styles: [], events: [], bindings: [], children: [],
    });
    const result = await executeSitePublication({ protocolVersion: 1, command: 'project-podsc-static', snapshot: input });
    expect(result.document).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_PODSC_EXTERNAL_REFERENCE',
      path: 'uiProject.screens[0].root.children[0].props.src',
    }));
  });

  it('blocks resource-backed widgets instead of publishing a placeholder', async () => {
    const input = snapshot();
    input.uiProject.screens[0]!.root.children.push({
      id: 'node:image-without-resource', type: 'image', props: {},
      styleRefs: [], styles: [], events: [], bindings: [], children: [],
    });
    const result = await executeSitePublication({ protocolVersion: 1, command: 'project-podsc-static', snapshot: input });
    expect(result.document).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_PODSC_RESOURCE_WIDGET_UNSUPPORTED',
      path: 'uiProject.screens[0].root.children[0].type',
    }));
  });
});
