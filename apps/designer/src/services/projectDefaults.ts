import { createEmptyProject, createNode, type LvProject } from '@lvd/schema';
import type { WidgetNodeV2 } from '@lvd/schema/v2';

export const DEFAULT_SCREEN_BACKGROUND = {
  bg_color: '#ffffff',
  bg_opa: 255,
} as const;

/** Creates a user-facing blank project without changing schema-level migration defaults. */
export function createDesignerProject(name?: string): LvProject {
  const project = createEmptyProject(name);
  const root = project.screens[0]?.root;
  if (root) {
    root.inlineStyles.push({ props: { ...DEFAULT_SCREEN_BACKGROUND } });
  }
  return project;
}

/** Creates a new screen root with an explicit, exported background. */
export function createDesignerScreenRoot(): WidgetNodeV2 {
  const legacyRoot = createNode('obj');
  const props = { ...legacyRoot.props };
  delete props.width;
  delete props.height;
  return {
    id: legacyRoot.id,
    type: legacyRoot.type,
    props,
    styleRefs: [],
    styles: [{ props: { ...DEFAULT_SCREEN_BACKGROUND } }],
    events: [],
    bindings: [],
    children: [],
  };
}
