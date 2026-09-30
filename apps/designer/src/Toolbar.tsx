/**
 * 工具条:undo/redo、缩放、设计/运行、圆屏开关、屏幕尺寸预设、新建/打开/保存/导出。
 */
import { useEffect, useState } from 'react';
import { useProjectStore } from './stores/projectStore';
import { useEditorStore } from './stores/editorStore';
import { exportUiZip, exportWebUiJson, openProjectFile, saveProjectFile } from './services/exportZip';
import { UserMenu } from './panels/auth/UserMenu';
import { useProjectsStore } from './stores/projectsStore';
import { requestText } from './services/appDialogs';
import { SyncBadge } from './panels/cloud/SyncBadge';
import { useBuildTargetStore } from './stores/buildTargetStore';
import { hasPermission, useAuthStore } from './stores/authStore';
import { getSiteTargetState } from './services/sitePublications';
import {
  displayPresetLabel,
  displayPresetsFromFrames,
  FALLBACK_DISPLAY_PRESETS,
  SITE_FRAME_MANIFEST_URL,
  unresolvedDisplayPresetLabel,
} from './services/displayPresets';

export function Toolbar(): JSX.Element {
  const dirty = useProjectStore((s) => s.dirty);
  const display = useProjectStore((s) => s.project.display);
  const mode = useEditorStore((s) => s.mode);
  const runtimeKind = useEditorStore((s) => s.runtimeKind);
  const controllerPreset = useBuildTargetStore((s) => s.controllerPreset);
  const catalogTargetRef = useBuildTargetStore((s) => s.catalogTargetRef);
  const canPublishSite = useAuthStore((state) => hasPermission(state.me, 'tool.lvgl.publish'));
  const cloudProjectId = useProjectsStore((state) => state.currentId);

  const [creatingProject, setCreatingProject] = useState(false);
  const [displayPresets, setDisplayPresets] = useState(FALLBACK_DISPLAY_PRESETS);

  const matchingPreset = displayPresets.fixed.find((preset) =>
    preset.width === display.width
    && preset.height === display.height
    && preset.shape === display.shape);
  const customPresetValue = `custom:${display.width}x${display.height}:${display.shape}`;
  const presetValue = matchingPreset?.frameId ?? customPresetValue;

  useEffect(() => {
    if (!canPublishSite) return;
    let cancelled = false;
    void getSiteTargetState()
      .then((target) => {
        if (!cancelled) setDisplayPresets(displayPresetsFromFrames(target.frames));
      })
      .catch(() => {
        // 离线或无目标仓库时继续使用 manifest 快照，屏幕选择不应被发布服务阻断。
      });
    return () => { cancelled = true; };
  }, [canPublishSite]);

  const applyController = (value: string): void => {
    useBuildTargetStore.getState().selectController(value === 'screen-only' ? 'screen-only' : null);
  };

  const applyPreset = (v: string): void => {
    const p = displayPresets.fixed.find((preset) => preset.frameId === v);
    if (!p) return;
    useProjectStore.getState().mutateDisplay('改屏幕预设', (display) => {
      display.width = p.width;
      display.height = p.height;
      display.shape = p.shape;
    });
  };

  const newProject = async (): Promise<void> => {
    const input = await requestText({
      title: '新建独立工程',
      message: '新工程不会覆盖当前工程。',
      label: '工程名称',
      defaultValue: '未命名工程',
      confirmLabel: '新建',
    });
    if (input == null) return;
    const name = input.trim();
    if (name === '') {
      useEditorStore.getState().setBanner('工程名不能为空');
      return;
    }
    setCreatingProject(true);
    try {
      await useProjectsStore.getState().newProject(name);
    } finally {
      setCreatingProject(false);
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar-row toolbar-main-row">
      <div className="toolbar-group toolbar-project-group">
      <button
        type="button"
        className="btn toolbar-icon-btn"
        disabled={creatingProject}
        aria-label={creatingProject ? '新建中' : '新建项目'}
        aria-busy={creatingProject}
        title={creatingProject ? '新建中…' : '新建项目'}
        onClick={() => void newProject()}
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
        onClick={() => saveProjectFile(useProjectStore.getState().project)}
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
      <select
        className="ed-select toolbar-display-select"
        aria-label="屏幕分辨率预设"
        title={`设备清单来源：${SITE_FRAME_MANIFEST_URL}`}
        value={presetValue}
        onChange={(e) => applyPreset(e.target.value)}
      >
        {displayPresets.fixed.map((preset) => (
          <option key={preset.frameId} value={preset.frameId}>{displayPresetLabel(preset)}</option>
        ))}
        {displayPresets.unresolved.map((preset) => (
          <option key={preset.frameId} value={preset.frameId} disabled>
            {unresolvedDisplayPresetLabel(preset)}
          </option>
        ))}
        {!matchingPreset && (
          <option value={customPresetValue} disabled>
            当前：{display.width}×{display.height} {display.shape === 'round' ? '圆' : '方'}（自定义工程，仅兼容）
          </option>
        )}
      </select>
      <select
        className="ed-select toolbar-controller-select"
        aria-label="目标控制器"
        title="Schema v2 ControllerProfile；发布目标必须锁定一个 Controller revision"
        value={catalogTargetRef ? 'catalog' : controllerPreset ?? 'unconfirmed'}
        onChange={(e) => applyController(e.target.value)}
      >
        {catalogTargetRef && <option value="catalog">平台目标：{catalogTargetRef}</option>}
        <option value="unconfirmed">Controller 待选择</option>
        <option value="screen-only">裸屏（无外壳）</option>
      </select>
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
      <UserMenu />
      </div>
      </div>
    </div>
  );
}
