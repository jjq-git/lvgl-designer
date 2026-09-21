/**
 * @lvd/compiler-core — Schema/Registry 到稳定 IR 的纯函数边界。
 *
 * 这个包不依赖 Preview runtime、XML 或 C codegen。
 * Preview Compiler 与各版本 C emitter 只能通过此处共享 lowering 结果。
 */
export type { Diagnostic } from './diagnostics.js';
export * from './types.js';
export { normalizeProject, anonPreviewName, type NormalizeResult } from './normalize.js';
