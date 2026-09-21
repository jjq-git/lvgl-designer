/**
 * exportZip — emitC95 → fflate zip 下载 ui.zip;保存/打开 .lvproj.json。
 */
import { zipSync, strToU8 } from 'fflate';
import type { LvProject } from '@lvd/schema';
import {
  collectProjectTextSymbolsByFont,
  convertFontToLvglC,
  findMissingFontCodePoints,
} from '@lvd/asset-pipeline';
import { createWebUiExport, WebUiDocumentError } from '@lvd/schema/v2';
import { emitC95 } from './codegen/adapter';
import { getAssetBytes, resyncAssets } from './assets';
import { useProjectStore } from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';
import { useBuildTargetStore, validateReleaseTarget } from '../stores/buildTargetStore';
import { createStoredProjectDocument, loadProjectDocument } from './projectPersistence';

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function formatCodePoint(point: number): string {
  return `U+${point.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** 把工程字体转换为可直接参与编译的 C 文件，并归档许可证信息。 */
async function exportFontFiles(project: LvProject): Promise<{
  files: Record<string, Uint8Array>;
  warnings: string[];
}> {
  const files: Record<string, Uint8Array> = {};
  const warnings: string[] = [];
  const collectedByFont = collectProjectTextSymbolsByFont(project);
  for (const font of project.assets.fonts) {
    const license = font.conv?.license?.trim() ?? '';
    if (!license || license === 'UNSPECIFIED') {
      throw new Error(`字体 ${font.name} 缺少许可证标识（例如 OFL-1.1）`);
    }
    const record = await getAssetBytes(font.file.sha256);
    if (!record) throw new Error(`字体 ${font.name} 的文件内容缺失`);
    const bytes = new Uint8Array(record.bytes);
    const autoSymbols = font.conv?.autoCollect === false ? '' : (
      collectedByFont[font.name] ?? collectedByFont[`font:${font.name}`] ?? ''
    );
    const symbols = `${font.conv?.symbols ?? ''}${autoSymbols}`;
    const usedCodePoints = [...new Set([...symbols].map((symbol) => symbol.codePointAt(0)!))];
    const missingUsed = usedCodePoints.length === 0
      ? []
      : await findMissingFontCodePoints(bytes, usedCodePoints);
    if (missingUsed.length > 0) {
      const preview = missingUsed.slice(0, 12).map(formatCodePoint).join(', ');
      throw new Error(
        `字体 ${font.name} 缺少工程正在使用的 ${missingUsed.length} 个字形：${preview}`,
      );
    }
    const converted = await convertFontToLvglC(bytes, {
      codeName: font.name,
      sizePx: font.sizePx ?? 16,
      bpp: font.conv?.bpp ?? 4,
      ranges: font.conv?.ranges,
      symbols,
    });
    files[`fonts/${font.name}.c`] = strToU8(converted.cSource);
    files[`licenses/${font.name}.txt`] = strToU8([
      `Asset: ${font.name}`,
      `SPDX-License-Identifier: ${license}`,
      ...(font.conv?.licenseUrl?.trim() ? [`Source: ${font.conv.licenseUrl.trim()}`] : []),
      ...(font.conv?.copyright?.trim() ? [`Copyright: ${font.conv.copyright.trim()}`] : []),
      '',
      ...(font.conv?.licenseText?.trim() ? [font.conv.licenseText.trim(), ''] : []),
    ].join('\n'));
    if (converted.missingCodePoints.length > 0) {
      warnings.push(`${font.name} 配置范围有 ${converted.missingCodePoints.length} 个字形缺失`);
    }
  }
  return { files, warnings };
}

/** 导出精确面向 LVGL 9.5.0 的 C 代码 zip。 */
export async function exportUiZip(project: LvProject): Promise<boolean> {
  const ed = useEditorStore.getState();
  const target = useBuildTargetStore.getState();
  target.syncProject(project);
  const currentTarget = useBuildTargetStore.getState();
  const readiness = validateReleaseTarget(currentTarget);
  if (!readiness.ready || readiness.buildTarget === null) {
    ed.setBanner(`导出失败：${readiness.errors.map((issue) => issue.message).join('；')}`);
    return false;
  }
  const res = emitC95(project, {
    colorFormat: currentTarget.displayProfile.colorFormat,
    buildTarget: readiness.buildTarget,
    displayProfileRef: currentTarget.uiProject.designDisplayRef,
  });
  if (!res) {
    ed.setBanner('导出不可用:@lvd/codegen 尚未提供 emitC95');
    return false;
  }
  const errors = res.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) {
    ed.setBanner(`导出失败:${errors.map((e) => e.message).join(';')}`);
    return false;
  }
  const files: Record<string, Uint8Array> = {};
  for (const f of res.files) {
    // 说明:actions.c 由 codegen 只生成一次(write-if-absent 语义);zip 每次全量打包,
    // 用户工程里如已有 actions.c,解压时请自行跳过覆盖(文件头注释同样声明)。
    files[f.path] = strToU8(f.content);
  }
  try {
    const fonts = await exportFontFiles(project);
    Object.assign(files, fonts.files);
    const zipped = zipSync(files);
    const buf = new Uint8Array(zipped.length);
    buf.set(zipped);
    download('ui-lvgl-9.5.0.zip', new Blob([buf.buffer], { type: 'application/zip' }));
    ed.setBanner(fonts.warnings.length > 0 ? `导出完成；${fonts.warnings.join('；')}` : null);
    return true;
  } catch (error) {
    ed.setBanner(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export function saveProjectFile(project: LvProject): void {
  const json = JSON.stringify(createStoredProjectDocument(project), null, 2);
  download(`${project.meta.name || 'untitled'}.lvproj.json`, new Blob([json], { type: 'application/json' }));
}

/** 导出供 IoT 后端入库、前端安全 Renderer 消费的 WebUiDocumentV1。 */
export async function exportWebUiJson(project: LvProject): Promise<boolean> {
  const ed = useEditorStore.getState();
  try {
    const result = await createWebUiExport(
      createStoredProjectDocument(project),
      async (asset) => {
        const record = await getAssetBytes(asset.sha256);
        return record === null ? null : new Uint8Array(record.bytes);
      },
    );
    download(result.fileName, new Blob([result.json], { type: 'application/json;charset=utf-8' }));
    ed.setBanner(`网页 UI JSON 已导出；SHA-256: ${result.sha256}`);
    return true;
  } catch (error) {
    const detail = error instanceof WebUiDocumentError
      ? error.issues.map((issue) => `${issue.path}(${issue.code}): ${issue.message}`).join('；')
      : (error as Error).message;
    ed.setBanner(`网页 UI JSON 导出失败：${detail}`);
    return false;
  }
}

/** 打开 .lvproj.json(文件选择器) */
export function openProjectFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.lvproj.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const raw: unknown = JSON.parse(await file.text());
      const { project, validation } = loadProjectDocument(raw);
      useProjectStore.getState().loadProject(project);
      void resyncAssets(); // 素材按 sha256 从本机内容寻址库重灌
      const ed = useEditorStore.getState();
      const home = project.screens.find((s) => s.isHome) ?? project.screens[0];
      if (home) ed.setActiveScreen(home.id);
      const warns = validation.warnings.length;
      ed.setBanner(warns ? `工程已打开(${warns} 条警告)` : null);
    } catch (e) {
      useEditorStore.getState().setBanner(`打开工程失败:${(e as Error).message}`);
    }
  };
  input.click();
}
