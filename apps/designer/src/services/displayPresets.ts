import { siteFrameSpecsLabel, type SiteFrame } from './sitePublications';

/**
 * 设备预设的权威来源：ui.podsc.com/site/frames/manifest.json（schemaVersion 1）。
 * 这里保留一份离线快照；有发布权限时 Toolbar 会用后端读取的目标分支清单覆盖它。
 */
export const SITE_FRAME_MANIFEST_URL =
  'http://192.168.1.88:3000/wf2/ui.podsc.com/src/branch/main/site/frames/manifest.json';

export interface DisplayPreset {
  frameId: string;
  model: string;
  nameCn: string;
  nameEn?: string;
  screenSizeInches?: number;
  physicalSize?: SiteFrame['physicalSize'];
  width: number;
  height: number;
  shape: 'round' | 'rect';
  resolutionSource: 'hardware' | 'demo';
}

export interface UnresolvedDisplayPreset {
  frameId: string;
  model: string;
  nameCn: string;
  nameEn?: string;
  screenSizeInches?: number;
  physicalSize?: SiteFrame['physicalSize'];
  shape: 'round' | 'rect';
  aspectRatio?: string;
}

const MANIFEST_SNAPSHOT: SiteFrame[] = [
  {
    id: 'WF2D-8620', model: 'WF2D-8620', nameCn: '86 圆屏',
    nameEn: '86 Round Screen', screenSizeInches: 1.28,
    physicalSize: { width: 86, height: 86, unit: 'mm' },
    resolution: { width: 240, height: 240 }, shape: 'round',
    demoLogicalSizes: [{ width: 240, height: 240, shape: 'round' }],
  },
  {
    id: 'WF2D-1040', model: 'WF2D-1040', nameCn: '6B 屏幕',
    nameEn: '6B Screen', screenSizeInches: 6.1,
    physicalSize: { width: 159, height: 97, unit: 'mm' },
    resolution: { width: 1080, height: 720 }, shape: 'rect',
    demoLogicalSizes: [{ width: 1080, height: 720, shape: 'rect' }],
  },
  {
    id: 'WF2D-1030', model: 'WF2D-1030', nameCn: '6A 屏幕',
    nameEn: '6A Screen', screenSizeInches: 5.9,
    physicalSize: { width: 159, height: 97, unit: 'mm' },
    resolution: { width: 1440, height: 720 }, shape: 'rect',
    demoLogicalSizes: [{ width: 1440, height: 720, shape: 'rect' }],
  },
  {
    id: 'WF2D-1050', model: 'WF2D-1050', nameCn: '7 屏幕',
    nameEn: '7 Screen', screenSizeInches: 7,
    physicalSize: { width: 179, height: 113, unit: 'mm' },
    resolution: { width: 1024, height: 600 }, shape: 'rect',
    demoLogicalSizes: [{ width: 1024, height: 600, shape: 'rect' }],
  },
  {
    id: 'WF2D-8630', model: 'WF2D-8630', nameCn: '86 方屏',
    nameEn: '86 Square Screen', screenSizeInches: 3.95,
    physicalSize: { width: 86, height: 86, unit: 'mm' },
    resolution: null, shape: 'rect', aspectRatio: '1:1', aspectRatioTolerance: 0.005,
    demoLogicalSizes: [{ width: 480, height: 480, shape: 'rect' }],
  },
];

export function displayPresetsFromFrames(frames: SiteFrame[]): {
  fixed: DisplayPreset[];
  unresolved: UnresolvedDisplayPreset[];
} {
  const fixed: DisplayPreset[] = [];
  const unresolved: UnresolvedDisplayPreset[] = [];
  for (const frame of frames) {
    const snapshotFrame = MANIFEST_SNAPSHOT.find((candidate) => candidate.id === frame.id);
    const demoLogicalSizes = frame.demoLogicalSizes?.length
      ? frame.demoLogicalSizes
      : snapshotFrame?.demoLogicalSizes;
    const demoSize = demoLogicalSizes?.find((size) => !frame.shape || size.shape === frame.shape);
    const availableSize = frame.resolution
      ? { ...frame.resolution, shape: frame.shape }
      : demoSize;
    if (availableSize?.shape) {
      fixed.push({
        frameId: frame.id,
        model: frame.model,
        nameCn: frame.nameCn ?? frame.model,
        nameEn: frame.nameEn,
        screenSizeInches: frame.screenSizeInches,
        physicalSize: frame.physicalSize,
        width: availableSize.width,
        height: availableSize.height,
        shape: availableSize.shape,
        resolutionSource: frame.resolution ? 'hardware' : 'demo',
      });
    } else if (frame.shape) {
      unresolved.push({
        frameId: frame.id,
        model: frame.model,
        nameCn: frame.nameCn ?? frame.model,
        nameEn: frame.nameEn,
        screenSizeInches: frame.screenSizeInches,
        physicalSize: frame.physicalSize,
        shape: frame.shape,
        aspectRatio: frame.aspectRatio,
      });
    }
  }
  return { fixed, unresolved };
}

export const FALLBACK_DISPLAY_PRESETS = displayPresetsFromFrames(MANIFEST_SNAPSHOT);

export function displayPresetLabel(preset: DisplayPreset): string {
  const label = siteFrameSpecsLabel({
    id: preset.frameId,
    model: preset.model,
    nameCn: preset.nameCn,
    nameEn: preset.nameEn,
    screenSizeInches: preset.screenSizeInches,
    physicalSize: preset.physicalSize,
    resolution: { width: preset.width, height: preset.height },
    shape: preset.shape,
  });
  return preset.resolutionSource === 'demo'
    ? `${label.replace(`${preset.width} x ${preset.height}px`, '').replace(/\s+/g, ' ').trim()} · ${preset.width}×${preset.height} Demo 画布（硬件分辨率待登记）`
    : label;
}

export function unresolvedDisplayPresetLabel(preset: UnresolvedDisplayPreset): string {
  return `${siteFrameSpecsLabel({
    id: preset.frameId,
    model: preset.model,
    nameCn: preset.nameCn,
    nameEn: preset.nameEn,
    screenSizeInches: preset.screenSizeInches,
    physicalSize: preset.physicalSize,
    resolution: null,
    shape: preset.shape,
    aspectRatio: preset.aspectRatio,
  })}（分辨率待登记）`;
}
