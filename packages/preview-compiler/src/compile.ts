import {
  normalizeProject,
  type Diagnostic, type IRNode, type IRProject,
} from '@lvd/compiler-core';
import { OBJ_BASE, type LvProject, type PropSpec, type PropValue } from '@lvd/schema';
import type { ColorFormat } from '@lvd/schema/v2';
import type {
  CompilePreviewOptions, CompilePreviewResult, PreviewNode, PreviewProgram,
} from './types.js';

function resolveColorFormat(
  project: LvProject,
  requested: ColorFormat | undefined,
  diagnostics: Diagnostic[],
): ColorFormat | null {
  const depth = project.display.colorDepth;
  if (requested === undefined) {
    if (depth === 16) {
      diagnostics.push({
        severity: 'error',
        code: 'E_COLOR_FORMAT_CONFIRM_REQUIRED',
        message: 'v1 colorDepth=16 无法区分 RGB565 与 RGB565_SWAPPED，必须由 DisplayProfile 显式确认',
      });
      return null;
    }
    return depth === 24 ? 'RGB888' : 'XRGB8888';
  }

  const compatible = depth === 16
    ? requested === 'RGB565' || requested === 'RGB565_SWAPPED'
    : depth === 24
      ? requested === 'RGB888'
      : requested === 'XRGB8888' || requested === 'ARGB8888';
  if (!compatible) {
    diagnostics.push({
      severity: 'error',
      code: 'E_COLOR_FORMAT_DEPTH_MISMATCH',
      message: `v1 colorDepth=${depth} 与显式 colorFormat=${requested} 不兼容`,
    });
    return null;
  }
  return requested;
}

function compileNode(
  node: IRNode,
  diagnostics: Diagnostic[],
  names: Record<string, string>,
): PreviewNode {
  names[node.previewName] = node.id;

  if (node.cPatch?.post) {
    diagnostics.push({
      severity: 'error',
      code: 'E_CPATCH_FORBIDDEN',
      message: 'Preview 协议禁止 cPatch；请改为 typed property',
      nodeId: node.id,
    });
  }

  const createProps: Record<string, PropValue> = {};
  const createKeys = new Set<string>();
  for (const spec of node.createPropSpecs) {
    createKeys.add(spec.key);
    const value = node.props[spec.key] ?? spec.default;
    if (value !== undefined) createProps[spec.key] = value;
  }

  const props: Record<string, PropValue> = {};
  const append = (key: string): void => {
    const value = node.props[key];
    if (!createKeys.has(key) && value !== undefined) props[key] = value;
  };
  const appendSpec = (spec: PropSpec): void => {
    append(spec.key);
    for (const companion of spec.companions ?? []) append(companion.key);
  };
  // Preview bridge 的部分 setter 有顺序依赖（例如 qrcode: size 必须先于 data）。
  // 按 registry 顺序固化协议，不能依赖用户 JSON 中对象键的插入顺序。
  if (node.useObjBase) OBJ_BASE.props.forEach(appendSpec);
  node.ownPropSpecs.forEach(appendSpec);
  for (const key of Object.keys(node.props)) {
    if (!Object.prototype.hasOwnProperty.call(props, key)) append(key);
  }

  return {
    id: node.id,
    type: node.type,
    runtimeName: node.previewName,
    named: node.named,
    kind: node.childKind ?? 'widget',
    useObjBase: node.useObjBase,
    createProps,
    props,
    flags: node.flags,
    states: node.states,
    inlineStyles: node.inlineStyles,
    styleUses: node.styleUses,
    bindings: node.bindings,
    events: node.events,
    children: node.children.map((child) => compileNode(child, diagnostics, names)),
  };
}

function compileProgram(
  ir: IRProject,
  colorFormat: ColorFormat,
  diagnostics: Diagnostic[],
): PreviewProgram {
  const runtimeNameToNodeId: Record<string, Record<string, string>> = {};
  const screens = ir.screens.map((screen) => {
    const names: Record<string, string> = {};
    runtimeNameToNodeId[screen.name] = names;
    return {
      id: screen.id,
      name: screen.name,
      consts: screen.consts,
      styles: screen.styles,
      root: compileNode(screen.root, diagnostics, names),
    };
  });

  return {
    protocolVersion: 1,
    display: { width: ir.display.width, height: ir.display.height, colorFormat },
    globals: {
      consts: ir.consts,
      styles: ir.styles,
      subjects: ir.subjects,
      fonts: ir.fonts,
      images: ir.images,
    },
    screens,
    homeScreenName: ir.homeScreenName,
    runtimeNameToNodeId,
  };
}

export function compilePreview(
  project: LvProject,
  options: CompilePreviewOptions = {},
): CompilePreviewResult {
  const normalized = normalizeProject(project);
  const diagnostics = [...normalized.diagnostics];
  const colorFormat = options.runtimeColorFormat
    ?? resolveColorFormat(project, options.colorFormat, diagnostics);
  if (colorFormat === null) return { program: null, diagnostics };

  const program = compileProgram(normalized.ir, colorFormat, diagnostics);
  if (diagnostics.some((d) => d.severity === 'error')) return { program: null, diagnostics };
  return { program, diagnostics };
}
