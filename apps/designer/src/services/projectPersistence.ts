/** Main persistence boundary: v2 snapshot on write, v1 compatibility on read. */
import { REGISTRY, newUuid, type LvProject } from '@lvd/schema';
import {
  componentIdFromType,
  isProjectSnapshotV2,
  loadStoredProjectDocument,
  type LoadedProjectDocument,
  type ProjectSnapshotV2,
  type StoredProjectDocument,
  type WidgetNodeV2,
} from '@lvd/schema/v2';
import { createFreshProjectSnapshot, useBuildTargetStore } from '../stores/buildTargetStore';

export type { StoredProjectDocument } from '@lvd/schema/v2';

export interface ProjectStructureRepair {
  code: 'tileview-direct-children-repaired';
  path: string;
  count: number;
}

export interface LoadedDesignerProjectDocument extends LoadedProjectDocument {
  repairs: ProjectStructureRepair[];
}

function isOrdinaryWidget(node: WidgetNodeV2): boolean {
  return REGISTRY.has(node.type) || componentIdFromType(node.type) !== null;
}

function repairTileviewChildren(
  node: WidgetNodeV2,
  path: string,
  repairs: ProjectStructureRepair[],
): void {
  if (node.type === 'tileview') {
    const directWidgets = node.children.filter(isOrdinaryWidget);
    if (directWidgets.length > 0) {
      let tile = node.children.find((child) => child.type === 'tileview-tile');
      if (tile) {
        node.children = node.children.filter((child) => !directWidgets.includes(child));
        tile.children.push(...directWidgets);
      } else {
        const firstIndex = node.children.findIndex(isOrdinaryWidget);
        tile = {
          id: newUuid(),
          type: 'tileview-tile',
          props: { col: 0, row: 0, dir: 'all' },
          styleRefs: [],
          styles: [],
          events: [],
          bindings: [],
          children: directWidgets,
        };
        const remaining = node.children.filter((child) => !directWidgets.includes(child));
        remaining.splice(Math.min(firstIndex, remaining.length), 0, tile);
        node.children = remaining;
      }
      repairs.push({
        code: 'tileview-direct-children-repaired',
        path,
        count: directWidgets.length,
      });
    }
  }
  node.children.forEach((child, index) => {
    repairTileviewChildren(child, `${path}.children[${index}]`, repairs);
  });
}

/** Repair project trees written by builds that allowed ordinary widgets directly under tileview. */
export function repairStoredProjectDocument(raw: unknown): {
  document: unknown;
  repairs: ProjectStructureRepair[];
} {
  if (!isProjectSnapshotV2(raw)) return { document: raw, repairs: [] };

  const document = cloneStoredProjectDocument(raw) as ProjectSnapshotV2;
  const repairs: ProjectStructureRepair[] = [];
  document.uiProject.screens.forEach((screen, index) => {
    repairTileviewChildren(screen.root, `uiProject.screens[${index}].root`, repairs);
  });
  document.uiProject.components.forEach((component, index) => {
    repairTileviewChildren(component.root, `uiProject.components[${index}].root`, repairs);
  });
  for (const repair of repairs) {
    document.migrationNotes.push({
      severity: 'info',
      code: repair.code,
      path: repair.path,
      message: `已将 tileview 下的 ${repair.count} 个直属组件移入 tileview-tile`,
    });
  }
  return { document, repairs };
}

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
export function loadProjectDocument(raw: unknown): LoadedDesignerProjectDocument {
  const repaired = repairStoredProjectDocument(raw);
  const loaded = loadStoredProjectDocument(repaired.document);
  if (loaded.snapshot === null) {
    useBuildTargetStore.getState().syncProject(loaded.project);
  } else {
    useBuildTargetStore.getState().loadSnapshot(loaded.project, loaded.snapshot);
  }
  return { ...loaded, repairs: repaired.repairs };
}

export function cloneStoredProjectDocument(document: StoredProjectDocument): StoredProjectDocument {
  return JSON.parse(JSON.stringify(document)) as StoredProjectDocument;
}
