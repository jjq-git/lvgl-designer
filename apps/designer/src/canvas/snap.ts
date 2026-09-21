/**
 * 拖动对齐吸附:候选 = 兄弟 rects + 画布中线/边缘,阈值 4/zoom px(design/04 §4.2)。
 */
import type { LvdRect } from '@lvd/lvgl-runtime';

export interface SnapResult {
  dx: number;
  dy: number;
  v: number[]; // 命中的竖直参考线 x
  h: number[]; // 命中的水平参考线 y
}

function edgesX(r: LvdRect): number[] {
  return [r.x, r.x + r.w / 2, r.x + r.w];
}
function edgesY(r: LvdRect): number[] {
  return [r.y, r.y + r.h / 2, r.y + r.h];
}

export function computeSnap(
  moving: LvdRect,
  siblings: LvdRect[],
  canvasW: number,
  canvasH: number,
  threshold: number,
): SnapResult {
  const candX: number[] = [0, canvasW / 2, canvasW];
  const candY: number[] = [0, canvasH / 2, canvasH];
  for (const r of siblings) {
    candX.push(...edgesX(r));
    candY.push(...edgesY(r));
  }
  let dx = 0;
  let dy = 0;
  let bestX = threshold + 1;
  let bestY = threshold + 1;
  let vLine: number | null = null;
  let hLine: number | null = null;
  for (const me of edgesX(moving)) {
    for (const c of candX) {
      const d = Math.abs(c - me);
      if (d <= threshold && d < bestX) {
        bestX = d;
        dx = c - me;
        vLine = c;
      }
    }
  }
  for (const me of edgesY(moving)) {
    for (const c of candY) {
      const d = Math.abs(c - me);
      if (d <= threshold && d < bestY) {
        bestY = d;
        dy = c - me;
        hLine = c;
      }
    }
  }
  return { dx, dy, v: vLine !== null ? [vLine] : [], h: hLine !== null ? [hLine] : [] };
}
