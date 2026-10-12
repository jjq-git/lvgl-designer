/**
 * 工具条:undo/redo、缩放、设计/运行、圆屏开关、屏幕尺寸预设、新建/打开/保存/导出。
 */
import { useEffect, useRef, useState } from 'react';
import type { LvProject } from '@lvd/schema';
import { useProjectStore } from './stores/projectStore';
import { useEditorStore } from './stores/editorStore';
import { exportUiZip, exportWebUiJson, openProjectFile } from './services/exportZip';
import { UserMenu } from './panels/auth/UserMenu';
import { useProjectsStore } from './stores/projectsStore';
import { SyncBadge } from './panels/cloud/SyncBadge';
import { hasPermission, useAuthStore } from './stores/authStore';
import { getProject } from './services/cloudStorage';
import {
  excludeCloudDuplicateLocal,
  excludePersistedBuiltIns,
  storedProjectDisplay,
  type ProjectDisplaySpec,
} from './services/projectPicker';
import { FALLBACK_DISPLAY_PRESETS } from './services/displayPresets';
import { loadLastProject } from './services/storage';
import {
  BUILT_IN_PROJECTS,
  findBuiltInProject,
  isLegacyWf3NavigationProject,
} from './services/builtInProjects';

const LOCAL_PROJECT_PICKER_ID = 'local:last';

interface ProjectPickerOption extends ProjectDisplaySpec {
  id: string;
  name: string;
  version?: number;
  source: 'cloud' | 'local' | 'builtin';
  project?: LvProject;
}

function presetMatchesDisplay(
  preset: ProjectDisplaySpec,
  candidate: ProjectDisplaySpec,
): boolean {
  return preset.width === candidate.width
    && preset.height === candidate.height
    && preset.shape === candidate.shape;
}

export function Toolbar(): JSX.Element {
  const dirty = useProjectStore((s) => s.dirty);
  const activeProject = useProjectStore((s) => s.project);
  const display = activeProject.display;
  const mode = useEditorStore((s) => s.mode);
  const runtimeKind = useEditorStore((s) => s.runtimeKind);
  const canPublishSite = useAuthStore((state) => hasPermission(state.me, 'tool.lvgl.publish'));
  const cloudProjectId = useProjectsStore((state) => state.currentId);
  const cloudProjects = useProjectsStore((state) => state.list);

  const matchingPreset = FALLBACK_DISPLAY_PRESETS.fixed.find((preset) =>
    preset.width === display.width
    && preset.height === display.height
    && preset.shape === display.shape);
  const [selectedPresetId, setSelectedPresetId] = useState(
    matchingPreset?.frameId ?? FALLBACK_DISPLAY_PRESETS.fixed[0]?.frameId ?? '',
  );
  const [selectedProjectId, setSelectedProjectId] = useState(cloudProjectId ?? '');
  const [projectOptions, setProjectOptions] = useState<ProjectPickerOption[]>([]);
  const [storedLocalProjectOption, setStoredLocalProjectOption] = useState<ProjectPickerOption | null>(null);
  const [projectOptionsLoading, setProjectOptionsLoading] = useState(false);
  const [openingProject, setOpeningProject] = useState(false);
  const refreshingLegacyWf3 = useRef(false);
  const localProjectOption: ProjectPickerOption | null = cloudProjectId === null
    ? {
        id: LOCAL_PROJECT_PICKER_ID,
        name: activeProject.meta.name || 'untitled',
        source: 'local',
        project: activeProject,
        width: activeProject.display.width,
        height: activeProject.display.height,
        shape: activeProject.display.shape,
      }
    : storedLocalProjectOption;

  useEffect(() => {
    if (
      cloudProjectId !== null
      || refreshingLegacyWf3.current
      || !isLegacyWf3NavigationProject(activeProject)
    ) return;
    const builtInProject = findBuiltInProject('builtin:wf3-firmware-284x76');
    if (!builtInProject) return;
    refreshingLegacyWf3.current = true;
    setOpeningProject(true);
    void builtInProject.load()
      .then((document) => useProjectsStore.getState().openLocalProject(document))
      .finally(() => {
        refreshingLegacyWf3.current = false;
        setOpeningProject(false);
      });
  }, [activeProject, cloudProjectId]);

  useEffect(() => {
    if (!matchingPreset) return;
    setSelectedPresetId(matchingPreset.frameId);
    setSelectedProjectId(cloudProjectId
      ?? (localProjectOption && presetMatchesDisplay(display, localProjectOption)
        ? LOCAL_PROJECT_PICKER_ID
        : ''));
  }, [
    cloudProjectId,
    localProjectOption?.height,
    localProjectOption?.name,
    localProjectOption?.shape,
    localProjectOption?.width,
    matchingPreset?.frameId,
  ]);

  useEffect(() => {
    let cancelled = false;
    void loadLastProject().then((project) => {
      if (cancelled) return;
      if (!project) {
        setStoredLocalProjectOption(null);
        return;
      }
      setStoredLocalProjectOption({
        id: LOCAL_PROJECT_PICKER_ID,
        name: project.meta.name || 'untitled',
        source: 'local',
        project,
        width: project.display.width,
        height: project.display.height,
        shape: project.display.shape,
      });
    });
    return () => { cancelled = true; };
  }, [cloudProjectId]);

  useEffect(() => {
    let cancelled = false;
    setProjectOptionsLoading(true);
    void Promise.all(cloudProjects.map(async (project) => {
      const result = await getProject(project.id);
      if (!result.ok) return null;
      return {
        id: project.id,
        name: project.name,
        version: project.version,
        source: 'cloud' as const,
        ...storedProjectDisplay(result.data.doc),
      } satisfies ProjectPickerOption;
    })).then((options) => {
      if (!cancelled) setProjectOptions(options.filter((option) => option !== null));
    }).finally(() => {
      if (!cancelled) setProjectOptionsLoading(false);
    });
    return () => { cancelled = true; };
  }, [cloudProjects]);

  const selectedPreset = FALLBACK_DISPLAY_PRESETS.fixed.find(
    (preset) => preset.frameId === selectedPresetId,
  );
  const builtInProjectOptions: ProjectPickerOption[] = BUILT_IN_PROJECTS.map((project) => ({
    id: project.id,
    name: project.name,
    source: 'builtin',
    width: project.width,
    height: project.height,
    shape: project.shape,
  }));
  const visibleLocalProjectOption = cloudProjectId === null
    ? localProjectOption
    : excludeCloudDuplicateLocal(localProjectOption, projectOptions);
  const persistedProjectOptions = visibleLocalProjectOption
    ? [visibleLocalProjectOption, ...projectOptions]
    : projectOptions;
  const uniqueBuiltInProjectOptions = excludePersistedBuiltIns(
    builtInProjectOptions,
    persistedProjectOptions,
  );
  const allProjectOptions = visibleLocalProjectOption
    ? [visibleLocalProjectOption, ...uniqueBuiltInProjectOptions, ...projectOptions]
    : [...uniqueBuiltInProjectOptions, ...projectOptions];
  const filteredProjects = selectedPreset
    ? allProjectOptions.filter((project) => presetMatchesDisplay(selectedPreset, project))
    : [];
  const selectedProjectValue = filteredProjects.some((project) => project.id === selectedProjectId)
    ? selectedProjectId
    : '';

  const selectProject = async (projectId: string): Promise<void> => {
    if (projectId === '') return;
    setSelectedProjectId(projectId);
    setOpeningProject(true);
    try {
      if (projectId === LOCAL_PROJECT_PICKER_ID && localProjectOption?.project) {
        await useProjectsStore.getState().openLocalProject(localProjectOption.project);
        return;
      }
      const builtInProject = findBuiltInProject(projectId);
      if (builtInProject) {
        await useProjectsStore.getState().openLocalProject(await builtInProject.load());
        return;
      }
      await useProjectsStore.getState().openProject(projectId);
      if (useProjectsStore.getState().currentId !== projectId) setSelectedProjectId('');
    } finally {
      setOpeningProject(false);
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar-row toolbar-main-row">
      <div className="toolbar-group toolbar-project-group">
      <button
        type="button"
        className="btn toolbar-icon-btn"
        aria-label="新建项目"
        title="新建项目并选择屏幕与控制器"
        onClick={() => useProjectsStore.getState().openPanel('projects')}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
          <path d="M14 3v6h6M12 13v6M9 16h6" />
        </svg>
      </button>
      <button
        type="button"
        className="btn toolbar-icon-btn"
        aria-label="打开项目"
        title="打开项目"
        onClick={openProjectFile}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2H7l-4 8Z" />
          <path d="M7 11h14l-4 8H3" />
        </svg>
      </button>
      <button
        type="button"
        className={`btn toolbar-icon-btn ${dirty ? 'is-dirty' : ''}`}
        aria-label={dirty ? '保存项目（有未保存更改）' : '保存项目'}
        title={dirty ? '保存项目（有未保存更改）' : '保存项目'}
        onClick={() => { void useProjectsStore.getState().saveCurrent(); }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4h14l2 2v14H4Z" />
          <path d="M8 4v6h8V4M8 20v-6h8v6" />
        </svg>
      </button>
      <SyncBadge />
      <span className="sep" />
      <button
        type="button"
        className="btn toolbar-icon-btn"
        aria-label="我的工程"
        title="我的工程"
        onClick={() => useProjectsStore.getState().openPanel('projects')}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16v13H4Z" />
          <path d="M8 7V4h8v3M9 12h6" />
        </svg>
      </button>
      <button
        type="button"
        className="btn toolbar-icon-btn"
        aria-label="版本历史"
        title="版本历史"
        onClick={() => useProjectsStore.getState().openPanel('history')}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v5l3 2M5 5v4h4" />
        </svg>
      </button>
      <button
        type="button"
        className="btn toolbar-icon-btn"
        aria-label="目标与构建"
        title="管理不可变 Profile、Theme、BuildTarget revision 及构建发布状态"
        onClick={() => window.dispatchEvent(new Event('lvd:open-catalog'))}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />
        </svg>
      </button>
      </div>
      <div className="toolbar-group toolbar-target-group">
      <span className="sep" />
      <div className="toolbar-project-picker" aria-label="按屏幕规格选择界面 UI">
        <select
          className="ed-select toolbar-spec-select"
          aria-label="屏幕规格"
          title="选择屏幕规格；此操作只筛选界面 UI，不会切换当前工程"
          value={selectedPresetId}
          onChange={(event) => {
            setSelectedPresetId(event.target.value);
            setSelectedProjectId('');
          }}
        >
          {FALLBACK_DISPLAY_PRESETS.fixed.map((preset) => (
            <option key={preset.frameId} value={preset.frameId}>
              {preset.frameId} · {preset.width}×{preset.height}{preset.shape === 'round' ? ' 圆屏' : ''}
            </option>
          ))}
        </select>
        <select
          className="ed-select toolbar-ui-select"
          aria-label="界面 UI"
          title="选择后打开并显示对应界面 UI"
          value={selectedProjectValue}
          disabled={(projectOptionsLoading && !localProjectOption) || openingProject || filteredProjects.length === 0}
          onChange={(event) => { void selectProject(event.target.value); }}
        >
          <option value="">
            {projectOptionsLoading
              ? '正在读取界面 UI…'
              : filteredProjects.length === 0 ? '该规格暂无界面 UI' : '请选择界面 UI'}
          </option>
          {filteredProjects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.source === 'cloud' ? `${project.name} · v${project.version}` : project.name}
            </option>
          ))}
        </select>
      </div>
      <span className="sep" />
      <button
        type="button"
        className={`btn toolbar-icon-btn ${mode === 'play' ? 'primary' : ''}`}
        aria-label={mode === 'design' ? '运行' : '停止'}
        title={mode === 'design' ? '运行预览' : '停止预览'}
        onClick={() => useEditorStore.getState().setMode(mode === 'design' ? 'play' : 'design')}
      >
        {mode === 'design' ? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 9 6-9 6Z" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" /></svg>
        )}
      </button>
      </div>
      <span className="toolbar-spacer" />
      <div className="toolbar-group toolbar-output-group">
      <span className={`rt-badge rt-${runtimeKind}`}>
        {runtimeKind === 'wasm'
          ? 'LVGL 9.5 · WASM 编辑预览'
          : runtimeKind === 'mock' ? '打桩模式' : '加载中…'}
      </span>
      <span className="sep" />
      <button
        type="button"
        className="btn primary toolbar-icon-btn"
        aria-label="导出 C 代码"
        title="导出精确钉死 LVGL 9.5.0 的 C 代码与构建 manifest"
        onClick={() => { void exportUiZip(useProjectStore.getState().project); }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m8 7-5 5 5 5M16 7l5 5-5 5M13 4l-2 16" />
        </svg>
      </button>
      <button
        type="button"
        className="btn toolbar-icon-btn"
        aria-label="导出网页 UI JSON"
        title="导出冻结的 WebUiDocumentV1 JSON；不包含 Build URL、编辑状态或后端主键"
        onClick={() => { void exportWebUiJson(useProjectStore.getState().project); }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 4H6a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-2" />
        </svg>
      </button>
      <button
        type="button"
        className="btn toolbar-icon-btn"
        disabled={!canPublishSite || cloudProjectId === null}
        aria-label="发布网页"
        title={!canPublishSite ? '需要 tool.lvgl.publish 权限' : cloudProjectId === null ? '请先保存为云端工程' : '准备并发布到 ui.podsc.com；不会修改设备外框'}
        onClick={() => window.dispatchEvent(new Event('lvd:open-site-publication'))}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 18a4 4 0 0 1-.5-8A6.5 6.5 0 0 1 18 9a4.5 4.5 0 0 1 0 9" />
          <path d="m9 13 3-3 3 3M12 10v9" />
        </svg>
      </button>
      <span className="sep" />
      <button
        type="button"
        className="btn toolbar-icon-btn"
        title="快捷键帮助(F1)"
        aria-label="快捷键帮助"
        onClick={() => window.dispatchEvent(new Event('lvd:open-help'))}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.8 9a2.4 2.4 0 1 1 3.5 2.1c-.8.4-1.3 1-1.3 1.9M12 17h.01" />
        </svg>
      </button>
      <a
        className="btn toolbar-icon-btn"
        href="/"
        aria-label="应用导航"
        title="返回应用导航"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4" width="6" height="6" rx="1" />
          <rect x="14" y="4" width="6" height="6" rx="1" />
          <rect x="4" y="14" width="6" height="6" rx="1" />
          <rect x="14" y="14" width="6" height="6" rx="1" />
        </svg>
      </a>
      <UserMenu />
      </div>
      </div>
    </div>
  );
}
