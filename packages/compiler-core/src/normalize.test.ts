import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@lvd/schema';
import { normalizeProject } from './index.js';

describe('@lvd/compiler-core', () => {
  it('只依赖 Schema/Registry 即可生成稳定 IR', () => {
    const project = createEmptyProject('core-smoke');
    const first = normalizeProject(project);
    const second = normalizeProject(project);

    expect(first.diagnostics).toEqual([]);
    expect(first.ir).toEqual(second.ir);
    expect(first.ir.name).toBe('core-smoke');
    expect(first.ir.screens).toHaveLength(1);
  });
});
