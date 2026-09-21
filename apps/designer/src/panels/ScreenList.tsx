/**
 * ScreenList — 多屏增删改切。切屏 → editorStore.activeScreenId → CanvasStage loadScreen。
 */
import { useState } from 'react';
import { autoName, checkCName, createNode, newUuid } from '@lvd/schema';
import type { ScreenDefV2, WidgetNodeV2 } from '@lvd/schema/v2';
import { useProjectStore } from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';

export function ScreenList(): JSX.Element {
  const screens = useProjectStore((s) => s.uiProject.screens);
  const activeScreenId = useEditorStore((s) => s.activeScreenId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const addScreen = (): void => {
    const st = useProjectStore.getState();
    const existing = st.uiProject.screens.map((s) => s.codeName);
    const name = autoName('screen', existing);
    const legacyRoot = createNode('obj');
    const root: WidgetNodeV2 = {
      id: legacyRoot.id,
      type: legacyRoot.type,
      props: { ...legacyRoot.props },
      styleRefs: [], styles: [], events: [], bindings: [], children: [],
    };
    delete root.props['width'];
    delete root.props['height'];
    const screen: ScreenDefV2 = { id: newUuid(), codeName: name, styles: [], consts: [], root };
    st.mutateV2('新建屏幕', (draft) => {
      draft.screens.push(screen);
    });
    useEditorStore.getState().setActiveScreen(screen.id);
  };

  const removeScreen = (id: string): void => {
    const st = useProjectStore.getState();
    if (st.uiProject.screens.length <= 1) return;
    st.mutateV2('删除屏幕', (draft) => {
      draft.screens = draft.screens.filter((s) => s.id !== id);
      if (!draft.screens.some((s) => s.isHome) && draft.screens[0]) draft.screens[0].isHome = true;
    });
    const remain = useProjectStore.getState().uiProject.screens;
    if (activeScreenId === id && remain[0]) useEditorStore.getState().setActiveScreen(remain[0].id);
  };

  const commitRename = (id: string): void => {
    setEditingId(null);
    const name = editName.trim();
    const st = useProjectStore.getState();
    const screen = st.uiProject.screens.find((s) => s.id === id);
    if (!screen || name === screen.codeName) return;
    const err = checkCName(name);
    if (err) {
      useEditorStore.getState().setBanner(`屏幕名非法:${err.message}`);
      return;
    }
    if (st.uiProject.screens.some((s) => s.id !== id && s.codeName === name)) {
      useEditorStore.getState().setBanner(`屏幕名重复:${name}`);
      return;
    }
    st.mutateV2('重命名屏幕', (draft) => {
      const s = draft.screens.find((x) => x.id === id);
      if (s) s.codeName = name;
    });
  };

  const setHome = (id: string): void => {
    useProjectStore.getState().mutateV2('设为主屏', (draft) => {
      for (const s of draft.screens) s.isHome = s.id === id;
    });
  };

  return (
    <div className="screen-list">
      {screens.map((s) => (
        <div
          key={s.id}
          className={`screen-row ${s.id === activeScreenId ? 'sel' : ''}`}
          onClick={() => useEditorStore.getState().setActiveScreen(s.id)}
          onDoubleClick={() => {
            setEditingId(s.id);
            setEditName(s.codeName);
          }}
        >
          {editingId === s.id ? (
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => commitRename(s.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(s.id);
                if (e.key === 'Escape') setEditingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span className="screen-name">{s.codeName}</span>
              <span className="screen-actions">
                <button
                  className={`icon-btn ${s.isHome ? 'active' : ''}`}
                  title="设为主屏"
                  onClick={(e) => {
                    e.stopPropagation();
                    setHome(s.id);
                  }}
                >
                  ★
                </button>
                <button
                  className="icon-btn"
                  title="删除屏幕"
                  disabled={screens.length <= 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeScreen(s.id);
                  }}
                >
                  ✕
                </button>
              </span>
            </>
          )}
        </div>
      ))}
      <button className="btn add-screen" onClick={addScreen}>
        + 新建屏幕
      </button>
    </div>
  );
}
