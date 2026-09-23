/**
 * ObjectTree — 活动屏对象树:选中联动 + dnd-kit sortable 同父重排(→L3)+ 右键删除。
 */
import { useEffect, useRef, useState } from 'react';
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

export function ObjectTree(): JSX.Element {
  const project = useProjectStore((s) => s.uiProject);
  const activeScreenId = useEditorStore((s) => s.activeScreenId);
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

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

  const screen = project.screens.find((s) => s.id === activeScreenId) ?? project.screens[0];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  if (!screen) return <div className="tree" />;

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
    <div className="tree" onClick={() => setMenu(null)}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <TreeNode node={screen.root} depth={0} isRoot onMenu={setMenu} />
      </DndContext>
      {menu && (
        <div ref={menuRef} className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
          {menuComponentId === null ? (
            <button
              onClick={() => {
                const node = findNodeByIdV2(project, menu.nodeId)?.node;
                const fallback = `${node?.displayName ?? node?.codeName ?? '新建'} 组件`;
                const name = window.prompt('可复用组件名称', fallback);
                if (name !== null) createComponentFromNode(menu.nodeId, name);
                setMenu(null);
              }}
            >
              创建可复用组件
            </button>
          ) : (
            <button
              onClick={() => {
                detachComponentInstance(menu.nodeId);
                setMenu(null);
              }}
            >
              解除组件关联
            </button>
          )}
          <button
            onClick={() => {
              useEditorStore.getState().select([menu.nodeId]);
              duplicateSelection();
              setMenu(null);
            }}
          >
            复刻
          </button>
          <button
            onClick={() => {
              deleteNode(menu.nodeId);
              setMenu(null);
            }}
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
}

function TreeNode(props: {
  node: WidgetNodeV2;
  depth: number;
  isRoot?: boolean;
  onMenu: (m: Menu | null) => void;
}): JSX.Element {
  const { node, depth, isRoot, onMenu } = props;
  return (
    <div>
      <TreeRow node={node} depth={depth} isRoot={isRoot} onMenu={onMenu} />
      {node.children.length > 0 && (
        <SortableContext items={node.children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} onMenu={onMenu} />
          ))}
        </SortableContext>
      )}
    </div>
  );
}

function TreeRow(props: {
  node: WidgetNodeV2;
  depth: number;
  isRoot?: boolean;
  onMenu: (m: Menu | null) => void;
}): JSX.Element {
  const { node, depth, isRoot, onMenu } = props;
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

  return (
    <div
      ref={setNodeRef}
      className={`tree-row ${selected ? 'sel' : ''} ${hovered ? 'hov' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{
        paddingLeft: 8 + depth * 14,
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onClick={(e) => {
        e.stopPropagation();
        const ed = useEditorStore.getState();
        if (e.shiftKey) ed.toggleSelect(node.id);
        else ed.select([node.id]);
      }}
      onPointerEnter={() => useEditorStore.getState().setHover(node.id)}
      onPointerLeave={() => useEditorStore.getState().setHover(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isRoot) return;
        useEditorStore.getState().select([node.id]);
        onMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
      }}
      {...attributes}
      {...listeners}
    >
      <span className="tree-type">{typeLabel}</span>
      <span className="tree-name">{isRoot ? '(屏根)' : label}</span>
      {!isRoot && (
        <button
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
