import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compilePreview } from '@lvd/preview-compiler';
import { loadStoredProjectDocument } from '@lvd/schema/v2';
import { validatePreviewProgramSupport } from './preview.js';

const PRESETS = [
  { model: 'WF2D-8620', background: '#071A1B' },
  { model: 'WF2D-1040', background: '#EEF7F3' },
  { model: 'WF2D-1030', background: '#F3F0E7' },
  { model: 'WF2D-1050', background: '#FFF7EA' },
  { model: 'WF2D-8630', background: '#EAF4FA' },
] as const;

describe('serene pod examples', () => {
  for (const { model, background } of PRESETS) {
    it(`compiles ${model} into a runtime-supported PreviewProgram`, () => {
      const url = new URL(`../../../examples/serene-pod/${model}-serene-pod.lvproj.json`, import.meta.url);
      const loaded = loadStoredProjectDocument(JSON.parse(readFileSync(url, 'utf8')));
      const result = compilePreview(loaded.project, { runtimeColorFormat: 'XRGB8888' });
      expect(result.diagnostics.filter((issue) => issue.severity === 'error')).toEqual([]);
      expect(result.program).not.toBeNull();
      expect(result.program?.screens).toHaveLength(5);
      expect(result.program?.screens[0]?.root.children.length).toBeGreaterThan(0);
      expect(result.program?.screens[0]?.root.inlineStyles[0]?.props.bg_color).toBe(background);
      expect(validatePreviewProgramSupport(result.program!)).toEqual([]);
    });
  }
});
