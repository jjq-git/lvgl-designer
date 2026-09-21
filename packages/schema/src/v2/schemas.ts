/**
 * Schema v2 —— zod 模型(结构层的单一事实源)。
 *
 * §10.1 要求「JSON Schema 由单一模型生成,不手写维护第二份结构定义」。
 * 本文件就是那个单一模型:
 *   - 运行时校验     ← validate.ts 直接用它做第 1 层结构校验
 *   - JSON Schema    ← scripts/gen-json-schema.mjs 用 z.toJSONSchema() 生成 packages/schema/schema/*.json
 *   - TS 类型一致性  ← __tests__/v2-schema-parity.test.ts 断言 z.infer 与手写 interface 互相可赋值
 *
 * 用 `zod/v4`(随 zod 3.25 一同发布的子路径),因为只有 v4 自带 toJSONSchema();
 * v1 的 validate.ts 继续用 zod v3 根导出,两者可共存,不需要改依赖。
 */
import { z } from 'zod/v4';

/* ------------------------------------------------------------------ 基元 */

/** `<kind>:<slug>@<revision>` */
const refPattern = (kind: string): RegExp => new RegExp(`^${kind}:[a-z0-9][a-z0-9._-]*@[1-9]\\d*$`);

export const zDisplayRef = z.string().regex(refPattern('display'));
export const zControllerRef = z.string().regex(refPattern('controller'));
export const zInputRef = z.string().regex(refPattern('input'));
export const zFirmwareRef = z.string().regex(refPattern('firmware'));
export const zUiRef = z.string().regex(refPattern('ui'));
export const zStandaloneThemeRef = z.string().regex(refPattern('theme'));
export const zEmbeddedThemeRef = z.string().regex(/^ui:[a-z0-9][a-z0-9._-]*@[1-9]\d*#theme:.+$/);
export const zThemeRef = z.union([zEmbeddedThemeRef, zStandaloneThemeRef]);

export const zColorFormat = z.enum([
  'RGB565', 'RGB565_SWAPPED', 'RGB888', 'XRGB8888', 'ARGB8888', 'L8', 'I1',
]);

export const zLvglVersion = z.enum(['9.4.0', '9.5.0']);

export const zRect = z.object({
  x: z.number(), y: z.number(), width: z.number(), height: z.number(),
});

export const zSizePx = z.object({ width: z.number(), height: z.number() });

export const zRotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);

/* 值 */

export const zPropValue = z.union([
  z.string(), z.number(), z.boolean(),
  z.array(z.number()), z.array(z.string()),
  z.strictObject({ $const: z.string() }),
  z.strictObject({ $token: z.string() }),
]);

export const zSelector = z.object({
  states: z.array(z.string()).optional(),
  part: z.string().optional(),
});

export const zConstDef = z.object({
  name: z.string(),
  type: z.enum(['int', 'px', 'color', 'string', 'percent']),
  value: z.string(),
});

/* ----------------------------------------------------------- Profile 们 */

export const zDisplayProfile = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('display-profile'),
  id: z.string().min(1),
  revision: z.number().int().positive(),
  displayName: z.string().optional(),
  logicalSize: zSizePx,
  shape: z.enum(['rect', 'round']),
  colorFormat: zColorFormat,
  dpi: z.number().positive().optional(),
  visibleRect: zRect.optional(),
  installRotation: zRotation.optional(),
});

export const zViewportClip = z.union([
  z.strictObject({ type: z.literal('none') }),
  z.strictObject({ type: z.literal('rect') }),
  z.strictObject({ type: z.literal('roundedRect'), radius: z.number() }),
  z.strictObject({ type: z.literal('circle') }),
]);

export const zPhysicalControl = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(['knob', 'button', 'switch']),
  displayName: z.string().optional(),
  hitArea: zRect,
  action: z.string().optional(),
});

export const zControllerProfile = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('controller-profile'),
  id: z.string().min(1),
  revision: z.number().int().positive(),
  model: z.string(),
  displayName: z.string().optional(),
  displayRef: zDisplayRef,
  frame: z.strictObject({
    assetRef: z.string().regex(/^asset:.+@sha256:[0-9a-f]{8,64}$/),
    viewBox: zRect,
    screenViewport: z.object({
      x: z.number(), y: z.number(), width: z.number(), height: z.number(),
      rotation: zRotation,
      clip: zViewportClip.optional(),
    }),
  }),
  inputProfileRef: zInputRef.optional(),
  physicalControls: z.array(zPhysicalControl).optional(),
});

export const zInputProfile = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('input-profile'),
  id: z.string().min(1),
  revision: z.number().int().positive(),
  displayName: z.string().optional(),
  rawSize: zSizePx,
  swapXy: z.boolean().optional(),
  invertX: z.boolean().optional(),
  invertY: z.boolean().optional(),
  affine: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]).optional(),
});

export const zFirmwareProfile = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('firmware-profile'),
  id: z.string().min(1),
  revision: z.number().int().positive(),
  displayName: z.string().optional(),
  target: z.string().min(1),
  uiAbiVersion: z.string().regex(/^[1-9][0-9]*\.[0-9]+\.[0-9]+$/),
  capabilityRevision: z.number().int().positive(),
  supportedWidgets: z.array(z.string().min(1)),
  supportedSubjects: z.array(z.string().min(1)),
  supportedActions: z.array(z.string().min(1)),
  lvConf: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  memoryBudgetBytes: z.number().int().positive().optional(),
});

export const zBuildTarget = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('lvgl-build-target'),
  id: z.string().min(1),
  revision: z.number().int().positive(),
  displayName: z.string().optional(),
  uiProjectRef: zUiRef,
  controllerProfileRef: zControllerRef,
  themeRef: zThemeRef,
  firmwareProfileRef: zFirmwareRef.optional(),
  lvglVersion: zLvglVersion,
});

/* --------------------------------------------------------------- 树 / 工程 */

export const zThemeToken = z.object({
  id: z.string(),
  type: z.enum(['color', 'px', 'percent', 'int', 'opa', 'fontRef', 'imageRef']),
  value: z.union([z.string(), z.number()]),
  description: z.string().optional(),
});

export const zThemeDef = z.object({
  id: z.string().min(1),
  displayName: z.string().optional(),
  extends: z.string().optional(),
  tokens: z.array(zThemeToken),
});

export const zThemeRevision = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('lvgl-theme'),
  id: z.string().min(1),
  revision: z.number().int().positive(),
  displayName: z.string().optional(),
  extends: zStandaloneThemeRef.optional(),
  tokens: z.array(zThemeToken),
});

export const zNamedStyle = z.object({
  id: z.string().min(1),
  codeName: z.string().optional(),
  displayName: z.string().optional(),
  props: z.record(z.string(), zPropValue),
});

export const zUiEvent = z.object({
  on: z.string(),
  action: z.string(),
  args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.strictObject({ $token: z.string() })])).optional(),
});

export const zBinding = z.union([
  z.strictObject({ kind: z.literal('prop'), prop: z.string(), subject: z.string(), fmt: z.string().optional() }),
  z.strictObject({ kind: z.literal('flag'), flag: z.string(), op: z.string(), subject: z.string(), refValue: z.number() }),
  z.strictObject({ kind: z.literal('state'), state: z.string(), op: z.string(), subject: z.string(), refValue: z.number() }),
  z.strictObject({
    kind: z.literal('style'), styleId: z.string(), selector: zSelector.optional(),
    subject: z.string(), refValue: z.number(),
  }),
]);

/**
 * WidgetNode。用 getter 写递归(zod v4 惯用法),toJSONSchema 会输出 `$ref: "#"`。
 * `.strict()`:cPatch 之类的越界字段会变成 unrecognized_keys 结构错误,而不是被静默丢弃 —— 这是信任边界(§8)。
 */
export const zWidgetNode = z.strictObject({
  id: z.string().min(1),
  type: z.string().min(1),
  codeName: z.string().optional(),
  displayName: z.string().optional(),
  props: z.record(z.string(), zPropValue),
  flags: z.record(z.string(), z.boolean()).optional(),
  states: z.record(z.string(), z.boolean()).optional(),
  styleRefs: z.array(z.object({ styleId: z.string(), selector: zSelector.optional() })),
  styles: z.array(z.object({ selector: zSelector.optional(), props: z.record(z.string(), zPropValue) })),
  events: z.array(zUiEvent),
  bindings: z.array(zBinding),
  get children() { return z.array(zWidgetNode); },
  editor: z.record(z.string(), z.unknown()).optional(),
});

export const zScreenDef = z.strictObject({
  id: z.string().min(1),
  codeName: z.string(),
  displayName: z.string().optional(),
  isHome: z.boolean().optional(),
  styles: z.array(zNamedStyle),
  consts: z.array(zConstDef),
  root: zWidgetNode,
});

export const zSubjectDef = z.union([
  z.strictObject({
    id: z.string().min(1), codeName: z.string(), displayName: z.string().optional(),
    type: z.enum(['int', 'float']), initial: z.number(),
    min: z.number().optional(), max: z.number().optional(),
  }),
  z.strictObject({
    id: z.string().min(1), codeName: z.string(), displayName: z.string().optional(),
    type: z.literal('string'), initial: z.string(),
  }),
  z.strictObject({
    id: z.string().min(1), codeName: z.string(), displayName: z.string().optional(),
    type: z.literal('color'), initial: z.string(),
  }),
]);

export const zComponentDef = z.strictObject({
  id: z.string().min(1),
  codeName: z.string(),
  displayName: z.string().optional(),
  api: z.array(z.object({
    name: z.string(),
    type: z.enum(['int', 'float', 'bool', 'string', 'color', 'size', 'imageRef']),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })),
  styles: z.array(zNamedStyle),
  consts: z.array(zConstDef),
  root: zWidgetNode,
});

export const zAssetEntry = z.object({
  id: z.string().min(1),
  codeName: z.string().optional(),
  displayName: z.string().optional(),
  file: z.object({ fileName: z.string(), sha256: z.string(), byteSize: z.number() }),
  conv: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const zUiProject = z.strictObject({
  schemaVersion: z.literal(2),
  kind: z.literal('lvgl-ui-project'),
  meta: z.strictObject({
    id: z.string().min(1),
    revision: z.number().int().positive(),
    name: z.string(),
    appVersion: z.string(),
    createdAt: z.string(),
    modifiedAt: z.string(),
  }),
  designDisplayRef: zDisplayRef,
  themes: z.array(zThemeDef),
  subjects: z.array(zSubjectDef),
  screens: z.array(zScreenDef).min(1),
  components: z.array(zComponentDef),
  styles: z.array(zNamedStyle),
  consts: z.array(zConstDef),
  assets: z.strictObject({
    fonts: z.array(zAssetEntry),
    images: z.array(zAssetEntry),
    icons: z.array(zAssetEntry),
  }),
  translations: z.union([
    z.null(),
    z.object({
      languages: z.array(z.string()),
      entries: z.array(z.object({ tag: z.string(), texts: z.record(z.string(), z.string()) })),
    }),
  ]),
  editor: z.record(z.string(), z.unknown()).optional(),
});

/* ---------------------------------------------------- Web UI 发布文档 v1 */

/**
 * Web 发布投影复用 UiProject 的字段模型，只移除编辑器私有字段。
 * 这里通过 omit/extend 派生，而不是另写一套 Widget Tree，避免契约漂移。
 */
const zWebWidgetNodeBase = zWidgetNode.omit({ children: true, editor: true });
export const zWebWidgetNode: z.ZodType = z.strictObject({
  ...zWebWidgetNodeBase.shape,
  get children(): z.ZodArray<z.ZodType> { return z.array(zWebWidgetNode); },
});

export const zWebScreenDef = zScreenDef.extend({ root: zWebWidgetNode });
export const zWebComponentDef = zComponentDef.extend({ root: zWebWidgetNode });
export const zWebUiProject = zUiProject.omit({
  screens: true,
  components: true,
  editor: true,
}).extend({
  screens: z.array(zWebScreenDef).min(1),
  components: z.array(zWebComponentDef),
});

export const zWebUiActionParam = z.strictObject({
  name: z.string().min(1),
  type: z.enum(['int', 'float', 'bool', 'string', 'color', 'screenRef', 'subjectRef']),
  required: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  enum: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const zWebUiAction = z.strictObject({
  id: z.string().min(1),
  displayName: z.string().optional(),
  description: z.string().optional(),
  params: z.array(zWebUiActionParam),
});

export const zWebUiAssetManifestEntry = z.strictObject({
  assetId: z.string().min(1),
  kind: z.enum(['font', 'image', 'icon']),
  fileName: z.string().min(1),
  mediaType: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byteSize: z.number().int().nonnegative(),
});

export const zWebUiDocumentV1 = z.strictObject({
  kind: z.literal('wf2-web-ui'),
  schemaVersion: z.literal(1),
  source: z.strictObject({
    kind: z.literal('lvgl-ui-project'),
    schemaVersion: z.literal(2),
    projectId: z.string().min(1),
    revision: z.number().int().positive(),
  }),
  uiProject: zWebUiProject,
  displayProfile: zDisplayProfile,
  actionRegistry: z.record(z.string(), zWebUiAction),
  assetManifest: z.array(zWebUiAssetManifestEntry),
});

export const zTrustedExtension = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('trusted-extension'),
  uiProjectId: z.string().min(1),
  patches: z.array(z.strictObject({
    nodeId: z.string().min(1),
    ownerId: z.string().min(1),
    post: z.string(),
    sha256: z.string().optional(),
    review: z.object({ by: z.string(), at: z.string(), note: z.string().optional() }).optional(),
  })),
});

/* --------------------------------------------------------- 生成清单 */

/** JSON Schema 生成目标:文件名 → zod 模型。gen-json-schema.mjs 遍历它 */
export const JSON_SCHEMA_TARGETS = {
  'ui.schema.json': zUiProject,
  'display-profile.schema.json': zDisplayProfile,
  'controller-profile.schema.json': zControllerProfile,
  'input-profile.schema.json': zInputProfile,
  'firmware-profile.schema.json': zFirmwareProfile,
  'theme.schema.json': zThemeRevision,
  'build-target.schema.json': zBuildTarget,
  'trusted-extension.schema.json': zTrustedExtension,
  'web-ui-document.v1.schema.json': zWebUiDocumentV1,
} as const;
