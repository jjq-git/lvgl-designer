import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { createEmptyProject } from '@lvd/schema';
import { migrateV1ToV2, type UiProject, type WidgetNodeV2 } from '@lvd/schema/v2';
import { applyAiOps } from '../applyOps.js';

function project(): UiProject {
  return migrateV1ToV2(createEmptyProject('structured-children')).uiProject;
}

function tileview(children: WidgetNodeV2[]): WidgetNodeV2 {
  return {
    id: 'tileview-1',
    type: 'tileview',
    codeName: 'pages',
    props: {},
    styleRefs: [],
    styles: [],
    events: [],
    bindings: [],
    children,
  };
}

describe('applyAiOps structured children', () => {
  it('routes additions targeting tileview into its tile container', () => {
    const current = project();
    current.screens[0]!.root.children.push(tileview([{
      id: 'tile-1',
      type: 'tileview-tile',
      props: { col: 0, row: 0, dir: 'all' },
      styleRefs: [],
      styles: [],
      events: [],
      bindings: [],
      children: [],
    }]));

    const result = applyAiOps(current, [
      { op: 'add', parent: 'pages', node: { type: 'label', name: 'inside', props: { text: 'ok' } } },
    ], current.screens[0]!.id);
    const next = produce(current, result.recipe!);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'child-routed-to-structural-container',
    }));
    const pages = next.screens[0]!.root.children[0]!;
    expect(pages.children).toHaveLength(1);
    expect(pages.children[0]!.type).toBe('tileview-tile');
    expect(pages.children[0]!.children[0]!.codeName).toBe('inside');
  });

  it('creates a default tile when adding to an empty tileview', () => {
    const current = project();
    current.screens[0]!.root.children.push(tileview([]));

    const result = applyAiOps(current, [
      { op: 'add', parent: 'pages', node: { type: 'label', name: 'inside' } },
    ], current.screens[0]!.id);

    const next = produce(current, result.recipe!);
    const pages = next.screens[0]!.root.children[0]!;

    expect(result.errors).toEqual([]);
    expect(pages.children[0]).toMatchObject({
      type: 'tileview-tile',
      props: { col: 0, row: 0, dir: 'all' },
    });
    expect(pages.children[0]!.children[0]!.codeName).toBe('inside');
  });

  it('rejects additions targeting a non-container widget', () => {
    const current = project();
    current.screens[0]!.root.children.push({
      id: 'slider-1', type: 'slider', codeName: 'action', props: {},
      styleRefs: [], styles: [], events: [], bindings: [], children: [],
    });

    const result = applyAiOps(current, [
      { op: 'add', parent: 'action', node: { type: 'label', name: 'inside' } },
    ], current.screens[0]!.id);

    expect(result.recipe).toBeUndefined();
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'children-not-accepted' }));
  });
});
