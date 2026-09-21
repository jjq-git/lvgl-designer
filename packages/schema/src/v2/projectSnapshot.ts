/**
 * Persisted Designer project snapshot.
 *
 * UiProject v2 is the only persisted UI tree. Profiles and BuildTarget are
 * separate immutable inputs captured beside it; the legacy LvProject exists
 * only as the current editor's in-memory compatibility view.
 */
import type {
  Binding, ComponentDef, EventAction, FontAsset, ImageAsset, InlineStyleGroup,
  LvProject, NamedStyle, PropValue, ScreenDef, ScreenLoadAnim, StyleUsage, SubjectDef, WidgetNode,
} from '../project.js';
import { loadProjectJson, ProjectFormatError } from '../migrations.js';
import type { ValidationResult } from '../validate.js';
import type { BuildTargetDraft, MigrationNote } from './migrate.js';
import type { ControllerProfile, DisplayProfile } from './profiles.js';
import { isRefOfKind, parseRef, parseThemeRef } from './refs.js';
import { isTokenRef, resolveTheme, type ThemeToken } from './theme.js';
import type {
  AssetEntry, BindingV2, ComponentDefV2, LocalStyleGroup, NamedStyleV2,
  ActionRegistry, PropValueV2, ScreenDefV2, SubjectDefV2, UiEvent, UiProject, WidgetNodeV2,
} from './uiProject.js';
import { validateCrossRefs, validateDisplayProfile, validateUiProjectV2 } from './validate.js';

export interface ProjectSnapshotV2 {
  kind: 'lvgl-project-snapshot';
  snapshotVersion: 1;
  uiProject: UiProject;
  displayProfile: DisplayProfile;
  controllerProfile: ControllerProfile | null;
  buildTarget: BuildTargetDraft;
  /** Project-specific Action contracts used for semantic validation. */
  actionRegistry: ActionRegistry;
  /** Preserve unresolved migration decisions across save/reopen and restore. */
  migrationNotes: MigrationNote[];
  colorFormatConfirmed: boolean;
}

export type StoredProjectDocument = LvProject | ProjectSnapshotV2;

export interface LoadedProjectDocument {
  project: LvProject;
  snapshot: ProjectSnapshotV2 | null;
  validation: ValidationResult;
}

export class ProjectSnapshotCompatibilityError extends ProjectFormatError {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Schema v2 工程暂不能进入当前编辑器:${issues.join('; ')}`);
    this.name = 'ProjectSnapshotCompatibilityError';
    this.issues = issues;
  }
}

export function isProjectSnapshotV2(raw: unknown): raw is ProjectSnapshotV2 {
  return typeof raw === 'object' && raw !== null
    && (raw as { kind?: unknown }).kind === 'lvgl-project-snapshot'
    && (raw as { snapshotVersion?: unknown }).snapshotVersion === 1;
}

function displayDepth(format: DisplayProfile['colorFormat']): 16 | 24 | 32 | null {
  if (format === 'RGB565' || format === 'RGB565_SWAPPED') return 16;
  if (format === 'RGB888') return 24;
  if (format === 'XRGB8888' || format === 'ARGB8888') return 32;
  return null;
}

function assertPlainProp(
  value: PropValueV2,
  path: string,
  issues: string[],
  tokens: Map<string, ThemeToken>,
): PropValue {
  if (isTokenRef(value)) {
    const token = tokens.get(value.$token);
    if (token === undefined) {
      issues.push(`${path} 引用了不存在的 Theme Token "${value.$token}"`);
      return '';
    }
    return token.value as PropValue;
  }
  return value as PropValue;
}

function propsV1(
  props: Record<string, PropValueV2>, path: string, issues: string[], tokens: Map<string, ThemeToken>,
): Record<string, PropValue> {
  return Object.fromEntries(Object.entries(props).map(([key, value]) => [
    key, assertPlainProp(value, `${path}.${key}`, issues, tokens),
  ]));
}

function styleV1(
  style: NamedStyleV2, path: string, issues: string[], tokens: Map<string, ThemeToken>,
): NamedStyle {
  if (style.codeName === undefined) issues.push(`${path} 缺 codeName`);
  return {
    id: style.id,
    name: style.codeName ?? 'invalid_style',
    ...(style.displayName === undefined ? {} : { displayName: style.displayName }),
    props: propsV1(style.props, `${path}.props`, issues, tokens),
  };
}

function subjectV1(subject: SubjectDefV2): SubjectDef {
  const common = { name: subject.codeName, type: subject.type, initial: subject.initial };
  if (subject.type === 'int' || subject.type === 'float') {
    return {
      ...common,
      ...(subject.min === undefined ? {} : { min: subject.min }),
      ...(subject.max === undefined ? {} : { max: subject.max }),
    } as SubjectDef;
  }
  return common as SubjectDef;
}

function eventV1(
  event: UiEvent,
  subjects: Map<string, { name: string; type: SubjectDefV2['type'] }>,
  screenIds: Set<string>,
  path: string,
  issues: string[],
): EventAction | null {
  const args = event.args ?? {};
  const subject = typeof args.subject === 'string' ? subjects.get(args.subject) : undefined;
  switch (event.action) {
    case 'screen.open':
    case 'screen.create': {
      const screenId = args.screen;
      if (typeof screenId !== 'string' || !screenIds.has(screenId)) {
        issues.push(`${path} 的 screen 参数无效`);
        return null;
      }
      return {
        kind: event.action === 'screen.open' ? 'screen_load' : 'screen_create',
        trigger: event.on,
        screenId,
        ...(typeof args.anim === 'string' ? { animType: args.anim as ScreenLoadAnim } : {}),
        ...(typeof args.duration === 'number' ? { duration: args.duration } : {}),
        ...(typeof args.delay === 'number' ? { delay: args.delay } : {}),
      } as EventAction;
    }
    case 'subject.set':
      if (subject === undefined || subject.type === 'color' || typeof args.value !== 'string') {
        issues.push(`${path} 的 subject.set 参数无效`);
        return null;
      }
      return {
        kind: 'subject_set', trigger: event.on, subject: subject.name,
        subjectType: subject.type, value: args.value,
      };
    case 'subject.toggle':
      if (subject === undefined) { issues.push(`${path} 的 subject.toggle 参数无效`); return null; }
      return { kind: 'subject_toggle', trigger: event.on, subject: subject.name };
    case 'subject.increment':
      if (subject === undefined) { issues.push(`${path} 的 subject.increment 参数无效`); return null; }
      return {
        kind: 'subject_increment', trigger: event.on, subject: subject.name,
        ...(typeof args.step === 'number' ? { step: args.step } : {}),
        ...(typeof args.min === 'number' ? { min: args.min } : {}),
        ...(typeof args.max === 'number' ? { max: args.max } : {}),
        ...(typeof args.rollover === 'boolean' ? { rollover: args.rollover } : {}),
      };
    default:
      if (event.action.startsWith('custom.') && /^custom\.[a-z][a-z0-9_]*$/.test(event.action)) {
        const userData = args.userData;
        if (userData !== undefined && typeof userData !== 'string') {
          issues.push(`${path} 的 custom Action userData 必须是字符串`);
        }
        return {
          kind: 'callback', trigger: event.on, callback: event.action.slice('custom.'.length),
          ...(typeof userData === 'string' ? { userData } : {}),
        };
      }
      issues.push(`${path} 的 Action ${event.action} 尚无编辑态适配器`);
      return null;
  }
}

function bindingV1(
  binding: BindingV2,
  subjectNames: Map<string, string>,
  styleNames: Map<string, string>,
  path: string,
  issues: string[],
): Binding | null {
  const subject = subjectNames.get(binding.subject);
  if (subject === undefined) { issues.push(`${path} 引用了不存在的 subject`); return null; }
  if (binding.kind === 'prop') {
    return { kind: 'prop', prop: binding.prop, subject, ...(binding.fmt === undefined ? {} : { fmt: binding.fmt }) };
  }
  if (binding.kind === 'flag') {
    return { kind: 'flag', flag: binding.flag, op: binding.op, subject, refValue: binding.refValue };
  }
  if (binding.kind === 'state') {
    return { kind: 'state', state: binding.state, op: binding.op, subject, refValue: binding.refValue };
  }
  const styleRef = styleNames.get(binding.styleId);
  if (styleRef === undefined) { issues.push(`${path} 引用了不存在的样式`); return null; }
  return {
    kind: 'style', styleRef, subject, refValue: binding.refValue,
    ...(binding.selector === undefined ? {} : { selector: binding.selector }),
  };
}

function localStyleV1(
  style: LocalStyleGroup, path: string, issues: string[], tokens: Map<string, ThemeToken>,
): InlineStyleGroup {
  return {
    ...(style.selector === undefined ? {} : { selector: style.selector }),
    props: propsV1(style.props, `${path}.props`, issues, tokens),
  };
}

function nodeV1(
  node: WidgetNodeV2,
  subjects: Map<string, { name: string; type: SubjectDefV2['type'] }>,
  styleNames: Map<string, string>,
  screenIds: Set<string>,
  path: string,
  issues: string[],
  tokens: Map<string, ThemeToken>,
): WidgetNode {
  return {
    id: node.id,
    type: node.type,
    ...(node.codeName === undefined ? {} : { name: node.codeName }),
    ...(node.displayName === undefined ? {} : { displayName: node.displayName }),
    props: propsV1(node.props, `${path}.props`, issues, tokens),
    ...(node.flags === undefined ? {} : { flags: node.flags }),
    ...(node.states === undefined ? {} : { states: node.states }),
    styles: node.styleRefs.map((ref): StyleUsage => ({
      styleId: ref.styleId,
      ...(ref.selector === undefined ? {} : { selector: ref.selector }),
    })),
    inlineStyles: node.styles.map((style, index) =>
      localStyleV1(style, `${path}.styles[${index}]`, issues, tokens)),
    events: node.events.map((event, index) =>
      eventV1(event, subjects, screenIds, `${path}.events[${index}]`, issues))
      .filter((event): event is EventAction => event !== null),
    bindings: node.bindings.map((binding, index) =>
      bindingV1(
        binding,
        new Map([...subjects].map(([id, subject]) => [id, subject.name])),
        styleNames,
        `${path}.bindings[${index}]`,
        issues,
      ))
      .filter((binding): binding is Binding => binding !== null),
    children: node.children.map((child, index) =>
      nodeV1(child, subjects, styleNames, screenIds, `${path}.children[${index}]`, issues, tokens)),
    ...(node.editor === undefined ? {} : { editor: node.editor }),
  };
}

function fontV1(asset: AssetEntry, path: string, issues: string[]): FontAsset {
  const conv = asset.conv ?? {};
  if (asset.codeName === undefined) issues.push(`${path} 缺 codeName`);
  if (conv.loader !== 'tiny_ttf' && conv.loader !== 'bin') issues.push(`${path}.conv.loader 无效`);
  return {
    name: asset.codeName ?? 'invalid_font', file: asset.file,
    loader: conv.loader === 'bin' ? 'bin' : 'tiny_ttf',
    ...(typeof conv.sizePx === 'number' ? { sizePx: conv.sizePx } : {}),
    ...(typeof conv.bpp === 'number' && typeof conv.ranges === 'string' ? {
      conv: {
        bpp: conv.bpp as 1 | 2 | 4 | 8,
        ranges: conv.ranges,
        ...(typeof conv.symbols === 'string' ? { symbols: conv.symbols } : {}),
        ...(typeof conv.autoCollect === 'boolean' ? { autoCollect: conv.autoCollect } : {}),
        ...(typeof conv.license === 'string' ? { license: conv.license } : {}),
        ...(typeof conv.licenseText === 'string' ? { licenseText: conv.licenseText } : {}),
        ...(typeof conv.licenseUrl === 'string' ? { licenseUrl: conv.licenseUrl } : {}),
        ...(typeof conv.copyright === 'string' ? { copyright: conv.copyright } : {}),
      },
    } : {}),
  };
}

function imageV1(asset: AssetEntry, path: string, issues: string[]): ImageAsset {
  const conv = asset.conv ?? {};
  const formats = ['RGB565', 'RGB565A8', 'ARGB8888', 'I1', 'I2', 'I4', 'I8', 'A8'] as const;
  if (asset.codeName === undefined) issues.push(`${path} 缺 codeName`);
  if (!formats.includes(conv.colorFormat as typeof formats[number])) issues.push(`${path}.conv.colorFormat 无效`);
  return {
    name: asset.codeName ?? 'invalid_image', file: asset.file,
    ...(conv.kind === 'lottie' ? { kind: 'lottie' as const } : {}),
    conv: {
      colorFormat: formats.includes(conv.colorFormat as typeof formats[number])
        ? conv.colorFormat as typeof formats[number] : 'ARGB8888',
      ...(typeof conv.stride === 'number' ? { stride: conv.stride } : {}),
    },
  };
}

/** Convert a validated v2 snapshot to the current transient editor model. */
export function snapshotToEditorProject(snapshot: ProjectSnapshotV2): LvProject {
  const issues: string[] = [];
  const uiValidation = validateUiProjectV2(snapshot.uiProject, { actions: snapshot.actionRegistry });
  if (!uiValidation.valid) issues.push(...uiValidation.errors.map((issue) => `${issue.path}: ${issue.message}`));
  const displayValidation = validateDisplayProfile(snapshot.displayProfile);
  if (!displayValidation.valid) issues.push(...displayValidation.errors.map((issue) => `display.${issue.path}: ${issue.message}`));
  if (`${snapshot.displayProfile.id}@${snapshot.displayProfile.revision}` !== snapshot.uiProject.designDisplayRef) {
    issues.push('displayProfile 与 uiProject.designDisplayRef 不一致');
  }
  if (snapshot.controllerProfile !== null && snapshot.buildTarget.controllerProfileRef !== undefined) {
    const cross = validateCrossRefs({
      uiProject: snapshot.uiProject,
      controller: snapshot.controllerProfile,
      display: snapshot.displayProfile,
      buildTarget: snapshot.buildTarget as Required<BuildTargetDraft>,
    });
    if (!cross.valid) issues.push(...cross.errors.map((issue) => `${issue.path}: ${issue.message}`));
  }

  const depth = displayDepth(snapshot.displayProfile.colorFormat);
  if (depth === null) issues.push(`编辑器暂不支持 ${snapshot.displayProfile.colorFormat} 作为设计画布格式`);
  const embeddedTheme = parseThemeRef(snapshot.buildTarget.themeRef);
  const standaloneTheme = isRefOfKind(snapshot.buildTarget.themeRef, 'theme')
    ? parseRef(snapshot.buildTarget.themeRef)
    : null;
  const themeId = embeddedTheme?.themeId
    ?? (standaloneTheme === null ? null : `theme:${standaloneTheme.slug}`);
  const tokens = themeId === null ? null : resolveTheme(snapshot.uiProject.themes, themeId);
  if (tokens === null) issues.push(`BuildTarget Theme "${snapshot.buildTarget.themeRef}" 无法解析`);
  const resolvedTokens = tokens ?? new Map<string, ThemeToken>();

  const styleNames = new Map<string, string>();
  const collectStyles = (styles: NamedStyleV2[], path: string): void => {
    for (const [index, style] of styles.entries()) {
      if (style.codeName === undefined) issues.push(`${path}[${index}] 缺 codeName`);
      else styleNames.set(style.id, style.codeName);
    }
  };
  collectStyles(snapshot.uiProject.styles, 'styles');
  for (const [index, screen] of snapshot.uiProject.screens.entries()) collectStyles(screen.styles, `screens[${index}].styles`);
  for (const [index, component] of snapshot.uiProject.components.entries()) collectStyles(component.styles, `components[${index}].styles`);
  const subjects = new Map(snapshot.uiProject.subjects.map((subject) => [
    subject.id, { name: subject.codeName, type: subject.type },
  ]));
  const screenIds = new Set(snapshot.uiProject.screens.map((screen) => screen.id));

  const screenV1 = (screen: ScreenDefV2, index: number): ScreenDef => ({
    id: screen.id, name: screen.codeName,
    ...(screen.displayName === undefined ? {} : { displayName: screen.displayName }),
    ...(screen.isHome === undefined ? {} : { isHome: screen.isHome }),
    styles: screen.styles.map((style, styleIndex) =>
      styleV1(style, `screens[${index}].styles[${styleIndex}]`, issues, resolvedTokens)),
    consts: screen.consts,
    root: nodeV1(
      screen.root, subjects, styleNames, screenIds, `screens[${index}].root`, issues, resolvedTokens,
    ),
  });
  const componentV1 = (component: ComponentDefV2, index: number): ComponentDef => ({
    id: component.id, name: component.codeName,
    ...(component.displayName === undefined ? {} : { displayName: component.displayName }),
    api: component.api.map((prop) => ({
      name: prop.name, type: prop.type,
      ...(prop.default === undefined ? {} : { default: String(prop.default) }),
    })),
    styles: component.styles.map((style, styleIndex) =>
      styleV1(style, `components[${index}].styles[${styleIndex}]`, issues, resolvedTokens)),
    consts: component.consts,
    root: nodeV1(
      component.root, subjects, styleNames, screenIds, `components[${index}].root`, issues, resolvedTokens,
    ),
  });

  const project: LvProject = {
    schemaVersion: 1,
    meta: {
      name: snapshot.uiProject.meta.name,
      lvglVersion: '9.4',
      appVersion: snapshot.uiProject.meta.appVersion,
      createdAt: snapshot.uiProject.meta.createdAt,
      modifiedAt: snapshot.uiProject.meta.modifiedAt,
    },
    display: {
      width: snapshot.displayProfile.logicalSize.width,
      height: snapshot.displayProfile.logicalSize.height,
      shape: snapshot.displayProfile.shape,
      colorDepth: depth ?? 32,
      ...(snapshot.displayProfile.dpi === undefined ? {} : { dpi: snapshot.displayProfile.dpi }),
    },
    screens: snapshot.uiProject.screens.map(screenV1),
    components: snapshot.uiProject.components.map(componentV1),
    styles: snapshot.uiProject.styles.map((style, index) =>
      styleV1(style, `styles[${index}]`, issues, resolvedTokens)),
    consts: snapshot.uiProject.consts,
    subjects: snapshot.uiProject.subjects.map(subjectV1),
    assets: {
      fonts: snapshot.uiProject.assets.fonts.map((asset, index) => fontV1(asset, `assets.fonts[${index}]`, issues)),
      images: snapshot.uiProject.assets.images.map((asset, index) => imageV1(asset, `assets.images[${index}]`, issues)),
    },
    translations: snapshot.uiProject.translations,
    codegen: { outputDirName: 'ui', exportXml: false, userIncludes: [] },
    ...(snapshot.uiProject.editor === undefined ? {} : { editor: snapshot.uiProject.editor }),
  };

  if (issues.length > 0) throw new ProjectSnapshotCompatibilityError([...new Set(issues)]);
  return project;
}

export function loadStoredProjectDocument(raw: unknown): LoadedProjectDocument {
  if (!isProjectSnapshotV2(raw)) {
    const legacy = loadProjectJson(raw);
    return { project: legacy.project, snapshot: null, validation: legacy.validation };
  }
  if (typeof raw.uiProject !== 'object' || raw.uiProject === null
    || typeof raw.displayProfile !== 'object' || raw.displayProfile === null
    || typeof raw.buildTarget !== 'object' || raw.buildTarget === null
    || typeof raw.actionRegistry !== 'object' || raw.actionRegistry === null
    || !Array.isArray(raw.migrationNotes)
    || typeof raw.colorFormatConfirmed !== 'boolean'
    || (raw.controllerProfile !== null
      && (typeof raw.controllerProfile !== 'object' || raw.controllerProfile === null))) {
    throw new ProjectFormatError('Schema v2 工程快照缺少 UiProject/Profile/BuildTarget 或门禁状态');
  }
  const project = snapshotToEditorProject(raw);
  const validation = validateUiProjectV2(raw.uiProject, { actions: raw.actionRegistry });
  return { project, snapshot: raw, validation };
}
