/**
 * PointerDnd — 自研指针拖拽(design/04 §4.4):组件面板 → 画布放置。
 * 画布内移动/缩放的会话在 CanvasStage 的指针状态机里(同一坐标换算)。
 *
 * 落点在 WASM canvas 内部,必须问 runtime.hitTest 找容器(obj/screen 根),
 * 蓝框高亮候选容器;pointerup → projectStore.mutate 插入 → L3 热重载。
 */
import { REGISTRY, autoName, createNode, findChildSpec, newUuid, type LvProject } from '@lvd/schema';
import { componentIdFromType, type WidgetNodeV2 } from '@lvd/schema/v2';
import { getPipeline } from './reloadPipeline';
import {
  findNodeById,
  findNodeByIdV2,
  namesInScreenV2,
  useProjectStore,
} from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';

/* CanvasStage 挂载时注册 stage 元素,palette 拖拽据此换算逻辑坐标 */
let stageEl: HTMLElement | null = null;
export function registerStageElement(el: HTMLElement | null): void {
  stageEl = el;
}

export function clientToLogical(clientX: number, clientY: number): { x: number; y: number } | null {
  if (!stageEl) return null;
  const rect = stageEl.getBoundingClientRect();
  const { zoom, pan } = useEditorStore.getState();
  return {
    x: (clientX - rect.left - pan.x) / zoom,
    y: (clientY - rect.top - pan.y) / zoom,
  };
}

function inCanvas(l: { x: number; y: number }, project: LvProject): boolean {
  return l.x >= 0 && l.y >= 0 && l.x < project.display.width && l.y < project.display.height;
}

/** 沿工程树上溯到最近可作容器的节点(acceptsWidgetChildren);null = 屏根 */
export function ascendToContainer(project: LvProject, nodeId: string | null, screenId: string): string {
  const screen = project.screens.find((s) => s.id === screenId) ?? project.screens[0];
  const rootId = screen ? screen.root.id : '';
  if (!nodeId) return rootId;
  let cur = nodeId;
  for (let guard = 0; guard < 64; guard++) {
    const hit = findNodeById(project, cur);
    if (!hit) return rootId;
    const spec = REGISTRY.get(hit.node.type);
    // 结构子元素容器(tabview-tab / tileview-tile / menu-page / msgbox 等)也可作 drop 目标
    const accepts = spec
      ? spec.acceptsWidgetChildren
      : findChildSpec(hit.node.type)?.child.acceptsWidgetChildren ?? false;
    if (accepts) return hit.node.id;
    if (!hit.parent) return rootId;
    cur = hit.parent.id;
  }
  return rootId;
}

/** palette item pointerdown 入口 */
export function startPaletteDrag(e: PointerEvent, widgetType: string): void {
  const spec = REGISTRY.get(widgetType);
  const componentId = componentIdFromType(widgetType);
  const component = componentId === null
    ? undefined
    : useProjectStore.getState().uiProject.components.find((item) => item.id === componentId);
  if (!spec && !component) return;
  e.preventDefault();

  const ghost = document.createElement('div');
  ghost.className = 'dnd-ghost';
  ghost.textContent = spec?.palette?.label ?? component?.displayName ?? component?.codeName ?? widgetType;
  document.body.appendChild(ghost);
  const moveGhost = (x: number, y: number): void => {
    ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
  };
  moveGhost(e.clientX, e.clientY);

  const onMove = (ev: PointerEvent): void => {
    moveGhost(ev.clientX, ev.clientY);
    const st = useProjectStore.getState();
    const ed = useEditorStore.getState();
    const l = clientToLogical(ev.clientX, ev.clientY);
    if (!l || !inCanvas(l, st.project) || ed.mode !== 'design') {
      ed.setDropTarget(null);
      return;
    }
    const pipeline = getPipeline();
    const hitId = pipeline ? pipeline.nodeIdAt(Math.round(l.x), Math.round(l.y)) : null;
    let containerId = ascendToContainer(st.project, hitId, ed.activeScreenId);
    const editableContainer = findNodeByIdV2(st.uiProject, containerId);
    if (editableContainer && componentIdFromType(editableContainer.node.type) !== null) {
      containerId = editableContainer.parent?.id ?? editableContainer.screen.root.id;
    }
    ed.setDropTarget(containerId);
  };

  const onUp = (ev: PointerEvent): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    ghost.remove();
    const ed = useEditorStore.getState();
    const containerId = ed.dropTargetId;
    ed.setDropTarget(null);
    const st = useProjectStore.getState();
    const l = clientToLogical(ev.clientX, ev.clientY);
    if (!containerId || !l || !inCanvas(l, st.project)) return;

    const pipeline = getPipeline();
    const contRect = pipeline?.rectOf(containerId) ?? { x: 0, y: 0, w: 0, h: 0 };
    const x = Math.max(0, Math.round(l.x - contRect.x));
    const y = Math.max(0, Math.round(l.y - contRect.y));
    const created = spec ? createNode(widgetType) : null;
    const node: WidgetNodeV2 = created ? {
      id: created.id, type: created.type, props: { ...created.props, x, y },
      styleRefs: [], styles: [], events: [], bindings: [], children: [],
    } : {
      id: newUuid(), type: widgetType, props: { x, y },
      styleRefs: [], styles: [], events: [], bindings: [], children: [],
    };

    st.mutateV2(`添加 ${spec?.palette?.label ?? component?.displayName ?? component?.codeName ?? widgetType}`, (draft) => {
      const screen = draft.screens.find((s) => s.id === ed.activeScreenId) ?? draft.screens[0];
      if (!screen) return;
      node.codeName = autoName(component?.codeName ?? widgetType, namesInScreenV2(screen));
      const container = findNodeByIdV2(draft, containerId)?.node ?? screen.root;
      container.children.push(node);
    });
    ed.select([node.id]);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
