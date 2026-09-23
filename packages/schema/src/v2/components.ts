import { CNAME_MAX_LEN } from '../ids.js';
import type { ComponentDefV2, UiProject, WidgetNodeV2 } from './uiProject.js';

/** Persisted marker for a linked reusable-component instance. */
export const COMPONENT_TYPE_PREFIX = 'component:';

export function componentType(componentId: string): string {
  return `${COMPONENT_TYPE_PREFIX}${componentId}`;
}

export function componentIdFromType(type: string): string | null {
  if (!type.startsWith(COMPONENT_TYPE_PREFIX)) return null;
  const id = type.slice(COMPONENT_TYPE_PREFIX.length);
  return id === '' ? null : id;
}

export function componentForNode(
  project: Pick<UiProject, 'components'>,
  node: Pick<WidgetNodeV2, 'type'>,
): ComponentDefV2 | undefined {
  const id = componentIdFromType(node.type);
  return id === null ? undefined : project.components.find((component) => component.id === id);
}

export interface ExpandedComponentTree {
  root: WidgetNodeV2;
  componentIds: Set<string>;
  issues: string[];
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0').slice(-7);
}

function scopedCodeName(instance: WidgetNodeV2, source: WidgetNodeV2): string | undefined {
  if (source.codeName === undefined) return undefined;
  const prefix = instance.codeName ?? `cmp_${shortHash(instance.id)}`;
  const suffix = `_${shortHash(`${instance.id}:${source.id}`)}`;
  const room = Math.max(1, CNAME_MAX_LEN - suffix.length);
  return `${`${prefix}_${source.codeName}`.slice(0, room)}${suffix}`;
}

function namespaceDefinitionNode(
  source: WidgetNodeV2,
  instance: WidgetNodeV2,
  isRoot: boolean,
): WidgetNodeV2 {
  const copy = structuredClone(source);
  copy.id = isRoot ? instance.id : `${instance.id}::${source.id}`;
  if (isRoot) {
    if (instance.codeName === undefined) delete copy.codeName;
    else copy.codeName = instance.codeName;
  } else {
    const codeName = scopedCodeName(instance, source);
    if (codeName === undefined) delete copy.codeName;
    else copy.codeName = codeName;
  }
  copy.children = source.children.map((child) => namespaceDefinitionNode(child, instance, false));
  return copy;
}

function applyComponentParams(
  root: WidgetNodeV2,
  component: ComponentDefV2,
  instance: WidgetNodeV2,
): Set<string> {
  const apiNames = new Set(component.api.map((prop) => prop.name));
  const values = new Map<string, unknown>();
  for (const prop of component.api) {
    const value = instance.props[prop.name] ?? prop.default;
    if (value !== undefined) values.set(prop.name, structuredClone(value));
  }
  const replace = (value: unknown): unknown => {
    if (typeof value === 'string' && value.startsWith('$')) {
      const parameter = values.get(value.slice(1));
      return parameter === undefined ? value : structuredClone(parameter);
    }
    if (Array.isArray(value)) return value.map(replace);
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
  };
  const walk = (node: WidgetNodeV2): void => {
    node.props = replace(node.props) as WidgetNodeV2['props'];
    node.styles = node.styles.map((style) => ({
      ...style, props: replace(style.props) as typeof style.props,
    }));
    node.events = node.events.map((event) => ({
      ...event,
      ...(event.args === undefined ? {} : { args: replace(event.args) as NonNullable<typeof event.args> }),
    }));
    node.children.forEach(walk);
  };
  walk(root);
  return apiNames;
}

/**
 * Lower linked component instances to ordinary WidgetNodeV2 trees.
 *
 * The persisted document keeps the link. Preview and device code generation consume this
 * deterministic projection, so editing a definition updates every instance without teaching
 * every downstream emitter about components.
 */
export function expandComponentTree(
  root: WidgetNodeV2,
  components: readonly ComponentDefV2[],
): ExpandedComponentTree {
  const byId = new Map(components.map((component) => [component.id, component]));
  const componentIds = new Set<string>();
  const issues: string[] = [];

  const expand = (node: WidgetNodeV2, stack: readonly string[]): WidgetNodeV2 => {
    const componentId = componentIdFromType(node.type);
    if (componentId === null) {
      return { ...structuredClone(node), children: node.children.map((child) => expand(child, stack)) };
    }

    componentIds.add(componentId);
    const component = byId.get(componentId);
    if (component === undefined) {
      issues.push(`组件实例 ${node.id} 引用了不存在的定义 "${componentId}"`);
      return structuredClone(node);
    }
    if (stack.includes(componentId)) {
      issues.push(`组件定义形成循环:${[...stack, componentId].join(' -> ')}`);
      return structuredClone(node);
    }

    const base = namespaceDefinitionNode(component.root, node, true);
    const apiNames = applyComponentParams(base, component, node);
    const instanceOverrides = Object.fromEntries(
      Object.entries(node.props).filter(([key]) => !apiNames.has(key)),
    );
    const merged: WidgetNodeV2 = {
      ...base,
      id: node.id,
      ...(node.codeName === undefined ? {} : { codeName: node.codeName }),
      ...(node.displayName === undefined ? {} : { displayName: node.displayName }),
      props: { ...base.props, ...structuredClone(instanceOverrides) },
      flags: { ...(base.flags ?? {}), ...(node.flags ?? {}) },
      states: { ...(base.states ?? {}), ...(node.states ?? {}) },
      styleRefs: [...base.styleRefs, ...structuredClone(node.styleRefs)],
      styles: [...base.styles, ...structuredClone(node.styles)],
      events: [...base.events, ...structuredClone(node.events)],
      bindings: [...base.bindings, ...structuredClone(node.bindings)],
      ...(node.editor === undefined ? {} : { editor: structuredClone(node.editor) }),
    };
    return {
      ...merged,
      children: merged.children.map((child) => expand(child, [...stack, componentId])),
    };
  };

  return { root: expand(root, []), componentIds, issues };
}
