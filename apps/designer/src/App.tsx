/**
 * App — 三栏布局(react-resizable-panels):
 * 左 = 组件面板/对象树/屏幕列表,中 = 工具条 + CanvasStage,右 = 检查器。
 * 深色主题,中文 UI(design/04 §4.1)。
 */
import { useEffect, useState } from 'react';
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

let bootstrapped = false;

export function App(): JSX.Element {
  const banner = useEditorStore((s) => s.banner);
  const [leftTab, setLeftTab] = useState<'widgets' | 'assets'>('widgets');
  const [helpOpen, setHelpOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);

  /* 启动:恢复最近工程 + 自动保存 + 全局快捷键 */
  useEffect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    // 启动拉取当前用户(拿角色);401/后端未接时容错为 me=null,不白屏
    void useAuthStore.getState().fetchMe();
    void (async () => {
      // 1) 探测云存储是否启用(503 → 纯本地);启用则拉工程列表
      await useProjectsStore.getState().init();
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
      if (ps.cloudEnabled) {
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
      const t = e.target as HTMLElement;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (typing) return;
        e.preventDefault();
        useProjectStore.getState().undo();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))
      ) {
        if (typing) return;
        e.preventDefault();
        useProjectStore.getState().redo();
        return;
      }
      // 复制 / 粘贴 / 复刻(仅设计态;typing 守卫)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'c') {
        if (typing || useEditorStore.getState().mode !== 'design') return;
        e.preventDefault();
        copySelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'v') {
        if (typing || useEditorStore.getState().mode !== 'design') return;
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'd') {
        if (typing || useEditorStore.getState().mode !== 'design') return;
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
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
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
      getPipeline,
    };
  }, []);

  /* 工具条「?」按钮经自定义事件打开帮助浮层(避免把瞬态 UI 态塞进 store) */
  useEffect(() => {
    const onOpenHelp = (): void => setHelpOpen(true);
    const onOpenCatalog = (): void => setCatalogOpen(true);
    window.addEventListener('lvd:open-help', onOpenHelp);
    window.addEventListener('lvd:open-catalog', onOpenCatalog);
    return () => {
      window.removeEventListener('lvd:open-help', onOpenHelp);
      window.removeEventListener('lvd:open-catalog', onOpenCatalog);
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
        <Panel defaultSize={18} minSize={12} className="side">
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
          <div className="panel-title">对象树</div>
          <div className="side-section tree-section"><ObjectTree /></div>
          <div className="panel-title">屏幕</div>
          <div className="side-section screens-section"><ScreenList /></div>
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel minSize={30}>
          <CanvasStage />
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel defaultSize={22} minSize={15} className="side">
          <Inspector />
        </Panel>
      </PanelGroup>
      <AiPanel />
      <AuthModals />
      <CloudPanels />
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
      {catalogOpen && <CatalogPanel onClose={() => setCatalogOpen(false)} />}
    </div>
  );
}
