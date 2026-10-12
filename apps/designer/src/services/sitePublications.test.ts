import { describe, expect, it } from 'vitest';
import {
  matchingSiteFrameId,
  parseSitePublicationError,
  sitePublicationErrorInfo,
  siteFrameCompatibility,
  siteFrameDemoSizeLabel,
  siteFrameSpecsLabel,
  type SiteFrame,
} from './sitePublications';

const frames: SiteFrame[] = [
  { id: 'round-240', model: 'round-240', resolution: { width: 240, height: 240 }, shape: 'round' },
  { id: 'rect-fluid', model: 'rect-fluid', resolution: null, shape: 'rect' },
  {
    id: 'square-fluid', model: 'square-fluid', resolution: null, shape: 'rect',
    aspectRatio: '1:1', aspectRatioTolerance: 0.005,
  },
];

describe('site publication frame compatibility', () => {
  it('selects a compatible frame instead of defaulting to the first frame', () => {
    expect(matchingSiteFrameId(frames, { width: 480, height: 480, shape: 'rect' })).toBe('rect-fluid');
    expect(matchingSiteFrameId(frames, { width: 480, height: 480, shape: 'round' })).toBe('');
  });

  it('reports shape and resolution mismatches', () => {
    expect(siteFrameCompatibility(frames[0]!, { width: 240, height: 240, shape: 'rect' })).toContain('形');
    expect(siteFrameCompatibility(frames[0]!, { width: 480, height: 480, shape: 'round' })).toContain('240×240');
  });

  it('enforces manifest aspect-ratio matches when resolution is not registered', () => {
    expect(siteFrameCompatibility(frames[2]!, { width: 480, height: 480, shape: 'rect' })).toBeNull();
    expect(siteFrameCompatibility(frames[2]!, { width: 1024, height: 600, shape: 'rect' }))
      .toContain('1:1');
  });

  it('formats device specifications from manifest fields exactly like the target gallery filter', () => {
    expect(siteFrameSpecsLabel({
      id: 'WF2D-1040', model: 'WF2D-1040', nameCn: '6B 屏幕', nameEn: '6B Screen',
      screenSizeInches: 6.1,
      physicalSize: { width: 159, height: 97, unit: 'mm' },
      resolution: { width: 1080, height: 720 }, shape: 'rect',
    })).toBe('WF2D-1040 6.1" 1080 x 720px 159 x 97mm 6B 屏幕');
    expect(siteFrameDemoSizeLabel({
      id: 'WF2D-8630', model: 'WF2D-8630', resolution: null, shape: 'rect',
      demoLogicalSizes: [{ width: 480, height: 480, shape: 'rect' }],
    })).toBe('480×480');
  });
});

describe('site publication error details', () => {
  it('preserves status, backend code, paths and every validation diagnostic', () => {
    const error = parseSitePublicationError(422, {
      detail: {
        code: 'podsc-static-invalid',
        message: 'project cannot be published to ui.podsc.com',
        detail: [
          {
            severity: 'error',
            code: 'E_PODSC_RESOURCE_WIDGET_UNSUPPORTED',
            path: 'uiProject.screens[1].root.children[1].type',
            message: '不支持依赖素材的组件 image',
          },
          {
            severity: 'error',
            code: 'E_PODSC_ASSET_UNSUPPORTED',
            path: 'assetManifest[0]',
            message: '不支持素材 image:podsc_logo',
          },
        ],
      },
    });

    expect(sitePublicationErrorInfo(error)).toEqual({
      message: 'project cannot be published to ui.podsc.com',
      status: 422,
      code: 'podsc-static-invalid',
      diagnostics: [
        {
          severity: 'error',
          code: 'E_PODSC_RESOURCE_WIDGET_UNSUPPORTED',
          path: 'uiProject.screens[1].root.children[1].type',
          message: '不支持依赖素材的组件 image',
        },
        {
          severity: 'error',
          code: 'E_PODSC_ASSET_UNSUPPORTED',
          path: 'assetManifest[0]',
          message: '不支持素材 image:podsc_logo',
        },
      ],
    });
  });

  it('keeps non-diagnostic backend detail available as formatted technical detail', () => {
    const error = parseSitePublicationError(409, {
      detail: { code: 'target-conflict', message: '目标分支冲突', detail: { branch: 'main' } },
    });
    expect(sitePublicationErrorInfo(error)).toMatchObject({
      message: '目标分支冲突', status: 409, code: 'target-conflict', diagnostics: [],
      detailText: '{\n  "branch": "main"\n}',
    });
  });

  it('shows standard FastAPI validation locations and error types', () => {
    const error = parseSitePublicationError(422, {
      detail: [{ type: 'missing', loc: ['body', 'frameId'], msg: 'Field required' }],
    });
    expect(sitePublicationErrorInfo(error)).toMatchObject({
      status: 422,
      diagnostics: [{ code: 'missing', path: 'body.frameId', message: 'Field required' }],
    });
  });

  it('does not discard a non-JSON server error response', () => {
    expect(sitePublicationErrorInfo(parseSitePublicationError(502, 'upstream unavailable'))).toMatchObject({
      message: 'upstream unavailable', status: 502,
    });
  });
});
