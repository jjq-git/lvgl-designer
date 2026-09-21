import type {
  Diagnostic, IRBinding, IREvent, IRNamedStyle,
} from '@lvd/compiler-core';
import type {
  ConstDef, FontAsset, ImageAsset, InlineStyleGroup,
  ObjFlagKey, ObjStateKey, PropValue, SubjectDef,
} from '@lvd/schema';
import type { ColorFormat } from '@lvd/schema/v2';

/**
 * Preview runtime 只接受这份 POD 协议。协议里刻意没有 XML tag/attr，
 * 也没有 cCreate/c.setter 等 C 模板。
 */
export interface PreviewProgram {
  protocolVersion: 1;
  display: {
    width: number;
    height: number;
    colorFormat: ColorFormat;
  };
  globals: {
    consts: ConstDef[];
    styles: IRNamedStyle[];
    subjects: SubjectDef[];
    fonts: FontAsset[];
    images: ImageAsset[];
  };
  screens: PreviewScreen[];
  homeScreenName: string;
  /** screen name → runtime object name → JSON node id */
  runtimeNameToNodeId: Record<string, Record<string, string>>;
}

export interface PreviewScreen {
  id: string;
  name: string;
  consts: ConstDef[];
  styles: IRNamedStyle[];
  root: PreviewNode;
}

export interface PreviewNode {
  id: string;
  type: string;
  runtimeName: string;
  named: boolean;
  kind: 'widget' | 'add' | 'getter' | 'virtual';
  useObjBase: boolean;
  /** 已补齐 registry default 的构造/寻址参数。 */
  createProps: Record<string, PropValue>;
  /** 不含 createProps；driver 按 type+key 调用受控 setter。 */
  props: Record<string, PropValue>;
  flags: [ObjFlagKey, boolean][];
  states: [ObjStateKey, boolean][];
  inlineStyles: InlineStyleGroup[];
  styleUses: { styleName: string; selector?: InlineStyleGroup['selector'] }[];
  bindings: IRBinding[];
  events: IREvent[];
  children: PreviewNode[];
}

export interface CompilePreviewOptions {
  /**
   * v1 colorDepth=16 无法区分 RGB565/RGB565_SWAPPED，必须由 DisplayProfile
   * 或用户显式传入。24/32 可确定性映射。
   */
  colorFormat?: ColorFormat;
  /**
   * Preview host 的实际 framebuffer 格式，不代表或确认固件目标格式。
   * 例如预览 host 可以用 XRGB8888 预览一个尚未确认 RGB565/
   * RGB565_SWAPPED 的 v1 工程；发布构建仍必须完成 colorFormat 确认。
   */
  runtimeColorFormat?: ColorFormat;
}

export interface CompilePreviewResult {
  program: PreviewProgram | null;
  diagnostics: Diagnostic[];
}
