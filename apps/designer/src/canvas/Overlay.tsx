/**
 * Overlay — 与 canvas 同置一个 translate+scale 容器的 SVG(design/02 §4.1),
 * 内部全用 LVGL 逻辑坐标;手柄尺寸按 1/zoom 反补偿;
 * 选择框 + 8 手柄 + hover 框 + 落点高亮 + 对齐参考线 + 圆屏遮罩。
 */
import { useEditorStore } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { getPipeline } from './reloadPipeline';
import type { LvdRect } from '@lvd/lvgl-runtime';

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type HandleDir = (typeof HANDLES)[number];

function handlePos(r: LvdRect, dir: HandleDir): { x: number; y: number } {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  switch (dir) {
    case 'nw': return { x: r.x, y: r.y };
    case 'n': return { x: cx, y: r.y };
    case 'ne': return { x: r.x + r.w, y: r.y };
    case 'e': return { x: r.x + r.w, y: cy };
    case 'se': return { x: r.x + r.w, y: r.y + r.h };
    case 's': return { x: cx, y: r.y + r.h };
    case 'sw': return { x: r.x, y: r.y + r.h };
    case 'w': return { x: r.x, y: cy };
  }
}

const CURSORS: Record<HandleDir, string> = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
};

export function Overlay(): JSX.Element | null {
  const display = useProjectStore((s) => s.project.display);
  // 订阅 revision:工程变化 → rect 可能变
  useProjectStore((s) => s.revision);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const hoverId = useEditorStore((s) => s.hoverId);
  const zoom = useEditorStore((s) => s.zoom);
  const mode = useEditorStore((s) => s.mode);
  const dropTargetId = useEditorStore((s) => s.dropTargetId);
  const guides = useEditorStore((s) => s.guides);
  const marquee = useEditorStore((s) => s.marquee);
  useEditorStore((s) => s.overlayTick);

  const { width: w, height: h } = display;
  const pipeline = getPipeline();

  const round = display.shape === 'round';
  const r = Math.min(w, h) / 2;
  const cx = w / 2;
  const cy = h / 2;
  // evenodd:外矩形(外扩防描边露缝)+ 内圆
  const maskPath =
    `M ${-w} ${-h} H ${2 * w} V ${2 * h} H ${-w} Z ` +
    `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;

  if (mode === 'play') {
    // 运行态:overlay 隐藏,仅保留圆屏遮罩
    return (
      <svg className="overlay" aria-hidden="true" viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
        {round && <path d={maskPath} fillRule="evenodd" fill="rgba(10,10,12,0.75)" />}
      </svg>
    );
  }

  const selRects: { id: string; rect: LvdRect }[] = [];
  if (pipeline) {
    const m = pipeline.rectsOf(selectedIds);
    for (const [id, rect] of m) selRects.push({ id, rect });
  }
  const hoverRect =
    pipeline && hoverId && !selectedIds.includes(hoverId) ? pipeline.rectOf(hoverId) : null;
  const dropRect = pipeline && dropTargetId ? pipeline.rectOf(dropTargetId) : null;
  const hs = 8 / zoom; // 手柄边长反补偿

  return (
    <svg className="overlay" aria-hidden="true" viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
      {/* 对齐参考线 */}
      {guides?.v.map((x) => (
        <line key={`v${x}`} x1={x} y1={0} x2={x} y2={h} stroke="#ff5cf4" strokeWidth={1 / zoom} />
      ))}
      {guides?.h.map((y) => (
        <line key={`h${y}`} x1={0} y1={y} x2={w} y2={y} stroke="#ff5cf4" strokeWidth={1 / zoom} />
      ))}
      {/* 落点容器高亮 */}
      {dropRect && (
        <rect
          x={dropRect.x} y={dropRect.y} width={dropRect.w} height={dropRect.h}
          fill="rgba(64,160,255,0.12)" stroke="#40a0ff" strokeWidth={2 / zoom}
        />
      )}
      {/* hover */}
      {hoverRect && (
        <rect
          x={hoverRect.x} y={hoverRect.y} width={hoverRect.w} height={hoverRect.h}
          fill="none" stroke="rgba(120,190,255,0.8)" strokeWidth={1 / zoom} strokeDasharray={`${3 / zoom}`}
        />
      )}
      {/* 选择框 + 手柄(单选才出手柄) */}
      {selRects.map(({ id, rect }) => (
        <g key={id}>
          <rect
            x={rect.x} y={rect.y} width={rect.w} height={rect.h}
            fill="none" stroke="#4aa8ff" strokeWidth={1.5 / zoom}
          />
          {selRects.length === 1 &&
            HANDLES.map((dir) => {
              const p = handlePos(rect, dir);
              return (
                <rect
                  key={dir}
                  data-handle={dir}
                  x={p.x - hs / 2} y={p.y - hs / 2} width={hs} height={hs}
                  fill="#fff" stroke="#4aa8ff" strokeWidth={1 / zoom}
                  style={{ cursor: CURSORS[dir], pointerEvents: 'all' }}
                />
              );
            })}
        </g>
      ))}
      {/* 框选选框(marquee) */}
      {marquee && (
        <rect
          className="marquee"
          x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h}
          fill="rgba(74,168,255,0.12)" stroke="#4aa8ff" strokeWidth={1 / zoom}
          strokeDasharray={`${4 / zoom} ${3 / zoom}`}
        />
      )}
      {/* 圆屏遮罩(最上层,pointer-events 由 CSS 关) */}
      {round && <path d={maskPath} fillRule="evenodd" fill="rgba(10,10,12,0.75)" />}
      {round && (
        <circle cx={cx} cy={cy} r={r - 0.5} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={1 / zoom} />
      )}
    </svg>
  );
}
