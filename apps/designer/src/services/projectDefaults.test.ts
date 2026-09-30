import { describe, expect, it } from 'vitest';
import { createDesignerProject, createDesignerScreenRoot } from './projectDefaults';

describe('designer project defaults', () => {
  it('gives a newly created project an explicit opaque white screen background', () => {
    const project = createDesignerProject('blank');

    expect(project.screens[0]!.root.inlineStyles).toEqual([
      { props: { bg_color: '#ffffff', bg_opa: 255 } },
    ]);
  });

  it('gives an added screen the same explicit background', () => {
    const root = createDesignerScreenRoot();

    expect(root.styles).toEqual([
      { props: { bg_color: '#ffffff', bg_opa: 255 } },
    ]);
    expect(root.props).not.toHaveProperty('width');
    expect(root.props).not.toHaveProperty('height');
  });
});
