/**
 * projectStore — UiProject v2 文档态 + runtime v1 投影 + undo/redo。
 * v2 是 Canvas/Inspector/AI/素材编辑的唯一可变真相；v1 仅供现有预览编译器和
 * DisplayProfile 控件消费。design/04 §2/§3:zustand + immer produceWithPatches;coalesceKey 合并;
 * begin/commit/abortInteraction 把连续拖动压成一条历史;limit 200。
 * lastPatches 暴露给 reloadPipeline 做 diff 分级。
 */
import { create } from 'zustand';
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import { createEmptyProject, type DisplayConfig, type LvProject } from '@lvd/schema';
import {
  snapshotToEditorProject,
  type ActionRegistry,
  type ProjectSnapshotV2,
  type UiProject,
} from '@lvd/schema/v2';
import { inferActionRegistry, useBuildTargetStore } from './buildTargetStore';

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  /** Present for edits whose canonical target is UiProject v2. */
  uiPatches?: Patch[];
  uiInversePatches?: Patch[];
  actionRegistryBefore?: ActionRegistry;
  actionRegistryAfter?: ActionRegistry;
  coalesceKey?: string;
  ts: number;
}

export interface MutateOptions {
  coalesceKey?: string;
  /** true = 不直接记历史(拖动中间帧);配合 begin/commitInteraction */
  transient?: boolean;
}

interface Interaction {
  label: string;
  coalesceKey: string;
  patches: Patch[];
  inversePatches: Patch[];
  uiPatches: Patch[];
  uiInversePatches: Patch[];
}

export type ChangeKind = 'mutate' | 'undo' | 'redo' | 'load';

const HISTORY_LIMIT = 200;
const COALESCE_WINDOW_MS = 800;

export interface ProjectStoreState {
  project: LvProject;
  /** Canonical editable tree; project is a runtime-only projection. */
  uiProject: UiProject;
  revision: number;
  dirty: boolean;
  /** 本次变更的 immer patches(kind='load' 时为空 → 管线整体重载) */
  lastPatches: Patch[];
  lastChangeKind: ChangeKind;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];

  /** DisplayProfile 兼容控件专用；不能修改 UiProject 树。 */
  mutateDisplay(label: string, recipe: (draft: DisplayConfig) => void, opts?: MutateOptions): void;
  mutateV2(label: string, recipe: (draft: UiProject) => void, opts?: MutateOptions): void;
  mutateActionRegistry(label: string, recipe: (draft: ActionRegistry) => void): void;
  beginInteraction(label: string, coalesceKey: string): void;
  commitInteraction(): void;
  abortInteraction(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  loadProject(p: LvProject): void;
  markSaved(): void;
}

let interaction: Interaction | null = null;

const initialProject = createEmptyProject();
useBuildTargetStore.getState().syncProject(initialProject);

function projectSnapshot(uiProject: UiProject): ProjectSnapshotV2 {
  const target = useBuildTargetStore.getState();
  return {
    kind: 'lvgl-project-snapshot',
    snapshotVersion: 1,
    uiProject,
    displayProfile: target.displayProfile,
    controllerProfile: target.controllerProfile,
    buildTarget: {
      ...target.buildTargetDraft,
      uiProjectRef: `${uiProject.meta.id}@${uiProject.meta.revision}` as `ui:${string}@${number}`,
    },
    actionRegistry: { ...target.actionRegistry, ...inferActionRegistry(uiProject) },
    migrationNotes: target.migrationNotes,
    colorFormatConfirmed: target.colorFormatConfirmed,
  };
}

function projectFromUi(uiProject: UiProject): LvProject {
  return snapshotToEditorProject(projectSnapshot(uiProject));
}

function recordHistory(
  stack: HistoryEntry[],
  entry: HistoryEntry,
): HistoryEntry[] {
  const top = stack[stack.length - 1];
  if (entry.coalesceKey && top?.coalesceKey === entry.coalesceKey
    && entry.ts - top.ts < COALESCE_WINDOW_MS
    && Boolean(top.uiPatches) === Boolean(entry.uiPatches)) {
    return [...stack.slice(0, -1), {
      ...top,
      patches: [...top.patches, ...entry.patches],
      inversePatches: [...entry.inversePatches, ...top.inversePatches],
      ...(entry.uiPatches ? {
        uiPatches: [...(top.uiPatches ?? []), ...entry.uiPatches],
        uiInversePatches: [...(entry.uiInversePatches ?? []), ...(top.uiInversePatches ?? [])],
      } : {}),
      ts: entry.ts,
    }];
  }
  const next = [...stack, entry];
  return next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next;
}

export const useProjectStore = create<ProjectStoreState>()((set, get) => ({
  project: initialProject,
  uiProject: useBuildTargetStore.getState().uiProject,
  revision: 0,
  dirty: false,
  lastPatches: [],
  lastChangeKind: 'load',
  undoStack: [],
  redoStack: [],

  mutateDisplay(label, recipe, opts = {}) {
    const s = get();
    const [next, patches, inversePatches] = produceWithPatches(s.project, (draft) => {
      recipe(draft.display);
    });
    if (patches.length === 0) return;

    let undoStack = s.undoStack;
    if (interaction) {
      // 交互进行中:全部累积进会话(transient 与否都算这次交互)
      interaction.patches.push(...patches);
      interaction.inversePatches.unshift(...inversePatches);
    } else if (!opts.transient) {
      const now = Date.now();
      undoStack = recordHistory(undoStack, {
        label, patches, inversePatches, coalesceKey: opts.coalesceKey, ts: now,
      });
    }
    useBuildTargetStore.getState().syncProject(next);
    set({
      project: next,
      uiProject: useBuildTargetStore.getState().uiProject,
      revision: s.revision + 1,
      dirty: true,
      lastPatches: patches,
      lastChangeKind: 'mutate',
      undoStack,
      redoStack: opts.transient && interaction ? s.redoStack : [],
    });
  },

  mutateV2(label, recipe, opts = {}) {
    const s = get();
    const [nextUi, uiPatches, uiInversePatches] = produceWithPatches(s.uiProject, recipe);
    if (uiPatches.length === 0) return;
    const projected = projectFromUi(nextUi);
    const [, patches, inversePatches] = produceWithPatches(s.project, (draft) => {
      Object.assign(draft, projected);
    });
    let undoStack = s.undoStack;
    if (interaction) {
      interaction.patches.push(...patches);
      interaction.inversePatches.unshift(...inversePatches);
      interaction.uiPatches.push(...uiPatches);
      interaction.uiInversePatches.unshift(...uiInversePatches);
    } else if (!opts.transient) {
      undoStack = recordHistory(undoStack, {
        label,
        patches,
        inversePatches,
        uiPatches,
        uiInversePatches,
        coalesceKey: opts.coalesceKey,
        ts: Date.now(),
      });
    }
    useBuildTargetStore.getState().replaceUiProject(projected, nextUi);
    set({
      project: projected,
      uiProject: nextUi,
      revision: s.revision + 1,
      dirty: true,
      lastPatches: patches,
      lastChangeKind: 'mutate',
      undoStack,
      redoStack: opts.transient && interaction ? s.redoStack : [],
    });
  },

  mutateActionRegistry(label, recipe) {
    if (interaction) get().commitInteraction();
    const s = get();
    const current = useBuildTargetStore.getState().actionRegistry;
    const [next, patches] = produceWithPatches(current, recipe);
    if (patches.length === 0) return;
    useBuildTargetStore.getState().replaceActionRegistry(next);
    const entry: HistoryEntry = {
      label,
      patches: [],
      inversePatches: [],
      actionRegistryBefore: current,
      actionRegistryAfter: next,
      ts: Date.now(),
    };
    set({
      revision: s.revision + 1,
      dirty: true,
      lastPatches: [],
      lastChangeKind: 'mutate',
      undoStack: recordHistory(s.undoStack, entry),
      redoStack: [],
    });
  },

  beginInteraction(label, coalesceKey) {
    if (interaction) get().commitInteraction();
    interaction = {
      label, coalesceKey, patches: [], inversePatches: [], uiPatches: [], uiInversePatches: [],
    };
  },

  commitInteraction() {
    if (!interaction) return;
    const it = interaction;
    interaction = null;
    if (it.patches.length === 0) return;
    const s = get();
    let undoStack = [...s.undoStack, {
      label: it.label,
      patches: it.patches,
      inversePatches: it.inversePatches,
      ...(it.uiPatches.length > 0 ? {
        uiPatches: it.uiPatches,
        uiInversePatches: it.uiInversePatches,
      } : {}),
      coalesceKey: it.coalesceKey,
      ts: Date.now(),
    }];
    if (undoStack.length > HISTORY_LIMIT) undoStack = undoStack.slice(-HISTORY_LIMIT);
    set({ undoStack, redoStack: [] });
  },

  abortInteraction() {
    if (!interaction) return;
    const it = interaction;
    interaction = null;
    if (it.inversePatches.length === 0) return;
    const s = get();
    const uiProject = it.uiInversePatches.length > 0
      ? applyPatches(s.uiProject, it.uiInversePatches)
      : s.uiProject;
    const project = it.uiInversePatches.length > 0
      ? projectFromUi(uiProject)
      : applyPatches(s.project, it.inversePatches);
    if (it.uiInversePatches.length > 0) {
      useBuildTargetStore.getState().replaceUiProject(project, uiProject);
    } else {
      useBuildTargetStore.getState().syncProject(project);
    }
    set({
      project,
      uiProject: it.uiInversePatches.length > 0
        ? uiProject
        : useBuildTargetStore.getState().uiProject,
      revision: s.revision + 1,
      lastPatches: it.inversePatches,
      lastChangeKind: 'mutate',
    });
  },

  undo() {
    if (interaction) get().commitInteraction();
    const s = get();
    const entry = s.undoStack[s.undoStack.length - 1];
    if (!entry) return;
    if (entry.actionRegistryBefore) {
      useBuildTargetStore.getState().replaceActionRegistry(entry.actionRegistryBefore);
      set({
        revision: s.revision + 1,
        dirty: true,
        lastPatches: [],
        lastChangeKind: 'undo',
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, entry],
      });
      return;
    }
    const uiProject = entry.uiInversePatches
      ? applyPatches(s.uiProject, entry.uiInversePatches)
      : s.uiProject;
    const project = entry.uiInversePatches
      ? projectFromUi(uiProject)
      : applyPatches(s.project, entry.inversePatches);
    if (entry.uiInversePatches) {
      useBuildTargetStore.getState().replaceUiProject(project, uiProject);
    } else {
      useBuildTargetStore.getState().syncProject(project);
    }
    set({
      project,
      uiProject: entry.uiInversePatches ? uiProject : useBuildTargetStore.getState().uiProject,
      revision: s.revision + 1,
      dirty: true,
      lastPatches: entry.inversePatches,
      lastChangeKind: 'undo',
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, entry],
    });
  },

  redo() {
    const s = get();
    const entry = s.redoStack[s.redoStack.length - 1];
    if (!entry) return;
    if (entry.actionRegistryAfter) {
      useBuildTargetStore.getState().replaceActionRegistry(entry.actionRegistryAfter);
      set({
        revision: s.revision + 1,
        dirty: true,
        lastPatches: [],
        lastChangeKind: 'redo',
        undoStack: [...s.undoStack, entry],
        redoStack: s.redoStack.slice(0, -1),
      });
      return;
    }
    const uiProject = entry.uiPatches ? applyPatches(s.uiProject, entry.uiPatches) : s.uiProject;
    const project = entry.uiPatches ? projectFromUi(uiProject) : applyPatches(s.project, entry.patches);
    if (entry.uiPatches) {
      useBuildTargetStore.getState().replaceUiProject(project, uiProject);
    } else {
      useBuildTargetStore.getState().syncProject(project);
    }
    set({
      project,
      uiProject: entry.uiPatches ? uiProject : useBuildTargetStore.getState().uiProject,
      revision: s.revision + 1,
      dirty: true,
      lastPatches: entry.patches,
      lastChangeKind: 'redo',
      undoStack: [...s.undoStack, entry],
      redoStack: s.redoStack.slice(0, -1),
    });
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  loadProject(p) {
    interaction = null;
    if (useBuildTargetStore.getState().sourceProject !== p) {
      useBuildTargetStore.getState().syncProject(p);
    }
    set({
      project: p,
      uiProject: useBuildTargetStore.getState().uiProject,
      revision: get().revision + 1,
      dirty: false,
      lastPatches: [],
      lastChangeKind: 'load',
      undoStack: [],
      redoStack: [],
    });
  },

  markSaved() {
    set({ dirty: false });
  },
}));

/* ---------------- 树查找工具(管线/面板共用) ---------------- */

import type { ScreenDef, WidgetNode } from '@lvd/schema';
import type { ScreenDefV2, WidgetNodeV2 } from '@lvd/schema/v2';

export function findNodeById(
  project: LvProject,
  nodeId: string,
): { screen: ScreenDef; node: WidgetNode; parent: WidgetNode | null } | null {
  for (const screen of project.screens) {
    const hit = findIn(screen.root, null, nodeId);
    if (hit) return { screen, node: hit.node, parent: hit.parent };
  }
  return null;
}

function findIn(
  node: WidgetNode,
  parent: WidgetNode | null,
  id: string,
): { node: WidgetNode; parent: WidgetNode | null } | null {
  if (node.id === id) return { node, parent };
  for (const c of node.children) {
    const hit = findIn(c, node, id);
    if (hit) return hit;
  }
  return null;
}

/** screen 内全部已占用 name(自动命名用) */
export function namesInScreen(screen: ScreenDef): Set<string> {
  const s = new Set<string>();
  const walk = (n: WidgetNode): void => {
    if (n.name) s.add(n.name);
    n.children.forEach(walk);
  };
  walk(screen.root);
  s.add(screen.name);
  return s;
}

export function findNodeByIdV2(
  project: UiProject,
  nodeId: string,
): { screen: ScreenDefV2; node: WidgetNodeV2; parent: WidgetNodeV2 | null } | null {
  const find = (
    node: WidgetNodeV2,
    parent: WidgetNodeV2 | null,
  ): { node: WidgetNodeV2; parent: WidgetNodeV2 | null } | null => {
    if (node.id === nodeId) return { node, parent };
    for (const child of node.children) {
      const hit = find(child, node);
      if (hit) return hit;
    }
    return null;
  };
  for (const screen of project.screens) {
    const hit = find(screen.root, null);
    if (hit) return { screen, node: hit.node, parent: hit.parent };
  }
  return null;
}

export function namesInScreenV2(screen: ScreenDefV2): Set<string> {
  const names = new Set<string>();
  const walk = (node: WidgetNodeV2): void => {
    if (node.codeName) names.add(node.codeName);
    node.children.forEach(walk);
  };
  walk(screen.root);
  names.add(screen.codeName);
  return names;
}
