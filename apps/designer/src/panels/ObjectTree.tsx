/**
 * ObjectTree — 活动屏对象树:选中联动 + dnd-kit sortable 同父重排(→L3)+ 右键删除。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { REGISTRY, findChildSpec } from '@lvd/schema';
import { requestText } from '../services/appDialogs';
import { componentIdFromType, type WidgetNodeV2 } from '@lvd/schema/v2';
import { findNodeByIdV2, useProjectStore } from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';
import { duplicateSelection } from '../services/clipboard';
import { createComponentFromNode, detachComponentInstance } from '../services/components';

interface Menu {
  x: number;
  y: number;
  nodeId: string;
}

const MENU_VIEWPORT_MARGIN = 8;

export function ObjectTree(): JSX.Element {
  const project = useProjectStore((s) => s.uiProject);
  const activeScreenId = useEditorStore((s) => s.activeScreenId);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuNodeRef = useRef<string | null>(null);

  /* 右键菜单开着时,点菜单外任意处(含 .tree 之外)关闭。清理监听防泄漏。 */
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  /* 菜单渲染后按真实尺寸约束到视口内，底部/右侧空间不足时自动向上/左移动。 */
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!menu || !element) return;
    const rect = element.getBoundingClientRect();
    const maxX = Math.max(MENU_VIEWPORT_MARGIN, window.innerWidth - rect.width - MENU_VIEWPORT_MARGIN);
    const maxY = Math.max(MENU_VIEWPORT_MARGIN, window.innerHeight - rect.height - MENU_VIEWPORT_MARGIN);
    const x = Math.min(Math.max(menu.x, MENU_VIEWPORT_MARGIN), maxX);
    const y = Math.min(Math.max(menu.y, MENU_VIEWPORT_MARGIN), maxY);
    if (x === menu.x && y === menu.y) return;
    setMenu((current) => current?.nodeId === menu.nodeId ? { ...current, x, y } : current);
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    menuNodeRef.current = menu.nodeId;
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [menu?.nodeId]);

  useEffect(() => {
    if (menu || !menuNodeRef.current) return;
    const nodeId = menuNodeRef.current;
    menuNodeRef.current = null;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-tree-node="${window.CSS.escape(nodeId)}"]`)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [menu]);

  const screen = project.screens.find((s) => s.id === activeScreenId) ?? project.screens[0];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesQuery = (node: WidgetNodeV2): boolean => {
    if (!normalizedQuery) return true;
    const spec = REGISTRY.get(node.type);
    const componentId = componentIdFromType(node.type);
    const component = componentId === null
      ? undefined
      : project.components.find((item) => item.id === componentId);
    const text = [
      node.type,
      node.codeName,
      node.displayName,
      spec?.palette?.label,
      component?.displayName,
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    return text.includes(normalizedQuery) || node.children.some(matchesQuery);
  };

  if (!screen) return <div className="tree-shell" />;

  const onDragEnd = (ev: DragEndEvent): void => {
    const activeId = String(ev.active.id);
    const overId = ev.over ? String(ev.over.id) : null;
    if (!overId || activeId === overId) return;
    const a = findNodeByIdV2(project, activeId);
    const b = findNodeByIdV2(project, overId);
    // 只允许同父重排(M1;跨容器 reparent 二期)
    if (!a || !b || !a.parent || a.parent !== b.parent) return;
    const parentId = a.parent.id;
    useProjectStore.getState().mutateV2('重排', (draft) => {
      const hit = findNodeByIdV2(draft, parentId);
      if (!hit) return;
      const ids = hit.node.children.map((c) => c.id);
      const from = ids.indexOf(activeId);
      const to = ids.indexOf(overId);
      if (from < 0 || to < 0) return;
      hit.node.children = arrayMove(hit.node.children, from, to);
    });
  };

  const deleteNode = (nodeId: string): void => {
    const hit = findNodeByIdV2(project, nodeId);
    if (!hit || !hit.parent) return; // 根不可删
    useProjectStore.getState().mutateV2(`删除 ${hit.node.codeName ?? hit.node.type}`, (draft) => {
      const h = findNodeByIdV2(draft, nodeId);
      if (!h?.parent) return;
      h.parent.children = h.parent.children.filter((c) => c.id !== nodeId);
    });
    const ed = useEditorStore.getState();
    ed.select(ed.selectedIds.filter((x) => x !== nodeId));
  };
  const menuNode = menu ? findNodeByIdV2(project, menu.nodeId)?.node : undefined;
  const menuComponentId = menuNode ? componentIdFromType(menuNode.type) : null;

  return (
    <div className="tree-shell">
      <label className="tree-search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 4 4" />
        </svg>
        <input
          type="search"
          value={query}
          placeholder="搜索对象…"
          aria-label="搜索对象树"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="tree-scroll">
        <div className="tree" role="tree" aria-label="对象树" onClick={() => setMenu(null)}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <TreeNode
              node={screen.root}
              depth={0}
              isRoot
              onMenu={setMenu}
              filterActive={normalizedQuery.length > 0}
              matchesQuery={matchesQuery}
            />
          </DndContext>
        </div>
      </div>
      {menu && createPortal(
        <div
          ref={menuRef}
          className="ctx-menu"
          role="menu"
          aria-label="对象操作"
          style={{ left: menu.x, top: menu.y }}
          onKeyDown={(event) => {
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const delta = event.key === 'ArrowDown' ? 1 : -1;
              items[(index + delta + items.length) % items.length]?.focus();
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
            }
          }}
        >
          {menuComponentId === null ? (
            <button
              role="menuitem"
              onClick={async () => {
                const node = findNodeByIdV2(project, menu.nodeId)?.node;
                const fallback = `${node?.displayName ?? node?.codeName ?? '新建'} 组件`;
                const name = await requestText({
                  title: '创建可复用组件',
                  label: '组件名称',
                  defaultValue: fallback,
                  confirmLabel: '创建',
                });
                if (name !== null) createComponentFromNode(menu.nodeId, name);
                setMenu(null);
              }}
            >
              创建可复用组件
            </button>
          ) : (
            <button
              role="menuitem"
              onClick={() => {
                detachComponentInstance(menu.nodeId);
                setMenu(null);
              }}
            >
              解除组件关联
            </button>
          )}
          <button
            role="menuitem"
            onClick={() => {
              useEditorStore.getState().select([menu.nodeId]);
              duplicateSelection();
              setMenu(null);
            }}
          >
            复刻
          </button>
          <button
            role="menuitem"
            onClick={() => {
              deleteNode(menu.nodeId);
              setMenu(null);
            }}
          >
            删除
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

function TreeNode(props: {
  node: WidgetNodeV2;
  depth: number;
  isRoot?: boolean;
  onMenu: (m: Menu | null) => void;
  filterActive: boolean;
  matchesQuery: (node: WidgetNodeV2) => boolean;
}): JSX.Element {
  const { node, depth, isRoot, onMenu, filterActive, matchesQuery } = props;
  const [expanded, setExpanded] = useState(true);
  const visibleChildren = filterActive ? node.children.filter(matchesQuery) : node.children;
  const childrenExpanded = filterActive || expanded;
  return (
    <div role="none">
      <TreeRow
        node={node}
        depth={depth}
        isRoot={isRoot}
        expanded={childrenExpanded}
        onToggle={() => setExpanded((value) => !value)}
        onMenu={onMenu}
      />
      {childrenExpanded && visibleChildren.length > 0 && (
        <div role="group">
          <SortableContext items={visibleChildren.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {visibleChildren.map((c) => (
              <TreeNode
                key={c.id}
                node={c}
                depth={depth + 1}
                onMenu={onMenu}
                filterActive={filterActive}
                matchesQuery={matchesQuery}
              />
            ))}
          </SortableContext>
        </div>
      )}
    </div>
  );
}

function TreeRow(props: {
  node: WidgetNodeV2;
  depth: number;
  isRoot?: boolean;
  expanded: boolean;
  onToggle: () => void;
  onMenu: (m: Menu | null) => void;
}): JSX.Element {
  const { node, depth, isRoot, expanded, onToggle, onMenu } = props;
  const components = useProjectStore((state) => state.uiProject.components);
  const selected = useEditorStore((s) => s.selectedIds.includes(node.id));
  const hovered = useEditorStore((s) => s.hoverId === node.id);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: node.id,
    disabled: isRoot,
  });
  const spec = REGISTRY.get(node.type);
  const componentId = componentIdFromType(node.type);
  const component = componentId === null ? undefined : components.find((item) => item.id === componentId);
  const typeLabel = spec?.palette?.label
    ?? component?.displayName
    ?? (findChildSpec(node.type) ? node.type.split('-').slice(1).join('-') : node.type);
  const label = node.displayName ?? node.codeName ?? `${node.type}_${node.id.slice(0, 6)}`;
  const hasChildren = node.children.length > 0;

  const selectNode = (toggle: boolean): void => {
    const editor = useEditorStore.getState();
    if (toggle) editor.toggleSelect(node.id);
    else editor.select([node.id]);
  };

  const openMenu = (x: number, y: number): void => {
    if (isRoot) return;
    selectNode(false);
    onMenu({ x, y, nodeId: node.id });
  };

  const moveWithKeyboard = (direction: -1 | 1): void => {
    const current = useProjectStore.getState().uiProject;
    const hit = findNodeByIdV2(current, node.id);
    if (!hit?.parent) return;
    const parentId = hit.parent.id;
    const index = hit.parent.children.findIndex((child) => child.id === node.id);
    const nextIndex = Math.max(0, Math.min(hit.parent.children.length - 1, index + direction));
    if (index === nextIndex) return;
    useProjectStore.getState().mutateV2('键盘重排', (draft) => {
      const parent = findNodeByIdV2(draft, parentId)?.node;
      if (parent) parent.children = arrayMove(parent.children, index, nextIndex);
    });
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="treeitem"
      tabIndex={0}
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-label={`${typeLabel} ${isRoot ? '屏幕根' : label}`}
      data-tree-node={node.id}
      className={`tree-row ${selected ? 'sel' : ''} ${hovered ? 'hov' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{
        paddingLeft: 8 + depth * 14,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onClick={(e) => {
        e.stopPropagation();
        selectNode(e.shiftKey);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          moveWithKeyboard(event.key === 'ArrowUp' ? -1 : 1);
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectNode(event.shiftKey);
          return;
        }
        if (event.key === 'ArrowRight' && hasChildren && !expanded) {
          event.preventDefault();
          onToggle();
          return;
        }
        if (event.key === 'ArrowLeft' && hasChildren && expanded) {
          event.preventDefault();
          onToggle();
          return;
        }
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          openMenu(rect.left + 24, rect.top + rect.height);
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          const rows = [...event.currentTarget.closest('[role="tree"]')!.querySelectorAll<HTMLElement>('[role="treeitem"]')];
          const index = rows.indexOf(event.currentTarget);
          const next = event.key === 'Home' ? rows[0]
            : event.key === 'End' ? rows.at(-1)
              : rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
          next?.focus();
        }
      }}
      onPointerEnter={() => useEditorStore.getState().setHover(node.id)}
      onPointerLeave={() => useEditorStore.getState().setHover(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu(e.clientX, e.clientY);
      }}
    >
      {hasChildren ? (
        <button
          type="button"
          className="tree-expander"
          aria-label={expanded ? `收起 ${label}` : `展开 ${label}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >{expanded ? '▾' : '▸'}</button>
      ) : <span className="tree-expander-spacer" aria-hidden="true" />}
      <span className="tree-type">{typeLabel}</span>
      <span className="tree-name">{isRoot ? '(屏根)' : label}</span>
      {!isRoot && (
        <button
          type="button"
          className="tree-action"
          title="复刻组件及全部子项"
          aria-label={`复刻 ${label}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            useEditorStore.getState().select([node.id]);
            duplicateSelection();
          }}
        >
          ⧉
        </button>
      )}
    </div>
  );
}
