/**
 * App — 三栏布局(react-resizable-panels):
 * 左 = 组件面板/对象树/屏幕列表,中 = 工具条 + CanvasStage,右 = 检查器。
 * 深色主题,中文 UI(design/04 §4.1)。
 */
import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Toolbar } from './Toolbar';
import { CanvasStage } from './canvas/CanvasStage';
import { WidgetPalette } from './panels/WidgetPalette';
import { AssetPanel } from './panels/AssetPanel';
import { ObjectTree } from './panels/ObjectTree';
import { ScreenList } from './panels/ScreenList';
import { Inspector } from './panels/Inspector';
import { findNodeByIdV2, useProjectStore } from './stores/projectStore';
import { useEditorStore } from './stores/editorStore';
import { loadLastProject, startAutoSave } from './services/storage';
import { resyncAssets } from './services/assets';
import { getPipeline } from './canvas/reloadPipeline';
import { AiPanel } from './panels/ai/AiPanel';
import { AuthModals } from './panels/auth/UserMenu';
import { useAuthStore } from './stores/authStore';
import { useProjectsStore, startCloudSync } from './stores/projectsStore';
import { CloudPanels } from './panels/cloud/CloudPanels';
import { copySelection, pasteClipboard, duplicateSelection } from './services/clipboard';
import { ShortcutsHelp } from './panels/ShortcutsHelp';
import { CatalogPanel } from './panels/catalog/CatalogPanel';
import { SitePublicationModal } from './panels/SitePublicationModal';
import { AppDialogHost } from './panels/AppDialogHost';
import { useBuildTargetStore } from './stores/buildTargetStore';

let bootstrapped = false;
const TREE_HEIGHT_STORAGE_KEY = 'lvd:left-tree-height';
const TREE_COLLAPSED_STORAGE_KEY = 'lvd:left-tree-collapsed';
const DEFAULT_TREE_HEIGHT = 180;
const MIN_TREE_HEIGHT = 96;
const MAX_TREE_HEIGHT = 520;
const MAX_TREE_HEIGHT_RATIO = 0.45;

function clampTreeHeight(value: number, panelHeight?: number): number {
  const responsiveMax = panelHeight === undefined
    ? MAX_TREE_HEIGHT
    : Math.min(MAX_TREE_HEIGHT, Math.floor(panelHeight * MAX_TREE_HEIGHT_RATIO));
  return Math.max(MIN_TREE_HEIGHT, Math.min(Math.round(value), responsiveMax));
}

function loadTreeHeight(): number {
  if (typeof window === 'undefined') return DEFAULT_TREE_HEIGHT;
  try {
    const value = Number(window.localStorage.getItem(TREE_HEIGHT_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? clampTreeHeight(value) : DEFAULT_TREE_HEIGHT;
  } catch {
    return DEFAULT_TREE_HEIGHT;
  }
}

function saveTreeHeight(value: number): void {
  try {
    window.localStorage.setItem(TREE_HEIGHT_STORAGE_KEY, String(value));
  } catch {
    // localStorage may be unavailable in privacy-restricted browsers.
  }
}

function loadTreeCollapsed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const value = window.localStorage.getItem(TREE_COLLAPSED_STORAGE_KEY);
    return value === null ? true : value === '1';
  } catch {
    return true;
  }
}

function saveTreeCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(TREE_COLLAPSED_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // localStorage may be unavailable in privacy-restricted browsers.
  }
}

export function App(): JSX.Element {
  const compactLayout = typeof window !== 'undefined' && window.innerWidth <= 1200;
  const banner = useEditorStore((s) => s.banner);
  const [leftTab, setLeftTab] = useState<'widgets' | 'assets'>('widgets');
  const [helpOpen, setHelpOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [sitePublicationOpen, setSitePublicationOpen] = useState(false);
  const [treeHeight, setTreeHeight] = useState(loadTreeHeight);
  const [treeCollapsed, setTreeCollapsed] = useState(loadTreeCollapsed);
  const [treeResizing, setTreeResizing] = useState(false);

  const toggleTreeCollapsed = (): void => {
    setTreeCollapsed((current) => {
      const next = !current;
      saveTreeCollapsed(next);
      return next;
    });
  };

  const startTreeResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    const panel = event.currentTarget.parentElement;
    if (!panel) return;
    const startY = event.clientY;
    const startHeight = treeHeight;
    const panelHeight = panel.getBoundingClientRect().height;
    let finalHeight = startHeight;

    setTreeResizing(true);
    document.body.classList.add('tree-resizing');
    const onMove = (moveEvent: PointerEvent): void => {
      finalHeight = clampTreeHeight(startHeight - (moveEvent.clientY - startY), panelHeight);
      setTreeHeight(finalHeight);
    };
    const onEnd = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('blur', onEnd);
      document.body.classList.remove('tree-resizing');
      setTreeResizing(false);
      saveTreeHeight(finalHeight);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    window.addEventListener('blur', onEnd);
  };

  const resetTreeHeight = (): void => {
    setTreeHeight(DEFAULT_TREE_HEIGHT);
    saveTreeHeight(DEFAULT_TREE_HEIGHT);
  };

  const resizeTreeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Home') return;
    event.preventDefault();
    if (event.key === 'Home') {
      resetTreeHeight();
      return;
    }
    const panelHeight = event.currentTarget.parentElement?.getBoundingClientRect().height;
    setTreeHeight((current) => {
      const delta = event.key === 'ArrowUp' ? 16 : -16;
      const next = clampTreeHeight(current + delta, panelHeight);
      saveTreeHeight(next);
      return next;
    });
  };

  /* 启动:恢复最近工程 + 自动保存 + 全局快捷键 */
  useEffect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    // 启动拉取当前用户(拿角色);401/后端未接时容错为 me=null,不白屏
    void (async () => {
      // 1) 探测云存储是否启用(503 → 纯本地);启用则拉工程列表
      await Promise.all([
        useAuthStore.getState().fetchMe(),
        useProjectsStore.getState().init(),
      ]);
      const ps = useProjectsStore.getState();

      // 有云工程:打开最近更新的一个
      const recent = [...ps.list].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      )[0];
      if (ps.cloudEnabled && recent) {
        await useProjectsStore.getState().openProject(recent.id);
        void resyncAssets();
        return;
      }

      // 2) 云启用但无工程 → 引导新建
      if (ps.cloudEnabled && useAuthStore.getState().me) {
        useEditorStore.getState().setBanner('还没有云端工程,点工具条「我的工程」新建你的第一个工程');
      }

      // 3) 纯本地 / 无云工程:回退恢复本地最近工程
      const last = await loadLastProject();
      if (last) {
        useProjectStore.getState().loadProject(last);
        const home = last.screens.find((s) => s.isHome) ?? last.screens[0];
        if (home) useEditorStore.getState().setActiveScreen(home.id);
        // 素材重灌:等 runtime/pipeline 起来后按 sha256 从 IndexedDB 注册 + reloadAll
        void resyncAssets();
      }
    })();
    const stopAutoSave = startAutoSave();
    const stopCloudSync = startCloudSync();

    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement;
      const typing = t instanceof HTMLInputElement
        || t instanceof HTMLTextAreaElement
        || t instanceof HTMLSelectElement
        || t.isContentEditable;
      const commandControl = t instanceof HTMLButtonElement
        || t instanceof HTMLAnchorElement
        || !!t.closest('[role="button"], [role="menuitem"], [role="tab"]');
      const interactive = typing || commandControl;
      const isDesignMode = useEditorStore.getState().mode === 'design';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (interactive || !isDesignMode) return;
        e.preventDefault();
        useProjectStore.getState().undo();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))
      ) {
        if (interactive || !isDesignMode) return;
        e.preventDefault();
        useProjectStore.getState().redo();
        return;
      }
      // 复制 / 粘贴 / 复刻(仅设计态;typing 守卫)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'c') {
        if (interactive || !isDesignMode) return;
        e.preventDefault();
        copySelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'v') {
        if (interactive || !isDesignMode) return;
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'd') {
        if (interactive || !isDesignMode) return;
        e.preventDefault();
        duplicateSelection();
        return;
      }
      // 快捷键帮助:F1 或 Shift+?(=Shift+/)。typing 时不拦。
      if (!typing && (e.key === 'F1' || (e.key === '?' && e.shiftKey))) {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !interactive) {
        const ed = useEditorStore.getState();
        if (ed.mode !== 'design' || ed.selectedIds.length === 0) return;
        e.preventDefault();
        const ids = [...ed.selectedIds];
        useProjectStore.getState().mutateV2(`删除 ${ids.length} 个对象`, (draft) => {
          for (const id of ids) {
            const hit = findNodeByIdV2(draft, id);
            if (!hit?.parent) continue; // 根不可删
            hit.parent.children = hit.parent.children.filter((c) => c.id !== id);
          }
        });
        ed.select([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      stopAutoSave();
      stopCloudSync();
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* e2e 钩子(冒烟脚本用) */
  useEffect(() => {
    (window as unknown as Record<string, unknown>)['__lvd'] = {
      projectStore: useProjectStore,
      editorStore: useEditorStore,
      buildTargetStore: useBuildTargetStore,
      getPipeline,
    };
  }, []);

  /* 工具条「?」按钮经自定义事件打开帮助浮层(避免把瞬态 UI 态塞进 store) */
  useEffect(() => {
    const onOpenHelp = (): void => setHelpOpen(true);
    const onOpenCatalog = (): void => setCatalogOpen(true);
    const onOpenSitePublication = (): void => setSitePublicationOpen(true);
    window.addEventListener('lvd:open-help', onOpenHelp);
    window.addEventListener('lvd:open-catalog', onOpenCatalog);
    window.addEventListener('lvd:open-site-publication', onOpenSitePublication);
    return () => {
      window.removeEventListener('lvd:open-help', onOpenHelp);
      window.removeEventListener('lvd:open-catalog', onOpenCatalog);
      window.removeEventListener('lvd:open-site-publication', onOpenSitePublication);
    };
  }, []);

  return (
    <div className="app">
      {banner && (
        <div className="banner">
          <span>{banner}</span>
          <button className="icon-btn" onClick={() => useEditorStore.getState().setBanner(null)}>✕</button>
        </div>
      )}
      <Toolbar />
      <PanelGroup direction="horizontal" className="main">
        <Panel
          defaultSize={compactLayout ? 20 : 14}
          minSize={compactLayout ? 18 : 12}
          maxSize={compactLayout ? 25 : 22}
          className="side side-left"
        >
          <div className="panel-title left-tabs">
            <button
              className={`left-tab ${leftTab === 'widgets' ? 'active' : ''}`}
              onClick={() => setLeftTab('widgets')}
            >组件</button>
            <button
              className={`left-tab ${leftTab === 'assets' ? 'active' : ''}`}
              onClick={() => setLeftTab('assets')}
            >素材</button>
          </div>
          <div className="side-section palette-section">
            {leftTab === 'widgets' ? <WidgetPalette /> : <AssetPanel />}
          </div>
          <div className="screens-section"><ScreenList /></div>
          {!treeCollapsed && (
            <div
              className={`tree-resize-handle ${treeResizing ? 'active' : ''}`}
              role="separator"
              aria-label="调整对象树高度"
              aria-orientation="horizontal"
              aria-valuemin={MIN_TREE_HEIGHT}
              aria-valuemax={MAX_TREE_HEIGHT}
              aria-valuenow={treeHeight}
              tabIndex={0}
              title="拖动调整对象树高度；双击恢复默认"
              onPointerDown={startTreeResize}
              onDoubleClick={resetTreeHeight}
              onKeyDown={resizeTreeWithKeyboard}
            >
              <span className="tree-resize-grip" aria-hidden="true" />
            </div>
          )}
          <div className="tree-panel-header">
            <button
              className="tree-panel-toggle"
              type="button"
              aria-expanded={!treeCollapsed}
              aria-controls="object-tree-section"
              title={treeCollapsed ? '展开对象树' : '收起对象树'}
              onClick={toggleTreeCollapsed}
            >
              <span className="tree-panel-label">对象树</span>
              <span className="tree-toggle-caret" aria-hidden="true">
                {treeCollapsed ? '▾' : '▴'}
              </span>
            </button>
          </div>
          {!treeCollapsed && (
            <div
              id="object-tree-section"
              className="side-section tree-section"
              style={{ height: treeHeight, flexBasis: treeHeight }}
            >
              <ObjectTree />
            </div>
          )}
        </Panel>
        <PanelResizeHandle className="resize-handle" aria-label="调整左侧面板宽度" />
        <Panel defaultSize={compactLayout ? 55 : 68} minSize={compactLayout ? 40 : 38} className="canvas-panel">
          <CanvasStage />
        </Panel>
        <PanelResizeHandle className="resize-handle" aria-label="调整右侧面板宽度" />
        <Panel
          defaultSize={compactLayout ? 25 : 18}
          minSize={compactLayout ? 22 : 16}
          maxSize={compactLayout ? 32 : 28}
          className="side side-right"
        >
          <Inspector />
        </Panel>
      </PanelGroup>
      <AiPanel />
      <AuthModals />
      <CloudPanels />
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
      {catalogOpen && <CatalogPanel onClose={() => setCatalogOpen(false)} />}
      {sitePublicationOpen && <SitePublicationModal onClose={() => setSitePublicationOpen(false)} />}
      <AppDialogHost />
    </div>
  );
}
