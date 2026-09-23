import { autoName, newUuid, type CName, type ConstDef } from '@lvd/schema';
import {
  componentIdFromType,
  componentType,
  expandComponentTree,
  type ComponentDefV2,
  type NamedStyleV2,
  type UiProject,
  type WidgetNodeV2,
} from '@lvd/schema/v2';
import { findNodeByIdV2, useProjectStore } from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';

function cloneDefinitionNode(node: WidgetNodeV2): WidgetNodeV2 {
  const copy = structuredClone(node);
  copy.id = newUuid();
  copy.children = node.children.map(cloneDefinitionNode);
  return copy;
}

function visit(node: WidgetNodeV2, fn: (item: WidgetNodeV2) => void): void {
  fn(node);
  node.children.forEach((child) => visit(child, fn));
}

function uniqueCodeName(base: string, used: Set<string>): CName {
  const safe = base.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]/, '_').slice(0, 55) || 'component';
  if (!used.has(safe)) return safe;
  let index = 2;
  while (used.has(`${safe}_${index}`)) index += 1;
  return `${safe}_${index}`;
}

function cloneReferencedScreenStyles(
  root: WidgetNodeV2,
  screenStyles: readonly NamedStyleV2[],
  componentCodeName: string,
  project: UiProject,
): NamedStyleV2[] {
  const referenced = new Set<string>();
  visit(root, (node) => {
    node.styleRefs.forEach((usage) => referenced.add(usage.styleId));
    node.bindings.forEach((binding) => {
      if (binding.kind === 'style') referenced.add(binding.styleId);
    });
  });
  const source = screenStyles.filter((style) => referenced.has(style.id));
  if (source.length === 0) return [];

  const usedNames = new Set([
    ...project.styles.map((style) => style.codeName).filter((name): name is string => name !== undefined),
    ...project.screens.flatMap((screen) => screen.styles.map((style) => style.codeName))
      .filter((name): name is string => name !== undefined),
    ...project.components.flatMap((component) => component.styles.map((style) => style.codeName))
      .filter((name): name is string => name !== undefined),
  ]);
  const idMap = new Map<string, string>();
  const copies = source.map((style) => {
    const id = newUuid();
    idMap.set(style.id, id);
    const codeName = style.codeName === undefined
      ? undefined
      : uniqueCodeName(`${componentCodeName}_${style.codeName}`, usedNames);
    if (codeName !== undefined) usedNames.add(codeName);
    return { ...structuredClone(style), id, ...(codeName === undefined ? {} : { codeName }) };
  });
  visit(root, (node) => {
    node.styleRefs = node.styleRefs.map((usage) => ({
      ...usage, styleId: idMap.get(usage.styleId) ?? usage.styleId,
    }));
    node.bindings = node.bindings.map((binding) => binding.kind === 'style'
      ? { ...binding, styleId: idMap.get(binding.styleId) ?? binding.styleId }
      : binding);
  });
  return copies;
}

function cloneReferencedScreenConsts(
  root: WidgetNodeV2,
  sourceConsts: readonly ConstDef[],
  componentCodeName: string,
  project: UiProject,
): ConstDef[] {
  const referenced = new Set<string>();
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (typeof value !== 'object' || value === null) return;
    if ('$const' in value && typeof (value as { $const?: unknown }).$const === 'string') {
      referenced.add((value as { $const: string }).$const);
      return;
    }
    Object.values(value).forEach(collect);
  };
  visit(root, (node) => {
    collect(node.props);
    node.styles.forEach((style) => collect(style.props));
  });
  const sources = sourceConsts.filter((item) => referenced.has(item.name));
  if (sources.length === 0) return [];

  const used = new Set([
    ...project.consts.map((item) => item.name),
    ...project.screens.flatMap((screen) => screen.consts.map((item) => item.name)),
    ...project.components.flatMap((component) => component.consts.map((item) => item.name)),
  ]);
  const nameMap = new Map<string, CName>();
  const copies = sources.map((item) => {
    const name = uniqueCodeName(`${componentCodeName}_${item.name}`, used);
    used.add(name);
    nameMap.set(item.name, name);
    return { ...structuredClone(item), name };
  });
  const replace = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(replace); return; }
    if (typeof value !== 'object' || value === null) return;
    if ('$const' in value && typeof (value as { $const?: unknown }).$const === 'string') {
      const ref = value as { $const: string };
      ref.$const = nameMap.get(ref.$const) ?? ref.$const;
      return;
    }
    Object.values(value).forEach(replace);
  };
  visit(root, (node) => {
    replace(node.props);
    node.styles.forEach((style) => replace(style.props));
  });
  return copies;
}

/** Turn one screen subtree into a linked reusable component, in one undoable transaction. */
export function createComponentFromNode(nodeId: string, displayName: string): string | null {
  const state = useProjectStore.getState();
  const hit = findNodeByIdV2(state.uiProject, nodeId);
  if (!hit?.parent || componentIdFromType(hit.node.type) !== null) return null;

  const usedComponentNames = new Set(state.uiProject.components.map((component) => component.codeName));
  const codeName = autoName('component', usedComponentNames);
  const componentId = newUuid();
  const definitionRoot = cloneDefinitionNode(hit.node);
  definitionRoot.props = { ...definitionRoot.props, x: 0, y: 0 };
  const componentStyles = cloneReferencedScreenStyles(
    definitionRoot, hit.screen.styles, codeName, state.uiProject,
  );
  const componentConsts = cloneReferencedScreenConsts(
    definitionRoot, hit.screen.consts, codeName, state.uiProject,
  );
  const positionProps = Object.fromEntries(
    ['x', 'y', 'align'].flatMap((key) => hit.node.props[key] === undefined ? [] : [[key, hit.node.props[key]]]),
  );
  const instance: WidgetNodeV2 = {
    id: hit.node.id,
    type: componentType(componentId),
    ...(hit.node.codeName === undefined ? {} : { codeName: hit.node.codeName }),
    ...(hit.node.displayName === undefined ? {} : { displayName: hit.node.displayName }),
    props: positionProps,
    styleRefs: [], styles: [], events: [], bindings: [], children: [],
    ...(hit.node.editor === undefined ? {} : { editor: structuredClone(hit.node.editor) }),
  };
  const component: ComponentDefV2 = {
    id: componentId,
    codeName,
    displayName: displayName.trim() || codeName,
    api: [], styles: componentStyles, consts: componentConsts, root: definitionRoot,
  };

  state.mutateV2(`创建组件 ${component.displayName}`, (draft) => {
    const current = findNodeByIdV2(draft, nodeId);
    if (!current?.parent) return;
    const index = current.parent.children.findIndex((child) => child.id === nodeId);
    if (index < 0) return;
    draft.components.push(component);
    current.parent.children[index] = instance;
  });
  useEditorStore.getState().select([instance.id]);
  return componentId;
}

/** Replace a linked instance with an independent ordinary widget subtree. */
export function detachComponentInstance(nodeId: string): boolean {
  const state = useProjectStore.getState();
  const hit = findNodeByIdV2(state.uiProject, nodeId);
  if (!hit?.parent || componentIdFromType(hit.node.type) === null) return false;
  const expanded = expandComponentTree(hit.node, state.uiProject.components);
  if (expanded.issues.length > 0) return false;
  state.mutateV2('解除组件关联', (draft) => {
    const current = findNodeByIdV2(draft, nodeId);
    if (!current?.parent) return;
    const index = current.parent.children.findIndex((child) => child.id === nodeId);
    if (index >= 0) current.parent.children[index] = expanded.root;
  });
  return true;
}

/** Replace a definition from the selected subtree; all linked instances refresh immediately. */
export function updateComponentFromNode(componentId: string, nodeId: string): boolean {
  const state = useProjectStore.getState();
  const component = state.uiProject.components.find((item) => item.id === componentId);
  const hit = findNodeByIdV2(state.uiProject, nodeId);
  if (!component || !hit || hit.node === hit.screen.root) return false;

  const expanded = expandComponentTree(hit.node, state.uiProject.components);
  if (expanded.issues.length > 0) return false;
  const definitionRoot = cloneDefinitionNode(expanded.root);
  definitionRoot.props = { ...definitionRoot.props, x: 0, y: 0 };
  const styles = cloneReferencedScreenStyles(
    definitionRoot,
    [...hit.screen.styles, ...component.styles],
    component.codeName,
    state.uiProject,
  );
  const consts = cloneReferencedScreenConsts(
    definitionRoot,
    [...hit.screen.consts, ...component.consts],
    component.codeName,
    state.uiProject,
  );
  state.mutateV2(`更新组件 ${component.displayName ?? component.codeName}`, (draft) => {
    const target = draft.components.find((item) => item.id === componentId);
    if (!target) return;
    target.root = definitionRoot;
    target.styles = styles;
    target.consts = consts;
  });
  return true;
}

export function renameComponent(componentId: string, displayName: string): boolean {
  const name = displayName.trim();
  if (name === '') return false;
  const state = useProjectStore.getState();
  const component = state.uiProject.components.find((item) => item.id === componentId);
  if (!component || component.displayName === name) return false;
  state.mutateV2('重命名可复用组件', (draft) => {
    const target = draft.components.find((item) => item.id === componentId);
    if (target) target.displayName = name;
  });
  return true;
}

export function componentUseCount(project: UiProject, componentId: string): number {
  let count = 0;
  const scan = (root: WidgetNodeV2): void => visit(root, (node) => {
    if (componentIdFromType(node.type) === componentId) count += 1;
  });
  project.screens.forEach((screen) => scan(screen.root));
  project.components.forEach((component) => scan(component.root));
  return count;
}

export function deleteUnusedComponent(componentId: string): boolean {
  const state = useProjectStore.getState();
  if (componentUseCount(state.uiProject, componentId) > 0) return false;
  const component = state.uiProject.components.find((item) => item.id === componentId);
  if (!component) return false;
  state.mutateV2(`删除组件 ${component.displayName ?? component.codeName}`, (draft) => {
    draft.components = draft.components.filter((item) => item.id !== componentId);
  });
  return true;
}
