import { describe, expect, it } from 'vitest';
import {
  DEVICE_FRAME_PREVIEWS,
  deviceFrameForDisplay,
  displayPresetsFromFrames,
  displayPresetLabel,
  FALLBACK_DISPLAY_PRESETS,
} from './displayPresets';

describe('site frame display presets', () => {
  it('matches the authoritative manifest snapshot exactly', () => {
    expect(FALLBACK_DISPLAY_PRESETS.fixed.map((preset) => ({
      id: preset.frameId,
      width: preset.width,
      height: preset.height,
      shape: preset.shape,
    }))).toEqual([
      { id: 'WF2D-8620', width: 240, height: 240, shape: 'round' },
      { id: 'WF2D-1040', width: 1080, height: 720, shape: 'rect' },
      { id: 'WF2D-1030', width: 1440, height: 720, shape: 'rect' },
      { id: 'WF2D-1050', width: 1024, height: 600, shape: 'rect' },
      { id: 'WF2D-8630', width: 480, height: 480, shape: 'rect' },
      { id: 'WF3-28476', width: 284, height: 76, shape: 'rect' },
    ]);
    expect(FALLBACK_DISPLAY_PRESETS.fixed[4]).toEqual(expect.objectContaining({
      frameId: 'WF2D-8630', resolutionSource: 'demo', width: 480, height: 480, shape: 'rect',
    }));
    expect(FALLBACK_DISPLAY_PRESETS.unresolved).toEqual([]);
  });

  it('shows model names and does not invent a resolution for unresolved frames', () => {
    expect(displayPresetLabel(FALLBACK_DISPLAY_PRESETS.fixed[0]!))
      .toBe('WF2D-8620 1.28" 240 x 240px 86 x 86mm 86 圆屏');
    expect(displayPresetLabel(FALLBACK_DISPLAY_PRESETS.fixed[4]!))
      .toBe('WF2D-8630 3.95" 86 x 86mm 86 方屏 · 480×480 Demo 画布（硬件分辨率待登记）');
  });

  it('keeps the verified 8630 Demo canvas when the live target omits demo metadata', () => {
    const presets = displayPresetsFromFrames([{
      id: 'WF2D-8630',
      model: 'WF2D-8630',
      nameCn: '86 方屏',
      screenSizeInches: 3.95,
      physicalSize: { width: 86, height: 86, unit: 'mm' },
      resolution: null,
      shape: 'rect',
      aspectRatio: '1:1',
    }]);

    expect(presets.fixed).toEqual([expect.objectContaining({
      frameId: 'WF2D-8630',
      resolutionSource: 'demo',
      width: 480,
      height: 480,
      shape: 'rect',
    })]);
    expect(presets.unresolved).toEqual([]);
  });

  it('maps every framed built-in display to its local device frame', () => {
    for (const preset of FALLBACK_DISPLAY_PRESETS.fixed) {
      expect(deviceFrameForDisplay(preset)).toEqual(expect.objectContaining({
        frameId: preset.frameId,
        svgMarkup: expect.stringContaining('<svg'),
      }));
    }
    expect(DEVICE_FRAME_PREVIEWS).toHaveLength(6);
    const round240Frame = deviceFrameForDisplay({ width: 240, height: 240, shape: 'round' });
    expect(round240Frame).toEqual(
      expect.objectContaining({
        frameId: 'WF2D-8620',
        aperture: {
          x: 0.287442,
          y: 0.287442,
          width: 0.425116,
          height: 0.425116,
          radius: '50%',
        },
      }),
    );
    const glassGradient = round240Frame?.svgMarkup.match(
      /<radialGradient id="glassG"[\s\S]*?<\/radialGradient>/,
    )?.[0];
    expect(glassGradient).toBeDefined();
    expect(glassGradient?.match(/stop-color="#000000"/g)).toHaveLength(4);
    expect(deviceFrameForDisplay({ width: 284, height: 76, shape: 'rect' })).toEqual(
      expect.objectContaining({
        frameId: 'WF3-28476',
        assetUrl: 'frames/WF3_FRONT.svg',
        aperture: expect.objectContaining({ width: 0.614660917, height: 0.16840417 }),
      }),
    );
    expect(deviceFrameForDisplay({ width: 320, height: 240, shape: 'rect' })).toBeNull();
  });
});
