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
import {
  createFreshProjectSnapshot,
  useBuildTargetStore,
  type ControllerPreset,
} from '../stores/buildTargetStore';
import { generateThemeFromCurrentStyles } from './themeBinding';

export type { StoredProjectDocument } from '@lvd/schema/v2';

export interface ProjectStructureRepair {
  code: 'tileview-direct-children-repaired'
    | 'binding-comparison-operator-repaired'
    | 'snapshot-references-repaired'
    | 'editable-theme-generated'
    | 'serene-brand-repaired';
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

function repairBindingComparisonOperators(node: WidgetNodeV2): number {
  let count = 0;
  for (const binding of node.bindings as Array<{ kind: string; op?: string }>) {
    if ((binding.kind === 'flag' || binding.kind === 'state') && binding.op === 'ne') {
      binding.op = 'not_eq';
      count += 1;
    }
  }
  return count + node.children.reduce(
    (total, child) => total + repairBindingComparisonOperators(child),
    0,
  );
}

function repairSereneBrand(project: ProjectSnapshotV2['uiProject']): number {
  const isSereneProject = project.editor?.example === 'serene-pod-control-suite'
    || project.meta.name.includes('自然舒适舱');
  if (!isSereneProject) return 0;
  const visit = (node: WidgetNodeV2): number => {
    let count = 0;
    if (node.props.text === 'SERENE') {
      node.props.text = 'BRAND A';
      count += 1;
    }
    return count + node.children.reduce((total, child) => total + visit(child), 0);
  };
  return [
    ...project.screens.map((screen) => screen.root),
    ...project.components.map((component) => component.root),
  ].reduce((total, root) => total + visit(root), 0);
}

function repairSnapshotReferences(document: ProjectSnapshotV2, generatedThemeId?: string): number {
  let count = 0;
  const displayRef = (`${document.displayProfile.id}@${document.displayProfile.revision}`) as typeof document.uiProject.designDisplayRef;
  const uiProjectRef = (`${document.uiProject.meta.id}@${document.uiProject.meta.revision}`) as typeof document.buildTarget.uiProjectRef;
  if (document.uiProject.designDisplayRef !== displayRef) {
    document.uiProject.designDisplayRef = displayRef;
    count += 1;
  }
  if (document.controllerProfile && document.controllerProfile.displayRef !== displayRef) {
    document.controllerProfile.displayRef = displayRef;
    count += 1;
  }
  if (document.buildTarget.uiProjectRef !== uiProjectRef) {
    document.buildTarget.uiProjectRef = uiProjectRef;
    count += 1;
  }
  if (document.controllerProfile) {
    const controllerRef = (`${document.controllerProfile.id}@${document.controllerProfile.revision}`) as NonNullable<typeof document.buildTarget.controllerProfileRef>;
    if (document.buildTarget.controllerProfileRef !== controllerRef) {
      document.buildTarget.controllerProfileRef = controllerRef;
      count += 1;
    }
  }

  const embeddedThemeId = document.buildTarget.themeRef.match(/#theme:(.+)$/)?.[1];
  const selectedThemeId = generatedThemeId
    ?? (embeddedThemeId && document.uiProject.themes.some((theme) => theme.id === embeddedThemeId)
      ? embeddedThemeId
      : undefined);
  if (selectedThemeId) {
    const themeRef = `${uiProjectRef}#theme:${selectedThemeId}` as typeof document.buildTarget.themeRef;
    if (document.buildTarget.themeRef !== themeRef) {
      document.buildTarget.themeRef = themeRef;
      count += 1;
    }
  }
  return count;
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
  const repairedBindingCount = [
    ...document.uiProject.screens.map((screen) => screen.root),
    ...document.uiProject.components.map((component) => component.root),
  ].reduce(
    (count, root) => count + repairBindingComparisonOperators(root),
    0,
  );
  if (repairedBindingCount > 0) {
    repairs.push({
      code: 'binding-comparison-operator-repaired',
      path: 'uiProject',
      count: repairedBindingCount,
    });
  }
  const repairedBrandCount = repairSereneBrand(document.uiProject);
  if (repairedBrandCount > 0) {
    repairs.push({
      code: 'serene-brand-repaired',
      path: 'uiProject.screens',
      count: repairedBrandCount,
    });
  }
  const preferredThemeId = document.buildTarget.themeRef.match(/#theme:(.+)$/)?.[1] ?? 'default';
  const generatedTheme = generateThemeFromCurrentStyles(document.uiProject, preferredThemeId);
  if (generatedTheme) {
    repairs.push({
      code: 'editable-theme-generated',
      path: 'uiProject.themes',
      count: generatedTheme.bindingCount,
    });
  }
  const repairedReferenceCount = repairSnapshotReferences(document, generatedTheme?.themeId);
  if (repairedReferenceCount > 0) {
    repairs.push({
      code: 'snapshot-references-repaired',
      path: 'uiProject.designDisplayRef',
      count: repairedReferenceCount,
    });
  }
  for (const repair of repairs) {
    document.migrationNotes.push({
      severity: 'info',
      code: repair.code,
      path: repair.path,
      message: repair.code === 'tileview-direct-children-repaired'
        ? `已将 tileview 下的 ${repair.count} 个直属组件移入 tileview-tile`
        : repair.code === 'binding-comparison-operator-repaired'
          ? `已将 ${repair.count} 处旧版 ne 比较条件迁移为 not_eq`
          : repair.code === 'editable-theme-generated'
            ? `已将 ${repair.count} 处现有颜色和字体转换为可编辑主题 Token`
            : repair.code === 'serene-brand-repaired'
              ? `已将 ${repair.count} 处 SERENE 品牌文字更新为 BRAND A`
              : `已修复 ${repair.count} 处工程显示、控制器或主题引用`,
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
export function createNewStoredProjectDocument(
  project: LvProject,
  controllerPreset: ControllerPreset | null = null,
): ProjectSnapshotV2 {
  // 云端创建可能失败；这里必须保持纯函数，不能提前改写当前工程的目标侧车状态。
  const document = createFreshProjectSnapshot(project, controllerPreset);
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

/**
 * Parse either a current v2 snapshot or a legacy v1 document without changing
 * the active editor session. Use this for background metadata/cache reads.
 */
export function parseProjectDocument(raw: unknown): LoadedDesignerProjectDocument {
  const repaired = repairStoredProjectDocument(raw);
  const loaded = loadStoredProjectDocument(repaired.document);
  return { ...loaded, repairs: repaired.repairs };
}

/** Load a parsed document into the active BuildTarget session. */
export function loadProjectDocument(raw: unknown): LoadedDesignerProjectDocument {
  const loaded = parseProjectDocument(raw);
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
