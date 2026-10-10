import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compilePreview } from '@lvd/preview-compiler';
import { loadStoredProjectDocument } from '@lvd/schema/v2';
import { validatePreviewProgramSupport } from './preview.js';

describe('WF3 firmware UI imported example', () => {
  it('compiles all 46 screens into the LVGL 9.5 preview contract', () => {
    const url = new URL(
      '../../../examples/wf3-firmware/WF3-284x76-firmware-ui.lvproj.json',
      import.meta.url,
    );
    const loaded = loadStoredProjectDocument(JSON.parse(readFileSync(url, 'utf8')));
    const result = compilePreview(loaded.project, { runtimeColorFormat: 'XRGB8888' });

    expect(result.diagnostics.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(result.program).not.toBeNull();
    expect(result.program?.screens).toHaveLength(46);
    expect(result.program?.screens[0]?.root.children.length).toBeGreaterThan(0);
    expect(validatePreviewProgramSupport(result.program!)).toEqual([]);
  });
});
