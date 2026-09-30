/**
 * ScreenList — 多屏增删改切。切屏 → editorStore.activeScreenId → CanvasStage loadScreen。
 */
import { useEffect, useRef, useState } from 'react';
import { autoName, checkCName, newUuid } from '@lvd/schema';
import type { ScreenDefV2 } from '@lvd/schema/v2';
import { useProjectStore } from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';
import { createDesignerScreenRoot } from '../services/projectDefaults';

export function ScreenList(): JSX.Element {
  const screens = useProjectStore((s) => s.uiProject.screens);
  const activeScreenId = useEditorStore((s) => s.activeScreenId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [open, setOpen] = useState(false);
  const navigatorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const activeScreen = screens.find((screen) => screen.id === activeScreenId) ?? screens[0];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!navigatorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && editingId === null) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [editingId, open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      navigatorRef.current?.querySelector<HTMLElement>('.screen-row.sel')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (wasOpenRef.current && !open) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);

  const addScreen = (): void => {
    const st = useProjectStore.getState();
    const existing = st.uiProject.screens.map((s) => s.codeName);
    const name = autoName('screen', existing);
    const root = createDesignerScreenRoot();
    const screen: ScreenDefV2 = { id: newUuid(), codeName: name, styles: [], consts: [], root };
    st.mutateV2('新建屏幕', (draft) => {
      draft.screens.push(screen);
    });
    useEditorStore.getState().setActiveScreen(screen.id);
    setOpen(false);
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
    <div className="screen-navigator" ref={navigatorRef}>
      <div className="screen-nav-header">
        <button
          ref={triggerRef}
          className="screen-current-btn"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown') return;
            event.preventDefault();
            setOpen(true);
          }}
        >
          <span className="screen-nav-label">屏幕</span>
          <span className="screen-current-name">{activeScreen?.codeName ?? '—'}</span>
          <span className="screen-nav-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
        <button type="button" className="screen-add-btn" title="新建屏幕" aria-label="新建屏幕" onClick={addScreen}>
          ＋
        </button>
      </div>
      {open && <div className="screen-list-popover" role="dialog" aria-label="屏幕列表">
        {screens.map((s) => (
          <div
            key={s.id}
            role="button"
            aria-label={`切换到屏幕 ${s.codeName}`}
            aria-current={s.id === activeScreen?.id ? 'page' : undefined}
            className={`screen-row ${s.id === activeScreen?.id ? 'sel' : ''}`}
            tabIndex={0}
            onClick={() => {
              useEditorStore.getState().setActiveScreen(s.id);
              setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                useEditorStore.getState().setActiveScreen(s.id);
                setOpen(false);
                return;
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                const rows = [...event.currentTarget.parentElement!.querySelectorAll<HTMLElement>('.screen-row')];
                const index = rows.indexOf(event.currentTarget);
                const next = event.key === 'Home' ? rows[0]
                  : event.key === 'End' ? rows.at(-1)
                    : rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
                next?.focus();
              }
            }}
          >
            {editingId === s.id ? (
              <input
                autoFocus
                aria-label={`重命名屏幕 ${s.codeName}`}
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
                    type="button"
                    className="icon-btn"
                    title="重命名屏幕"
                    aria-label={`重命名 ${s.codeName}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(s.id);
                      setEditName(s.codeName);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className={`icon-btn ${s.isHome ? 'active' : ''}`}
                    title="设为主屏"
                    aria-label={`将 ${s.codeName} 设为主屏`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setHome(s.id);
                    }}
                  >
                    ★
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="删除屏幕"
                    aria-label={`删除屏幕 ${s.codeName}`}
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
      </div>}
    </div>
  );
}
