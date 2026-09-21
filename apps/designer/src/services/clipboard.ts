/**
 * 复制 / 粘贴 / 复刻 —— 内存剪贴板 + 子树 id/name 重生成。
 *
 * 约束:
 * - 不碰 canvas/ 下四个文件;一切经 store 间接实现(editorStore.selectedIds /
 *   projectStore.mutate),mutate 后热重载管线自动跟。
 * - 所有 id 重生成(newUuid),codeName 走 autoName 去重(递归整棵子树)。
 * - 一次操作一条 undo;粘贴后选中新控件。
 */
import { autoName, newUuid } from '@lvd/schema';
import type { ScreenDefV2, WidgetNodeV2 } from '@lvd/schema/v2';
import { findNodeByIdV2, namesInScreenV2, useProjectStore } from '../stores/projectStore';
import {
  getClipboard,
  setClipboard,
  useEditorStore,
} from '../stores/editorStore';

/** 该 screen 内(草稿态)找容器节点;找不到回落屏根 */
function findInScreen(root: WidgetNodeV2, id: string): WidgetNodeV2 | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = findInScreen(c, id);
    if (hit) return hit;
  }
  return null;
}

/**
 * 深拷贝一棵子树并递归重生成 id;name 用 usedNames 去重(就地累积,
 * 保证同一次粘贴的多个节点/兄弟之间也不撞名)。原节点无 name 的保持匿名。
 */
function cloneWithFreshIds(node: WidgetNodeV2, usedNames: Set<string>): WidgetNodeV2 {
  const copy: WidgetNodeV2 = structuredClone(node);
  copy.id = newUuid();
  if (node.codeName != null) {
    // 用原 name 的类型段做基,交给 autoName 取最小可用序号
    const fresh = autoName(node.type, usedNames);
    copy.codeName = fresh;
    usedNames.add(fresh);
  } else {
    delete copy.codeName;
  }
  copy.children = node.children.map((c) => cloneWithFreshIds(c, usedNames));
  return copy;
}

/** 选中集里剔除「其祖先也被选中」的节点(避免父+子都复制造成重复) */
function topLevelSelection(screen: ScreenDefV2, ids: string[]): WidgetNodeV2[] {
  const idSet = new Set(ids);
  const out: WidgetNodeV2[] = [];
  const walk = (node: WidgetNodeV2, hasSelectedAncestor: boolean): void => {
    const selected = idSet.has(node.id);
    // 屏根不可复制
    if (selected && !hasSelectedAncestor && node.id !== screen.root.id) out.push(node);
    for (const c of node.children) walk(c, hasSelectedAncestor || selected);
  };
  walk(screen.root, false);
  return out;
}

function activeScreen(): ScreenDefV2 | null {
  const project = useProjectStore.getState().uiProject;
  const activeId = useEditorStore.getState().activeScreenId;
  return project.screens.find((s) => s.id === activeId) ?? project.screens[0] ?? null;
}

/** Ctrl+C:把选中控件子树深拷贝进内存剪贴板 */
export function copySelection(): void {
  const screen = activeScreen();
  if (!screen) return;
  const ids = useEditorStore.getState().selectedIds;
  if (ids.length === 0) return;
  const nodes = topLevelSelection(screen, ids);
  if (nodes.length === 0) return;
  setClipboard(nodes);
}

/**
 * 把一组子树粘贴进指定 screen 的目标容器。
 * @param sources 待粘贴的子树(会被深拷贝 + 重生成 id/name,不改动入参)
 * @param offset  就地复刻时传 0,普通粘贴 +10 避免完全重叠
 * @param label   undo 标签
 */
function pasteInto(sources: WidgetNodeV2[], offset: number, label: string): void {
  if (sources.length === 0) return;
  const screen = activeScreen();
  if (!screen) return;

  // 目标容器:恰好选中 1 个 → 粘到它的【父容器】(产生同级副本,符合设计器直觉;
  // 避免"复制粘贴自己却把副本塞进自己内部"导致画布上看不到)。选中屏根/无选中 → 粘到屏根。
  const sel = useEditorStore.getState().selectedIds;
  let targetId = screen.root.id;
  if (sel.length === 1) {
    const hit = findNodeByIdV2(useProjectStore.getState().uiProject, sel[0]!);
    if (hit && hit.screen.id === screen.id && hit.parent) targetId = hit.parent.id;
  }

  // name 去重基线 = 该屏现有全部 name(粘贴过程就地累积)
  const usedNames = namesInScreenV2(screen);
  const clones = sources.map((n) => cloneWithFreshIds(n, usedNames));

  // 位置偏移:仅对带数值 x/y 的顶层克隆生效(content/百分比/绝对布局之外的不动)
  if (offset !== 0) {
    for (const c of clones) {
      if (typeof c.props['x'] === 'number') c.props['x'] = (c.props['x'] as number) + offset;
      if (typeof c.props['y'] === 'number') c.props['y'] = (c.props['y'] as number) + offset;
    }
  }

  useProjectStore.getState().mutateV2(label, (draft) => {
    const dScreen = draft.screens.find((s) => s.id === screen.id) ?? draft.screens[0];
    if (!dScreen) return;
    const container = findInScreen(dScreen.root, targetId) ?? dScreen.root;
    container.children.push(...clones);
  });

  useEditorStore.getState().select(clones.map((c) => c.id));
}

/** Ctrl+V:把剪贴板粘到当前屏(或选中容器内),偏移 +10 */
export function pasteClipboard(): void {
  const sources = getClipboard();
  if (sources.length === 0) return;
  pasteInto(sources, 10, sources.length > 1 ? `粘贴 ${sources.length} 个对象` : '粘贴');
}

/** Ctrl+D:就地复刻选中控件(复制 + 立即粘贴,不经剪贴板,偏移 +10) */
export function duplicateSelection(): void {
  const screen = activeScreen();
  if (!screen) return;
  const ids = useEditorStore.getState().selectedIds;
  if (ids.length === 0) return;
  const nodes = topLevelSelection(screen, ids);
  if (nodes.length === 0) return;
  pasteInto(nodes, 10, nodes.length > 1 ? `复刻 ${nodes.length} 个对象` : '复刻');
}
