import { describe, expect, it } from 'vitest';
import {
  imagePixelSizeForScale,
  imageScaleForPixelSize,
} from './imageSizing';

describe('image sizing', () => {
  it('maps intuitive pixel sizes to LVGL 256-based scaling', () => {
    expect(imageScaleForPixelSize(32, 16)).toBe(128);
    expect(imageScaleForPixelSize(32, 32)).toBe(256);
    expect(imageScaleForPixelSize(32, 48)).toBe(384);
    expect(imageScaleForPixelSize(32, 64)).toBe(512);
  });

  it('maps an existing uniform scale back to the displayed pixel size', () => {
    expect(imagePixelSizeForScale(32, 192)).toBe(24);
    expect(imagePixelSizeForScale(48, 256)).toBe(48);
  });
});
