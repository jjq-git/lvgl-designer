import { apiUrl } from '../stores/authStore';

export interface SiteFrame {
  id: string;
  model: string;
  nameCn?: string;
  nameEn?: string;
  screenSizeInches?: number;
  physicalSize?: { width: number; height: number; unit: 'mm' };
  screenPhysicalSize?: { width: number; height: number; unit: 'mm' };
  resolution: { width: number; height: number } | null;
  /** Existing UI coordinate systems for this frame; they are not hardware specifications. */
  demoLogicalSizes?: Array<{ width: number; height: number; shape: 'round' | 'rect' }>;
  shape?: 'round' | 'rect';
  aspectRatio?: string;
  aspectRatioTolerance?: number;
}

/** 与目标站 galleryFilterInfo 使用相同字段和排列，不从 UI 文档补推硬件规格。 */
export function siteFrameSpecsLabel(frame: SiteFrame, language: 'cn' | 'en' = 'cn'): string {
  const name = language === 'cn'
    ? frame.nameCn ?? frame.nameEn
    : frame.nameEn ?? frame.nameCn;
  const physical = frame.physicalSize?.unit === 'mm'
    && frame.physicalSize.width > 0 && frame.physicalSize.height > 0
    ? `${frame.physicalSize.width} x ${frame.physicalSize.height}mm`
    : '';
  return [
    frame.model || frame.id,
    Number.isFinite(frame.screenSizeInches) && frame.screenSizeInches! > 0
      ? `${frame.screenSizeInches}"`
      : '',
    frame.resolution
      ? `${frame.resolution.width} x ${frame.resolution.height}px`
      : '',
    physical,
    name,
  ].filter(Boolean).join(' ');
}

export function siteFrameDemoSizeLabel(frame: SiteFrame): string {
  return (frame.demoLogicalSizes ?? [])
    .map((size) => `${size.width}×${size.height}`)
    .join('、');
}

export interface SiteDemo {
  id: string;
  frameId: string;
  name: string;
  description: string;
  isPublic: boolean;
}

export interface SiteTargetState {
  targetCommit: string;
  branch: string;
  frames: SiteFrame[];
  demos: SiteDemo[];
}

export interface SiteDisplay {
  width: number;
  height: number;
  shape: 'round' | 'rect';
}

export function siteFrameCompatibility(frame: SiteFrame, display: SiteDisplay): string | null {
  if (frame.shape && frame.shape !== display.shape) {
    return `当前画布为${display.shape === 'round' ? '圆形' : '方形'}，该型号要求${frame.shape === 'round' ? '圆形' : '方形'}`;
  }
  if (frame.resolution
    && (frame.resolution.width !== display.width || frame.resolution.height !== display.height)) {
    return `当前画布为 ${display.width}×${display.height}，该型号要求 ${frame.resolution.width}×${frame.resolution.height}`;
  }
  if (frame.aspectRatio) {
    const [ratioWidth, ratioHeight] = frame.aspectRatio.split(':').map(Number);
    if (Number.isFinite(ratioWidth) && Number.isFinite(ratioHeight) && ratioWidth! > 0 && ratioHeight! > 0) {
      const expected = ratioWidth! / ratioHeight!;
      const actual = display.width / display.height;
      const tolerance = frame.aspectRatioTolerance ?? 0;
      if (Math.abs(actual - expected) > tolerance) {
        return `当前画布比例为 ${display.width}:${display.height}，该型号要求 ${frame.aspectRatio}`;
      }
    }
  }
  return null;
}

export function matchingSiteFrameId(frames: SiteFrame[], display: SiteDisplay): string {
  return frames.find((frame) => siteFrameCompatibility(frame, display) === null)?.id ?? '';
}

export interface SitePublication {
  id: string;
  projectId: string;
  demoId: string;
  frameId: string;
  name: string;
  description: string;
  isPublic: boolean;
  status: 'preparing' | 'prepared' | 'publishing' | 'git_committed' | 'failed' | 'conflict' | 'rolled_back' | 'rollback_failed';
  sourceProjectVersion: number;
  sourceSnapshotSeq: number;
  sourceUiRevision: number;
  documentSha256?: string;
  thumbnailSha256?: string;
  targetBaseCommit?: string;
  commitSha?: string;
  rollbackCommitSha?: string;
  diagnostics?: Array<{ severity: 'error' | 'warning'; code: string; message: string; path?: string }>;
  diffStat?: string;
  changedPaths?: string[];
  previewUrl?: string;
  deploymentStatus?: 'git_submitted' | 'deploying' | 'deployed' | 'deployment_partial' | 'deployment_failed';
  interactivePreviewAvailable?: boolean;
  manifestChange?: { before: SiteDemo | Record<string, unknown> | null; after: SiteDemo | Record<string, unknown> };
  delivery?: {
    git: { status: 'not_started' | 'submitted' | 'rolled_back'; commitSha?: string | null };
    staticUpload: DeliveryStage;
    stalePageDeletion: DeliveryStage;
    cdnRefresh: DeliveryStage;
  };
  error?: { code: string; message: string; detail?: unknown } | null;
}

export interface DeliveryStage {
  status: 'not_started' | 'running' | 'succeeded' | 'failed' | 'skipped';
  detail?: string;
  updatedAt?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
      ...init,
    });
  } catch {
    throw new Error('无法连接发布服务');
  }
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const body = await response.json() as { detail?: string | { message?: string } };
      if (typeof body.detail === 'string') message = body.detail;
      else if (body.detail?.message) message = body.detail.message;
    } catch { /* non-JSON response */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function getSiteTargetState(): Promise<SiteTargetState> {
  return request('api/lvgl/site-publications/frames');
}

export function listSitePublications(projectId: string): Promise<SitePublication[]> {
  return request<{ publications: SitePublication[] }>(
    `api/lvgl/site-publications?projectId=${encodeURIComponent(projectId)}`,
  ).then((value) => value.publications);
}

export function prepareSitePublication(input: {
  requestId: string;
  projectId: string;
  frameId: string;
  name: string;
  description: string;
  demoId?: string;
  isPublic?: boolean;
}): Promise<SitePublication> {
  return request('api/lvgl/site-publications/prepare', { method: 'POST', body: JSON.stringify(input) });
}

export function publishSitePublication(publicationId: string): Promise<SitePublication> {
  return request(`api/lvgl/site-publications/${encodeURIComponent(publicationId)}/publish`, { method: 'POST' });
}

export function getSitePublication(publicationId: string): Promise<SitePublication> {
  return request(`api/lvgl/site-publications/${encodeURIComponent(publicationId)}`);
}

export function rollbackSitePublication(publicationId: string): Promise<SitePublication> {
  return request(`api/lvgl/site-publications/${encodeURIComponent(publicationId)}/rollback`, { method: 'POST' });
}

export function sitePublicationThumbnailUrl(publicationId: string): string {
  return apiUrl(`api/lvgl/site-publications/${encodeURIComponent(publicationId)}/thumbnail`);
}

export function sitePublicationPreviewUrl(publicationId: string): string {
  return apiUrl(`api/lvgl/site-publications/${encodeURIComponent(publicationId)}/preview`);
}
