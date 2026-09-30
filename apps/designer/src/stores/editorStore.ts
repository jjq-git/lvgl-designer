/**
 * editorStore — 瞬态 UI 状态(选中/悬停/缩放/平移/模式/活动屏)。
 * 绝不进历史栈、绝不进工程文件(design/04 §2)。
 */
import { create } from 'zustand';
import type { WidgetNodeV2 } from '@lvd/schema/v2';

export type EditorMode = 'design' | 'play';

/**
 * 复制粘贴用的内存剪贴板(模块级,不进历史栈/不进工程文件)。
 * 存的是选中子树的深拷贝(id/name 保留原样,粘贴时才重生成)。
 * 跨屏可用:切屏不清空,切工程也保留(纯内存,刷新即失效,符合直觉)。
 */
let clipboard: WidgetNodeV2[] = [];

export function setClipboard(nodes: WidgetNodeV2[]): void {
  // 深拷贝入库,避免后续对原树(immer 冻结)或粘贴复用同一引用造成污染
  clipboard = structuredClone(nodes);
}

export function getClipboard(): WidgetNodeV2[] {
  return clipboard;
}

export function clipboardHasContent(): boolean {
  return clipboard.length > 0;
}

export interface GuideLines {
  v: number[]; // 竖直参考线的 x
  h: number[]; // 水平参考线的 y
}

export interface MarqueeRect {
  x: number; // stage 逻辑坐标(LVGL 坐标系,与 overlay 同)
  y: number;
  w: number;
  h: number;
}

/* CanvasStage 注册 stage 容器,fitToScreen 据此拿可视区尺寸 */
let stageElForFit: HTMLElement | null = null;
export function registerFitStageElement(el: HTMLElement | null): void {
  stageElForFit = el;
}

function centeredPan(
  displaySize: { width: number; height: number },
  zoom: number,
): { x: number; y: number } | null {
  if (!stageElForFit || displaySize.width <= 0 || displaySize.height <= 0) return null;
  const rect = stageElForFit.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: (rect.width - displaySize.width * zoom) / 2,
    y: (rect.height - displaySize.height * zoom) / 2,
  };
}

export interface EditorStoreState {
  selectedIds: string[];
  hoverId: string | null;
  zoom: number;
  pan: { x: number; y: number };
  mode: EditorMode;
  activeScreenId: string;
  /** 管线每次应用完 runtime 变更后 +1,Overlay 靠它重读 rect */
  overlayTick: number;
  runtimeKind: 'none' | 'wasm' | 'mock';
  banner: string | null;
  dropTargetId: string | null;
  guides: GuideLines | null;
  /** 框选中的选框(stage 逻辑坐标);null = 无框选进行中 */
  marquee: MarqueeRect | null;

  select(ids: string[]): void;
  toggleSelect(id: string): void;
  setHover(id: string | null): void;
  setZoom(zoom: number): void;
  setPan(pan: { x: number; y: number }): void;
  setMode(mode: EditorMode): void;
  setActiveScreen(id: string): void;
  bumpOverlay(): void;
  setRuntimeKind(k: 'none' | 'wasm' | 'mock'): void;
  setBanner(b: string | null): void;
  setDropTarget(id: string | null): void;
  setGuides(g: GuideLines | null): void;
  setMarquee(m: MarqueeRect | null): void;
  /** 视图复位:zoom=1,内容在可视区水平垂直居中 */
  resetView(displaySize: { width: number; height: number }): void;
  /** 适应窗口:内容(display.width×height)居中 + ~10% 边距 */
  fitToScreen(displaySize: { width: number; height: number }): void;
}

export const useEditorStore = create<EditorStoreState>()((set, get) => ({
  selectedIds: [],
  hoverId: null,
  zoom: 1,
  pan: { x: 40, y: 40 },
  mode: 'design',
  activeScreenId: '',
  overlayTick: 0,
  runtimeKind: 'none',
  banner: null,
  dropTargetId: null,
  guides: null,
  marquee: null,

  select: (ids) => set({ selectedIds: ids }),
  toggleSelect: (id) => {
    const cur = get().selectedIds;
    set({ selectedIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  },
  setHover: (hoverId) => set({ hoverId }),
  setZoom: (zoom) => set({ zoom: Math.min(8, Math.max(0.25, zoom)) }),
  setPan: (pan) => set({ pan }),
  setMode: (mode) => set({ mode }),
  setActiveScreen: (activeScreenId) => set({ activeScreenId, selectedIds: [], hoverId: null }),
  bumpOverlay: () => set((s) => ({ overlayTick: s.overlayTick + 1 })),
  setRuntimeKind: (runtimeKind) => set({ runtimeKind }),
  setBanner: (banner) => set({ banner }),
  setDropTarget: (dropTargetId) => set({ dropTargetId }),
  setGuides: (guides) => set({ guides }),
  setMarquee: (marquee) => set({ marquee }),

  resetView: (displaySize) => set({
    zoom: 1,
    pan: centeredPan(displaySize, 1) ?? { x: 40, y: 40 },
  }),

  fitToScreen: (displaySize) => {
    const el = stageElForFit;
    const cw = displaySize.width;
    const ch = displaySize.height;
    if (!el || cw <= 0 || ch <= 0) {
      // 兜底:拿不到 stage 尺寸就退回复位视图
      set({ zoom: 1, pan: { x: 40, y: 40 } });
      return;
    }
    const rect = el.getBoundingClientRect();
    const vw = rect.width;
    const vh = rect.height;
    if (vw <= 0 || vh <= 0) {
      set({ zoom: 1, pan: { x: 40, y: 40 } });
      return;
    }
    const margin = 0.1; // 两侧各留 ~10% 边距 → 内容占 80%
    const usable = 1 - margin * 2;
    const zoomRaw = Math.min((vw * usable) / cw, (vh * usable) / ch);
    // 与 setZoom 同样钳制在 [0.25, 8]
    const zoom = Math.min(8, Math.max(0.25, zoomRaw));
    // 让内容居中:pan 使 (cw/2,ch/2)*zoom 落在可视区中心
    const pan = {
      x: (vw - cw * zoom) / 2,
      y: (vh - ch * zoom) / 2,
    };
    set({ zoom, pan });
  },
}));
