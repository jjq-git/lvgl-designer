export const LVGL_IMAGE_SCALE_NONE = 256;

export function imageScaleForPixelSize(sourceSizePx: number, targetSizePx: number): number {
  if (!Number.isFinite(sourceSizePx) || sourceSizePx <= 0) return LVGL_IMAGE_SCALE_NONE;
  return Math.max(1, Math.round((targetSizePx / sourceSizePx) * LVGL_IMAGE_SCALE_NONE));
}

export function imagePixelSizeForScale(sourceSizePx: number, scale: number): number {
  if (!Number.isFinite(sourceSizePx) || sourceSizePx <= 0) return 0;
  return Math.max(1, Math.round((sourceSizePx * scale) / LVGL_IMAGE_SCALE_NONE));
}
