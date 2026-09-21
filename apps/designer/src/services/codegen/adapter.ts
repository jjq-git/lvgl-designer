/**
 * @lvd/codegen 运行时探测 adapter。
 *
 * 背景:designer 与 codegen 并行开发;本文件对 codegen 的导出做运行时探测,
 * emitXml 缺失时回落到本地兜底 emitter(localEmitXml,契约同形),
 * emitC95 缺失时返回 null(导出按钮给出提示)。
 */
import * as codegenMod from '@lvd/codegen';
import type { LvProject } from '@lvd/schema';
import { localEmitXml } from './localEmitXml';
import type { EmitCFn, EmitCOptions, EmitCResult, EmitXmlFn, EmitXmlResult } from './types';

const cg = codegenMod as unknown as Partial<{
  emitXml: EmitXmlFn;
  emitC94: EmitCFn;
  emitC95: EmitCFn;
}>;

export const usingFallbackEmitXml = typeof cg.emitXml !== 'function';

export function emitXml(project: LvProject): EmitXmlResult {
  if (typeof cg.emitXml === 'function') return cg.emitXml(project);
  return localEmitXml(project);
}

/** 正式发布入口：固定使用 LVGL 9.5.0 emitter。 */
export function emitC95(project: LvProject, options?: EmitCOptions): EmitCResult | null {
  if (typeof cg.emitC95 === 'function') return cg.emitC95(project, options);
  return null;
}

/** @deprecated 仅供需要复现 9.4 存量产物的内部工具使用。 */
export function emitC94(project: LvProject, options?: EmitCOptions): EmitCResult | null {
  if (typeof cg.emitC94 === 'function') return cg.emitC94(project, options);
  return null;
}
