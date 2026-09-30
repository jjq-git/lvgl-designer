/**
 * App — 三栏布局(react-resizable-panels):
 * 左 = 组件面板/对象树/屏幕列表,中 = 工具条 + CanvasStage,右 = 检查器。
 * 深色主题,中文 UI(design/04 §4.1)。
 */
import {
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
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
const TREE_COLLAPSED_STORAGE_KEY = 'lvd:tree-dock-collapsed';

function loadTreeCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const value = window.localStorage.getItem(TREE_COLLAPSED_STORAGE_KEY);
    return value === '1';
  } catch {
    return false;
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
  const [treeCollapsed, setTreeCollapsed] = useState(loadTreeCollapsed);
  const treePanelRef = useRef<ImperativePanelHandle | null>(null);

  const toggleTreeCollapsed = (): void => {
    const panel = treePanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  };

  useEffect(() => {
    if (treeCollapsed) treePanelRef.current?.collapse();
  }, []);

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
          defaultSize={compactLayout ? 75 : 82}
          minSize={compactLayout ? 68 : 70}
          maxSize={compactLayout ? 78 : 84}
          className="workspace-shell"
        >
          <PanelGroup direction="horizontal" className="workspace-main">
            <Panel
              defaultSize={compactLayout ? 25 : 17}
              minSize={compactLayout ? 22 : 14}
              maxSize={compactLayout ? 32 : 26}
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
            </Panel>
            <PanelResizeHandle className="resize-handle" aria-label="调整组件面板宽度" />
            <Panel defaultSize={compactLayout ? 75 : 83} minSize={60} className="design-shell">
              <PanelGroup direction="horizontal" className="design-main">
                <Panel
                  ref={treePanelRef}
                  id="object-tree-dock"
                  defaultSize={compactLayout ? 31 : 18}
                  minSize={compactLayout ? 25 : 14}
                  maxSize={compactLayout ? 40 : 30}
                  collapsedSize={0}
                  collapsible
                  className={`side tree-dock ${treeCollapsed ? 'collapsed' : ''}`}
                  onCollapse={() => {
                    setTreeCollapsed(true);
                    saveTreeCollapsed(true);
                  }}
                  onExpand={() => {
                    setTreeCollapsed(false);
                    saveTreeCollapsed(false);
                  }}
                >
                  {!treeCollapsed && (
                    <>
                      <div className="tree-dock-header">
                        <button
                          className="tree-dock-toggle"
                          type="button"
                          aria-expanded="true"
                          aria-controls="object-tree-section"
                          title="收起对象树"
                          onClick={toggleTreeCollapsed}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="4" y="4" width="6" height="6" rx="1" />
                            <rect x="14" y="4" width="6" height="6" rx="1" />
                            <rect x="9" y="14" width="6" height="6" rx="1" />
                            <path d="M7 10v2h10v-2M12 12v2" />
                          </svg>
                          <span className="tree-dock-title">对象树</span>
                          <span className="tree-dock-caret" aria-hidden="true">‹</span>
                        </button>
                      </div>
                      <div className="screens-section"><ScreenList /></div>
                      <div id="object-tree-section" className="tree-dock-body"><ObjectTree /></div>
                    </>
                  )}
                </Panel>
                <PanelResizeHandle
                  className={`resize-handle tree-canvas-resize-handle ${treeCollapsed ? 'collapsed' : ''}`}
                  aria-label="调整对象树宽度"
                />
                <Panel defaultSize={compactLayout ? 69 : 82} minSize={60} className="canvas-panel">
                  <CanvasStage />
                </Panel>
              </PanelGroup>
              {treeCollapsed && (
                <button
                  className="tree-dock-collapsed-toggle"
                  type="button"
                  aria-expanded="false"
                  aria-controls="object-tree-section"
                  title="展开对象树"
                  onClick={toggleTreeCollapsed}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="4" y="4" width="6" height="6" rx="1" />
                    <rect x="14" y="4" width="6" height="6" rx="1" />
                    <rect x="9" y="14" width="6" height="6" rx="1" />
                    <path d="M7 10v2h10v-2M12 12v2" />
                  </svg>
                </button>
              )}
            </Panel>
          </PanelGroup>
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
