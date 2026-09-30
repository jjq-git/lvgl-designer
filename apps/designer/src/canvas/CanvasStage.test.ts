import { describe, expect, it } from 'vitest';
import { createEmptyProject, createNode } from '@lvd/schema';
import { constrainCanvasPan, selectedIdFromPointerTarget, topLevelMovableIds } from './CanvasStage';

describe('constrainCanvasPan', () => {
  it('keeps at least 64px of a large screen visible on every edge', () => {
    const viewport = { width: 1000, height: 800 };
    const display = { width: 1440, height: 720 };

    expect(constrainCanvasPan({ x: -9999, y: -9999 }, viewport, display, 1))
      .toEqual({ x: -1376, y: -656 });
    expect(constrainCanvasPan({ x: 9999, y: 9999 }, viewport, display, 1))
      .toEqual({ x: 936, y: 736 });
  });

  it('keeps a canvas smaller than the visibility margin fully inside the viewport', () => {
    expect(constrainCanvasPan(
      { x: -200, y: 900 },
      { width: 1000, height: 800 },
      { width: 240, height: 240 },
      0.25,
    )).toEqual({ x: 0, y: 740 });
  });
});

describe('topLevelMovableIds', () => {
  it('removes selected descendants and screen roots from a move set', () => {
    const project = createEmptyProject('move-selection');
    const root = project.screens[0]!.root;
    const parent = createNode('obj');
    const child = createNode('button');
    const sibling = createNode('label');
    parent.children.push(child);
    root.children.push(parent, sibling);

    expect(topLevelMovableIds(project, [root.id, parent.id, child.id, sibling.id]))
      .toEqual([parent.id, sibling.id]);
    expect(topLevelMovableIds(project, [child.id, sibling.id]))
      .toEqual([child.id, sibling.id]);
  });
});

describe('selectedIdFromPointerTarget', () => {
  it('recovers the selected node id from an overflow selection outline', () => {
    const target = {
      getAttribute: (name: string) => name === 'data-selected-id' ? 'offscreen-widget' : null,
    };

    expect(selectedIdFromPointerTarget(target as unknown as EventTarget)).toBe('offscreen-widget');
    expect(selectedIdFromPointerTarget(null)).toBeNull();
    expect(selectedIdFromPointerTarget({} as EventTarget)).toBeNull();
  });
});
