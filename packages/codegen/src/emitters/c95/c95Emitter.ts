/** LVGL 9.5.0 C emitter：复用中立 IR 与已对账的 registry C 模板。 */
import { normalizeProject, type Diagnostic, type IRProject } from '@lvd/compiler-core';
import type { LvProject } from '@lvd/schema';
import {
  emitCForVersionFromIr,
  type CEmitResult, type EmitC94Options,
} from '../c94/c94Emitter.js';

export type EmitC95Options = EmitC94Options;

export function emitC95FromIr(
  ir: IRProject,
  diagnostics: Diagnostic[],
  options?: EmitC95Options,
): CEmitResult {
  return emitCForVersionFromIr(ir, diagnostics, '9.5.0', options);
}

export function emitC95(project: LvProject, options?: EmitC95Options): CEmitResult {
  const { ir, diagnostics } = normalizeProject(project);
  return emitC95FromIr(ir, diagnostics, options);
}
