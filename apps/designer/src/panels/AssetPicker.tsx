/**
 * AssetPicker — imageRef 属性的素材选择器(含缩略图下拉);
 * AssetMultiPicker — animimage 帧序列多选。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ImageAsset } from '@lvd/schema';
import { useProjectStore } from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';
import {
  importMaterialSymbol,
  materialSymbolSvgUrl,
  searchMaterialSymbols,
  type MaterialSymbolsSearchResult,
} from '../services/assets';
import { useThumb } from './AssetPanel';

const PICKER_VIEWPORT_MARGIN = 8;
const PICKER_GAP = 4;
const PICKER_MAX_HEIGHT = 220;
const MATERIAL_PICKER_MAX_HEIGHT = 460;
const MATERIAL_PICKER_WIDTH = 460;

interface PickerPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

function Thumb({ asset }: { asset: ImageAsset | null }): JSX.Element {
  const url = useThumb(asset);
  if (!asset) return <span className="asset-thumb asset-thumb-sm asset-thumb-icon">—</span>;
  if ((asset.kind ?? 'image') === 'lottie') return <span className="asset-thumb asset-thumb-sm asset-thumb-icon">🎞</span>;
  return (
    <span className="asset-thumb asset-thumb-sm">
      {url ? <img src={url} alt={asset.name} /> : <span className="asset-thumb-icon">…</span>}
    </span>
  );
}

export function AssetPicker(props: {
  ariaLabel?: string;
  value: string | undefined;
  accept: 'image' | 'lottie';
  onChange: (v: string | undefined) => void;
}): JSX.Element {
  const { value, accept, onChange } = props;
  const images = useProjectStore((s) => s.project.assets.images);
  const options = images.filter((a) => (a.kind ?? 'image') === accept);
  const current = images.find((a) => a.name === value) ?? null;
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<'assets' | 'material'>('assets');
  const [query, setQuery] = useState('');
  const [materialResult, setMaterialResult] = useState<MaterialSymbolsSearchResult | null>(null);
  const [materialLoading, setMaterialLoading] = useState(false);
  const [materialBusy, setMaterialBusy] = useState('');
  const [materialError, setMaterialError] = useState('');
  const [materialSize, setMaterialSize] = useState(32);
  const [position, setPosition] = useState<PickerPosition>({ left: 0, top: 0, width: 0, maxHeight: PICKER_MAX_HEIGHT });
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const openPicker = (): void => {
    if (open) {
      setOpen(false);
      return;
    }
    setPanel('assets');
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition({
        left: rect.left,
        top: rect.bottom + PICKER_GAP,
        width: rect.width,
        maxHeight: PICKER_MAX_HEIGHT,
      });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const close = (): void => setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || panel !== 'material') return;
    let alive = true;
    const timer = window.setTimeout(() => {
      setMaterialError('');
      setMaterialLoading(true);
      void searchMaterialSymbols(query, 80, 0).then((next) => {
        if (!alive) return;
        setMaterialResult(next);
        setMaterialLoading(false);
      }).catch((reason: unknown) => {
        if (!alive) return;
        setMaterialError(reason instanceof Error ? reason.message : String(reason));
        setMaterialLoading(false);
      });
    }, query ? 180 : 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [open, panel, query]);

  useLayoutEffect(() => {
    if (!open || !rootRef.current || !popupRef.current) return;
    const trigger = rootRef.current.getBoundingClientRect();
    const popup = popupRef.current;
    const spaceBelow = window.innerHeight - trigger.bottom - PICKER_GAP - PICKER_VIEWPORT_MARGIN;
    const spaceAbove = trigger.top - PICKER_GAP - PICKER_VIEWPORT_MARGIN;
    const heightLimit = panel === 'material' ? MATERIAL_PICKER_MAX_HEIGHT : PICKER_MAX_HEIGHT;
    const naturalHeight = Math.min(popup.scrollHeight, heightLimit);
    const openAbove = naturalHeight > spaceBelow && spaceAbove > spaceBelow;
    const availableHeight = Math.max(72, openAbove ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(heightLimit, availableHeight);
    const actualHeight = Math.min(popup.scrollHeight, maxHeight);
    const desiredWidth = panel === 'material' ? MATERIAL_PICKER_WIDTH : trigger.width;
    const width = Math.min(desiredWidth, window.innerWidth - PICKER_VIEWPORT_MARGIN * 2);
    const left = Math.min(
      Math.max(PICKER_VIEWPORT_MARGIN, panel === 'material' ? trigger.right - width : trigger.left),
      window.innerWidth - width - PICKER_VIEWPORT_MARGIN,
    );
    const top = openAbove
      ? Math.max(PICKER_VIEWPORT_MARGIN, trigger.top - PICKER_GAP - actualHeight)
      : Math.min(trigger.bottom + PICKER_GAP, window.innerHeight - actualHeight - PICKER_VIEWPORT_MARGIN);
    setPosition({ left, top, width, maxHeight });
  }, [materialResult?.icons.length, open, options.length, panel]);

  const loadMoreMaterial = async (): Promise<void> => {
    if (!materialResult?.hasMore || materialLoading) return;
    setMaterialLoading(true);
    setMaterialError('');
    try {
      const next = await searchMaterialSymbols(query, 80, materialResult.icons.length);
      setMaterialResult({ ...next, offset: 0, icons: [...materialResult.icons, ...next.icons] });
    } catch (reason) {
      setMaterialError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setMaterialLoading(false);
    }
  };

  const chooseMaterial = async (name: string): Promise<void> => {
    setMaterialBusy(name);
    setMaterialError('');
    try {
      const codeName = await importMaterialSymbol({
        name,
        sizePx: materialSize,
        sourcePage: materialResult?.sourcePage,
      });
      onChange(codeName);
      useEditorStore.getState().setBanner(
        `已将当前图片控件替换为 Material 图标 ${name}；设备使用 A8，网页导出和发布使用 SVG`,
      );
      setOpen(false);
    } catch (reason) {
      setMaterialError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setMaterialBusy('');
    }
  };

  return (
    <div className="asset-picker" ref={rootRef} data-asset-picker={accept}>
      <button
        aria-label={props.ariaLabel}
        className="asset-picker-btn"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={openPicker}
        title={value ?? '选择素材'}
      >
        <Thumb asset={current} />
        <span className="asset-picker-label">
          {value ?? (options.length ? '(选择素材)' : '(先上传素材)')}
        </span>
        <span className="asset-picker-caret">▾</span>
      </button>
      {open && createPortal(
        <div
          ref={popupRef}
          className={`asset-picker-pop ${panel === 'material' ? 'asset-picker-material-pop' : ''}`}
          role={panel === 'material' ? 'dialog' : 'listbox'}
          aria-label={panel === 'material' ? '统一图标选择器' : accept === 'lottie' ? '选择 Lottie 素材' : '选择图片素材'}
          style={position}
        >
          {panel === 'material' ? (
            <>
              <div className="asset-picker-material-head">
                <div>
                  <strong>统一图标选择器</strong>
                  <span>应用到当前图片 · 设备 A8 + 网页 SVG</span>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => setPanel('assets')}>返回素材</button>
              </div>
              <input className="ed-text lvgl-symbol-search" aria-label="搜索 Material 图标"
                value={query} placeholder="搜索英文名称：home、settings、wifi…" autoFocus
                onChange={(event) => setQuery(event.target.value)} />
              <div className="lvgl-material-toolbar">
                <span className="lvgl-material-warning">选择后直接修改当前图片，不会新建组件</span>
                <label>尺寸 <input className="ed-num" type="number" min={8} max={300} value={materialSize}
                  onChange={(event) => setMaterialSize(Math.max(8, Math.min(300, Number(event.target.value) || 8)))} /> px</label>
              </div>
              {materialError && <div className="lvgl-material-error">{materialError}</div>}
              <div className="lvgl-material-grid" role="listbox" aria-label="Material Symbols 图片图标">
                {materialResult?.icons.map((name) => (
                  <button key={name} type="button" role="option" aria-selected={false}
                    disabled={materialBusy !== ''} title={`替换为 ${name}`}
                    onClick={() => void chooseMaterial(name)}>
                    <img src={materialSymbolSvgUrl(name)} alt="" loading="lazy" />
                    <span>{materialBusy === name ? '应用中…' : name}</span>
                    <small>替换当前图片</small>
                  </button>
                ))}
                {materialResult && materialResult.icons.length === 0 && <div className="lvgl-symbol-empty">没有匹配的图标</div>}
                {materialResult?.hasMore && (
                  <button type="button" className="lvgl-material-more" disabled={materialLoading || materialBusy !== ''}
                    onClick={() => void loadMoreMaterial()}>
                    {materialLoading ? '加载中…' : `加载更多（剩余 ${materialResult.total - materialResult.icons.length} 个）`}
                  </button>
                )}
                {!materialResult && !materialError && <div className="lvgl-symbol-empty">正在读取 Material Symbols…</div>}
              </div>
            </>
          ) : (
            <>
              {accept === 'image' && (
                <button type="button" className="asset-picker-material-entry" onClick={() => {
                  setQuery('');
                  setMaterialResult(null);
                  setMaterialError('');
                  setPanel('material');
                }}>打开统一图标选择器…</button>
              )}
              <button
                type="button"
                role="option"
                aria-selected={value === undefined}
                className="asset-picker-item"
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                }}
              >
                <Thumb asset={null} />
                <span>(不设置)</span>
              </button>
              {options.map((a) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={a.name === value}
                  key={a.name}
                  className={`asset-picker-item ${a.name === value ? 'sel' : ''}`}
                  data-asset-option={a.name}
                  onClick={() => {
                    onChange(a.name);
                    setOpen(false);
                  }}
                >
                  <Thumb asset={a} />
                  <span>{a.name}</span>
                </button>
              ))}
              {options.length === 0 && (
                <div className="asset-picker-empty">无{accept === 'lottie' ? ' lottie' : '图片'}素材,请到「素材」面板上传</div>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** 帧序列多选(animimage srcs:勾选即按点选顺序追加) */
export function AssetMultiPicker(props: {
  value: string[] | undefined;
  onChange: (v: string[] | undefined) => void;
}): JSX.Element {
  const { value, onChange } = props;
  const images = useProjectStore((s) => s.project.assets.images);
  const options = images.filter((a) => (a.kind ?? 'image') === 'image');
  const cur = value ?? [];

  const toggle = (name: string): void => {
    const next = cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name];
    onChange(next.length ? next : undefined);
  };

  return (
    <div className="asset-multi">
      {options.length === 0 && <div className="asset-picker-empty">先到「素材」面板上传图片</div>}
      {options.map((a) => (
        <label key={a.name} className={`asset-multi-item ${cur.includes(a.name) ? 'sel' : ''}`}>
          <input type="checkbox" checked={cur.includes(a.name)} onChange={() => toggle(a.name)} />
          <Thumb asset={a} />
          <span>{a.name}</span>
          {cur.includes(a.name) && <span className="asset-multi-ord">#{cur.indexOf(a.name) + 1}</span>}
        </label>
      ))}
      {cur.length > 0 && <div className="asset-multi-seq">序列:{cur.join(' → ')}</div>}
    </div>
  );
}
