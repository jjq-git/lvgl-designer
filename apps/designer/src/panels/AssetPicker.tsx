/**
 * AssetPicker — imageRef 属性的素材选择器(含缩略图下拉);
 * AssetMultiPicker — animimage 帧序列多选。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ImageAsset } from '@lvd/schema';
import { useProjectStore } from '../stores/projectStore';
import { useThumb } from './AssetPanel';

const PICKER_VIEWPORT_MARGIN = 8;
const PICKER_GAP = 4;
const PICKER_MAX_HEIGHT = 220;

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
  const [position, setPosition] = useState<PickerPosition>({ left: 0, top: 0, width: 0, maxHeight: PICKER_MAX_HEIGHT });
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const openPicker = (): void => {
    if (open) {
      setOpen(false);
      return;
    }
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

  useLayoutEffect(() => {
    if (!open || !rootRef.current || !popupRef.current) return;
    const trigger = rootRef.current.getBoundingClientRect();
    const popup = popupRef.current;
    const spaceBelow = window.innerHeight - trigger.bottom - PICKER_GAP - PICKER_VIEWPORT_MARGIN;
    const spaceAbove = trigger.top - PICKER_GAP - PICKER_VIEWPORT_MARGIN;
    const naturalHeight = Math.min(popup.scrollHeight, PICKER_MAX_HEIGHT);
    const openAbove = naturalHeight > spaceBelow && spaceAbove > spaceBelow;
    const availableHeight = Math.max(72, openAbove ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(PICKER_MAX_HEIGHT, availableHeight);
    const actualHeight = Math.min(popup.scrollHeight, maxHeight);
    const width = Math.min(trigger.width, window.innerWidth - PICKER_VIEWPORT_MARGIN * 2);
    const left = Math.min(
      Math.max(PICKER_VIEWPORT_MARGIN, trigger.left),
      window.innerWidth - width - PICKER_VIEWPORT_MARGIN,
    );
    const top = openAbove
      ? Math.max(PICKER_VIEWPORT_MARGIN, trigger.top - PICKER_GAP - actualHeight)
      : Math.min(trigger.bottom + PICKER_GAP, window.innerHeight - actualHeight - PICKER_VIEWPORT_MARGIN);
    setPosition({ left, top, width, maxHeight });
  }, [open, options.length]);

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
          className="asset-picker-pop"
          role="listbox"
          aria-label={accept === 'lottie' ? '选择 Lottie 素材' : '选择图片素材'}
          style={position}
        >
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
