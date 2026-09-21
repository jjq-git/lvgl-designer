/**
 * CanvasStage — 画布交互层(design/02 §4)。
 * world 容器 translate(pan)+scale(zoom),canvas 与 svg overlay 同 LVGL 逻辑坐标;
 * ctrl+滚轮缩放 / 空格拖平移;设计态指针状态机(选中/拖动/缩放 = L1 每帧 updateAttrs);
 * 运行态 overlay 隐藏、事件透传给 canvas(SDL 自行监听)。
 */
import { useEffect, useRef } from 'react';
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
  const spaceRef = useRef(false);
  const prevModeRef = useRef<'design' | 'play'>('design');

  const display = useProjectStore((s) => s.project.display);
  const zoom = useEditorStore((s) => s.zoom);
  const pan = useEditorStore((s) => s.pan);
  const mode = useEditorStore((s) => s.mode);
  const activeScreenId = useEditorStore((s) => s.activeScreenId);
  const runtimeKind = useEditorStore((s) => s.runtimeKind);

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
      const home = proj.screens.find((s) => s.isHome) ?? proj.screens[0];
      if (home) ed.setActiveScreen(home.id);
      p.start();
    })();
    return () => {
      registerStageElement(null);
      registerFitStageElement(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 模式切换:runtime.setMode;退出运行态强制 L3 复位(评审 G8) ---------- */
  useEffect(() => {
    const p = getPipeline();
    if (!p) {
      prevModeRef.current = mode;
      return;
    }
    p.runtime.setMode(mode);
    if (prevModeRef.current === 'play' && mode === 'design') p.resetActiveScreen();
    prevModeRef.current = mode;
  }, [mode, runtimeKind]);

  /* ---------- 切屏 ---------- */
  useEffect(() => {
    if (!activeScreenId) return;
    getPipeline()?.loadScreenById(activeScreenId);
  }, [activeScreenId, runtimeKind]);

  /* ---------- 空格平移 / Esc 取消 / 方向键微移 ---------- */
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      const typing =
        t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || !!t?.isContentEditable;
      if (e.code === 'Space' && !typing) {
        spaceRef.current = true;
      }
      if (e.key === 'Escape' && sessionRef.current) {
        const s = sessionRef.current;
        sessionRef.current = null;
        if (s.kind === 'drag' || s.kind === 'resize') {
          useProjectStore.getState().abortInteraction();
          useEditorStore.getState().setGuides(null);
        }
      }
      // Shift+1:适应窗口(内容居中缩放)
      if (!typing && e.shiftKey && (e.key === '!' || e.code === 'Digit1')) {
        e.preventDefault();
        const disp = useProjectStore.getState().project.display;
        useEditorStore.getState().fitToScreen({ width: disp.width, height: disp.height });
        return;
      }
      // 方向键微移(nudge):焦点不在输入框 + 设计态 + 有选中
      if (!typing && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const ed = useEditorStore.getState();
        if (ed.mode !== 'design' || ed.selectedIds.length === 0 || sessionRef.current) return;
        e.preventDefault(); // 防页面滚动
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        nudgeSelection(dx, dy);
      }
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') spaceRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /* ---------- 滚轮:ctrl=缩放(以指针为中心),否则平移(非 passive) ---------- */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const ed = useEditorStore.getState();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const oldZoom = ed.zoom;
        const factor = Math.exp(-e.deltaY * 0.0015);
        const newZoom = Math.min(8, Math.max(0.25, oldZoom * factor));
        // 保持指针下的逻辑点不动
        const lx = (px - ed.pan.x) / oldZoom;
        const ly = (py - ed.pan.y) / oldZoom;
        ed.setZoom(newZoom);
        ed.setPan({ x: px - lx * newZoom, y: py - ly * newZoom });
      } else {
        ed.setPan({ x: ed.pan.x - e.deltaX, y: ed.pan.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* ---------- 指针状态机(设计态) ---------- */

  const onPointerDown = (e: React.PointerEvent): void => {
    const ed = useEditorStore.getState();
    if (ed.mode === 'play') return;
    const stage = stageRef.current;
    if (!stage) return;
    stage.setPointerCapture(e.pointerId);

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
      ed.setPan({
        x: s.origPan.x + (e.clientX - s.startClient.x),
        y: s.origPan.y + (e.clientY - s.startClient.y),
      });
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
      const rect = pipeline.rectOf(s.id);
      if (!rect) return;
      const project = useProjectStore.getState().project;
      const hit = findNodeById(project, s.id);
      if (!hit) return;
      const parentRect = parentRectOf(s.id) ?? { x: 0, y: 0, w: display.width, h: display.height };
      const siblings = (hit.parent?.children ?? []).filter((c) => c.id !== s.id).map((c) => c.id);
      const siblingRects = [...pipeline.rectsOf(siblings).values()];

      // 多选:除主控件外,把其余选中控件也纳入随动,各自记 origRel/startRect
      const moving = ed.selectedIds.includes(s.id) ? ed.selectedIds : [s.id];
      const items: DragItem[] = [];
      for (const mid of moving) {
        const mrect = mid === s.id ? rect : pipeline.rectOf(mid);
        if (!mrect) continue;
        const mparent = parentRectOf(mid) ?? { x: 0, y: 0, w: display.width, h: display.height };
        items.push({ id: mid, startRect: mrect, origRel: { x: mrect.x - mparent.x, y: mrect.y - mparent.y } });
      }
      const label = items.length > 1 ? `移动 ${items.length} 个对象` : `移动 ${hit.node.name ?? hit.node.type}`;
      useProjectStore.getState().beginInteraction(label, `drag:${s.id}`);
      sessionRef.current = {
        kind: 'drag', id: s.id, startL: s.startL,
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
    sessionRef.current = null;
    stageRef.current?.releasePointerCapture(e.pointerId);
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
      const box = ed.marquee;
      ed.setMarquee(null);
      const pipeline = getPipeline();
      // 拖出了选框(有实际面积)→ 矩形相交测试;否则视为单击空白 → 取消选择
      if (box && (box.w > 1 || box.h > 1) && pipeline) {
        const rects = pipeline.activeScreenNodeRects();
        const hitIds: string[] = [];
        for (const [id, r] of rects) {
          if (rectsIntersect(box, r)) hitIds.push(id);
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
      onPointerDown={isPlay ? undefined : onPointerDown}
      onPointerMove={isPlay ? undefined : onPointerMove}
      onPointerUp={isPlay ? undefined : onPointerUp}
      onPointerLeave={() => useEditorStore.getState().setHover(null)}
    >
      <div
        className="world"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        <canvas
          ref={canvasRef}
          id="lvgl-canvas"
          width={display.width}
          height={display.height}
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
  const ids = ed.selectedIds;
  if (ids.length === 0) return;
  const pipeline = getPipeline();
  const project = useProjectStore.getState().project;
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
  setNodesXy(label, entries, { coalesceKey: 'nudge' });
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
