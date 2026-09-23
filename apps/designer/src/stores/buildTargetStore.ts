/**
 * Designer 的 Schema v2 持久化快照协调器。
 *
 * UiProject v2 是当前编辑模型；本 Store 协调它与 DisplayProfile、
 * ControllerProfile、BuildTargetDraft 以及 runtime v1 投影，供持久化、预览和发布共同消费。
 * 发布前必须完成 16bpp 字节序和 Controller 选择，并通过 v2 跨引用校验。
 */
import { create } from 'zustand';
import {
  createEmptyProject,
  type InlineStyleGroup,
  type LvProject,
  type NamedStyle,
  type PropValue,
  type WidgetNode,
} from '@lvd/schema';
import {
  formatRef,
  isTokenRef,
  migrateV1ToV2,
  validateCrossRefs,
  type ActionRegistry,
  type BuildTarget,
  type BuildTargetDraft,
  type ColorFormat,
  type ControllerProfile,
  type DisplayProfile,
  type MigrationNote,
  type NamedStyleV2,
  type ProjectSnapshotV2,
  type PropValueV2,
  type ThemeRevision,
  type UiProject,
  type WidgetNodeV2,
} from '@lvd/schema/v2';

export type PreviewColorFormat = Extract<
  ColorFormat,
  'RGB565' | 'RGB565_SWAPPED' | 'RGB888' | 'XRGB8888' | 'ARGB8888'
>;

export type ControllerPreset = 'screen-only';

export const PREVIEW_COLOR_FORMATS: readonly PreviewColorFormat[] = [
  'RGB565', 'RGB565_SWAPPED', 'RGB888', 'XRGB8888', 'ARGB8888',
];

/** public/controllers/screen-only.svg 的内容寻址引用。 */
export const SCREEN_ONLY_FRAME_REF =
  'asset:controller/screen-only.svg@sha256:10728d35a077e58fad2d6ad1cbeb18fafbbfd9c39488e3ecc3492f672ae8297d' as const;

const FORMATS_BY_DEPTH: Record<16 | 24 | 32, readonly PreviewColorFormat[]> = {
  16: ['RGB565', 'RGB565_SWAPPED'],
  24: ['RGB888'],
  32: ['XRGB8888', 'ARGB8888'],
};

function sourceKey(project: LvProject): string {
  const d = project.display;
  return [project.meta.name, d.width, d.height, d.shape, d.colorDepth, d.dpi ?? ''].join(':');
}

function displayRef(profile: DisplayProfile) {
  return formatRef('display', profile.id.replace(/^display:/, ''), profile.revision);
}

function controllerRef(profile: ControllerProfile) {
  return formatRef('controller', profile.id.replace(/^controller:/, ''), profile.revision);
}

interface TargetDraft {
  uiProject: UiProject;
  actionRegistry: ActionRegistry;
  displayProfile: DisplayProfile;
  controllerProfile: ControllerProfile | null;
  controllerPreset: ControllerPreset | null;
  buildTargetDraft: BuildTargetDraft;
  migrationNotes: MigrationNote[];
  colorFormatConfirmed: boolean;
}

export function inferActionRegistry(uiProject: UiProject): ActionRegistry {
  const registry: ActionRegistry = {};
  const visit = (node: WidgetNodeV2): void => {
    for (const event of node.events) {
      if (event.action.startsWith('custom.') && registry[event.action] === undefined) {
        registry[event.action] = {
          id: event.action,
          displayName: event.action.slice('custom.'.length),
          description: '由旧版 callback 迁移的受控回调契约',
          params: [{ name: 'userData', type: 'string' }],
        };
      }
    }
    node.children.forEach(visit);
  };
  uiProject.screens.forEach((screen) => visit(screen.root));
  uiProject.components.forEach((component) => visit(component.root));
  return registry;
}

function acknowledgeProductVersion(notes: MigrationNote[]): MigrationNote[] {
  return notes.map((note) => note.code === 'lvgl-version-moved'
    ? {
        severity: 'info',
        code: 'lvgl-version-target-fixed',
        path: 'buildTarget.lvglVersion',
        message: 'Designer 产品发布目标已明确固定为 LVGL 9.5.0。',
      }
    : note);
}

function makeDraft(project: LvProject): TargetDraft {
  const migrated = migrateV1ToV2(project, { lvglVersion: '9.5.0' });
  return {
    uiProject: migrated.uiProject,
    actionRegistry: inferActionRegistry(migrated.uiProject),
    displayProfile: migrated.displayProfile,
    controllerProfile: null,
    controllerPreset: null,
    buildTargetDraft: migrated.buildTargetDraft,
    migrationNotes: acknowledgeProductVersion(migrated.notes),
    colorFormatConfirmed: project.display.colorDepth !== 16,
  };
}

/** 为尚未打开的新工程创建独立快照，不读写当前编辑会话。 */
export function createFreshProjectSnapshot(project: LvProject): ProjectSnapshotV2 {
  const draft = makeDraft(project);
  return {
    kind: 'lvgl-project-snapshot',
    snapshotVersion: 1,
    uiProject: draft.uiProject,
    displayProfile: draft.displayProfile,
    controllerProfile: draft.controllerProfile,
    buildTarget: draft.buildTargetDraft,
    actionRegistry: draft.actionRegistry,
    migrationNotes: draft.migrationNotes,
    colorFormatConfirmed: draft.colorFormatConfirmed,
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function selectorKey(group: { selector?: unknown }): string {
  return JSON.stringify(group.selector ?? null);
}

function restoreTokenProps(
  previous: Record<string, PropValueV2>,
  oldProjection: Record<string, PropValue>,
  newProjection: Record<string, PropValue>,
  next: Record<string, PropValueV2>,
): void {
  for (const [key, value] of Object.entries(previous)) {
    if (isTokenRef(value) && sameValue(oldProjection[key], newProjection[key])) next[key] = value;
  }
}

function restoreNamedStyleTokens(
  previous: readonly NamedStyleV2[],
  oldProjection: readonly NamedStyle[],
  newProjection: readonly NamedStyle[],
  next: NamedStyleV2[],
): void {
  const oldById = new Map(oldProjection.map((style) => [style.id, style]));
  const newById = new Map(newProjection.map((style) => [style.id, style]));
  for (const style of next) {
    const prior = previous.find((item) => item.id === style.id);
    const oldStyle = oldById.get(style.id);
    const newStyle = newById.get(style.id);
    if (prior && oldStyle && newStyle) {
      restoreTokenProps(prior.props, oldStyle.props, newStyle.props, style.props);
    }
  }
}

function restoreNodeTokens(
  previous: WidgetNodeV2,
  oldProjection: WidgetNode,
  newProjection: WidgetNode,
  next: WidgetNodeV2,
): void {
  restoreTokenProps(previous.props, oldProjection.props, newProjection.props, next.props);
  const oldGroups = new Map(oldProjection.inlineStyles.map((group) => [selectorKey(group), group]));
  const newGroups = new Map(newProjection.inlineStyles.map((group) => [selectorKey(group), group]));
  const priorGroups = new Map(previous.styles.map((group) => [selectorKey(group), group]));
  for (const group of next.styles) {
    const key = selectorKey(group);
    const prior = priorGroups.get(key);
    const oldGroup = oldGroups.get(key) as InlineStyleGroup | undefined;
    const newGroup = newGroups.get(key) as InlineStyleGroup | undefined;
    if (prior && oldGroup && newGroup) {
      restoreTokenProps(prior.props, oldGroup.props, newGroup.props, group.props);
    }
  }
  const oldChildren = new Map(oldProjection.children.map((node) => [node.id, node]));
  const newChildren = new Map(newProjection.children.map((node) => [node.id, node]));
  const priorChildren = new Map(previous.children.map((node) => [node.id, node]));
  for (const child of next.children) {
    const prior = priorChildren.get(child.id);
    const oldChild = oldChildren.get(child.id);
    const newChild = newChildren.get(child.id);
    if (prior && oldChild && newChild) restoreNodeTokens(prior, oldChild, newChild, child);
  }
}

/** Keep v2-only semantics while a legacy editor projection is still in use. */
function preserveV2Data(
  previous: UiProject,
  oldProjection: LvProject,
  newProjection: LvProject,
  migrated: UiProject,
): UiProject {
  const oldScreens = new Map(oldProjection.screens.map((screen) => [screen.id, screen]));
  const newScreens = new Map(newProjection.screens.map((screen) => [screen.id, screen]));
  const priorScreens = new Map(previous.screens.map((screen) => [screen.id, screen]));
  for (const screen of migrated.screens) {
    const prior = priorScreens.get(screen.id);
    const oldScreen = oldScreens.get(screen.id);
    const newScreen = newScreens.get(screen.id);
    if (!prior || !oldScreen || !newScreen) continue;
    restoreNamedStyleTokens(prior.styles, oldScreen.styles, newScreen.styles, screen.styles);
    restoreNodeTokens(prior.root, oldScreen.root, newScreen.root, screen.root);
  }
  restoreNamedStyleTokens(previous.styles, oldProjection.styles, newProjection.styles, migrated.styles);
  const oldComponents = new Map(oldProjection.components.map((item) => [item.id, item]));
  const newComponents = new Map(newProjection.components.map((item) => [item.id, item]));
  const priorComponents = new Map(previous.components.map((item) => [item.id, item]));
  for (const component of migrated.components) {
    const prior = priorComponents.get(component.id);
    const oldComponent = oldComponents.get(component.id);
    const newComponent = newComponents.get(component.id);
    if (!prior || !oldComponent || !newComponent) continue;
    restoreNamedStyleTokens(prior.styles, oldComponent.styles, newComponent.styles, component.styles);
    restoreNodeTokens(prior.root, oldComponent.root, newComponent.root, component.root);
    if (sameValue(oldComponent.api, newComponent.api)) component.api = prior.api;
  }
  return {
    ...migrated,
    meta: { ...migrated.meta, id: previous.meta.id, revision: previous.meta.revision },
    themes: previous.themes,
    assets: { ...migrated.assets, icons: previous.assets.icons },
  };
}

function screenOnlyController(profile: DisplayProfile): ControllerProfile {
  const suffix = profile.id.replace(/^display:/, '');
  return {
    schemaVersion: 1,
    kind: 'controller-profile',
    id: `controller:screen-only-${suffix}`,
    revision: 1,
    model: 'SCREEN-ONLY',
    displayName: `裸屏 · ${profile.logicalSize.width}×${profile.logicalSize.height}`,
    displayRef: displayRef(profile),
    frame: {
      assetRef: SCREEN_ONLY_FRAME_REF,
      viewBox: { x: 0, y: 0, width: 1, height: 1 },
      screenViewport: {
        x: 0, y: 0, width: 1, height: 1, rotation: 0,
        clip: profile.shape === 'round' ? { type: 'circle' } : { type: 'rect' },
      },
    },
  };
}

function withoutController(draft: TargetDraft): TargetDraft {
  const { controllerProfileRef: _removed, ...buildTargetDraft } = draft.buildTargetDraft;
  const ref = displayRef(draft.displayProfile);
  return {
    ...draft,
    controllerProfile: null,
    controllerPreset: null,
    buildTargetDraft,
    migrationNotes: [
      ...draft.migrationNotes.filter((note) =>
        note.code !== 'controller-profile-missing' && note.code !== 'controller-profile-selected'),
      {
        severity: 'must-confirm',
        code: 'controller-profile-missing',
        path: 'buildTarget.controllerProfileRef',
        message: 'BuildTarget 尚未选择 ControllerProfile；所选 Profile 的 displayRef 必须等于 '
          + `"${ref}"。`,
      },
    ],
  };
}

function withController(draft: TargetDraft, preset: ControllerPreset): TargetDraft {
  const controller = preset === 'screen-only' ? screenOnlyController(draft.displayProfile) : null;
  if (controller === null) return withoutController(draft);
  const ref = controllerRef(controller);
  return {
    ...draft,
    controllerProfile: controller,
    controllerPreset: preset,
    buildTargetDraft: { ...draft.buildTargetDraft, controllerProfileRef: ref },
    migrationNotes: [
      ...draft.migrationNotes.filter((note) =>
        note.code !== 'controller-profile-missing' && note.code !== 'controller-profile-selected'),
      {
        severity: 'info',
        code: 'controller-profile-selected',
        path: 'buildTarget.controllerProfileRef',
        message: `用户已选择 ControllerProfile ${ref}，displayRef=${controller.displayRef}。`,
      },
    ],
  };
}

/** Display 快照变化时原子重写 UI/Controller/Target 三处引用。 */
function relinkDisplay(draft: TargetDraft): TargetDraft {
  const next: TargetDraft = {
    ...draft,
    uiProject: { ...draft.uiProject, designDisplayRef: displayRef(draft.displayProfile) },
  };
  return draft.controllerPreset === null
    ? withoutController(next)
    : withController(next, draft.controllerPreset);
}

function withConfirmedFormat(draft: TargetDraft, format: PreviewColorFormat): TargetDraft {
  const size = draft.displayProfile.logicalSize;
  const slug = `${size.width}x${size.height}-${format.toLowerCase().replaceAll('_', '-')}`;
  const profile: DisplayProfile = {
    ...draft.displayProfile,
    id: `display:${slug}`,
    displayName: `${size.width}×${size.height} ${draft.displayProfile.shape === 'round' ? '圆' : '方'} ${format}`,
    colorFormat: format,
  };
  return relinkDisplay({
    ...draft,
    displayProfile: profile,
    migrationNotes: [
      ...draft.migrationNotes.filter((note) =>
        note.code !== 'color-format-ambiguous' && note.code !== 'color-format-confirmed'),
      {
        severity: 'info',
        code: 'color-format-confirmed',
        path: 'display.colorDepth',
        message: `用户已确认 DisplayProfile ${displayRef(profile)} 使用 ${format}`,
      },
    ],
    colorFormatConfirmed: true,
  });
}

function fromState(state: BuildTargetStoreState): TargetDraft {
  return {
    uiProject: state.uiProject,
    actionRegistry: state.actionRegistry,
    displayProfile: state.displayProfile,
    controllerProfile: state.controllerProfile,
    controllerPreset: state.controllerPreset,
    buildTargetDraft: state.buildTargetDraft,
    migrationNotes: state.migrationNotes,
    colorFormatConfirmed: state.colorFormatConfirmed,
  };
}

export interface BuildTargetStoreState extends TargetDraft {
  /** Immer 每次语义编辑都会产生新根对象；用于保证迁移后的 UiProject 不陈旧。 */
  sourceProject: LvProject;
  sourceKey: string;
  revision: number;
  catalogTargetRef: string | null;
  syncProject(project: LvProject): boolean;
  loadSnapshot(project: LvProject, snapshot: ProjectSnapshotV2): void;
  replaceUiProject(project: LvProject, uiProject: UiProject): void;
  replaceActionRegistry(actionRegistry: ActionRegistry): void;
  confirmColorFormat(format: PreviewColorFormat): boolean;
  clearColorFormatConfirmation(): void;
  selectController(preset: ControllerPreset | null): void;
  selectCatalogTarget(
    buildTarget: BuildTarget,
    display: DisplayProfile,
    controller: ControllerProfile,
    theme?: ThemeRevision,
  ): TargetValidationIssue[];
}

export interface TargetValidationIssue {
  code: string;
  message: string;
}

export interface TargetReadiness {
  ready: boolean;
  buildTarget: BuildTarget | null;
  errors: TargetValidationIssue[];
  warnings: TargetValidationIssue[];
}

const initialProject = createEmptyProject();
const initial = makeDraft(initialProject);

export const useBuildTargetStore = create<BuildTargetStoreState>()((set, get) => ({
  sourceProject: initialProject,
  sourceKey: sourceKey(initialProject),
  ...initial,
  revision: 0,
  catalogTargetRef: null,

  syncProject(project) {
    if (project === get().sourceProject) return false;
    const key = sourceKey(project);
    const state = get();
    const currentFormat = state.displayProfile.colorFormat as PreviewColorFormat;
    let next = makeDraft(project);
    const previousNodeIds = new Set(state.sourceProject.screens.map((screen) => screen.root.id));
    const sameDocument = state.sourceProject.meta.createdAt === project.meta.createdAt
      && project.screens.some((screen) => previousNodeIds.has(screen.root.id));
    if (sameDocument) {
      next = {
        ...next,
        uiProject: preserveV2Data(state.uiProject, state.sourceProject, project, next.uiProject),
        actionRegistry: { ...state.actionRegistry, ...inferActionRegistry(next.uiProject) },
      };
    }
    const uiRef = `${next.uiProject.meta.id}@${next.uiProject.meta.revision}` as `ui:${string}@${number}`;
    next = {
      ...next,
      buildTargetDraft: {
        ...next.buildTargetDraft,
        uiProjectRef: uiRef,
        themeRef: `${uiRef}#theme:${next.uiProject.themes[0]?.id ?? 'default'}`,
      },
    };
    if (state.colorFormatConfirmed
      && FORMATS_BY_DEPTH[project.display.colorDepth].includes(currentFormat)) {
      next = withConfirmedFormat(next, currentFormat);
    }
    if (state.controllerPreset !== null) next = withController(next, state.controllerPreset);
    set({
      sourceProject: project, sourceKey: key, ...next,
      catalogTargetRef: null,
      revision: state.revision + 1,
    });
    return true;
  },

  loadSnapshot(project, snapshot) {
    const controllerPreset = snapshot.controllerProfile?.model === 'SCREEN-ONLY'
      ? 'screen-only' as const
      : null;
    set({
      sourceProject: project,
      sourceKey: sourceKey(project),
      uiProject: snapshot.uiProject,
      actionRegistry: snapshot.actionRegistry,
      displayProfile: snapshot.displayProfile,
      controllerProfile: snapshot.controllerProfile,
      controllerPreset,
      buildTargetDraft: snapshot.buildTarget,
      migrationNotes: snapshot.migrationNotes,
      colorFormatConfirmed: snapshot.colorFormatConfirmed,
      catalogTargetRef: null,
      revision: get().revision + 1,
    });
  },

  replaceUiProject(project, uiProject) {
    const state = get();
    const uiRef = `${uiProject.meta.id}@${uiProject.meta.revision}` as `ui:${string}@${number}`;
    const embeddedTheme = state.buildTargetDraft.themeRef.match(/#theme:(.+)$/)?.[1];
    const themeId = embeddedTheme && uiProject.themes.some((theme) => theme.id === embeddedTheme)
      ? embeddedTheme
      : uiProject.themes[0]?.id ?? 'default';
    set({
      sourceProject: project,
      sourceKey: sourceKey(project),
      uiProject,
      actionRegistry: { ...state.actionRegistry, ...inferActionRegistry(uiProject) },
      buildTargetDraft: {
        ...state.buildTargetDraft,
        uiProjectRef: uiRef,
        themeRef: `${uiRef}#theme:${themeId}`,
      },
      catalogTargetRef: null,
      revision: state.revision + 1,
    });
  },

  replaceActionRegistry(actionRegistry) {
    const state = get();
    set({
      actionRegistry,
      catalogTargetRef: null,
      revision: state.revision + 1,
    });
  },

  confirmColorFormat(format) {
    const state = get();
    const depth = state.displayProfile.colorFormat === 'RGB888' ? 24
      : state.displayProfile.colorFormat === 'XRGB8888' || state.displayProfile.colorFormat === 'ARGB8888' ? 32
        : 16;
    if (!FORMATS_BY_DEPTH[depth].includes(format)) return false;
    const next = withConfirmedFormat(fromState(state), format);
    set({ ...next, catalogTargetRef: null, revision: state.revision + 1 });
    return true;
  },

  clearColorFormatConfirmation() {
    const state = get();
    const depth = state.displayProfile.colorFormat === 'RGB888' ? 24
      : state.displayProfile.colorFormat === 'XRGB8888' || state.displayProfile.colorFormat === 'ARGB8888' ? 32
        : 16;
    if (depth !== 16 || !state.colorFormatConfirmed) return;
    const size = state.displayProfile.logicalSize;
    const profile: DisplayProfile = {
      ...state.displayProfile,
      id: `display:${size.width}x${size.height}-rgb565`,
      displayName: `${size.width}×${size.height} ${state.displayProfile.shape === 'round' ? '圆' : '方'} RGB565`,
      colorFormat: 'RGB565',
    };
    const next = relinkDisplay({
      ...fromState(state),
      displayProfile: profile,
      migrationNotes: [
        ...state.migrationNotes.filter((note) =>
          note.code !== 'color-format-confirmed' && note.code !== 'color-format-ambiguous'),
        {
          severity: 'must-confirm',
          code: 'color-format-ambiguous',
          path: 'display.colorDepth',
          message: 'v1 colorDepth=16 无法区分 RGB565 与 RGB565_SWAPPED，发布前必须确认。',
        },
      ],
      colorFormatConfirmed: false,
    });
    set({ ...next, catalogTargetRef: null, revision: state.revision + 1 });
  },

  selectController(preset) {
    const state = get();
    const next = preset === null
      ? withoutController(fromState(state))
      : withController(fromState(state), preset);
    set({ ...next, catalogTargetRef: null, revision: state.revision + 1 });
  },

  selectCatalogTarget(buildTarget, display, controller, theme) {
    const state = get();
    const uiRef = `${state.uiProject.meta.id}@${state.uiProject.meta.revision}`;
    if (buildTarget.uiProjectRef !== uiRef) {
      return [{
        code: 'ui-project-ref-mismatch',
        message: `BuildTarget 锁定 ${buildTarget.uiProjectRef}，当前工程是 ${uiRef}`,
      }];
    }
    let uiProject = state.uiProject;
    if (buildTarget.themeRef.startsWith('theme:')) {
      if (theme === undefined || `${theme.id}@${theme.revision}` !== buildTarget.themeRef) {
        return [{ code: 'theme-revision-required', message: '独立 Theme revision 未加载或与 BuildTarget 不一致' }];
      }
      uiProject = {
        ...uiProject,
        themes: [{
          id: theme.id,
          ...(theme.displayName === undefined ? {} : { displayName: theme.displayName }),
          tokens: theme.tokens,
        }, ...uiProject.themes.filter((item) => item.id !== theme.id)],
      };
    }
    const result = validateCrossRefs({ uiProject, controller, display, buildTarget });
    if (!result.valid) {
      return result.errors.map(({ code, message }) => ({ code, message }));
    }
    set({
      uiProject,
      displayProfile: display,
      controllerProfile: controller,
      controllerPreset: null,
      buildTargetDraft: buildTarget,
      colorFormatConfirmed: true,
      catalogTargetRef: `${buildTarget.id}@${buildTarget.revision}`,
      migrationNotes: [
        ...state.migrationNotes.filter((note) =>
          note.code !== 'controller-profile-missing' && note.code !== 'controller-profile-selected'),
        {
          severity: 'info',
          code: 'catalog-target-selected',
          path: 'buildTarget',
          message: `已选择平台 BuildTarget ${buildTarget.id}@${buildTarget.revision}`,
        },
      ],
      revision: state.revision + 1,
    });
    return [];
  },
}));

/** 当前真实 framebuffer 格式；未确认的 16bpp 仅回退为编辑态 XRGB8888。 */
export function runtimeColorFormat(state = useBuildTargetStore.getState()): PreviewColorFormat {
  const format = state.displayProfile.colorFormat;
  return state.colorFormatConfirmed && PREVIEW_COLOR_FORMATS.includes(format as PreviewColorFormat)
    ? format as PreviewColorFormat
    : 'XRGB8888';
}

export function compatiblePreviewFormats(depth: 16 | 24 | 32): readonly PreviewColorFormat[] {
  return FORMATS_BY_DEPTH[depth];
}

/** 发布门禁：返回已锁定的 BuildTarget 快照以及 v2 跨引用诊断。 */
export function validateReleaseTarget(
  state = useBuildTargetStore.getState(),
): TargetReadiness {
  const errors: TargetValidationIssue[] = [];
  if (!state.colorFormatConfirmed) {
    errors.push({
      code: 'color-format-confirm-required',
      message: '当前 16bpp 工程尚未确认 RGB565 字节序',
    });
  }
  if (state.controllerProfile === null || state.buildTargetDraft.controllerProfileRef === undefined) {
    errors.push({
      code: 'controller-profile-required',
      message: '尚未选择 ControllerProfile',
    });
  }
  for (const note of state.migrationNotes.filter((item) => item.severity === 'must-confirm')) {
    if (note.code !== 'color-format-ambiguous' && note.code !== 'controller-profile-missing') {
      errors.push({ code: note.code, message: note.message });
    }
  }
  if (errors.length > 0 || state.controllerProfile === null
    || state.buildTargetDraft.controllerProfileRef === undefined) {
    return { ready: false, buildTarget: null, errors, warnings: [] };
  }

  const buildTarget: BuildTarget = {
    ...state.buildTargetDraft,
    controllerProfileRef: state.buildTargetDraft.controllerProfileRef,
    themeRef: state.buildTargetDraft.themeRef as BuildTarget['themeRef'],
  };
  const result = validateCrossRefs({
    uiProject: state.uiProject,
    controller: state.controllerProfile,
    display: state.displayProfile,
    buildTarget,
    capability: {
      version: '9.5.0',
      supportedColorFormats: PREVIEW_COLOR_FORMATS,
      supportedWidgets: [],
      hasXmlEngine: false,
    },
  });
  return {
    ready: result.errors.length === 0,
    buildTarget: result.errors.length === 0 ? buildTarget : null,
    errors: result.errors.map(({ code, message }) => ({ code, message })),
    warnings: result.warnings.map(({ code, message }) => ({ code, message })),
  };
}
