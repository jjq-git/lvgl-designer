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

export function extOf(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i >= 0 ? fileName.slice(i + 1).toLowerCase() : '';
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
): Promise<{ uploaded: number; missing: string[] }> {
  let uploaded = 0;
  const missing: string[] = [];
  const d = await db();
  for (const asset of [...project.assets.fonts, ...project.assets.images]) {
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
    if (!await getAssetBytes(asset.file.sha256)) missing.push(asset.name);
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
          loader: 'bin',
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
    if (p && kind !== 'font') {
      try {
        registerAssetToRuntime(p.runtime, asset as ImageAsset, bytes);
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
    draft.assets.images = draft.assets.images.filter((asset) => asset.codeName !== name);
    draft.assets.fonts = draft.assets.fonts.filter((asset) => asset.codeName !== name);
    draft.assets.icons = draft.assets.icons.filter((asset) => asset.codeName !== name && asset.id !== name);
  });
}

/* ---------------- 缩略图(object URL 按 sha 缓存) ---------------- */

const thumbCache = new Map<string, string>();

export async function thumbUrlFor(asset: ImageAsset): Promise<string | null> {
  if ((asset.kind ?? 'image') !== 'image') return null;
  const cached = thumbCache.get(asset.file.sha256);
  if (cached) return cached;
  const rec = await getAssetBytes(asset.file.sha256);
  if (!rec) return null;
  const url = URL.createObjectURL(new Blob([rec.bytes], { type: rec.mime }));
  thumbCache.set(asset.file.sha256, url);
  return url;
}
