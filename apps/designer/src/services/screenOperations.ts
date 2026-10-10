import type { UiProject, WidgetNodeV2 } from '@lvd/schema/v2';

function removeInboundEvents(node: WidgetNodeV2, screenId: string): number {
  const before = node.events.length;
  node.events = node.events.filter((event) => event.args?.screen !== screenId);
  return before - node.events.length
    + node.children.reduce((count, child) => count + removeInboundEvents(child, screenId), 0);
}

/** Delete a screen and every action event that would otherwise point at it. */
export function removeScreenAndReferences(project: UiProject, screenId: string): number {
  if (project.screens.length <= 1 || !project.screens.some((screen) => screen.id === screenId)) {
    return 0;
  }

  let removedReferences = 0;
  for (const screen of project.screens) {
    if (screen.id !== screenId) removedReferences += removeInboundEvents(screen.root, screenId);
  }
  for (const component of project.components) {
    removedReferences += removeInboundEvents(component.root, screenId);
  }
  project.screens = project.screens.filter((screen) => screen.id !== screenId);
  if (!project.screens.some((screen) => screen.isHome) && project.screens[0]) {
    project.screens[0].isHome = true;
  }
  return removedReferences;
}
