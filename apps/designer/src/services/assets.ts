/**
 * assets — 素材管线(设计器侧)。
 *
 * 流程(ARCHITECTURE §3.5):
 * - 上传:文件字节 → sha256 内容寻址存 IndexedDB 'assets' 表 →
 *   runtime.writeFile(MEMFS) + registerImage(名→ 'A:assets/<name>.<ext>')→
 *   工程 assets.images 数组(触发 L4 reloadAll,XML 里 imageRef 立即可解析)。
 * - 刷新/打开工程:resyncAssets() 等管线就绪后按 sha256 从 IndexedDB 重灌 + reloadAll。
 * - lottie json 同走本表(ImageAsset.kind='lottie'),注册值 = MEMFS 路径,
 *   自研 lv_lottie parser 经 lv_xml_get_image 解析到路径后 set_src_file。
 */
import type { FontAsset, ImageAsset, LvProject } from '@lvd/schema';
import type { AssetEntry } from '@lvd/schema/v2';
import type { LvglRuntimeApi } from '@lvd/lvgl-runtime';
import { ASSET_STORE, db } from './storage';
import { getPipeline } from '../canvas/reloadPipeline';
import { useProjectStore } from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';
import { apiUrl } from '../stores/authStore';

export interface AssetBlobRecord {
  bytes: ArrayBuffer;
  mime: string;
  fileName: string;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg']);
const LOTTIE_EXTS = new Set(['json']);
const FONT_EXTS = new Set(['ttf']);

export interface MaterialSymbolsSearchResult {
  source: 'material-symbols';
  sourcePage: string;
  license: 'Apache-2.0';
  icons: string[];
  total: number;
  offset: number;
  hasMore: boolean;
}

export interface MaterialSymbolImportOptions {
  name: string;
  sizePx: number;
  sourcePage?: string;
}

export function extOf(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i >= 0 ? fileName.slice(i + 1).toLowerCase() : '';
}

const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/**
 * Web Crypto is unavailable on plain-HTTP LAN origins in Chromium. Keep the
 * content-address verification intact there instead of silently accepting an
 * unchecked blob or treating every server asset as missing.
 */
export function sha256HexPortable(bytes: Uint8Array): string {
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15]!;
      const y = words[i - 2]!;
      const s0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const s1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[i] = (words[i - 16]! + s0 + words[i - 7]! + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i++) {
      const sum1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choose = (e! & f!) ^ (~e! & g!);
      const t1 = (h! + sum1 + choose + SHA256_ROUND_CONSTANTS[i]! + words[i]!) >>> 0;
      const sum0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const t2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d! + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }

    hash[0] = (hash[0]! + a!) >>> 0;
    hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0;
    hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0;
    hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0;
    hash[7] = (hash[7]! + h!) >>> 0;
  }

  return [...hash].map((value) => value.toString(16).padStart(8, '0')).join('');
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const buf = await subtle.digest('SHA-256', bytes as BufferSource);
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Some embedded browsers expose SubtleCrypto but reject digest on an
      // insecure origin. The portable implementation below covers that case.
    }
  }
  return sha256HexPortable(bytes);
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/* ---------------- IndexedDB 内容寻址 blob 表 ---------------- */

export async function putAssetBytes(sha: string, rec: AssetBlobRecord): Promise<void> {
  const d = await db();
  await d.put(ASSET_STORE, rec, sha);
  await uploadAssetToServer(sha, rec);
}

export async function getAssetBytes(sha: string): Promise<AssetBlobRecord | null> {
  const d = await db();
  const local = (await d.get(ASSET_STORE, sha)) as AssetBlobRecord | undefined;
  if (local) return local;
  const remote = await downloadAssetFromServer(sha);
  if (remote) await d.put(ASSET_STORE, remote, sha);
  return remote;
}

export async function searchMaterialSymbols(
  query = '',
  limit = 80,
  offset = 0,
): Promise<MaterialSymbolsSearchResult> {
  const params = new URLSearchParams({ query, limit: String(limit), offset: String(offset) });
  const response = await fetch(apiUrl(`api/lvgl/icon-library/material-symbols?${params}`), {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`图标素材库请求失败（HTTP ${response.status}）`);
  return response.json() as Promise<MaterialSymbolsSearchResult>;
}

export function materialSymbolSvgUrl(name: string): string {
  return apiUrl(`api/lvgl/icon-library/material-symbols/${encodeURIComponent(name)}.svg`);
}

export function materialSymbolCodeName(name: string, sizePx: number): string {
  const clean = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return `ic_${clean || 'symbol'}_${sizePx}`;
}

async function fetchMaterialSymbolSvg(name: string): Promise<string> {
  const response = await fetch(materialSymbolSvgUrl(name), {
    credentials: 'same-origin',
    headers: { accept: 'image/svg+xml' },
  });
  if (!response.ok) throw new Error(`图标 ${name} 下载失败（HTTP ${response.status}）`);
  const svg = await response.text();
  if (!svg.trimStart().startsWith('<svg')) throw new Error(`图标 ${name} 返回的不是 SVG`);
  return svg;
}

export async function rasterizeSvgToPng(svg: string, sizePx: number): Promise<Uint8Array> {
  if (!Number.isInteger(sizePx) || sizePx < 8 || sizePx > 300) {
    throw new Error('图标尺寸必须是 8–300 的整数');
  }
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('浏览器无法解析图标 SVG'));
      image.src = svgUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = sizePx;
    canvas.height = sizePx;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器不支持图标栅格化');
    context.clearRect(0, 0, sizePx, sizePx);
    context.drawImage(image, 0, 0, sizePx, sizePx);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('图标 PNG 生成失败');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

/**
 * IndexedDB remains the offline cache, while the platform CAS is the shared
 * source used by other browsers and the formal build worker. Network/auth
 * failures are non-fatal; the next cloud save retries referenced local blobs.
 */
async function uploadAssetToServer(sha: string, rec: AssetBlobRecord): Promise<boolean> {
  try {
    const res = await fetch(
      apiUrl(`api/lvgl/assets/${encodeURIComponent(sha)}?fileName=${encodeURIComponent(rec.fileName)}`),
      {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': rec.mime || 'application/octet-stream' },
        body: rec.bytes,
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function downloadAssetFromServer(sha: string): Promise<AssetBlobRecord | null> {
  try {
    const res = await fetch(apiUrl(`api/lvgl/assets/${encodeURIComponent(sha)}`), {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/octet-stream' },
    });
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    const actual = await sha256Hex(new Uint8Array(bytes));
    if (actual !== sha) return null;
    const encodedName = res.headers.get('x-asset-file-name');
    let fileName = sha;
    if (encodedName) {
      try { fileName = decodeURIComponent(encodedName); } catch { fileName = encodedName; }
    }
    return {
      bytes,
      mime: res.headers.get('content-type')?.split(';', 1)[0] || 'application/octet-stream',
      fileName,
    };
  } catch {
    return null;
  }
}

/** Retry uploading every locally available blob referenced by a project. */
export async function syncProjectAssetsToCloud(
  project: LvProject,
  iconSources: AssetEntry[] = [],
): Promise<{ uploaded: number; missing: string[] }> {
  let uploaded = 0;
  const missing: string[] = [];
  const d = await db();
  const assets = [
    ...project.assets.fonts.map((asset) => ({ name: asset.name, file: asset.file })),
    ...project.assets.images.map((asset) => ({ name: asset.name, file: asset.file })),
    ...iconSources.map((asset) => ({ name: asset.displayName ?? asset.codeName ?? asset.id, file: asset.file })),
  ];
  for (const asset of assets) {
    const rec = (await d.get(ASSET_STORE, asset.file.sha256)) as AssetBlobRecord | undefined;
    if (!rec) {
      missing.push(asset.name);
      continue;
    }
    if (await uploadAssetToServer(asset.file.sha256, rec)) uploaded++;
  }
  return { uploaded, missing };
}

/* ---------------- runtime 注册 ---------------- */

function memfsName(asset: ImageAsset): string {
  // MEMFS 文件名必须带扩展名(图片解码器按后缀分发)
  const ext = extOf(asset.file.fileName) || (asset.kind === 'lottie' ? 'json' : 'png');
  return `${asset.name}.${ext}`;
}

/** 单个素材注册进 runtime(写 MEMFS + registerImage;lottie 注册值即路径) */
export function registerAssetToRuntime(rt: LvglRuntimeApi, asset: ImageAsset, bytes: Uint8Array): void {
  const fn = memfsName(asset);
  rt.writeFile(`/assets/${fn}`, bytes);
  rt.registerImage(asset.name, `A:assets/${fn}`);
}

/** 工程全部素材重灌(启动/打开工程);返回缺 blob 的素材名 */
export async function syncProjectAssetsToRuntime(
  rt: LvglRuntimeApi,
  project: LvProject,
): Promise<{ registered: number; missing: string[] }> {
  let registered = 0;
  const missing: string[] = [];
  for (const asset of project.assets.fonts) {
    const rec = await getAssetBytes(asset.file.sha256);
    if (!rec) {
      missing.push(asset.name);
      continue;
    }
    try {
      rt.registerFontTinyTtf(asset.name, new Uint8Array(rec.bytes), asset.sizePx ?? 16);
      registered++;
    } catch (e) {
      console.warn('[assets] 注册字体失败', asset.name, e);
      missing.push(asset.name);
    }
  }
  for (const asset of project.assets.images) {
    const rec = await getAssetBytes(asset.file.sha256);
    if (!rec) {
      missing.push(asset.name);
      continue;
    }
    try {
      registerAssetToRuntime(rt, asset, new Uint8Array(rec.bytes));
      registered++;
    } catch (e) {
      console.warn('[assets] 注册素材失败', asset.name, e);
      missing.push(asset.name);
    }
  }
  return { registered, missing };
}

/**
 * Prepare assets before publishing a project to projectStore. Project loads
 * notify the preview pipeline synchronously, so remote fonts/images must be
 * registered first to avoid a transient failed build and blank canvas.
 */
export async function primeProjectAssets(project: LvProject): Promise<void> {
  const assets = [...project.assets.fonts, ...project.assets.images];
  if (assets.length === 0) return;
  const p = getPipeline();
  if (p) {
    await syncProjectAssetsToRuntime(p.runtime, project);
    return;
  }
  // CanvasStage may still be booting. Populate IndexedDB now so its initial
  // runtime registration does not need to wait for the network.
  const uniqueShas = new Set(assets.map((asset) => asset.file.sha256));
  await Promise.all([...uniqueShas].map((sha) => getAssetBytes(sha)));
}

/** 等管线就绪后重灌素材并 reloadAll(打开工程/启动恢复用) */
export async function resyncAssets(): Promise<void> {
  for (let i = 0; i < 300; i++) {
    const p = getPipeline();
    if (p) {
      const project = useProjectStore.getState().project;
      if (project.assets.images.length === 0 && project.assets.fonts.length === 0) return;
      const { registered, missing } = await syncProjectAssetsToRuntime(p.runtime, project);
      if (missing.length > 0) {
        useEditorStore.getState().setBanner(`素材缺失(本地缓存与平台 CAS 均无内容):${missing.join(', ')}`);
      }
      if (registered > 0) p.reloadAllNow();
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/* ---------------- 上传 ---------------- */

/** 文件名 → 合法 CName 素材名(小写、[a-z0-9_]、字母开头) */
function sanitizeAssetName(fileName: string, kind: 'image' | 'lottie' | 'font'): string {
  const base = fileName.replace(/\.[^.]*$/, '');
  let name = base
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(name)) {
    const prefix = kind === 'lottie' ? 'anim' : kind === 'font' ? 'font' : 'img';
    name = `${prefix}${name ? `_${name}` : ''}`;
  }
  return name;
}

function uniqueAssetName(base: string, project: LvProject): string {
  const used = new Set<string>([
    ...project.assets.images.map((a) => a.name),
    ...project.assets.fonts.map((f) => f.name),
  ]);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/**
 * Freeze one catalogue icon into the project.
 *
 * The original SVG is retained in assets.icons for provenance/portability;
 * the browser-generated transparent PNG is an assets.images derivative used
 * by the existing LVGL preview and deterministic A8 build pipeline.
 */
export async function importMaterialSymbol(options: MaterialSymbolImportOptions): Promise<string> {
  const { name, sizePx } = options;
  if (!/^[a-z0-9][a-z0-9_]*$/.test(name)) throw new Error('Material Symbols 图标名称不合法');
  if (!Number.isInteger(sizePx) || sizePx < 8 || sizePx > 300) {
    throw new Error('图标尺寸必须是 8–300 的整数');
  }
  const iconId = `icon:material-symbols:${name}:${sizePx}`;
  const state = useProjectStore.getState();
  const existingIcon = state.uiProject.assets.icons.find((item) => item.id === iconId);
  if (existingIcon) {
    const derivative = state.uiProject.assets.images.find((item) => item.conv?.sourceIconId === iconId);
    return derivative?.codeName ?? materialSymbolCodeName(name, sizePx);
  }

  const svg = await fetchMaterialSymbolSvg(name);
  const sourceBytes = new TextEncoder().encode(svg);
  const pngBytes = await rasterizeSvgToPng(svg, sizePx);
  const sourceSha = await sha256Hex(sourceBytes);
  const pngSha = await sha256Hex(pngBytes);
  const sourceFileName = `material-${name}.svg`;
  const pngFileName = `material-${name}-${sizePx}.png`;
  await putAssetBytes(sourceSha, {
    bytes: ownedArrayBuffer(sourceBytes),
    mime: 'image/svg+xml',
    fileName: sourceFileName,
  });
  await putAssetBytes(pngSha, {
    bytes: ownedArrayBuffer(pngBytes),
    mime: 'image/png',
    fileName: pngFileName,
  });

  const project = useProjectStore.getState().project;
  const codeName = uniqueAssetName(materialSymbolCodeName(name, sizePx), project);
  const imageAsset: ImageAsset = {
    name: codeName,
    kind: 'image',
    file: { fileName: pngFileName, sha256: pngSha, byteSize: pngBytes.byteLength },
    conv: { colorFormat: 'A8' },
  };
  const pipeline = getPipeline();
  if (pipeline) registerAssetToRuntime(pipeline.runtime, imageAsset, pngBytes);

  useProjectStore.getState().mutateV2(`导入 Material Symbols ${name}`, (draft) => {
    draft.assets.icons.push({
      id: iconId,
      displayName: name,
      file: { fileName: sourceFileName, sha256: sourceSha, byteSize: sourceBytes.byteLength },
      conv: {
        source: 'material-symbols',
        sourcePage: options.sourcePage ?? 'http://192.168.1.38/pages/tools/material-symbols/',
        iconName: name,
        sizePx,
        colorFormat: 'A8',
        license: 'Apache-2.0',
      },
    });
    draft.assets.images.push({
      id: `image:${codeName}`,
      codeName,
      displayName: `${name} ${sizePx}px`,
      file: imageAsset.file,
      conv: {
        colorFormat: 'A8',
        kind: 'image',
        sourceIconId: iconId,
        sourceSha256: sourceSha,
      },
    });
  });
  if (pipeline) pipeline.reloadAllNow();
  return codeName;
}

/**
 * 导入素材文件(png/jpg → image,json → lottie,ttf → font)。
 * 先注册 runtime,再 mutate 工程(L4 reloadAll 时 imageRef 已可解析)。
 * @returns 实际导入的素材名列表
 */
export async function importAssetFiles(files: Iterable<File>): Promise<string[]> {
  const ed = useEditorStore.getState();
  const imported: string[] = [];
  for (const file of files) {
    const ext = extOf(file.name);
    const kind: 'image' | 'lottie' | 'font' | null = IMAGE_EXTS.has(ext)
      ? 'image'
      : LOTTIE_EXTS.has(ext)
        ? 'lottie'
        : FONT_EXTS.has(ext)
          ? 'font'
          : null;
    if (!kind) {
      ed.setBanner(`不支持的素材类型:${file.name}(仅 png/jpg/lottie json/ttf)`);
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha = await sha256Hex(bytes);
    await putAssetBytes(sha, {
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      mime: file.type || (kind === 'lottie'
        ? 'application/json'
        : kind === 'font'
          ? 'font/ttf'
          : `image/${ext === 'jpg' ? 'jpeg' : ext}`),
      fileName: file.name,
    });

    const project = useProjectStore.getState().project;
    const name = uniqueAssetName(sanitizeAssetName(file.name, kind), project);
    const fileRef = { fileName: file.name, sha256: sha, byteSize: bytes.byteLength };
    const asset: ImageAsset | FontAsset = kind === 'font'
      ? {
          name,
          file: fileRef,
          loader: 'tiny_ttf',
          sizePx: 16,
          conv: { bpp: 4, ranges: '0x20-0x7e', autoCollect: true, license: 'UNSPECIFIED' },
        }
      : {
          name,
          kind,
          file: fileRef,
          conv: { colorFormat: 'ARGB8888' },
        };

    const p = getPipeline();
    if (p) {
      try {
        if (kind === 'font') {
          p.runtime.registerFontTinyTtf(name, bytes, (asset as FontAsset).sizePx ?? 16);
        } else {
          registerAssetToRuntime(p.runtime, asset as ImageAsset, bytes);
        }
      } catch (e) {
        ed.setBanner(`素材注册失败:${file.name} — ${(e as Error).message}`);
        continue;
      }
    }
    useProjectStore.getState().mutateV2(`导入素材 ${name}`, (draft) => {
      const entry: AssetEntry = kind === 'font'
        ? {
            id: `font:${name}`,
            codeName: name,
            file: fileRef,
            conv: {
              loader: (asset as FontAsset).loader,
              sizePx: (asset as FontAsset).sizePx ?? 16,
              ...((asset as FontAsset).conv ?? {}),
            },
          }
        : {
            id: `image:${name}`,
            codeName: name,
            file: fileRef,
            conv: {
              ...((asset as ImageAsset).kind ? { kind: (asset as ImageAsset).kind! } : {}),
              ...(asset as ImageAsset).conv,
            },
          };
      if (kind === 'font') draft.assets.fonts.push(entry);
      else draft.assets.images.push(entry);
    });
    imported.push(name);
  }
  return imported;
}

/** 从工程移除素材(blob 留在内容寻址库,可被其它工程/再次导入复用) */
export function removeAsset(name: string): void {
  useProjectStore.getState().mutateV2(`删除素材 ${name}`, (draft) => {
    const removedIconIds = new Set(draft.assets.icons
      .filter((asset) => asset.codeName === name || asset.id === name)
      .map((asset) => asset.id));
    draft.assets.images = draft.assets.images.filter((asset) =>
      asset.codeName !== name
      && asset.id !== name
      && !(typeof asset.conv?.sourceIconId === 'string' && removedIconIds.has(asset.conv.sourceIconId)));
    draft.assets.fonts = draft.assets.fonts.filter((asset) => asset.codeName !== name);
    draft.assets.icons = draft.assets.icons.filter((asset) => asset.codeName !== name && asset.id !== name);
  });
}

/* ---------------- 缩略图(object URL 按 sha 缓存) ---------------- */

const thumbCache = new Map<string, string>();

export async function thumbUrlForEntry(
  file: { sha256: string },
): Promise<string | null> {
  const cached = thumbCache.get(file.sha256);
  if (cached) return cached;
  const rec = await getAssetBytes(file.sha256);
  if (!rec) return null;
  const url = URL.createObjectURL(new Blob([rec.bytes], { type: rec.mime }));
  thumbCache.set(file.sha256, url);
  return url;
}

export async function thumbUrlFor(asset: ImageAsset): Promise<string | null> {
  if ((asset.kind ?? 'image') !== 'image') return null;
  return thumbUrlForEntry(asset.file);
}
