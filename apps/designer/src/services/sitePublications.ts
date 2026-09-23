import { apiUrl } from '../stores/authStore';

export interface SiteFrame {
  id: string;
  model: string;
  nameCn?: string;
  nameEn?: string;
  resolution: { width: number; height: number } | null;
  shape?: 'round' | 'rect';
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
