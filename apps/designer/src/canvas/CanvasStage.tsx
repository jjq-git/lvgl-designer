/**
 * CanvasStage — 画布交互层(design/02 §4)。
 * world 容器 translate(pan)+scale(zoom),canvas 与 svg overlay 同 LVGL 逻辑坐标;
 * ctrl+滚轮缩放 / 空格拖平移;设计态指针状态机(选中/拖动/缩放 = L1 每帧 updateAttrs);
 * 运行态 overlay 隐藏、事件透传给 canvas(SDL 自行监听)。
 */
import { useCallback, useEffect, useRef } from 'react';
import type { LvProject, WidgetNode } from '@lvd/schema';
import { LvglRuntime, createMockRuntime, type LvdRect, type LvglRuntimeApi } from '@lvd/lvgl-runtime';
import { ReloadPipeline, getPipeline, setPipeline } from './reloadPipeline';
import { Overlay, type HandleDir } from './Overlay';
import { clientToLogical, registerStageElement } from './PointerDnd';
import { computeSnap } from './snap';
import { findNodeById, findNodeByIdV2, useProjectStore } from '../stores/projectStore';
import { registerFitStageElement, useEditorStore } from '../stores/editorStore';
import { syncProjectAssetsToRuntime } from '../services/assets';

/** 多选拖动时每个受动节点的起始状态(相对父的原始 x/y + 起始 rect) */
interface DragItem {
  id: string;
  origRel: { x: number; y: number };
  startRect: LvdRect;
}

type Session =
  | { kind: 'pan'; startClient: { x: number; y: number }; origPan: { x: number; y: number } }
  | { kind: 'press'; id: string; startL: { x: number; y: number } }
  | {
      kind: 'drag';
      /** 主控件(命中的那个)——吸附以它的 rect 为基准 */
      id: string;
      startL: { x: number; y: number };
      origRel: { x: number; y: number };
      startRect: LvdRect;
      siblingRects: LvdRect[];
      /** 全部随动节点(单选时只含主控件) */
      items: DragItem[];
    }
  | {
      kind: 'resize';
      id: string;
      dir: HandleDir;
      startL: { x: number; y: number };
      startRect: LvdRect;
      origRel: { x: number; y: number };
    }
  | {
      kind: 'marquee';
      startL: { x: number; y: number };
      additive: boolean;
      baseIds: string[]; // Shift 追加时的初始选中集
    };

const MIN_VISIBLE_CANVAS_PX = 64;

export function constrainCanvasPan(
  pan: { x: number; y: number },
  viewport: { width: number; height: number },
  displaySize: { width: number; height: number },
  zoom: number,
): { x: number; y: number } {
  const contentWidth = Math.max(0, displaySize.width * zoom);
  const contentHeight = Math.max(0, displaySize.height * zoom);
  const visibleX = Math.min(MIN_VISIBLE_CANVAS_PX, contentWidth, Math.max(0, viewport.width));
  const visibleY = Math.min(MIN_VISIBLE_CANVAS_PX, contentHeight, Math.max(0, viewport.height));
  return {
    x: Math.min(viewport.width - visibleX, Math.max(visibleX - contentWidth, pan.x)),
    y: Math.min(viewport.height - visibleY, Math.max(visibleY - contentHeight, pan.y)),
  };
}

function setNodeProps(id: string, label: string, props: Record<string, number>): void {
  useProjectStore.getState().mutateV2(
    label,
    (draft) => {
      const hit = findNodeByIdV2(draft, id);
      if (!hit) return;
      for (const [k, v] of Object.entries(props)) hit.node.props[k] = v;
    },
    { transient: true },
  );
}

/** 一次 mutate 写多个节点的 x/y —— 多选拖动/微移合并成一条历史(配合 begin/commitInteraction) */
function setNodesXy(
  label: string,
  entries: { id: string; x: number; y: number }[],
  opts?: { transient?: boolean; coalesceKey?: string },
): void {
  useProjectStore.getState().mutateV2(
    label,
    (draft) => {
      for (const { id, x, y } of entries) {
        const hit = findNodeByIdV2(draft, id);
        if (!hit) continue;
        hit.node.props['x'] = x;
        hit.node.props['y'] = y;
      }
    },
    opts,
  );
}

export function CanvasStage(): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bootRef = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const spaceRef = useRef(false);
  const prevModeRef = useRef<'design' | 'play'>('design');

  const display = useProjectStore((s) => s.project.display);
  const zoom = useEditorStore((s) => s.zoom);
  const pan = useEditorStore((s) => s.pan);
  const mode = useEditorStore((s) => s.mode);
  const activeScreenId = useEditorStore((s) => s.activeScreenId);
  const runtimeKind = useEditorStore((s) => s.runtimeKind);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const canUndo = useProjectStore((s) => s.undoStack.length > 0);
  const canRedo = useProjectStore((s) => s.redoStack.length > 0);

  const cancelActiveSession = useCallback((): void => {
    const session = sessionRef.current;
    sessionRef.current = null;
    const pointerId = activePointerIdRef.current;
    activePointerIdRef.current = null;
    const stage = stageRef.current;
    if (pointerId !== null && stage?.hasPointerCapture(pointerId)) {
      stage.releasePointerCapture(pointerId);
    }
    const editor = useEditorStore.getState();
    editor.setMarquee(null);
    editor.setGuides(null);
    if (session?.kind === 'drag' || session?.kind === 'resize') {
      useProjectStore.getState().abortInteraction();
      editor.bumpOverlay();
    }
  }, []);

  /* ---------- 运行时启动(单例;main.tsx 未用 StrictMode) ---------- */
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    registerStageElement(stageRef.current);
    registerFitStageElement(stageRef.current);
    const canvas = canvasRef.current;
    if (!canvas) return;
    void (async () => {
      const ed = useEditorStore.getState();
      const proj = useProjectStore.getState().project;
      let rt: LvglRuntimeApi;
      try {
        rt = await LvglRuntime.create(canvas, proj.display.width, proj.display.height);
        ed.setRuntimeKind('wasm');
      } catch (e) {
        console.error('[CanvasStage] WASM 加载失败,回落 mock', e);
        rt = createMockRuntime();
        ed.setRuntimeKind('mock');
        ed.setBanner(`WASM 运行时加载失败,已回落打桩模式(画布无渲染):${(e as Error).message}`);
      }
      rt.setMode('design');
      rt.start();
      // 素材先于首次 reloadAll 重灌(imageRef 解析依赖 registerImage;G5 管线)
      try {
        const latest = useProjectStore.getState().project;
        const { missing } = await syncProjectAssetsToRuntime(rt, latest);
        if (missing.length > 0) ed.setBanner(`素材缺失(本机库无内容):${missing.join(', ')}`);
      } catch (e) {
        console.warn('[CanvasStage] 启动素材重灌失败', e);
      }
      const p = new ReloadPipeline(rt);
      setPipeline(p);
      // Runtime/WASM 初始化期间可能已异步恢复了本地或云工程，不能再用挂载时捕获的旧工程
      // 覆盖 activeScreenId；管线启动也会从 store 读取同一份最新文档。
      const latestProject = useProjectStore.getState().project;
      const home = latestProject.screens.find((s) => s.isHome) ?? latestProject.screens[0];
      if (home) ed.setActiveScreen(home.id);
      p.start();
    })();
    return () => {
      registerStageElement(null);
      registerFitStageElement(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 首次进入及切换屏幕规格时，以 100% 缩放把设备屏幕放到内容区正中央。 */
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      useEditorStore.getState().resetView({ width: display.width, height: display.height });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeScreenId, display.height, display.width]);

  /* ---------- 模式切换:runtime.setMode;退出运行态强制 L3 复位(评审 G8) ---------- */
  useEffect(() => {
    if (mode === 'play') cancelActiveSession();
    const p = getPipeline();
    if (!p) {
      prevModeRef.current = mode;
      return;
    }
    p.runtime.setMode(mode);
    if (prevModeRef.current === 'play' && mode === 'design') p.resetActiveScreen();
    prevModeRef.current = mode;
  }, [cancelActiveSession, mode, runtimeKind]);

  /* ---------- 切屏 ---------- */
  useEffect(() => {
    if (!activeScreenId) return;
    getPipeline()?.loadScreenById(activeScreenId);
  }, [activeScreenId, runtimeKind]);

  /* ---------- 空格平移 / Esc 取消 / 方向键微移 ---------- */
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      const typing =
        t instanceof HTMLInputElement
        || t instanceof HTMLTextAreaElement
        || t instanceof HTMLSelectElement
        || !!t?.isContentEditable;
      const commandControl = t instanceof HTMLButtonElement
        || !!t?.closest('[role="button"], [role="menuitem"], [role="tab"]');
      const interactive = typing || commandControl;
      if (e.code === 'Space' && !interactive) {
        spaceRef.current = true;
      }
      if (e.key === 'Escape' && sessionRef.current) {
        e.preventDefault();
        cancelActiveSession();
      }
      // Shift+1:适应窗口(内容居中缩放)
      if (!interactive && e.shiftKey && (e.key === '!' || e.code === 'Digit1')) {
        e.preventDefault();
        const disp = useProjectStore.getState().project.display;
        useEditorStore.getState().fitToScreen({ width: disp.width, height: disp.height });
        return;
      }
      // 方向键微移(nudge):焦点不在输入框 + 设计态 + 有选中
      if (!interactive && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const ed = useEditorStore.getState();
        if (ed.mode !== 'design' || ed.selectedIds.length === 0 || sessionRef.current) return;
        e.preventDefault(); // 防页面滚动
        const step = e.shiftKey ? 10 : 1;
        if (e.ctrlKey || e.metaKey) {
          resizeSelection(
            e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
            e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
          );
          return;
        }
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        nudgeSelection(dx, dy);
      }
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') spaceRef.current = false;
    };

    const blur = (): void => {
      spaceRef.current = false;
      cancelActiveSession();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [cancelActiveSession]);

  /* ---------- 滚轮:ctrl=缩放;普通=纵移;shift=横移;始终保留一部分屏幕可见 ---------- */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const ed = useEditorStore.getState();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const oldZoom = ed.zoom;
        const factor = Math.exp(-e.deltaY * 0.0015);
        const newZoom = Math.min(8, Math.max(0.25, oldZoom * factor));
        // 保持指针下的逻辑点不动
        const lx = (px - ed.pan.x) / oldZoom;
        const ly = (py - ed.pan.y) / oldZoom;
        const nextPan = constrainCanvasPan(
          { x: px - lx * newZoom, y: py - ly * newZoom },
          { width: rect.width, height: rect.height },
          display,
          newZoom,
        );
        ed.setZoom(newZoom);
        ed.setPan(nextPan);
      } else {
        const horizontalDelta = e.shiftKey
          ? (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY)
          : e.deltaX;
        const verticalDelta = e.shiftKey ? 0 : e.deltaY;
        ed.setPan(constrainCanvasPan(
          { x: ed.pan.x - horizontalDelta, y: ed.pan.y - verticalDelta },
          { width: rect.width, height: rect.height },
          display,
          ed.zoom,
        ));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [display.height, display.width]);

  /* 面板或窗口尺寸变化时只收紧边界，不改变用户当前缩放和位置。 */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const size = entries[0]?.contentRect;
      if (!size) return;
      const ed = useEditorStore.getState();
      const nextPan = constrainCanvasPan(
        ed.pan,
        { width: size.width, height: size.height },
        display,
        ed.zoom,
      );
      if (nextPan.x !== ed.pan.x || nextPan.y !== ed.pan.y) ed.setPan(nextPan);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [display.height, display.width]);

  /* ---------- 指针状态机(设计态) ---------- */

  const onPointerDown = (e: React.PointerEvent): void => {
    const ed = useEditorStore.getState();
    if (ed.mode === 'play') return;
    const stage = stageRef.current;
    if (!stage) return;
    stage.focus({ preventScroll: true });
    stage.setPointerCapture(e.pointerId);
    activePointerIdRef.current = e.pointerId;

    if (spaceRef.current || e.button === 1) {
      sessionRef.current = { kind: 'pan', startClient: { x: e.clientX, y: e.clientY }, origPan: { ...ed.pan } };
      return;
    }
    if (e.button !== 0) return;

    const target = e.target as HTMLElement;
    const handle = target.getAttribute?.('data-handle') as HandleDir | null;
    const pipeline = getPipeline();
    const l = clientToLogical(e.clientX, e.clientY);
    if (!l || !pipeline) return;

    if (handle && ed.selectedIds.length === 1) {
      const id = ed.selectedIds[0]!;
      const rect = pipeline.rectOf(id);
      if (!rect) return;
      const parentRect = parentRectOf(id) ?? { x: 0, y: 0, w: display.width, h: display.height };
      useProjectStore.getState().beginInteraction('调整大小', `resize:${id}`);
      sessionRef.current = {
        kind: 'resize', id, dir: handle, startL: l, startRect: rect,
        origRel: { x: rect.x - parentRect.x, y: rect.y - parentRect.y },
      };
      return;
    }

    const project = useProjectStore.getState().project;
    const screen = project.screens.find((s) => s.id === ed.activeScreenId) ?? project.screens[0];
    const hitId = pipeline.nodeIdAt(Math.round(l.x), Math.round(l.y));
    if (!hitId || hitId === screen?.root.id) {
      // 空白处按下:进入框选会话(拖出选框才生效;若只是单击则 up 时取消选择)
      sessionRef.current = {
        kind: 'marquee', startL: l, additive: e.shiftKey, baseIds: e.shiftKey ? [...ed.selectedIds] : [],
      };
      ed.setMarquee(null);
      return;
    }
    if (e.shiftKey) {
      ed.toggleSelect(hitId);
      return;
    }
    // 命中一个"已在选中集里"的控件 → 不重置选择,后续拖动带动全部选中控件
    if (!ed.selectedIds.includes(hitId)) ed.select([hitId]);
    sessionRef.current = { kind: 'press', id: hitId, startL: l };
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const ed = useEditorStore.getState();
    if (ed.mode === 'play') return;
    const l = clientToLogical(e.clientX, e.clientY);
    const s = sessionRef.current;
    const pipeline = getPipeline();

    if (!s) {
      // hover 高亮
      if (!l || !pipeline) return;
      const inside = l.x >= 0 && l.y >= 0 && l.x < display.width && l.y < display.height;
      ed.setHover(inside ? pipeline.nodeIdAt(Math.round(l.x), Math.round(l.y)) : null);
      return;
    }

    if (s.kind === 'pan') {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      ed.setPan(constrainCanvasPan(
        {
          x: s.origPan.x + (e.clientX - s.startClient.x),
          y: s.origPan.y + (e.clientY - s.startClient.y),
        },
        { width: rect.width, height: rect.height },
        display,
        ed.zoom,
      ));
      return;
    }
    if (!l || !pipeline) return;

    if (s.kind === 'marquee') {
      const x = Math.min(s.startL.x, l.x);
      const y = Math.min(s.startL.y, l.y);
      const w = Math.abs(l.x - s.startL.x);
      const h = Math.abs(l.y - s.startL.y);
      ed.setMarquee({ x, y, w, h });
      return;
    }

    if (s.kind === 'press') {
      const dist = Math.hypot(l.x - s.startL.x, l.y - s.startL.y);
      if (dist <= 3 / ed.zoom) return;
      // 升级为拖动:采集(全部选中控件的)起始 rect / 父 rect / 兄弟 rects
      const project = useProjectStore.getState().project;
      const moving = ed.selectedIds.includes(s.id)
        ? topLevelMovableIds(project, ed.selectedIds)
        : [s.id];
      const primaryId = moving.includes(s.id) ? s.id : moving[0];
      if (!primaryId) return;
      const rect = pipeline.rectOf(primaryId);
      if (!rect) return;
      const hit = findNodeById(project, primaryId);
      if (!hit) return;
      const parentRect = parentRectOf(primaryId) ?? { x: 0, y: 0, w: display.width, h: display.height };
      const siblings = (hit.parent?.children ?? []).filter((c) => c.id !== primaryId).map((c) => c.id);
      const siblingRects = [...pipeline.rectsOf(siblings).values()];

      // 多选只移动顶层选中项，避免已选父容器和其子节点被重复位移。
      const items: DragItem[] = [];
      for (const mid of moving) {
        const mrect = mid === primaryId ? rect : pipeline.rectOf(mid);
        if (!mrect) continue;
        const mparent = parentRectOf(mid) ?? { x: 0, y: 0, w: display.width, h: display.height };
        items.push({ id: mid, startRect: mrect, origRel: { x: mrect.x - mparent.x, y: mrect.y - mparent.y } });
      }
      const label = items.length > 1 ? `移动 ${items.length} 个对象` : `移动 ${hit.node.name ?? hit.node.type}`;
      useProjectStore.getState().beginInteraction(label, `drag:${s.id}`);
      sessionRef.current = {
        kind: 'drag', id: primaryId, startL: s.startL,
        origRel: { x: rect.x - parentRect.x, y: rect.y - parentRect.y },
        startRect: rect, siblingRects, items,
      };
      return;
    }

    if (s.kind === 'drag') {
      let dx = l.x - s.startL.x;
      let dy = l.y - s.startL.y;
      // 吸附以主控件 rect 为基准
      const moving: LvdRect = { x: s.startRect.x + dx, y: s.startRect.y + dy, w: s.startRect.w, h: s.startRect.h };
      const snap = computeSnap(moving, s.siblingRects, display.width, display.height, 4 / ed.zoom);
      dx += snap.dx;
      dy += snap.dy;
      ed.setGuides(snap.v.length || snap.h.length ? { v: snap.v, h: snap.h } : null);
      const label = s.items.length > 1 ? `移动 ${s.items.length} 个对象` : '移动';
      // 同一 Δ 写回每个随动控件各自的 x/y(一次 mutate 合并)
      setNodesXy(
        label,
        s.items.map((it) => ({
          id: it.id,
          x: Math.round(it.origRel.x + dx),
          y: Math.round(it.origRel.y + dy),
        })),
        { transient: true },
      );
      return;
    }

    if (s.kind === 'resize') {
      const dx = l.x - s.startL.x;
      const dy = l.y - s.startL.y;
      const d = s.dir;
      let { x, y } = s.origRel;
      let w = s.startRect.w;
      let h = s.startRect.h;
      if (d.includes('e')) w = Math.max(1, Math.round(s.startRect.w + dx));
      if (d.includes('s')) h = Math.max(1, Math.round(s.startRect.h + dy));
      if (d.includes('w')) {
        w = Math.max(1, Math.round(s.startRect.w - dx));
        x = Math.round(s.origRel.x + s.startRect.w - w);
      }
      if (d.includes('n')) {
        h = Math.max(1, Math.round(s.startRect.h - dy));
        y = Math.round(s.origRel.y + s.startRect.h - h);
      }
      const props: Record<string, number> = { width: w, height: h };
      if (d.includes('w')) props['x'] = x;
      if (d.includes('n')) props['y'] = y;
      setNodeProps(s.id, '调整大小', props);
    }
  };

  const onPointerUp = (e: React.PointerEvent): void => {
    const s = sessionRef.current;
    const marqueeBox = s?.kind === 'marquee' ? useEditorStore.getState().marquee : null;
    sessionRef.current = null;
    activePointerIdRef.current = null;
    const stage = stageRef.current;
    if (stage?.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    if (!s) return;
    const ed = useEditorStore.getState();
    if (s.kind === 'drag' || s.kind === 'resize') {
      useProjectStore.getState().commitInteraction();
      ed.setGuides(null);
      // 松手后 rect 由 LVGL 布局回读刷新 overlay(setNodesXy 已 bump revision,此处兜底)
      ed.bumpOverlay();
      return;
    }
    if (s.kind === 'marquee') {
      ed.setMarquee(null);
      const pipeline = getPipeline();
      // 拖出了选框(有实际面积)→ 矩形相交测试;否则视为单击空白 → 取消选择
      if (marqueeBox && (marqueeBox.w > 1 || marqueeBox.h > 1) && pipeline) {
        const rects = pipeline.activeScreenNodeRects();
        const hitIds: string[] = [];
        for (const [id, r] of rects) {
          if (rectsIntersect(marqueeBox, r)) hitIds.push(id);
        }
        if (s.additive) {
          const set = new Set(s.baseIds);
          for (const id of hitIds) set.add(id);
          ed.select([...set]);
        } else {
          ed.select(hitIds);
        }
      } else if (!s.additive) {
        // 单击空白:取消选择(Shift 单击空白则保留原选择)
        ed.select([]);
      }
      return;
    }
    if (s.kind === 'press') {
      // 单击(未拖动)已在 pointerdown 选中,无需额外处理
      return;
    }
  };

  const isPlay = mode === 'play';

  return (
    <div
      ref={stageRef}
      className={`stage ${isPlay ? 'stage-play' : ''}`}
      role="region"
      tabIndex={0}
      aria-label={isPlay ? 'LVGL 运行画布' : 'LVGL 设计画布'}
      aria-describedby="canvas-keyboard-help"
      onFocus={() => useEditorStore.getState().setHover(null)}
      onPointerDown={isPlay ? undefined : onPointerDown}
      onPointerMove={isPlay ? undefined : onPointerMove}
      onPointerUp={isPlay ? undefined : onPointerUp}
      onPointerCancel={isPlay ? undefined : cancelActiveSession}
      onLostPointerCapture={isPlay ? undefined : cancelActiveSession}
      onPointerLeave={() => useEditorStore.getState().setHover(null)}
    >
      <span id="canvas-keyboard-help" className="sr-only">
        {isPlay
          ? '运行模式。画布事件会发送到 LVGL。'
          : '设计模式。方向键移动选中对象，Shift 加方向键移动十像素，Ctrl 或 Command 加方向键调整宽高。'}
      </span>
      <span className="sr-only" aria-live="polite">
        {selectedIds.length === 0 ? '未选中对象' : `已选中 ${selectedIds.length} 个对象`}
      </span>
      <div
        className="canvas-view-tools"
        role="toolbar"
        aria-label="画布视图工具"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="canvas-tool-btn"
          disabled={!canUndo || mode !== 'design'}
          title="撤销 (Ctrl+Z)"
          aria-label="撤销"
          onClick={() => useProjectStore.getState().undo()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 7 4 12l5 5" />
            <path d="M5 12h8a6 6 0 0 1 6 6" />
          </svg>
        </button>
        <button
          type="button"
          className="canvas-tool-btn"
          disabled={!canRedo || mode !== 'design'}
          title="重做 (Ctrl+Y)"
          aria-label="重做"
          onClick={() => useProjectStore.getState().redo()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 7 5 5-5 5" />
            <path d="M19 12h-8a6 6 0 0 0-6 6" />
          </svg>
        </button>
        <span className="canvas-zoom-label" title="Ctrl+滚轮缩放，空格拖动平移">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className="canvas-tool-btn"
          title="适应窗口 (Shift+1)"
          aria-label="适应窗口"
          onClick={() => {
            const currentDisplay = useProjectStore.getState().project.display;
            useEditorStore.getState().fitToScreen({
              width: currentDisplay.width,
              height: currentDisplay.height,
            });
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
          </svg>
        </button>
        <button
          type="button"
          className="canvas-tool-btn"
          title="重置视图（100% 居中）"
          aria-label="重置视图"
          onClick={() => {
            const currentDisplay = useProjectStore.getState().project.display;
            useEditorStore.getState().resetView({
              width: currentDisplay.width,
              height: currentDisplay.height,
            });
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
          </svg>
        </button>
      </div>
      <div
        className="world"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        <canvas
          ref={canvasRef}
          id="lvgl-canvas"
          width={display.width}
          height={display.height}
          aria-hidden="true"
          style={{ imageRendering: zoom >= 2 ? 'pixelated' : 'auto' }}
        />
        <Overlay />
      </div>
    </div>
  );
}

/**
 * 方向键微移:把全部选中控件按 (dx,dy) 平移。
 * 位置以 LVGL 布局回读为准(flex/align 下 props.x/y 不生效时,读当前实际相对父 rect 再加 Δ),
 * 与拖动同一套写回语义。一次 mutate + coalesceKey='nudge' 把连续按键合并成一条 undo。
 */
function nudgeSelection(dx: number, dy: number): void {
  const ed = useEditorStore.getState();
  const project = useProjectStore.getState().project;
  const ids = topLevelMovableIds(project, ed.selectedIds);
  if (ids.length === 0) return;
  const pipeline = getPipeline();
  const display = project.display;
  const entries: { id: string; x: number; y: number }[] = [];
  for (const id of ids) {
    const hit = findNodeById(project, id);
    if (!hit || hit.node === hit.screen.root) continue; // 屏根不动
    const rect = pipeline?.rectOf(id);
    let relX: number;
    let relY: number;
    if (rect) {
      const parentRect = parentRectOf(id) ?? { x: 0, y: 0, w: display.width, h: display.height };
      relX = rect.x - parentRect.x;
      relY = rect.y - parentRect.y;
    } else {
      // 无 runtime rect(mock 等):退回读 props.x/y(缺省 0)
      relX = typeof hit.node.props['x'] === 'number' ? (hit.node.props['x'] as number) : 0;
      relY = typeof hit.node.props['y'] === 'number' ? (hit.node.props['y'] as number) : 0;
    }
    entries.push({ id, x: Math.round(relX + dx), y: Math.round(relY + dy) });
  }
  if (entries.length === 0) return;
  const label = entries.length > 1 ? `微移 ${entries.length} 个对象` : '微移';
  setNodesXy(label, entries, { coalesceKey: `nudge:${ids.slice().sort().join(',')}` });
}

/** Ctrl/Command + 方向键：为鼠标缩放手柄提供键盘等价操作。 */
function resizeSelection(dw: number, dh: number): void {
  const ids = useEditorStore.getState().selectedIds;
  if (ids.length !== 1) return;
  const id = ids[0]!;
  const project = useProjectStore.getState().uiProject;
  const hit = findNodeByIdV2(project, id);
  if (!hit || hit.node === hit.screen.root) return;
  const rect = getPipeline()?.rectOf(id);
  const currentWidth = rect?.w
    ?? (typeof hit.node.props['width'] === 'number' ? hit.node.props['width'] : 1);
  const currentHeight = rect?.h
    ?? (typeof hit.node.props['height'] === 'number' ? hit.node.props['height'] : 1);
  useProjectStore.getState().mutateV2(
    '键盘调整大小',
    (draft) => {
      const current = findNodeByIdV2(draft, id)?.node;
      if (!current) return;
      if (dw !== 0) current.props['width'] = Math.max(1, Math.round(currentWidth + dw));
      if (dh !== 0) current.props['height'] = Math.max(1, Math.round(currentHeight + dh));
    },
    { coalesceKey: `keyboard-resize:${id}` },
  );
}

/**
 * 多选移动只保留没有已选祖先的节点。否则父容器移动后，其已选子节点又会被写入一次
 * x/y，造成视觉上的双倍位移。返回顺序与工程树一致，且屏根始终不可移动。
 */
export function topLevelMovableIds(project: LvProject, ids: string[]): string[] {
  const selected = new Set(ids);
  const result: string[] = [];
  const walk = (node: WidgetNode, hasSelectedAncestor: boolean, isRoot: boolean): void => {
    const isMovableSelection = selected.has(node.id) && !isRoot;
    if (isMovableSelection && !hasSelectedAncestor) result.push(node.id);
    const blocksDescendants = hasSelectedAncestor || isMovableSelection;
    for (const child of node.children) walk(child, blocksDescendants, false);
  };
  for (const screen of project.screens) walk(screen.root, false, true);
  return result;
}

/** 矩形相交测试(边接触不算相交;框选用) */
function rectsIntersect(a: { x: number; y: number; w: number; h: number }, b: LvdRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 节点父容器的屏幕坐标 rect(根的父 = 画布) */
function parentRectOf(nodeId: string): LvdRect | null {
  const pipeline = getPipeline();
  if (!pipeline) return null;
  const project = useProjectStore.getState().project;
  const hit = findNodeById(project, nodeId);
  if (!hit || !hit.parent) return null;
  return pipeline.rectOf(hit.parent.id);
}
