import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('sealed preview host', () => {
  it('loads only a PreviewProgram and immutable same-build assets', () => {
    const source = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(source).toContain("fetch('./preview-program.json'");
    expect(source).toContain('./assets/');
    expect(source).not.toContain('/api/lvgl/projects');
    expect(source).not.toMatch(/\beval\s*\(/);
  });
});
