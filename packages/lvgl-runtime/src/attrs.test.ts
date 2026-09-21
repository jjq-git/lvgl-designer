import { describe, expect, it } from 'vitest';
import { packAttrs, packStrArray } from './attrs';
import { LvglError } from './errors';
import type { AllocModule } from './types';

/** fake 线性堆:指针从 4 起按 4 对齐分配;字符串按 ptr 记录 */
function makeFakeModule() {
  const HEAP32 = new Int32Array(4096);
  let brk = 4;
  const live = new Set<number>();
  const strings = new Map<number, string>();
  const mod: AllocModule = {
    _malloc(size: number): number {
      const p = brk;
      brk += Math.ceil(size / 4) * 4;
      live.add(p);
      return p;
    },
    _free(p: number): void {
      if (!live.has(p)) throw new Error(`double/invalid free: ${p}`);
      live.delete(p);
      strings.delete(p);
    },
    HEAP32,
    stringToNewUTF8(s: string): number {
      const p = mod._malloc(s.length + 1);
      strings.set(p, s);
      return p;
    },
  };
  return { mod, live, strings, HEAP32 };
}

describe('packStrArray', () => {
  it('builds NULL-terminated char** with double NULL slot', () => {
    const { mod, strings, HEAP32 } = makeFakeModule();
    const p = packStrArray(mod, ['a', 'bb', 'ccc']);
    const base = p.table >> 2;
    expect(strings.get(HEAP32[base]!)).toBe('a');
    expect(strings.get(HEAP32[base + 1]!)).toBe('bb');
    expect(strings.get(HEAP32[base + 2]!)).toBe('ccc');
    expect(HEAP32[base + 3]).toBe(0); // NULL 结尾
    expect(HEAP32[base + 4]).toBe(0); // 双 NULL(成对判空兼容)
    p.free();
  });

  it('free() releases every string and the table (no leaks)', () => {
    const { mod, live } = makeFakeModule();
    const p = packStrArray(mod, ['x', 'y']);
    expect(live.size).toBe(3); // 2 串 + 表
    p.free();
    expect(live.size).toBe(0);
  });

  it('handles empty list: table with two NULLs only', () => {
    const { mod, HEAP32 } = makeFakeModule();
    const p = packStrArray(mod, []);
    const base = p.table >> 2;
    expect(HEAP32[base]).toBe(0);
    expect(HEAP32[base + 1]).toBe(0);
    p.free();
  });
});

describe('packAttrs', () => {
  it('packs k,v alternating in insertion order', () => {
    const { mod, strings, HEAP32 } = makeFakeModule();
    const p = packAttrs(mod, { x: '10', y: '20', text: 'hi' });
    const base = p.table >> 2;
    const flat = [0, 1, 2, 3, 4, 5].map((i) => strings.get(HEAP32[base + i]!));
    expect(flat).toEqual(['x', '10', 'y', '20', 'text', 'hi']);
    expect(HEAP32[base + 6]).toBe(0);
    expect(HEAP32[base + 7]).toBe(0);
    p.free();
  });

  it('rejects "name" key (design/02 §5.3 invariant 3)', () => {
    const { mod } = makeFakeModule();
    expect(() => packAttrs(mod, { name: 'nope' })).toThrow(LvglError);
    expect(() => packAttrs(mod, { name: 'nope' })).toThrow(/name/);
  });

  it('stringifies values', () => {
    const { mod, strings, HEAP32 } = makeFakeModule();
    const p = packAttrs(mod, { width: 42 as unknown as string });
    const base = p.table >> 2;
    expect(strings.get(HEAP32[base + 1]!)).toBe('42');
    p.free();
  });
});
