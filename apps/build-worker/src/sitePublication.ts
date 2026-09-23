import { pathToFileURL } from 'node:url';
import {
  canonicalJson,
  createWebUiDocument,
  sha256Utf8,
  type ProjectSnapshotV2,
} from '@lvd/schema/v2';

interface SitePublicationRequest {
  protocolVersion: 1;
  command: 'project-podsc-static';
  snapshot: ProjectSnapshotV2;
}

interface Diagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
}

const REMOTE_REFERENCE_RE = /^(?:https?:|data:|blob:|file:|\/\/)/i;
const RESOURCE_WIDGET_TYPES = new Set(['image', 'imagebutton', 'animimage', 'lottie']);

function scanReferences(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (typeof value === 'string') {
    if (REMOTE_REFERENCE_RE.test(value.trim())) diagnostics.push({
      severity: 'error', code: 'E_PODSC_EXTERNAL_REFERENCE', path,
      message: `ui.podsc.com 首期不允许外部或内联资源引用：${path}`,
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanReferences(item, `${path}[${index}]`, diagnostics));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) scanReferences(child, path ? `${path}.${key}` : key, diagnostics);
}

function scanResourceWidgets(value: unknown, path: string, diagnostics: Diagnostic[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanResourceWidgets(item, `${path}[${index}]`, diagnostics));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (typeof record.type === 'string' && RESOURCE_WIDGET_TYPES.has(record.type)) {
    diagnostics.push({
      severity: 'error',
      code: 'E_PODSC_RESOURCE_WIDGET_UNSUPPORTED',
      path: `${path}.type`,
      message: `ui.podsc.com 首期不支持依赖素材的组件 ${record.type}；请移除组件或等待目标站支持素材发布`,
    });
  }
  for (const [key, child] of Object.entries(record)) {
    scanResourceWidgets(child, path ? `${path}.${key}` : key, diagnostics);
  }
}

export async function executeSitePublication(request: SitePublicationRequest) {
  const diagnostics: Diagnostic[] = [];
  try {
    if (request.protocolVersion !== 1 || request.command !== 'project-podsc-static') throw new Error('unsupported worker protocol');
    scanReferences(request.snapshot.uiProject, 'uiProject', diagnostics);
    scanResourceWidgets(request.snapshot.uiProject.screens, 'uiProject.screens', diagnostics);
    if (diagnostics.some((item) => item.severity === 'error')) {
      return { protocolVersion: 1, command: request.command, document: null, json: null, sha256: null, diagnostics };
    }
    const document = createWebUiDocument(request.snapshot);
    document.assetManifest.forEach((asset, index) => diagnostics.push({
      severity: 'error', code: 'E_PODSC_ASSET_UNSUPPORTED', path: `assetManifest[${index}]`,
      message: `ui.podsc.com 首期不支持素材：${asset.assetId}`,
    }));
    scanReferences(document.uiProject, 'uiProject', diagnostics);
    if (diagnostics.some((item) => item.severity === 'error')) {
      return { protocolVersion: 1, command: request.command, document: null, json: null, sha256: null, diagnostics };
    }
    const json = canonicalJson(document);
    return { protocolVersion: 1, command: request.command, document, json, sha256: await sha256Utf8(json), diagnostics };
  } catch (error: unknown) {
    diagnostics.push({ severity: 'error', code: 'E_PODSC_PROJECTION', message: error instanceof Error ? error.message : String(error) });
    return { protocolVersion: 1, command: request.command, document: null, json: null, sha256: null, diagnostics };
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const request = JSON.parse(await readStdin()) as SitePublicationRequest;
  process.stdout.write(`${JSON.stringify(await executeSitePublication(request))}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
