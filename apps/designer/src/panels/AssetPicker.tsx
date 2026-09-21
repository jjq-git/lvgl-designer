/**
 * AssetPicker — imageRef 属性的素材选择器(含缩略图下拉);
 * AssetMultiPicker — animimage 帧序列多选。
 */
import { useEffect, useRef, useState } from 'react';
import type { ImageAsset } from '@lvd/schema';
import { useProjectStore } from '../stores/projectStore';
import { useThumb } from './AssetPanel';

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
  value: string | undefined;
  accept: 'image' | 'lottie';
  onChange: (v: string | undefined) => void;
}): JSX.Element {
  const { value, accept, onChange } = props;
  const images = useProjectStore((s) => s.project.assets.images);
  const options = images.filter((a) => (a.kind ?? 'image') === accept);
  const current = images.find((a) => a.name === value) ?? null;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div className="asset-picker" ref={rootRef} data-asset-picker={accept}>
      <button className="asset-picker-btn" onClick={() => setOpen(!open)} title={value ?? '选择素材'}>
        <Thumb asset={current} />
        <span className="asset-picker-label">
          {value ?? (options.length ? '(选择素材)' : '(先上传素材)')}
        </span>
        <span className="asset-picker-caret">▾</span>
      </button>
      {open && (
        <div className="asset-picker-pop">
          <div
            className="asset-picker-item"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
          >
            <Thumb asset={null} />
            <span>(不设置)</span>
          </div>
          {options.map((a) => (
            <div
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
            </div>
          ))}
          {options.length === 0 && (
            <div className="asset-picker-empty">无{accept === 'lottie' ? ' lottie' : '图片'}素材,请到「素材」面板上传</div>
          )}
        </div>
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
