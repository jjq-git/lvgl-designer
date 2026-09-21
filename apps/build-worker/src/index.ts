import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  collectProjectTextSymbolsByFont,
  convertFontToLvglC,
  findMissingFontCodePoints,
} from '@lvd/asset-pipeline';
import { emitC95 } from '@lvd/codegen';
import { validatePreviewProgramSupport } from '@lvd/lvgl-runtime';
import { compilePreview } from '@lvd/preview-compiler';
import {
  snapshotToEditorProject,
  type BuildTarget,
  type ControllerProfile,
  type DisplayProfile,
  type ProjectSnapshotV2,
} from '@lvd/schema/v2';

interface LockedProfile<T> { ref: string; sha256: string; doc: T }

interface WorkerRequest {
  protocolVersion: 1;
  inputLock: {
    uiProject: ProjectSnapshotV2['uiProject'];
    actionRegistry: ProjectSnapshotV2['actionRegistry'];
    buildTarget: BuildTarget;
    profiles: {
      display: LockedProfile<DisplayProfile>;
      controller: LockedProfile<ControllerProfile>;
    };
    assets?: Array<{
      category: 'fonts' | 'images' | 'icons';
      id: string;
      codeName?: string;
      sha256: string;
      byteSize: number;
      conv?: Record<string, string | number | boolean>;
    }>;
  };
  assetPayloads?: Record<string, string>;
  target?: 'esp-idf' | 'cmake' | 'bare';
}

interface WorkerResponse {
  protocolVersion: 1;
  files: Record<string, string>;
  diagnostics: Array<{ severity: 'error' | 'warning'; code: string; message: string; nodeId?: string }>;
  generatorManifest: Record<string, unknown>;
}

class FontBuildError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

async function convertFonts(request: WorkerRequest): Promise<{
  files: Record<string, string>;
  manifest: Array<Record<string, unknown>>;
  diagnostics: WorkerResponse['diagnostics'];
}> {
  const files: Record<string, string> = {};
  const manifest: Array<Record<string, unknown>> = [];
  const diagnostics: WorkerResponse['diagnostics'] = [];
  const collectedByFont = collectProjectTextSymbolsByFont(request.inputLock.uiProject);
  for (const asset of request.inputLock.assets ?? []) {
    if (asset.category !== 'fonts') continue;
    if (!asset.codeName) throw new FontBuildError('E_FONT_CODE_NAME_REQUIRED', `font requires codeName: ${asset.id}`);
    const encoded = request.assetPayloads?.[asset.sha256];
    if (!encoded) throw new FontBuildError('E_FONT_PAYLOAD_MISSING', `font payload is missing: ${asset.id}`);
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.byteLength !== asset.byteSize
      || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
      throw new FontBuildError('E_FONT_PAYLOAD_INTEGRITY', `font payload integrity failed: ${asset.id}`);
    }
    const conv = asset.conv ?? {};
    const license = typeof conv.license === 'string' ? conv.license.trim() : '';
    if (!license || license === 'UNSPECIFIED') {
      throw new FontBuildError('E_FONT_LICENSE_REQUIRED', `font license metadata is required: ${asset.id}`);
    }
    const autoSymbols = conv.autoCollect === false ? '' : (
      collectedByFont[asset.id]
      ?? collectedByFont[asset.codeName]
      ?? collectedByFont[`font:${asset.codeName}`]
      ?? ''
    );
    const configuredSymbols = typeof conv.symbols === 'string' ? conv.symbols : '';
    const symbols = `${configuredSymbols}${autoSymbols}`;
    const usedCodePoints = [...new Set([...symbols].map((symbol) => symbol.codePointAt(0)!))];
    let missingUsed: number[];
    try {
      missingUsed = usedCodePoints.length === 0 ? [] : await findMissingFontCodePoints(bytes, usedCodePoints);
    } catch (error: unknown) {
      throw new FontBuildError(
        'E_FONT_CONVERSION',
        `font coverage inspection failed for ${asset.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (missingUsed.length > 0) {
      const preview = missingUsed.slice(0, 16).map((point) => (
        `U+${point.toString(16).toUpperCase().padStart(4, '0')} ${JSON.stringify(String.fromCodePoint(point))}`
      )).join(', ');
      const remainder = missingUsed.length > 16 ? `, and ${missingUsed.length - 16} more` : '';
      throw new FontBuildError(
        'E_FONT_GLYPH_MISSING',
        `font ${asset.id} is missing ${missingUsed.length} used glyph(s): ${preview}${remainder}`,
      );
    }
    let converted: Awaited<ReturnType<typeof convertFontToLvglC>>;
    try {
      converted = await convertFontToLvglC(bytes, {
        codeName: asset.codeName,
        sizePx: typeof conv.sizePx === 'number' ? conv.sizePx : 16,
        bpp: typeof conv.bpp === 'number' ? conv.bpp as 1 | 2 | 4 | 8 : 4,
        ranges: typeof conv.ranges === 'string' ? conv.ranges : undefined,
        symbols,
      });
    } catch (error: unknown) {
      throw new FontBuildError(
        'E_FONT_CONVERSION',
        `font conversion failed for ${asset.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (converted.missingCodePoints.length > 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'W_FONT_RANGE_GLYPHS_MISSING',
        message: `font ${asset.id} does not cover ${converted.missingCodePoints.length} configured range code point(s)`,
      });
    }
    const output = `fonts/${asset.codeName}.c`;
    files[output] = converted.cSource;
    const licenseText = typeof conv.licenseText === 'string' ? conv.licenseText.trim() : '';
    const licenseFile = `licenses/${asset.codeName}.txt`;
    const archivedLicense = [
      `Asset: ${asset.id}`,
      `SPDX-License-Identifier: ${license}`,
      ...(typeof conv.licenseUrl === 'string' && conv.licenseUrl.trim()
        ? [`Source: ${conv.licenseUrl.trim()}`] : []),
      ...(typeof conv.copyright === 'string' && conv.copyright.trim()
        ? [`Copyright: ${conv.copyright.trim()}`] : []),
      '',
      ...(licenseText ? [licenseText, ''] : []),
    ].join('\n');
    files[licenseFile] = archivedLicense;
    manifest.push({
      id: asset.id,
      codeName: asset.codeName,
      sha256: asset.sha256,
      output,
      sizePx: typeof conv.sizePx === 'number' ? conv.sizePx : 16,
      bpp: typeof conv.bpp === 'number' ? conv.bpp : 4,
      glyphCount: converted.glyphCount,
      requestedGlyphCount: converted.requestedGlyphCount,
      missingGlyphCount: converted.missingCodePoints.length,
      ranges: converted.ranges,
      autoCollectedGlyphCount: [...autoSymbols].length,
      collectedTextSha256: createHash('sha256').update(autoSymbols, 'utf8').digest('hex'),
      license,
      licenseFile,
      licenseFileSha256: createHash('sha256').update(archivedLicense, 'utf8').digest('hex'),
      licenseTextEmbedded: licenseText.length > 0,
      licenseUrl: typeof conv.licenseUrl === 'string' ? conv.licenseUrl : null,
      copyright: typeof conv.copyright === 'string' ? conv.copyright : null,
    });
  }
  return { files, manifest, diagnostics };
}

export async function executeBuild(request: WorkerRequest): Promise<WorkerResponse> {
  if (request.protocolVersion !== 1) throw new Error('unsupported worker protocol version');
  const { inputLock } = request;
  const display = inputLock.profiles.display.doc;
  const controller = inputLock.profiles.controller.doc;
  const snapshot: ProjectSnapshotV2 = {
    kind: 'lvgl-project-snapshot',
    snapshotVersion: 1,
    uiProject: inputLock.uiProject,
    displayProfile: display,
    controllerProfile: controller,
    buildTarget: inputLock.buildTarget,
    actionRegistry: inputLock.actionRegistry,
    migrationNotes: [],
    colorFormatConfirmed: true,
  };
  const project = snapshotToEditorProject(snapshot);
  const preview = compilePreview(project, { colorFormat: display.colorFormat });
  const previewDiagnostics = [...preview.diagnostics];
  if (preview.program) {
    previewDiagnostics.push(...validatePreviewProgramSupport(preview.program).map((issue) => ({
      severity: 'error' as const,
      code: issue.code,
      message: `${issue.path}: ${issue.message}`,
    })));
  }
  const emitted = emitC95(project, {
    target: request.target ?? 'esp-idf',
    colorFormat: display.colorFormat,
    buildTarget: inputLock.buildTarget,
    displayProfileRef: inputLock.profiles.display.ref as `display:${string}@${number}`,
  });
  const generatedManifestFile = emitted.files.find((file) => file.path === 'build-manifest.json');
  const generatorManifest = generatedManifestFile === undefined
    ? {}
    : JSON.parse(generatedManifestFile.content) as Record<string, unknown>;
  const diagnostics = [...emitted.diagnostics, ...previewDiagnostics];
  const unimplemented = generatorManifest.unimplementedActions;
  if (Array.isArray(unimplemented) && unimplemented.length > 0) {
    diagnostics.push({
      severity: 'error',
      code: 'E_UNIMPLEMENTED_ACTIONS',
      message: `formal build has unimplemented Actions: ${unimplemented.join(', ')}`,
    });
  }
  let fonts: Awaited<ReturnType<typeof convertFonts>> = { files: {}, manifest: [], diagnostics: [] };
  try {
    fonts = await convertFonts(request);
  } catch (error: unknown) {
    diagnostics.push({
      severity: 'error',
      code: error instanceof FontBuildError ? error.code : 'E_FONT_CONVERSION',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  diagnostics.push(...fonts.diagnostics);
  return {
    protocolVersion: 1,
    files: {
      ...Object.fromEntries(emitted.files.map((file) => [file.path, file.content])),
      ...fonts.files,
      ...(preview.program === null ? {} : {
        'preview/preview-program.json': `${JSON.stringify(preview.program, null, 2)}\n`,
      }),
    },
    diagnostics,
    generatorManifest: {
      ...generatorManifest,
      convertedAssets: fonts.manifest,
      preview: preview.program === null ? null : {
        protocolVersion: preview.program.protocolVersion,
        entrypoint: 'preview/index.html',
        program: 'preview/preview-program.json',
      },
    },
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const request = JSON.parse(await readStdin()) as WorkerRequest;
  process.stdout.write(`${JSON.stringify(await executeBuild(request))}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
