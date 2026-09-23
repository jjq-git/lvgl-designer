import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@lvd/schema';
import {
  migrateV1ToV2,
  snapshotToEditorProject,
  type ProjectSnapshotV2,
} from '@lvd/schema/v2';
import {
  compatiblePreviewFormats,
  runtimeColorFormat,
  useBuildTargetStore,
  validateReleaseTarget,
} from './buildTargetStore';

describe('BuildTarget/DisplayProfile preview sidecar', () => {
  beforeEach(() => {
    const project = createEmptyProject(`target-${Math.random()}`);
    useBuildTargetStore.getState().syncProject(project);
    useBuildTargetStore.getState().clearColorFormatConfirmation();
    useBuildTargetStore.getState().selectController(null);
  });

  it('v1 16bpp 保持未确认，编辑预览才回退 XRGB8888', () => {
    const state = useBuildTargetStore.getState();
    expect(state.buildTargetDraft.lvglVersion).toBe('9.5.0');
    expect(state.displayProfile.colorFormat).toBe('RGB565');
    expect(state.colorFormatConfirmed).toBe(false);
    expect(runtimeColorFormat(state)).toBe('XRGB8888');
    expect(state.uiProject.designDisplayRef)
      .toBe(`${state.displayProfile.id}@${state.displayProfile.revision}`);
    expect(validateReleaseTarget(state).errors.map((issue) => issue.code))
      .toEqual(expect.arrayContaining(['color-format-confirm-required', 'controller-profile-required']));
    expect(state.migrationNotes).toContainEqual(expect.objectContaining({
      severity: 'must-confirm', code: 'color-format-ambiguous',
    }));
  });

  it('确认 RGB565 字节序后由 DisplayProfile 驱动真实预览格式', () => {
    expect(useBuildTargetStore.getState().confirmColorFormat('RGB565_SWAPPED')).toBe(true);
    const state = useBuildTargetStore.getState();
    expect(state.colorFormatConfirmed).toBe(true);
    expect(state.displayProfile.colorFormat).toBe('RGB565_SWAPPED');
    expect(state.displayProfile.id).toContain('rgb565-swapped');
    expect(runtimeColorFormat(state)).toBe('RGB565_SWAPPED');
    expect(state.migrationNotes.some((note) => note.code === 'color-format-ambiguous')).toBe(false);
    expect(state.migrationNotes).toContainEqual(expect.objectContaining({
      code: 'controller-profile-missing',
      message: expect.stringContaining(`${state.displayProfile.id}@${state.displayProfile.revision}`),
    }));

    const renamed = createEmptyProject('renamed-after-confirm');
    useBuildTargetStore.getState().syncProject(renamed);
    expect(useBuildTargetStore.getState().displayProfile.colorFormat).toBe('RGB565_SWAPPED');
    expect(useBuildTargetStore.getState().colorFormatConfirmed).toBe(true);
  });

  it('24/32bpp 可确定性派生，并拒绝与深度不兼容的格式', () => {
    const project = createEmptyProject('target-24');
    project.display.colorDepth = 24;
    useBuildTargetStore.getState().syncProject(project);
    expect(runtimeColorFormat()).toBe('RGB888');
    expect(useBuildTargetStore.getState().colorFormatConfirmed).toBe(true);
    expect(useBuildTargetStore.getState().confirmColorFormat('RGB565')).toBe(false);
    expect(compatiblePreviewFormats(32)).toEqual(['XRGB8888', 'ARGB8888']);
  });

  it('选择裸屏 Controller 后锁定四对象引用并通过发布门禁', () => {
    useBuildTargetStore.getState().confirmColorFormat('RGB565_SWAPPED');
    useBuildTargetStore.getState().selectController('screen-only');

    const state = useBuildTargetStore.getState();
    const displayRef = `${state.displayProfile.id}@${state.displayProfile.revision}`;
    const controllerRef = `${state.controllerProfile!.id}@${state.controllerProfile!.revision}`;
    expect(state.uiProject.designDisplayRef).toBe(displayRef);
    expect(state.controllerProfile?.displayRef).toBe(displayRef);
    expect(state.buildTargetDraft.controllerProfileRef).toBe(controllerRef);
    expect(state.controllerProfile?.frame.screenViewport.clip).toEqual({ type: 'circle' });

    const readiness = validateReleaseTarget(state);
    expect(readiness.errors).toEqual([]);
    expect(readiness.ready).toBe(true);
    expect(readiness.buildTarget?.controllerProfileRef).toBe(controllerRef);
  });

  it('Display 格式变化时重建 Controller 快照和全部引用', () => {
    useBuildTargetStore.getState().confirmColorFormat('RGB565');
    useBuildTargetStore.getState().selectController('screen-only');
    const before = useBuildTargetStore.getState().buildTargetDraft.controllerProfileRef;

    useBuildTargetStore.getState().confirmColorFormat('RGB565_SWAPPED');
    const state = useBuildTargetStore.getState();
    const displayRef = `${state.displayProfile.id}@${state.displayProfile.revision}`;
    expect(state.buildTargetDraft.controllerProfileRef).not.toBe(before);
    expect(state.uiProject.designDisplayRef).toBe(displayRef);
    expect(state.controllerProfile?.displayRef).toBe(displayRef);
    expect(validateReleaseTarget(state).ready).toBe(true);

    useBuildTargetStore.getState().selectController(null);
    expect(useBuildTargetStore.getState().buildTargetDraft.controllerProfileRef).toBeUndefined();
    expect(validateReleaseTarget().errors.map((issue) => issue.code))
      .toContain('controller-profile-required');
  });

  it('普通节点编辑也刷新迁移后的 UiProject，同时保留已确认目标', () => {
    const project = createEmptyProject('semantic-sync');
    useBuildTargetStore.getState().syncProject(project);
    useBuildTargetStore.getState().confirmColorFormat('RGB565_SWAPPED');
    useBuildTargetStore.getState().selectController('screen-only');

    const edited = structuredClone(project);
    edited.screens[0]!.root.props.x = 23;
    expect(useBuildTargetStore.getState().syncProject(edited)).toBe(true);

    const state = useBuildTargetStore.getState();
    expect(state.uiProject.screens[0]!.root.props.x).toBe(23);
    expect(state.displayProfile.colorFormat).toBe('RGB565_SWAPPED');
    expect(state.controllerPreset).toBe('screen-only');
    expect(validateReleaseTarget(state).ready).toBe(true);
  });

  it('legacy projection refresh keeps manually configured device actions', () => {
    const state = useBuildTargetStore.getState();
    useBuildTargetStore.getState().replaceActionRegistry({
      ...state.actionRegistry,
      'custom.wifi_scan': {
        id: 'custom.wifi_scan',
        displayName: '扫描 Wi-Fi',
        params: [{ name: 'userData', type: 'string' }],
      },
    });
    const edited = structuredClone(useBuildTargetStore.getState().sourceProject);
    edited.screens[0]!.root.props.x = 31;
    useBuildTargetStore.getState().syncProject(edited);
    expect(useBuildTargetStore.getState().actionRegistry['custom.wifi_scan']?.id)
      .toBe('custom.wifi_scan');
  });

  it('旧投影编辑不会覆盖未触及的 Theme Token 和 icons', () => {
    const source = createEmptyProject('v2-preserve');
    const migrated = migrateV1ToV2(source);
    migrated.uiProject.themes[0]!.tokens.push({
      id: 'color.text.primary', type: 'color', value: '#ffffff',
    });
    migrated.uiProject.screens[0]!.root.styles.push({
      props: { text_color: { $token: 'color.text.primary' } },
    });
    migrated.uiProject.assets.icons.push({
      id: 'icon:home', file: { fileName: 'home.svg', sha256: 'a'.repeat(64), byteSize: 12 },
    });
    const snapshot: ProjectSnapshotV2 = {
      kind: 'lvgl-project-snapshot',
      snapshotVersion: 1,
      uiProject: migrated.uiProject,
      displayProfile: migrated.displayProfile,
      controllerProfile: null,
      buildTarget: migrated.buildTargetDraft,
      actionRegistry: {},
      migrationNotes: migrated.notes,
      colorFormatConfirmed: false,
    };
    const projection = snapshotToEditorProject(snapshot);
    useBuildTargetStore.getState().loadSnapshot(projection, snapshot);

    const geometryEdit = structuredClone(projection);
    geometryEdit.screens[0]!.root.props.x = 17;
    useBuildTargetStore.getState().syncProject(geometryEdit);
    let state = useBuildTargetStore.getState();
    expect(state.uiProject.screens[0]!.root.styles[0]!.props.text_color)
      .toEqual({ $token: 'color.text.primary' });
    expect(state.uiProject.assets.icons).toEqual(snapshot.uiProject.assets.icons);

    const styleEdit = structuredClone(geometryEdit);
    styleEdit.screens[0]!.root.inlineStyles[0]!.props.text_color = '#000000';
    useBuildTargetStore.getState().syncProject(styleEdit);
    state = useBuildTargetStore.getState();
    expect(state.uiProject.screens[0]!.root.styles[0]!.props.text_color).toBe('#000000');
  });

  it('应用 Catalog BuildTarget 时解析并锁定独立 Theme revision', () => {
    const before = useBuildTargetStore.getState();
    const display = { ...before.displayProfile, colorFormat: 'RGB565_SWAPPED' as const };
    const displayRef = `${display.id}@${display.revision}` as `display:${string}@${number}`;
    const controller = {
      schemaVersion: 1 as const,
      kind: 'controller-profile' as const,
      id: 'controller:catalog',
      revision: 2,
      model: 'CATALOG',
      displayRef,
      frame: {
        assetRef: `asset:frame@sha256:${'0'.repeat(64)}` as `asset:${string}@sha256:${string}`,
        viewBox: { x: 0, y: 0, width: 240, height: 240 },
        screenViewport: { x: 0, y: 0, width: 240, height: 240, rotation: 0 as const },
      },
    };
    const uiRef = `${before.uiProject.meta.id}@${before.uiProject.meta.revision}` as `ui:${string}@${number}`;
    const target = {
      schemaVersion: 1 as const,
      kind: 'lvgl-build-target' as const,
      id: 'target:catalog',
      revision: 3,
      uiProjectRef: uiRef,
      controllerProfileRef: 'controller:catalog@2' as const,
      themeRef: 'theme:night@4' as const,
      firmwareProfileRef: 'firmware:test@1' as const,
      lvglVersion: '9.5.0' as const,
    };
    const issues = useBuildTargetStore.getState().selectCatalogTarget(target, display, controller, {
      schemaVersion: 1,
      kind: 'lvgl-theme',
      id: 'theme:night',
      revision: 4,
      tokens: [{ id: 'color.text', type: 'color', value: '#ffffff' }],
    });
    expect(issues).toEqual([]);
    expect(useBuildTargetStore.getState().catalogTargetRef).toBe('target:catalog@3');
    expect(useBuildTargetStore.getState().uiProject.themes[0]).toMatchObject({
      id: 'theme:night', tokens: [{ id: 'color.text', value: '#ffffff' }],
    });
  });
});
