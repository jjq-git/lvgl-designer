/**
 * AssetPanel — 素材管理(左栏 tab):上传 png/jpg/lottie json →
 * IndexedDB 内容寻址 + runtime 注册 + 工程 assets 数组;列表带缩略图/删除。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FontAsset, ImageAsset } from '@lvd/schema';
import type { AssetEntry } from '@lvd/schema/v2';
import { useProjectStore } from '../stores/projectStore';
import { importAssetFiles, removeAsset, thumbUrlFor, thumbUrlForEntry } from '../services/assets';
import { addPaletteWidgetAtCenter } from '../canvas/PointerDnd';
import { useEditorStore } from '../stores/editorStore';
import { fontFamilyOptions } from '../services/fontFamilies';

export function useThumb(asset: ImageAsset | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const sha = asset?.file.sha256;
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!asset) return;
    void thumbUrlFor(asset).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sha]);
  return url;
}

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function patchFontFamily(sha256: string, patch: Partial<NonNullable<FontAsset['conv']>>): void {
  useProjectStore.getState().mutateV2('修改字体家族', (draft) => {
    for (const font of draft.assets.fonts) {
      if (font.file.sha256 !== sha256) continue;
      font.conv ??= { loader: 'tiny_ttf', sizePx: 16, bpp: 4, ranges: '0x20-0x7e', autoCollect: true, license: 'UNSPECIFIED' };
      Object.assign(font.conv, patch);
    }
  });
}

function removeFontFamily(sha256: string): void {
  useProjectStore.getState().mutateV2('删除字体家族', (draft) => {
    draft.assets.fonts = draft.assets.fonts.filter((asset) => asset.file.sha256 !== sha256);
  });
}

function FontOptions({ asset, sizes }: { asset: FontAsset; sizes: readonly number[] }): JSX.Element {
  const conv = asset.conv ?? { bpp: 4 as const, ranges: '0x20-0x7e' };
  return (
    <div className="asset-font-config">
      <div className="asset-font-sizes">已生成字号：{sizes.map((size) => `${size}px`).join('、')}</div>
      <label>BPP
        <select value={conv.bpp}
          onChange={(event) => patchFontFamily(asset.file.sha256, { bpp: Number(event.target.value) as 1 | 2 | 4 | 8 })}>
          {[1, 2, 4, 8].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label className="asset-font-wide">范围
        <input value={conv.ranges}
          onChange={(event) => patchFontFamily(asset.file.sha256, { ranges: event.target.value })}
          placeholder="0x20-0x7e,U+4E00-U+4E5F" />
      </label>
      <label className="asset-font-wide">附加字符
        <input value={conv.symbols ?? ''}
          onChange={(event) => patchFontFamily(asset.file.sha256, { symbols: event.target.value })} />
      </label>
      <label className="asset-font-wide">许可证
        <input value={conv.license ?? ''}
          onChange={(event) => patchFontFamily(asset.file.sha256, { license: event.target.value })}
          placeholder="例如 OFL-1.1；必填" />
      </label>
      <label className="asset-font-check">
        <input type="checkbox" checked={conv.autoCollect !== false}
          onChange={(event) => patchFontFamily(asset.file.sha256, { autoCollect: event.target.checked })} />
        自动收集工程文本
      </label>
    </div>
  );
}

function AssetRow({
  asset,
  type,
  onUse,
  displayName,
  fontSizes,
}: {
  asset: ImageAsset | FontAsset;
  type: 'image' | 'font';
  onUse?(): void;
  displayName?: string;
  fontSizes?: readonly number[];
}): JSX.Element {
  const image = type === 'image' ? asset as ImageAsset : null;
  const font = type === 'font' ? asset as FontAsset : null;
  const thumb = useThumb(image);
  const isLottie = image !== null && (image.kind ?? 'image') === 'lottie';
  return (
    <div className="asset-row" data-asset={asset.name} title={`${asset.file.fileName}(${asset.file.sha256.slice(0, 8)})`}>
      <span className="asset-thumb">
        {type === 'font' ? <span className="asset-thumb-icon">Aa</span>
          : isLottie ? <span className="asset-thumb-icon">🎞</span>
            : thumb ? <img src={thumb} alt={asset.name} /> : <span className="asset-thumb-icon">…</span>}
      </span>
      <span className="asset-meta">
        <span className="asset-name">{displayName ?? asset.name}</span>
        <span className="asset-sub">{type === 'font' ? 'font' : isLottie ? 'lottie' : 'image'} · {fmtSize(asset.file.byteSize)}</span>
        {font ? <FontOptions asset={font} sizes={fontSizes ?? [font.sizePx ?? 16]} /> : null}
      </span>
      <span className="asset-row-actions">
        {onUse && !isLottie ? <button className="btn asset-use-btn" title="添加为图片控件；图片控件暂不支持网页发布" onClick={onUse}>使用</button> : null}
        <button className="icon-btn" title="从工程移除" onClick={() => (
          type === 'font' ? removeFontFamily(asset.file.sha256) : removeAsset(asset.name)
        )}>✕</button>
      </span>
    </div>
  );
}

function IconAssetRow({
  source,
  derivative,
  onUse,
}: {
  source: AssetEntry;
  derivative: ImageAsset | null;
  onUse?(): void;
}): JSX.Element {
  const name = source.displayName ?? source.codeName ?? source.id;
  const derivativeThumb = useThumb(derivative);
  const [sourceThumb, setSourceThumb] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void thumbUrlForEntry(source.file).then((url) => {
      if (alive) setSourceThumb(url);
    });
    return () => { alive = false; };
  }, [source.file.sha256]);
  const thumb = derivativeThumb ?? sourceThumb;
  const totalBytes = source.file.byteSize + (derivative?.file.byteSize ?? 0);
  return (
    <div className="asset-row" data-asset={source.id} title={`${source.file.fileName}（SVG 源文件随工程留档）`}>
      <span className="asset-thumb">{thumb
        ? <img src={thumb} alt={name} />
        : <span className="asset-thumb-icon">◆</span>}</span>
      <span className="asset-meta">
        <span className="asset-name">{name}</span>
        <span className="asset-sub">Material 图标 · 设备 A8 + 网页 SVG · {fmtSize(totalBytes)}</span>
      </span>
      <span className="asset-row-actions">
        {onUse ? <button className="btn asset-use-btn" title="添加为图片控件；支持设备/C、网页导出和 ui.podsc.com 发布" onClick={onUse}>使用</button> : null}
        <button className="icon-btn" title="同时移除 SVG 源文件和派生图片" onClick={() => removeAsset(source.id)}>✕</button>
      </span>
    </div>
  );
}

export function AssetPanel(): JSX.Element {
  const images = useProjectStore((s) => s.project.assets.images);
  const fonts = useProjectStore((s) => s.project.assets.fonts);
  const uiFonts = useProjectStore((s) => s.uiProject.assets.fonts);
  const icons = useProjectStore((s) => s.uiProject.assets.icons);
  const uiImages = useProjectStore((s) => s.uiProject.assets.images);
  const derivativesBySource = useMemo(() => new Map(uiImages.flatMap((asset) => {
    const sourceId = asset.conv?.sourceIconId;
    if (typeof sourceId !== 'string' || !asset.codeName) return [];
    return [[sourceId, images.find((image) => image.name === asset.codeName) ?? null] as const];
  })), [images, uiImages]);
  const iconDerivativeNames = useMemo(() => new Set([...derivativesBySource.values()]
    .filter((asset): asset is ImageAsset => asset !== null)
    .map((asset) => asset.name)), [derivativesBySource]);
  const regularImages = useMemo(
    () => images.filter((image) => !iconDerivativeNames.has(image.name)),
    [iconDerivativeNames, images],
  );
  const fontFamilies = useMemo(
    () => fontFamilyOptions(uiFonts).filter((family) => family.sourceCodeName !== null),
    [uiFonts],
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFiles = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      await importAssetFiles(files);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const useImage = (name: string, materialIcon = false): void => {
    if (!addPaletteWidgetAtCenter('image', { src: name })) {
      useEditorStore.getState().setBanner('请切换到设计模式后再使用图片素材');
      return;
    }
    useEditorStore.getState().setBanner(materialIcon
      ? `已将 Material 图标 ${name} 添加到当前画布；支持设备/C、网页导出和 ui.podsc.com 发布`
      : `已将图片素材 ${name} 添加到当前画布；普通图片控件仅适用于设备/C，不能网页导出或发布`);
  };

  return (
    <div className="asset-panel">
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.json,.ttf"
        multiple
        style={{ display: 'none' }}
        data-testid="asset-upload"
        onChange={(e) => void onFiles(e.target.files)}
      />
      <button className="btn asset-upload-btn" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? '导入中…' : '+ 上传素材(png/jpg/lottie/ttf)'}
      </button>
      {images.length === 0 && fonts.length === 0 && icons.length === 0 ? (
        <div className="asset-empty">尚无素材。支持图片、Lottie JSON 和 TTF 字体。</div>
      ) : (
        <>
          {fontFamilies.map((family) => {
            const asset = fonts.find((font) => font.name === family.sourceCodeName)
              ?? fonts.find((font) => font.file.sha256 === family.sourceSha256);
            return asset ? (
              <AssetRow
                key={family.id}
                asset={asset}
                type="font"
                displayName={family.label}
                fontSizes={family.sizes}
              />
            ) : null;
          })}
          {regularImages.map((a) => (
            <AssetRow
              key={`image:${a.name}`}
              asset={a}
              type="image"
              onUse={() => useImage(a.name)}
            />
          ))}
          {icons.map((source) => {
            const derivative = derivativesBySource.get(source.id) ?? null;
            return (
              <IconAssetRow
                key={source.id}
                source={source}
                derivative={derivative}
                onUse={derivative ? () => useImage(derivative.name, true) : undefined}
              />
            );
          })}
        </>
      )}
    </div>
  );
}
