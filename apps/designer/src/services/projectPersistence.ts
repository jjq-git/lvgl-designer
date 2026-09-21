/** Main persistence boundary: v2 snapshot on write, v1 compatibility on read. */
import type { LvProject } from '@lvd/schema';
import {
  loadStoredProjectDocument,
  type LoadedProjectDocument,
  type ProjectSnapshotV2,
  type StoredProjectDocument,
} from '@lvd/schema/v2';
import { useBuildTargetStore } from '../stores/buildTargetStore';

export type { StoredProjectDocument } from '@lvd/schema/v2';

/** Create the only format written by current Designer builds. */
export function createStoredProjectDocument(project: LvProject): ProjectSnapshotV2 {
  useBuildTargetStore.getState().syncProject(project);
  const state = useBuildTargetStore.getState();
  return {
    kind: 'lvgl-project-snapshot',
    snapshotVersion: 1,
    uiProject: state.uiProject,
    displayProfile: state.displayProfile,
    controllerProfile: state.controllerProfile,
    buildTarget: state.buildTargetDraft,
    actionRegistry: state.actionRegistry,
    migrationNotes: state.migrationNotes,
    colorFormatConfirmed: state.colorFormatConfirmed,
  };
}

/** Load either a current v2 snapshot or a legacy v1 document. */
export function loadProjectDocument(raw: unknown): LoadedProjectDocument {
  const loaded = loadStoredProjectDocument(raw);
  if (loaded.snapshot === null) {
    useBuildTargetStore.getState().syncProject(loaded.project);
  } else {
    useBuildTargetStore.getState().loadSnapshot(loaded.project, loaded.snapshot);
  }
  return loaded;
}

export function cloneStoredProjectDocument(document: StoredProjectDocument): StoredProjectDocument {
  return JSON.parse(JSON.stringify(document)) as StoredProjectDocument;
}
