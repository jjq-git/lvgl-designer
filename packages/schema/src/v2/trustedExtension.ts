/**
 * Schema v2 —— Trusted Extension(方案 §8)。
 *
 * 普通 UI Project 禁止任意 C 片段。确实无法建模的代码进入**独立**的 trusted extension manifest:
 *  - 与 UiProject 分文件存放,普通工程导入路径不得携带它;
 *  - 仅开发者可写,构建时要求权限、内容哈希和人工审查记录;
 *  - **AI Operations 永远不暴露它**。
 *
 * 注意(阶段 0 结论):v1 的 cPatch 用途几乎全是为绕开 XML 的表达限制
 * (calendar 高亮日期、chart scatter X 坐标、arc change_rate/knob_offset)。
 * 去 XML 后这些都能直接调 setter 并建模为 typed property —— 迁移时应优先补 registry,
 * 而不是把它们统统塞进本 manifest。见 docs/preview-architecture.md §5。
 */
import type { BizId } from './uiProject.js';

export interface TrustedPatch {
  /** 目标节点的业务 id */
  nodeId: BizId;
  /** 所属 screen/component 的业务 id,便于定位 */
  ownerId: BizId;
  /** 对象创建 + 属性设置完成后插入的 C 片段,$obj 为对象表达式占位符 */
  post: string;
  /**
   * 片段内容的 sha256,构建时比对,防止绕过审查改内容。
   * 迁移器只在调用方提供 hash 函数时填充(schema 包不引入哈希实现,也不做异步 Web Crypto)。
   */
  sha256?: string;
  /** 人工审查记录;未审查的片段不得进入发布构建 */
  review?: { by: string; at: string; note?: string };
}

export interface TrustedExtensionManifest {
  schemaVersion: 1;
  kind: 'trusted-extension';
  /** 关联的 UiProject 业务 id */
  uiProjectId: BizId;
  patches: TrustedPatch[];
}

/** 是否可进入发布构建:每个片段都有内容哈希**且**有人工审查记录 */
export function isReleaseReady(m: TrustedExtensionManifest): boolean {
  return m.patches.every((p) => p.review !== undefined && typeof p.sha256 === 'string' && p.sha256.length > 0);
}
