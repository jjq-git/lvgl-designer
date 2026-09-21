/**
 * snapshot 像素转换:LVGL ARGB8888 小端(内存序 B,G,R,A)→ RGBA。
 * alpha 强制 255:LVGL snapshot 是预乘 alpha,截图当不透明用(m0 实测定案)。
 */
export function bgraToRgba(
  heap: Uint8Array,
  ptr: number,
  w: number,
  h: number,
  stride: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ptr + y * stride;
    const dst = y * w * 4;
    for (let x = 0; x < w; x++) {
      const s = src + x * 4;
      const d = dst + x * 4;
      out[d] = heap[s + 2]!; // R ← B 位
      out[d + 1] = heap[s + 1]!; // G
      out[d + 2] = heap[s]!; // B ← R 位
      out[d + 3] = 255;
    }
  }
  return out;
}
