import type {
  BuildTarget,
  ControllerProfile,
  DisplayProfile,
  FirmwareProfile,
  InputProfile,
  ThemeRevision,
} from '@lvd/schema/v2';
import { apiUrl } from '../stores/authStore';

export type CatalogDocument =
  | DisplayProfile | ControllerProfile | InputProfile | FirmwareProfile
  | ThemeRevision | BuildTarget;

export interface CatalogRecord<T extends CatalogDocument = CatalogDocument> {
  kind: T['kind'];
  id: string;
  revision: number;
  sha256: string;
  createdBy: number;
  createdAt: string;
  doc: T;
}

export interface PlatformBuild {
  id: string;
  state: string;
  buildTargetRef: string;
  createdAt: string;
  updatedAt: string;
  failure?: { code?: string; message?: string } | null;
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const detail = body?.detail;
    const message = typeof detail === 'string'
      ? detail
      : typeof detail === 'object' && detail !== null && 'message' in detail
        ? String((detail as { message?: unknown }).message ?? response.statusText)
        : response.statusText;
    throw new Error(`${response.status}: ${message}`);
  }
  return body as T;
}

export async function listCatalog(): Promise<{
  profiles: CatalogRecord[];
  themes: CatalogRecord<ThemeRevision>[];
  buildTargets: CatalogRecord<BuildTarget>[];
}> {
  const [profiles, themes, targets] = await Promise.all([
    jsonRequest<{ profiles: CatalogRecord[] }>('api/lvgl/catalog/profiles'),
    jsonRequest<{ themes: CatalogRecord<ThemeRevision>[] }>('api/lvgl/catalog/themes'),
    jsonRequest<{ buildTargets: CatalogRecord<BuildTarget>[] }>('api/lvgl/catalog/build-targets'),
  ]);
  return { profiles: profiles.profiles, themes: themes.themes, buildTargets: targets.buildTargets };
}

export async function publishCatalogDocument(doc: CatalogDocument): Promise<CatalogRecord> {
  let path: string;
  switch (doc.kind) {
    case 'display-profile': path = 'api/lvgl/catalog/profiles/display'; break;
    case 'controller-profile': path = 'api/lvgl/catalog/profiles/controller'; break;
    case 'input-profile': path = 'api/lvgl/catalog/profiles/input'; break;
    case 'firmware-profile': path = 'api/lvgl/catalog/profiles/firmware'; break;
    case 'lvgl-theme': path = 'api/lvgl/catalog/themes'; break;
    case 'lvgl-build-target': path = 'api/lvgl/catalog/build-targets'; break;
  }
  return jsonRequest<CatalogRecord>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ doc }),
  });
}

function splitRef(reference: string, expected: string): { id: string; revision: number } {
  const match = new RegExp(`^${expected}:[a-z0-9][a-z0-9._-]*@([1-9]\\d*)$`).exec(reference);
  if (!match) throw new Error(`引用格式无效: ${reference}`);
  return { id: reference.slice(0, reference.lastIndexOf('@')), revision: Number(match[1]) };
}

export async function getProfileRevision<T extends CatalogDocument>(reference: string): Promise<CatalogRecord<T>> {
  const kind = reference.slice(0, reference.indexOf(':'));
  if (!['display', 'controller', 'input', 'firmware'].includes(kind)) {
    throw new Error(`不是 Profile 引用: ${reference}`);
  }
  const { id, revision } = splitRef(reference, kind);
  return jsonRequest<CatalogRecord<T>>(
    `api/lvgl/catalog/profiles/${kind}/${encodeURIComponent(id)}/revisions/${revision}`,
  );
}

export async function getThemeRevision(reference: string): Promise<CatalogRecord<ThemeRevision>> {
  const { id, revision } = splitRef(reference, 'theme');
  return jsonRequest<CatalogRecord<ThemeRevision>>(
    `api/lvgl/catalog/themes/${encodeURIComponent(id)}/revisions/${revision}`,
  );
}

export async function resolveBuildTargetProfiles(target: BuildTarget): Promise<{
  controller: ControllerProfile;
  display: DisplayProfile;
  theme?: ThemeRevision;
}> {
  const controller = await getProfileRevision<ControllerProfile>(target.controllerProfileRef);
  const display = await getProfileRevision<DisplayProfile>(controller.doc.displayRef);
  const theme = target.themeRef.startsWith('theme:')
    ? (await getThemeRevision(target.themeRef)).doc
    : undefined;
  return { controller: controller.doc, display: display.doc, ...(theme ? { theme } : {}) };
}

export async function listBuilds(): Promise<PlatformBuild[]> {
  return (await jsonRequest<{ builds: PlatformBuild[] }>('api/lvgl/builds')).builds;
}

export async function queueBuild(target: BuildTarget): Promise<PlatformBuild> {
  return jsonRequest<PlatformBuild>('api/lvgl/builds', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ buildTargetId: target.id, buildTargetRevision: target.revision }),
  });
}

export async function transitionBuild(
  buildId: string, action: 'approve' | 'publish' | 'rollback',
): Promise<PlatformBuild> {
  return jsonRequest<PlatformBuild>(`api/lvgl/builds/${encodeURIComponent(buildId)}/${action}`, { method: 'POST' });
}
