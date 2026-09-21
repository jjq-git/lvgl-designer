/**
 * @lvd/codegen 契约类型(ARCHITECTURE §3.6 + 任务契约)。
 * codegen 包落地后应导出同形 API;这里只做本地类型面,供 adapter 做运行时探测。
 */
import type { LvProject } from '@lvd/schema';
import type { BuildTarget, ColorFormat, DisplayRef } from '@lvd/schema/v2';

export interface Diagnostic {
  severity: 'error' | 'warning';
  code?: string;
  message: string;
  nodeId?: string;
}

export interface XmlScreenOut {
  name: string;
  xml: string;
  lineMap: { line: number; nodeId: string }[];
  previewNameToId: Record<string, string>;
}

export interface EmitXmlResult {
  globalsXml: string;
  screens: XmlScreenOut[];
  diagnostics: Diagnostic[];
}

export interface EmitCResult {
  files: { path: string; content: string }[];
  diagnostics: Diagnostic[];
}

export interface EmitCOptions {
  target?: 'esp-idf' | 'cmake' | 'bare';
  colorFormat?: ColorFormat;
  buildTarget?: BuildTarget;
  displayProfileRef?: DisplayRef;
}

export type EmitXmlFn = (project: LvProject) => EmitXmlResult;
export type EmitCFn = (project: LvProject, options?: EmitCOptions) => EmitCResult;

/** @deprecated 仅供存量调用编译，新导出统一用 EmitCResult/EmitCFn。 */
export type EmitC94Result = EmitCResult;
/** @deprecated 仅供存量调用编译。 */
export type EmitC94Fn = EmitCFn;
