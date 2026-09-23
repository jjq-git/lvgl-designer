/**
 * 工具条:undo/redo、缩放、设计/运行、圆屏开关、屏幕尺寸预设、新建/打开/保存/导出。
 */
import { useState } from 'react';
import { useProjectStore } from './stores/projectStore';
import { useEditorStore } from './stores/editorStore';
import { exportUiZip, exportWebUiJson, openProjectFile, saveProjectFile } from './services/exportZip';
import { UserMenu } from './panels/auth/UserMenu';
import { useProjectsStore } from './stores/projectsStore';
import { SyncBadge } from './panels/cloud/SyncBadge';
import {
  compatiblePreviewFormats,
  runtimeColorFormat,
  useBuildTargetStore,
  type PreviewColorFormat,
} from './stores/buildTargetStore';
import { getPipeline } from './canvas/reloadPipeline';
import { hasPermission, useAuthStore } from './stores/authStore';

// 预设来自本机仓库实际在用的屏(2026-07-02 全仓盘点,详见 docs/screen-inventory.md)
const SIZE_PRESETS = [
  { label: '240×240 圆 · GC9A01 (WF2P-0050)', w: 240, h: 240, shape: 'round' as const },
  { label: '480×480 圆 · MX039/ST7102', w: 480, h: 480, shape: 'round' as const },
  { label: '480×480 方 · YDP395/D395/HD400', w: 480, h: 480, shape: 'rect' as const },
  { label: '128×64 方 · SSD1306 OLED', w: 128, h: 64, shape: 'rect' as const },
  { label: '128×160 方 · ST7735S 1.77″', w: 128, h: 160, shape: 'rect' as const },
  { label: '480×960 条 · TXW6.2″/ST7701SN', w: 480, h: 960, shape: 'rect' as const },
  { label: '480×1920 条 · 8.8″/OTA7290B', w: 480, h: 1920, shape: 'rect' as const },
  { label: '1024×600 方 · 7″ EK79007', w: 1024, h: 600, shape: 'rect' as const },
  { label: '720×1280 方 · P4-6B/ILI9881C', w: 720, h: 1280, shape: 'rect' as const },
  { label: '720×1440 方 · P4-6A/HX8394', w: 720, h: 1440, shape: 'rect' as const },
  { label: '320×240 矩形(通用)', w: 320, h: 240, shape: 'rect' as const },
];

const SIZE_MIN = 16;
const SIZE_MAX = 2048;

export function Toolbar(): JSX.Element {
  const canUndo = useProjectStore((s) => s.undoStack.length > 0);
  const canRedo = useProjectStore((s) => s.redoStack.length > 0);
  const dirty = useProjectStore((s) => s.dirty);
  const display = useProjectStore((s) => s.project.display);
  const zoom = useEditorStore((s) => s.zoom);
  const mode = useEditorStore((s) => s.mode);
  const runtimeKind = useEditorStore((s) => s.runtimeKind);
  const targetFormat = useBuildTargetStore((s) => s.displayProfile.colorFormat);
  const colorFormatConfirmed = useBuildTargetStore((s) => s.colorFormatConfirmed);
  const controllerPreset = useBuildTargetStore((s) => s.controllerPreset);
  const catalogTargetRef = useBuildTargetStore((s) => s.catalogTargetRef);
  const canPublishSite = useAuthStore((state) => hasPermission(state.me, 'tool.lvgl.publish'));
  const cloudProjectId = useProjectsStore((state) => state.currentId);

  const [customOpen, setCustomOpen] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [customW, setCustomW] = useState(String(display.width));
  const [customH, setCustomH] = useState(String(display.height));

  const presetValue = `${display.width}x${display.height}:${display.shape}`;
  const previewFormat = runtimeColorFormat();

  const applyColorFormat = (value: string): void => {
    const target = useBuildTargetStore.getState();
    if (value === 'unconfirmed') target.clearColorFormatConfirmation();
    else if (!target.confirmColorFormat(value as PreviewColorFormat)) {
      useEditorStore.getState().setBanner(`${value} 与当前 ${display.colorDepth}bpp 工程不兼容`);
      return;
    }
    getPipeline()?.refreshTarget();
  };

  const applyController = (value: string): void => {
    useBuildTargetStore.getState().selectController(value === 'screen-only' ? 'screen-only' : null);
  };

  const applyPreset = (v: string): void => {
    if (v === 'custom') {
      setCustomW(String(display.width));
      setCustomH(String(display.height));
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    const p = SIZE_PRESETS.find((x) => `${x.w}x${x.h}:${x.shape}` === v);
    if (!p) return;
    useProjectStore.getState().mutateDisplay('改屏幕预设', (display) => {
      display.width = p.w;
      display.height = p.h;
      display.shape = p.shape;
    });
  };

  const applyCustom = (): void => {
    const w = Math.round(Number(customW));
    const h = Math.round(Number(customH));
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    const cw = Math.min(SIZE_MAX, Math.max(SIZE_MIN, w));
    const ch = Math.min(SIZE_MAX, Math.max(SIZE_MIN, h));
    setCustomW(String(cw));
    setCustomH(String(ch));
    useProjectStore.getState().mutateDisplay('自定义分辨率', (display) => {
      display.width = cw;
      display.height = ch;
    });
    setCustomOpen(false);
  };

  const newProject = async (): Promise<void> => {
    const input = window.prompt('新建独立工程名称（不会覆盖当前工程）:', '未命名工程');
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
      <button className="btn" disabled={creatingProject} onClick={() => void newProject()}>
        {creatingProject ? '新建中…' : '新建'}
      </button>
      <button className="btn" onClick={openProjectFile}>打开</button>
      <button className="btn" onClick={() => saveProjectFile(useProjectStore.getState().project)}>
        保存{dirty ? ' •' : ''}
      </button>
      <SyncBadge />
      <span className="sep" />
      <button className="btn" onClick={() => useProjectsStore.getState().openPanel('projects')}>我的工程</button>
      <button className="btn" onClick={() => useProjectsStore.getState().openPanel('history')}>历史</button>
      <button
        className="btn"
        title="管理不可变 Profile、Theme、BuildTarget revision 及构建发布状态"
        onClick={() => window.dispatchEvent(new Event('lvd:open-catalog'))}
      >
        目标与构建
      </button>
      <span className="sep" />
      <button className="btn" disabled={!canUndo || mode !== 'design'} title="Ctrl+Z" onClick={() => useProjectStore.getState().undo()}>
        ↶ 撤销
      </button>
      <button className="btn" disabled={!canRedo || mode !== 'design'} title="Ctrl+Y" onClick={() => useProjectStore.getState().redo()}>
        ↷ 重做
      </button>
      <span className="sep" />
      <span className="zoom-label" title="Ctrl+滚轮缩放,空格拖动平移">{Math.round(zoom * 100)}%</span>
      <button
        className="btn"
        title="适应窗口(Shift+1):内容居中并缩放到刚好塞进画布"
        onClick={() => {
          const disp = useProjectStore.getState().project.display;
          useEditorStore.getState().fitToScreen({ width: disp.width, height: disp.height });
        }}
      >
        适应窗口
      </button>
      <button
        className="btn"
        title="重置视图:100% 缩放,回到左上角"
        onClick={() => useEditorStore.getState().resetView()}
      >
        重置视图
      </button>
      <span className="sep" />
      <select
        className="ed-select"
        value={customOpen ? 'custom' : presetValue}
        onChange={(e) => applyPreset(e.target.value)}
      >
        {SIZE_PRESETS.map((p) => (
          <option key={p.label} value={`${p.w}x${p.h}:${p.shape}`}>{p.label}</option>
        ))}
        {!customOpen && !SIZE_PRESETS.some((p) => `${p.w}x${p.h}:${p.shape}` === presetValue) && (
          <option value={presetValue}>{display.width}×{display.height} {display.shape === 'round' ? '圆' : '方'}(自定义)</option>
        )}
        <option value="custom">自定义分辨率…</option>
      </select>
      {customOpen && (
        <span className="custom-size">
          <input
            className="ed-num"
            type="number"
            min={SIZE_MIN}
            max={SIZE_MAX}
            value={customW}
            onChange={(e) => setCustomW(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
            aria-label="宽"
          />
          ×
          <input
            className="ed-num"
            type="number"
            min={SIZE_MIN}
            max={SIZE_MAX}
            value={customH}
            onChange={(e) => setCustomH(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
            aria-label="高"
          />
          <button className="btn" onClick={applyCustom}>✓ 应用</button>
          <button className="btn" onClick={() => setCustomOpen(false)}>取消</button>
        </span>
      )}
      <label className="chk">
        <input
          type="checkbox"
          checked={display.shape === 'round'}
          onChange={(e) =>
            useProjectStore.getState().mutateDisplay('切换圆屏', (display) => {
              display.shape = e.target.checked ? 'round' : 'rect';
            })
          }
        />
        圆屏
      </label>
      <select
        className="ed-select"
        aria-label="目标颜色格式"
        title="来自 Schema v2 DisplayProfile；16bpp 必须确认 RGB565 字节序"
        value={colorFormatConfirmed ? targetFormat : 'unconfirmed'}
        onChange={(e) => applyColorFormat(e.target.value)}
      >
        {!colorFormatConfirmed && (
          <option value="unconfirmed">目标格式待确认（编辑预览 XRGB8888）</option>
        )}
        {compatiblePreviewFormats(display.colorDepth).map((format) => (
          <option key={format} value={format}>{format}</option>
        ))}
      </select>
      <select
        className="ed-select"
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
        className={`btn ${mode === 'play' ? 'primary' : ''}`}
        onClick={() => useEditorStore.getState().setMode(mode === 'design' ? 'play' : 'design')}
      >
        {mode === 'design' ? '▶ 运行' : '■ 停止'}
      </button>
      <span className="spacer" />
      <span className={`rt-badge rt-${runtimeKind}`}>
        {runtimeKind === 'wasm'
          ? `LVGL 9.5 · ${previewFormat}${colorFormatConfirmed ? '' : '（目标待确认）'}`
          : runtimeKind === 'mock' ? '打桩模式' : '加载中…'}
      </span>
      <button
        className="btn primary"
        title="导出精确钉死 LVGL 9.5.0 的 C 代码与构建 manifest"
        onClick={() => { void exportUiZip(useProjectStore.getState().project); }}
      >
        导出 C 代码
      </button>
      <button
        className="btn"
        title="导出冻结的 WebUiDocumentV1 JSON；不包含 Build URL、编辑状态或后端主键"
        onClick={() => { void exportWebUiJson(useProjectStore.getState().project); }}
      >
        导出网页 UI JSON
      </button>
      <button
        className="btn"
        disabled={!canPublishSite || cloudProjectId === null}
        title={!canPublishSite ? '需要 tool.lvgl.publish 权限' : cloudProjectId === null ? '请先保存为云端工程' : '准备并发布到 ui.podsc.com；不会修改设备外框'}
        onClick={() => window.dispatchEvent(new Event('lvd:open-site-publication'))}
      >
        发布到 ui.podsc.com
      </button>
      <span className="sep" />
      <button
        className="btn"
        title="快捷键帮助(F1)"
        aria-label="快捷键帮助"
        onClick={() => window.dispatchEvent(new Event('lvd:open-help'))}
      >
        ?
      </button>
      <UserMenu />
    </div>
  );
}
