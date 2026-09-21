/**
 * @lvd/codegen — 纯函数代码生成(Node/浏览器双端)。
 * 跨包契约见 docs/ARCHITECTURE.md §3.6 与 design/03,禁止私改:
 * - emitXml(project): { globalsXml; screens: {name; xml; lineMap; previewNameToId}[]; diagnostics }
 *   每个节点强制输出 name('_x'+id.replace(/-/g,'').slice(0,8) 兜底)
 * - emitC94(project, options?): { files: {path,content,overwrite?}[]; diagnostics }
 * - emitC95(project, options?): 同一 IR 生成精确钉死 LVGL 9.5.0 的发布产物
 *   src/ui/ 布局,actions 分文件+UI_WEAK(actions.c 标 overwrite:false),
 *   set_name 包 #if LV_USE_OBJ_NAME 守卫(R8 定案);
 *   options.target: 'esp-idf'(默认)|'cmake'|'bare' 决定构建文件形态,
 *   三种目标都额外产出 REQUIREMENTS.txt + INTEGRATION.md
 */

// IR / normalize(Preview 与各 emitter 共享的中立包;此处仅作向后兼容转发)
export type { Diagnostic } from '@lvd/compiler-core';
export * from '@lvd/compiler-core';

// XML emitter(预览通道)
export {
  emitXml, emitXmlFromIr,
  type XmlEmitResult, type XmlScreenResult,
} from './emitters/xml/xmlEmitter.js';

// C 9.4 emitter(导出物)
export {
  emitC94, emitC94FromIr, emitCForVersionFromIr,
  type CEmitResult, type CEmitterVersion, type CTarget, type EmitC94Options, type GeneratedFile,
} from './emitters/c94/c94Emitter.js';
export {
  emitC95, emitC95FromIr, type EmitC95Options,
} from './emitters/c95/c95Emitter.js';
export {
  collectRequirements, requirementsTxt, integrationMd,
  type LvglCVersion, type Requirements,
} from './emitters/c94/requirements.js';
