import { pathToFileURL } from 'node:url';
import {
  canonicalJson,
  createPodscStaticWebUiDocument,
  sha256Utf8,
  WebUiDocumentError,
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

export async function executeSitePublication(request: SitePublicationRequest) {
  const diagnostics: Diagnostic[] = [];
  try {
    if (request.protocolVersion !== 1 || request.command !== 'project-podsc-static') throw new Error('unsupported worker protocol');
    const document = createPodscStaticWebUiDocument(request.snapshot);
    const json = canonicalJson(document);
    return { protocolVersion: 1, command: request.command, document, json, sha256: await sha256Utf8(json), diagnostics };
  } catch (error: unknown) {
    if (error instanceof WebUiDocumentError) {
      diagnostics.push(...error.issues.map((issue) => ({ severity: 'error' as const, ...issue })));
      return { protocolVersion: 1, command: request.command, document: null, json: null, sha256: null, diagnostics };
    }
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
