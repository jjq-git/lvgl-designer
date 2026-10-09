import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compilePreview } from '@lvd/preview-compiler';
import { loadStoredProjectDocument } from '@lvd/schema/v2';
import { validatePreviewProgramSupport } from './preview.js';

const MODELS = ['WF2D-8620', 'WF2D-1040', 'WF2D-1030', 'WF2D-1050', 'WF2D-8630'];

describe('serene pod examples', () => {
  for (const model of MODELS) {
    it(`compiles ${model} into a runtime-supported PreviewProgram`, () => {
      const url = new URL(`../../../examples/serene-pod/${model}-serene-pod.lvproj.json`, import.meta.url);
      const loaded = loadStoredProjectDocument(JSON.parse(readFileSync(url, 'utf8')));
      const result = compilePreview(loaded.project, { runtimeColorFormat: 'XRGB8888' });
      expect(result.diagnostics.filter((issue) => issue.severity === 'error')).toEqual([]);
      expect(result.program).not.toBeNull();
      expect(result.program?.screens).toHaveLength(5);
      expect(result.program?.screens[0]?.root.children.length).toBeGreaterThan(0);
      expect(result.program?.screens[0]?.root.inlineStyles[0]?.props.bg_color).toBe('#F4F1EA');
      expect(validatePreviewProgramSupport(result.program!)).toEqual([]);
    });
  }
});
