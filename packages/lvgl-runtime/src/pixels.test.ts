import { describe, expect, it } from 'vitest';
import { bgraToRgba } from './pixels';

describe('bgraToRgba', () => {
  it('swaps B and R channels, forces alpha 255', () => {
    // 1 像素 BGRA: B=1 G=2 R=3 A=4
    const heap = new Uint8Array([1, 2, 3, 4]);
    const out = bgraToRgba(heap, 0, 1, 1, 4);
    expect([...out]).toEqual([3, 2, 1, 255]); // RGBA
  });

  it('respects stride padding and ptr offset', () => {
    // 2x2,stride=12(每行 4 字节 padding),前置 8 字节偏移
    const stride = 12;
    const heap = new Uint8Array(8 + 2 * stride);
    const px = (row: number, col: number, bgra: number[]) =>
      heap.set(bgra, 8 + row * stride + col * 4);
    px(0, 0, [10, 20, 30, 0]);
    px(0, 1, [11, 21, 31, 0]);
    px(1, 0, [12, 22, 32, 0]);
    px(1, 1, [13, 23, 33, 0]);
    const out = bgraToRgba(heap, 8, 2, 2, stride);
    expect(out.length).toBe(16);
    expect([...out.slice(0, 4)]).toEqual([30, 20, 10, 255]);
    expect([...out.slice(4, 8)]).toEqual([31, 21, 11, 255]);
    expect([...out.slice(8, 12)]).toEqual([32, 22, 12, 255]);
    expect([...out.slice(12, 16)]).toEqual([33, 23, 13, 255]);
  });
});
