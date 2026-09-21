import { ALL_WIDGETS, OBJ_BASE, REGISTRY, findChildSpec } from '../widgets/index.js';
import { STYLE_PROPS } from '../styleProps.js';
import { TRIGGER_TOKENS } from '../enums.js';
import type { ValidationIssue, ValidationResult } from '../validate.js';
import { zWebUiDocumentV1 } from './schemas.js';
import type { DisplayProfile } from './profiles.js';
import type { ProjectSnapshotV2 } from './projectSnapshot.js';
import {
  BUILTIN_ACTIONS,
  type ActionRegistry,
  type ActionSpec,
  type AssetEntry,
  type ComponentDefV2,
  type ScreenDefV2,
  type UiProject,
  type WidgetNodeV2,
} from './uiProject.js';
import { validateDisplayProfile, validateUiProjectV2 } from './validate.js';

export const WEB_UI_DOCUMENT_KIND = 'wf2-web-ui' as const;
export const WEB_UI_DOCUMENT_SCHEMA_VERSION = 1 as const;

/** 第一版网页 Renderer 的冻结控件集合，包含已验证的兼容控件修订。 */
const WEB_UI_LOWERED_WIDGETS = new Set(['list', 'list-text', 'list-button']);
export const WEB_UI_WIDGETS_V1: readonly string[] = Object.freeze([
  ...ALL_WIDGETS.map((widget) => widget.type),
  ...ALL_WIDGETS.flatMap((widget) => (widget.children ?? []).map((child) => child.type)),
]
  .filter((type, index, all) => !WEB_UI_LOWERED_WIDGETS.has(type) && all.indexOf(type) === index)
  .sort());

export const WEB_UI_LOCAL_ACTIONS_V1 = Object.freeze(Object.keys(BUILTIN_ACTIONS).sort());

export const WEB_UI_LIMITS_V1 = Object.freeze({
  maxJsonBytes: 1_048_576,
  maxScreens: 32,
  maxNodes: 2_000,
  maxDepth: 32,
  maxChildrenPerNode: 200,
  maxActions: 128,
  maxAssets: 256,
  maxAssetBytes: 8_388_608,
  maxTotalAssetBytes: 33_554_432,
  maxStringBytes: 16_384,
});

export type WebUiAssetKindV1 = 'font' | 'image' | 'icon';

export interface WebUiSourceV1 {
  kind: 'lvgl-ui-project';
  schemaVersion: 2;
  projectId: string;
  revision: number;
}

/**
 * 资源交接只携带稳定身份和完整性元数据，不携带 URL、IoT file UUID 或本地路径。
 * IoT 后端负责把 sha256 映射到自己的 files 记录并授权读取。
 */
export interface WebUiAssetManifestEntryV1 {
  assetId: string;
  kind: WebUiAssetKindV1;
  fileName: string;
  mediaType: string;
  sha256: string;
  byteSize: number;
}

export type WebUiWidgetNodeV1 = Omit<WidgetNodeV2, 'editor' | 'children'> & {
  children: WebUiWidgetNodeV1[];
};

export type WebUiScreenV1 = Omit<ScreenDefV2, 'root'> & { root: WebUiWidgetNodeV1 };
export type WebUiComponentV1 = Omit<ComponentDefV2, 'root'> & { root: WebUiWidgetNodeV1 };
export type WebUiProjectV1 = Omit<UiProject, 'editor' | 'screens' | 'components'> & {
  screens: WebUiScreenV1[];
  components: WebUiComponentV1[];
};

export interface WebUiDocumentV1 {
  kind: 'wf2-web-ui';
  schemaVersion: 1;
  source: WebUiSourceV1;
  uiProject: WebUiProjectV1;
  displayProfile: DisplayProfile;
  actionRegistry: ActionRegistry;
  assetManifest: WebUiAssetManifestEntryV1[];
}

export interface WebUiExportV1 {
  document: WebUiDocumentV1;
  /** UTF-8、对象键按 ECMAScript UTF-16 code unit 排序、无空白、无末尾换行。 */
  json: string;
  sha256: string;
  fileName: string;
}

export type WebUiAssetResolver = (
  asset: WebUiAssetManifestEntryV1,
) => Uint8Array | null | Promise<Uint8Array | null>;

export class WebUiDocumentError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(`网页 UI 发布文档校验失败：${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
    this.name = 'WebUiDocumentError';
    this.issues = issues;
  }
}

const WEB_WIDGET_SET = new Set<string>(WEB_UI_WIDGETS_V1);
const WEB_EVENT_SET = new Set<string>(TRIGGER_TOKENS);
const WEB_FLAG_SET = new Set<string>(OBJ_BASE.flags);
const WEB_STATE_SET = new Set<string>(OBJ_BASE.states);
const SHA256_RE = /^[0-9a-f]{64}$/;

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function collectNodeIds(project: UiProject): Set<string> {
  const ids = new Set<string>();
  const walk = (node: WidgetNodeV2): void => {
    ids.add(node.id);
    node.children.forEach(walk);
  };
  project.screens.forEach((screen) => walk(screen.root));
  project.components.forEach((component) => walk(component.root));
  return ids;
}

function derivedNodeId(sourceId: string, role: string, usedIds: Set<string>): string {
  const prefix = `${sourceId}::web-${role}`;
  let candidate = prefix;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${prefix}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

/**
 * Web V1 只暴露冻结的基础控件。Designer 的 list 复合控件在发布投影中确定性降级为
 * obj/label/button，避免要求已经冻结的 IoT Renderer 再实现一套 LVGL 专有结构。
 */
function publishedNode(
  node: WidgetNodeV2,
  usedIds: Set<string>,
  parentType?: string,
): WebUiWidgetNodeV1 {
  const { editor: _editor, children, ...published } = node;
  const result: WebUiWidgetNodeV1 = {
    ...jsonClone(published),
    children: children.map((child) => publishedNode(child, usedIds, node.type)),
  };

  if (node.type === 'list') {
    return {
      ...result,
      type: 'obj',
      props: { flex_flow: 'column', ...result.props },
    };
  }
  if (parentType === 'list' && node.type === 'list-text') {
    return { ...result, type: 'label' };
  }
  if (parentType === 'list' && node.type === 'list-button') {
    const { text = '', icon, ...props } = result.props;
    const textNode: WebUiWidgetNodeV1 = {
      id: derivedNodeId(node.id, 'label', usedIds),
      type: 'label',
      props: { text },
      styleRefs: [],
      styles: [],
      events: [],
      bindings: [],
      children: [],
    };
    return {
      ...result,
      type: 'button',
      props,
      styles: icon === undefined
        ? result.styles
        : [...result.styles, { props: { bg_image_src: icon } }],
      children: [textNode, ...result.children],
    };
  }
  return result;
}

function publishedProject(project: UiProject): WebUiProjectV1 {
  const { editor: _editor, screens, components, ...published } = project;
  const usedIds = collectNodeIds(project);
  return {
    ...jsonClone(published),
    screens: screens.map((screen) => ({
      ...jsonClone({ ...screen, root: undefined }),
      root: publishedNode(screen.root, usedIds),
    })),
    components: components.map((component) => ({
      ...jsonClone({ ...component, root: undefined }),
      root: publishedNode(component.root, usedIds),
    })),
  };
}

function collectActions(project: UiProject): Set<string> {
  const actions = new Set<string>();
  const walk = (node: WidgetNodeV2): void => {
    for (const event of node.events) actions.add(event.action);
    for (const child of node.children) walk(child);
  };
  for (const screen of project.screens) walk(screen.root);
  for (const component of project.components) walk(component.root);
  return actions;
}

function publishedActions(project: UiProject, registry: ActionRegistry): ActionRegistry {
  const available = { ...BUILTIN_ACTIONS, ...registry };
  return Object.fromEntries([...collectActions(project)].sort().flatMap((id) => {
    const action = available[id];
    return action === undefined ? [] : [[id, jsonClone(action)] as [string, ActionSpec]];
  }));
}

function mediaType(kind: WebUiAssetKindV1, fileName: string): string {
  const extension = fileName.toLowerCase().split('.').pop() ?? '';
  const known: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    svg: 'image/svg+xml', gif: 'image/gif', bmp: 'image/bmp', json: 'application/json',
    ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  };
  return known[extension] ?? 'application/octet-stream';
}

function assetEntries(project: UiProject): WebUiAssetManifestEntryV1[] {
  const groups: readonly [WebUiAssetKindV1, AssetEntry[]][] = [
    ['font', project.assets.fonts],
    ['image', project.assets.images],
    ['icon', project.assets.icons],
  ];
  return groups.flatMap(([kind, assets]) => assets.map((asset) => ({
    assetId: asset.id,
    kind,
    fileName: asset.file.fileName,
    mediaType: mediaType(kind, asset.file.fileName),
    sha256: asset.file.sha256,
    byteSize: asset.file.byteSize,
  }))).sort((a, b) => {
    const left = `${a.kind}\0${a.assetId}`;
    const right = `${b.kind}\0${b.assetId}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function toIssue(issue: ValidationIssue, prefix = ''): ValidationIssue {
  const codeMap: Record<string, string> = {
    'unknown-widget': 'unsupported_widget',
    'unknown-action': 'unsupported_action',
    'duplicate-id': 'duplicate_id',
    'duplicate-screen-id': 'duplicate_id',
    'duplicate-subject-id': 'duplicate_id',
    'duplicate-style-id': 'duplicate_id',
    'unknown-style-prop': 'unsupported_style_property',
    'extra-action-arg': 'unsupported_action_argument',
  };
  return {
    path: prefix.length > 0 && issue.path !== '(root)' ? `${prefix}.${issue.path}` : prefix || issue.path,
    code: codeMap[issue.code] ?? issue.code.replaceAll('-', '_'),
    message: issue.message,
  };
}

function structuralIssues(raw: unknown): ValidationIssue[] {
  const parsed = zWebUiDocumentV1.safeParse(raw);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    code: 'schema_invalid',
    message: issue.message,
  }));
}

function walkNodes(
  project: UiProject,
  visit: (node: WidgetNodeV2, path: string, depth: number) => void,
): void {
  const walk = (node: WidgetNodeV2, path: string, depth: number): void => {
    visit(node, path, depth);
    node.children.forEach((child, index) => walk(child, `${path}.children[${index}]`, depth + 1));
  };
  project.screens.forEach((screen, index) => walk(screen.root, `uiProject.screens[${index}].root`, 1));
  project.components.forEach((component, index) => walk(component.root, `uiProject.components[${index}].root`, 1));
}

function allowedProps(node: WidgetNodeV2): Set<string> {
  const spec = REGISTRY.get(node.type);
  const child = findChildSpec(node.type)?.child;
  return new Set([
    ...(spec === undefined && child?.isObj !== true ? [] : OBJ_BASE.props),
    ...(spec?.props ?? child?.props ?? []),
    ...(child?.createProps ?? []),
  ].flatMap((prop) => [prop.key, ...(prop.companions ?? []).map((item) => item.key)]));
}

/** 前后端可直接消费的 V1 能力矩阵；对应 JSON fixture 由测试固化。 */
export function webUiCapabilitiesV1(): Record<string, unknown> {
  return {
    kind: 'wf2-web-ui-capabilities',
    schemaVersion: 1,
    documentSchemaVersion: WEB_UI_DOCUMENT_SCHEMA_VERSION,
    widgets: Object.fromEntries(WEB_UI_WIDGETS_V1.map((type) => {
      const spec = REGISTRY.get(type);
      const child = findChildSpec(type)?.child;
      return [type, {
        props: [...allowedProps({ type } as WidgetNodeV2)].sort(),
        bindableProps: [...(spec?.bindableProps ?? [])].sort(),
        acceptsWidgetChildren: spec?.acceptsWidgetChildren ?? child?.acceptsWidgetChildren ?? false,
      }];
    })),
    styleProperties: Object.keys(STYLE_PROPS).sort(),
    flags: [...OBJ_BASE.flags].sort(),
    states: [...OBJ_BASE.states].sort(),
    events: [...TRIGGER_TOKENS].sort(),
    actions: Object.fromEntries(Object.entries(BUILTIN_ACTIONS).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
    subjectTypes: ['color', 'float', 'int', 'string'],
    bindingKinds: ['flag', 'prop', 'state', 'style'],
    limits: WEB_UI_LIMITS_V1,
  };
}

function semanticIssues(document: WebUiDocumentV1): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const projectResult = validateUiProjectV2(document.uiProject, { actions: document.actionRegistry });
  issues.push(...projectResult.errors.map((issue) => toIssue(issue, 'uiProject')));
  issues.push(...projectResult.warnings
    .filter((issue) => issue.code === 'unknown-style-prop' || issue.code === 'extra-action-arg')
    .map((issue) => toIssue(issue, 'uiProject')));
  const displayResult = validateDisplayProfile(document.displayProfile);
  issues.push(...displayResult.errors.map((issue) => toIssue(issue, 'displayProfile')));

  if (document.source.projectId !== document.uiProject.meta.id) {
    issues.push({ path: 'source.projectId', code: 'source_mismatch', message: 'source.projectId 必须等于 uiProject.meta.id' });
  }
  if (document.source.revision !== document.uiProject.meta.revision) {
    issues.push({ path: 'source.revision', code: 'source_mismatch', message: 'source.revision 必须等于 uiProject.meta.revision' });
  }
  const displayRef = `${document.displayProfile.id}@${document.displayProfile.revision}`;
  if (document.uiProject.designDisplayRef !== displayRef) {
    issues.push({
      path: 'displayProfile', code: 'display_profile_mismatch',
      message: `displayProfile 快照 ${displayRef} 与 uiProject.designDisplayRef 不一致`,
    });
  }

  let nodes = 0;
  walkNodes(document.uiProject, (node, path, depth) => {
    nodes += 1;
    if (!WEB_WIDGET_SET.has(node.type)) {
      issues.push({ path: `${path}.type`, code: 'unsupported_widget', message: `WebUiDocumentV1 不支持 Widget "${node.type}"` });
    }
    if (depth > WEB_UI_LIMITS_V1.maxDepth) {
      issues.push({ path, code: 'max_depth_exceeded', message: `节点深度不得超过 ${WEB_UI_LIMITS_V1.maxDepth}` });
    }
    if (node.children.length > WEB_UI_LIMITS_V1.maxChildrenPerNode) {
      issues.push({ path: `${path}.children`, code: 'max_children_exceeded', message: `单节点 children 不得超过 ${WEB_UI_LIMITS_V1.maxChildrenPerNode}` });
    }
    const props = allowedProps(node);
    for (const key of Object.keys(node.props)) {
      if (!props.has(key)) {
        issues.push({ path: `${path}.props.${key}`, code: 'unsupported_widget_property', message: `Widget "${node.type}" 不支持属性 "${key}"` });
      }
    }
    for (const key of Object.keys(node.flags ?? {})) {
      if (!WEB_FLAG_SET.has(key)) {
        issues.push({ path: `${path}.flags.${key}`, code: 'unsupported_flag', message: `不支持 Flag "${key}"` });
      }
    }
    for (const key of Object.keys(node.states ?? {})) {
      if (!WEB_STATE_SET.has(key)) {
        issues.push({ path: `${path}.states.${key}`, code: 'unsupported_state', message: `不支持 State "${key}"` });
      }
    }
    const spec = REGISTRY.get(node.type);
    for (const [index, binding] of node.bindings.entries()) {
      if (binding.kind === 'prop' && spec !== undefined && !spec.bindableProps.includes(binding.prop)) {
        issues.push({ path: `${path}.bindings[${index}].prop`, code: 'unsupported_binding_property', message: `Widget "${node.type}" 不支持属性绑定 "${binding.prop}"` });
      }
    }
    for (const [index, event] of node.events.entries()) {
      const eventPath = `${path}.events[${index}]`;
      if (!WEB_EVENT_SET.has(event.on)) {
        issues.push({ path: `${eventPath}.on`, code: 'unsupported_event', message: `不支持 Event "${event.on}"` });
      }
      const builtin = BUILTIN_ACTIONS[event.action];
      if (builtin === undefined) {
        issues.push({ path: `${eventPath}.action`, code: 'unsupported_action', message: `WebUiDocumentV1 只允许本地内置 Action，"${event.action}" 尚未冻结` });
      }
    }
  });
  if (nodes > WEB_UI_LIMITS_V1.maxNodes) {
    issues.push({ path: 'uiProject', code: 'max_nodes_exceeded', message: `节点总数不得超过 ${WEB_UI_LIMITS_V1.maxNodes}` });
  }
  if (document.uiProject.screens.length > WEB_UI_LIMITS_V1.maxScreens) {
    issues.push({ path: 'uiProject.screens', code: 'max_screens_exceeded', message: `Screen 数不得超过 ${WEB_UI_LIMITS_V1.maxScreens}` });
  }

  const referencedActions = collectActions(document.uiProject);
  for (const id of referencedActions) {
    if (document.actionRegistry[id] === undefined) {
      issues.push({ path: 'actionRegistry', code: 'action_missing', message: `缺少已引用 Action "${id}"` });
    }
  }
  for (const id of Object.keys(document.actionRegistry)) {
    if (!referencedActions.has(id)) {
      issues.push({ path: `actionRegistry.${id}`, code: 'action_not_referenced', message: `Action "${id}" 未被当前项目引用` });
    }
    const builtin = BUILTIN_ACTIONS[id];
    if (builtin === undefined) {
      issues.push({ path: `actionRegistry.${id}`, code: 'unsupported_action', message: `WebUiDocumentV1 只允许本地内置 Action，"${id}" 尚未冻结` });
    } else if (canonicalJson(document.actionRegistry[id]) !== canonicalJson(builtin)) {
      issues.push({ path: `actionRegistry.${id}`, code: 'action_contract_mismatch', message: `Action "${id}" 必须与冻结内置契约完全一致` });
    }
  }
  if (Object.keys(document.actionRegistry).length > WEB_UI_LIMITS_V1.maxActions) {
    issues.push({ path: 'actionRegistry', code: 'max_actions_exceeded', message: `Action 数不得超过 ${WEB_UI_LIMITS_V1.maxActions}` });
  }
  if (document.uiProject.components.length > 0) {
    issues.push({ path: 'uiProject.components', code: 'unsupported_component', message: 'WebUiDocumentV1 暂不发布自定义 Component' });
  }

  const expectedAssets = assetEntries(document.uiProject);
  if (canonicalJson(expectedAssets) !== canonicalJson(document.assetManifest)) {
    issues.push({ path: 'assetManifest', code: 'asset_manifest_mismatch', message: 'assetManifest 必须与 uiProject.assets 完全对应' });
  }
  const seenAssets = new Set<string>();
  let totalAssetBytes = 0;
  for (const [index, asset] of document.assetManifest.entries()) {
    const path = `assetManifest[${index}]`;
    const key = `${asset.kind}:${asset.assetId}`;
    if (seenAssets.has(key)) issues.push({ path, code: 'duplicate_asset', message: `资源 ${key} 重复` });
    seenAssets.add(key);
    if (!SHA256_RE.test(asset.sha256)) issues.push({ path: `${path}.sha256`, code: 'asset_hash_invalid', message: '资源 SHA-256 必须是 64 位小写十六进制' });
    if (asset.fileName.includes('/') || asset.fileName.includes('\\') || asset.fileName === '.' || asset.fileName === '..') {
      issues.push({ path: `${path}.fileName`, code: 'asset_filename_invalid', message: '资源文件名必须是 basename，不能包含路径' });
    }
    if (asset.byteSize > WEB_UI_LIMITS_V1.maxAssetBytes) {
      issues.push({ path: `${path}.byteSize`, code: 'asset_too_large', message: `单资源不得超过 ${WEB_UI_LIMITS_V1.maxAssetBytes} 字节` });
    }
    totalAssetBytes += asset.byteSize;
  }
  if (document.assetManifest.length > WEB_UI_LIMITS_V1.maxAssets) {
    issues.push({ path: 'assetManifest', code: 'max_assets_exceeded', message: `资源数不得超过 ${WEB_UI_LIMITS_V1.maxAssets}` });
  }
  if (totalAssetBytes > WEB_UI_LIMITS_V1.maxTotalAssetBytes) {
    issues.push({ path: 'assetManifest', code: 'total_assets_too_large', message: `资源总大小不得超过 ${WEB_UI_LIMITS_V1.maxTotalAssetBytes} 字节` });
  }

  const scan = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      if (new TextEncoder().encode(value).byteLength > WEB_UI_LIMITS_V1.maxStringBytes) {
        issues.push({ path, code: 'string_too_large', message: `单字符串不得超过 ${WEB_UI_LIMITS_V1.maxStringBytes} UTF-8 字节` });
      }
      if (/<\s*(script|iframe|object|embed)\b/i.test(value) || /javascript\s*:/i.test(value)) {
        issues.push({ path, code: 'dangerous_content', message: '发布文档禁止脚本、可执行 HTML 和 javascript: URL' });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => scan(item, `${path}[${index}]`));
    } else if (value !== null && typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) => scan(item, path ? `${path}.${key}` : key));
    }
  };
  scan(document, '');

  const jsonBytes = new TextEncoder().encode(canonicalJson(document)).byteLength;
  if (jsonBytes > WEB_UI_LIMITS_V1.maxJsonBytes) {
    issues.push({ path: '(root)', code: 'document_too_large', message: `规范化 JSON 不得超过 ${WEB_UI_LIMITS_V1.maxJsonBytes} 字节` });
  }
  return issues;
}

export function validateWebUiDocument(raw: unknown): ValidationResult {
  const structure = structuralIssues(raw);
  if (structure.length > 0) return { valid: false, errors: structure, warnings: [] };
  const errors = semanticIssues(raw as WebUiDocumentV1);
  return { valid: errors.length === 0, errors, warnings: [] };
}

/** 从编辑快照创建无 editor/build/private 字段的确定性发布文档。 */
export function createWebUiDocument(snapshot: ProjectSnapshotV2): WebUiDocumentV1 {
  const uiProject = publishedProject(snapshot.uiProject);
  const document: WebUiDocumentV1 = {
    kind: WEB_UI_DOCUMENT_KIND,
    schemaVersion: WEB_UI_DOCUMENT_SCHEMA_VERSION,
    source: {
      kind: 'lvgl-ui-project',
      schemaVersion: 2,
      projectId: uiProject.meta.id,
      revision: uiProject.meta.revision,
    },
    uiProject,
    displayProfile: jsonClone(snapshot.displayProfile),
    actionRegistry: publishedActions(uiProject, snapshot.actionRegistry),
    assetManifest: assetEntries(uiProject),
  };
  const validation = validateWebUiDocument(document);
  if (!validation.valid) throw new WebUiDocumentError(validation.errors);
  return document;
}

function canonicalValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON 不支持非有限数值');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError('canonical JSON 不支持循环引用');
    ancestors.add(value);
    const result = `[${value.map((item) => canonicalValue(item, ancestors)).join(',')}]`;
    ancestors.delete(value);
    return result;
  }
  if (typeof value === 'object') {
    if (ancestors.has(value)) throw new TypeError('canonical JSON 不支持循环引用');
    ancestors.add(value);
    const record = value as Record<string, unknown>;
    const result = `{${Object.keys(record).sort().map((key) => {
      const item = record[key];
      if (item === undefined) throw new TypeError(`canonical JSON 不支持 undefined：${key}`);
      return `${JSON.stringify(key)}:${canonicalValue(item, ancestors)}`;
    }).join(',')}}`;
    ancestors.delete(value);
    return result;
  }
  throw new TypeError(`canonical JSON 不支持 ${typeof value}`);
}

/** RFC 8259 JSON 的仓内规范化子集：对象键按 UTF-16 code unit 排序，数组顺序保持。 */
export function canonicalJson(value: unknown): string {
  return canonicalValue(value, new Set());
}

export async function sha256Utf8(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyWebUiAssets(
  document: WebUiDocumentV1,
  resolve: WebUiAssetResolver,
): Promise<ValidationResult> {
  const errors: ValidationIssue[] = [];
  for (const [index, asset] of document.assetManifest.entries()) {
    const bytes = await resolve(asset);
    const path = `assetManifest[${index}]`;
    if (bytes === null) {
      errors.push({ path, code: 'asset_blob_missing', message: `缺少资源 blob：${asset.assetId}` });
      continue;
    }
    if (bytes.byteLength !== asset.byteSize) {
      errors.push({ path: `${path}.byteSize`, code: 'asset_size_mismatch', message: `资源 ${asset.assetId} 的实际字节数不一致` });
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
    const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== asset.sha256) {
      errors.push({ path: `${path}.sha256`, code: 'asset_hash_mismatch', message: `资源 ${asset.assetId} 的实际 SHA-256 不一致` });
    }
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

export async function createWebUiExport(
  snapshot: ProjectSnapshotV2,
  resolveAssets?: WebUiAssetResolver,
): Promise<WebUiExportV1> {
  const document = createWebUiDocument(snapshot);
  if (document.assetManifest.length > 0) {
    if (resolveAssets === undefined) {
      throw new WebUiDocumentError(document.assetManifest.map((asset, index) => ({
        path: `assetManifest[${index}]`, code: 'asset_blob_missing', message: `导出前必须提供资源 blob：${asset.assetId}`,
      })));
    }
    const result = await verifyWebUiAssets(document, resolveAssets);
    if (!result.valid) throw new WebUiDocumentError(result.errors);
  }
  const json = canonicalJson(document);
  const sha256 = await sha256Utf8(json);
  const slug = document.source.projectId.replace(/^ui:/, '').replace(/[^a-zA-Z0-9._-]+/g, '-');
  return { document, json, sha256, fileName: `${slug || 'ui'}-wf2-web-ui.v1.json` };
}
