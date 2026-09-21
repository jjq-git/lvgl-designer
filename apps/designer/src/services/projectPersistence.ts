/** Main persistence boundary: v2 snapshot on write, v1 compatibility on read. */
import { newUuid, type LvProject } from '@lvd/schema';
import {
  loadStoredProjectDocument,
  type LoadedProjectDocument,
  type ProjectSnapshotV2,
  type StoredProjectDocument,
} from '@lvd/schema/v2';
import { createFreshProjectSnapshot, useBuildTargetStore } from '../stores/buildTargetStore';

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

/**
 * Create a snapshot for a brand new project with an identity that cannot collide
 * with another project that happens to use the same display name.
 */
export function createNewStoredProjectDocument(project: LvProject): ProjectSnapshotV2 {
  // 云端创建可能失败；这里必须保持纯函数，不能提前改写当前工程的目标侧车状态。
  const document = createFreshProjectSnapshot(project);
  const suffix = newUuid().replaceAll('-', '').slice(0, 12);
  const base = document.uiProject.meta.id.slice('ui:'.length) || 'untitled-ui';
  const uiProjectId = `ui:${base}-${suffix}`;
  const uiProjectRef = `${uiProjectId}@${document.uiProject.meta.revision}` as typeof document.buildTarget.uiProjectRef;
  const themeId = document.uiProject.themes[0]?.id ?? 'default';

  document.uiProject.meta.id = uiProjectId;
  document.buildTarget = {
    ...document.buildTarget,
    id: `target:${base}-${suffix}-draft`,
    uiProjectRef,
    themeRef: `${uiProjectRef}#theme:${themeId}`,
  };
  return document;
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
