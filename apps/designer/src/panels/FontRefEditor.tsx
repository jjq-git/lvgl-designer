import { useEffect, useMemo, useState } from 'react';
import type { PropValueV2 } from '@lvd/schema/v2';
import { ensureFontInstance } from '../services/assets';
import {
  BUILTIN_FONT_FAMILY_ID,
  BUILTIN_FONT_SIZES,
  builtInFontRef,
  fontFamilyOptions,
  resolveFontSelection,
} from '../services/fontFamilies';
import { useEditorStore } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';

const COMMON_FONT_SIZES = [10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64];

export function FontRefEditor(props: {
  value: PropValueV2 | undefined;
  onChange(value: PropValueV2 | undefined): void;
}): JSX.Element {
  const { value, onChange } = props;
  const assets = useProjectStore((state) => state.uiProject.assets.fonts);
  const families = useMemo(() => fontFamilyOptions(assets), [assets]);
  const literalValue = typeof value === 'string' ? value : undefined;
  const selection = useMemo(
    () => resolveFontSelection(literalValue, assets),
    [assets, literalValue],
  );
  const [draftSize, setDraftSize] = useState(String(selection?.sizePx ?? 16));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraftSize(String(selection?.sizePx ?? 16));
  }, [selection?.familyId, selection?.sizePx]);

  const applySelection = async (familyId: string, requestedSize: number): Promise<void> => {
    if (!familyId) {
      onChange(undefined);
      return;
    }
    if (familyId === BUILTIN_FONT_FAMILY_ID) {
      onChange(builtInFontRef(requestedSize));
      return;
    }
    const family = families.find((item) => item.id === familyId);
    if (!family?.sourceCodeName) return;
    if (!family.resizable) {
      const instance = family.instances.reduce((nearest, candidate) => (
        Math.abs(candidate.sizePx - requestedSize) < Math.abs(nearest.sizePx - requestedSize)
          ? candidate
          : nearest
      ), family.instances[0]!);
      if (instance) onChange(instance.fontRef);
      return;
    }
    setBusy(true);
    try {
      const fontRef = await ensureFontInstance(family.sourceCodeName, requestedSize);
      onChange(fontRef);
    } catch (error) {
      useEditorStore.getState().setBanner(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const commitCustomSize = (): void => {
    const size = Number(draftSize);
    if (!Number.isFinite(size)) {
      setDraftSize(String(selection?.sizePx ?? 16));
      return;
    }
    const normalized = Math.max(4, Math.min(256, Math.round(size)));
    setDraftSize(String(normalized));
    if (selection && normalized !== selection.sizePx) {
      void applySelection(selection.familyId, normalized);
    }
  };

  const familyId = selection?.familyId ?? (literalValue ? `unknown:${literalValue}` : '');
  const isBuiltIn = familyId === BUILTIN_FONT_FAMILY_ID;
  const isCustom = familyId.startsWith('asset:');
  const currentFamily = families.find((family) => family.id === familyId);
  const isSet = Boolean(literalValue);

  return (
    <div className={`font-ref-editor ${isSet ? '' : 'unset'}`}>
      <div className="prop-row">
        <label>字体</label>
        <select
          aria-label="字体"
          className="ed-select"
          value={familyId}
          disabled={busy}
          onChange={(event) => {
            const nextFamily = event.target.value;
            void applySelection(nextFamily, selection?.sizePx ?? 16);
          }}
        >
          <option value="">(继承默认字体)</option>
          {literalValue && !selection ? <option value={`unknown:${literalValue}`}>失效引用：{literalValue}</option> : null}
          {families.map((family) => (
            <option key={family.id} value={family.id}>{family.label}</option>
          ))}
        </select>
        {isSet ? (
          <button className="icon-btn" title="清除字体设置" onClick={() => onChange(undefined)}>↶</button>
        ) : null}
      </div>
      {(isBuiltIn || isCustom) ? (
        <div className="prop-row">
          <label>字号</label>
          {isBuiltIn || currentFamily?.resizable === false ? (
            <select
              aria-label="字号"
              className="ed-select"
              value={selection?.sizePx ?? 16}
              onChange={(event) => void applySelection(familyId, Number(event.target.value))}
            >
              {(isBuiltIn ? BUILTIN_FONT_SIZES : currentFamily?.sizes ?? []).map((size) => (
                <option key={size} value={size}>{size} px</option>
              ))}
            </select>
          ) : (
            <div className="font-size-input">
              <input
                aria-label="字号"
                className="ed-num"
                type="number"
                min={4}
                max={256}
                step={1}
                list="lvd-common-font-sizes"
                value={draftSize}
                disabled={busy}
                onChange={(event) => setDraftSize(event.target.value)}
                onBlur={commitCustomSize}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
              <span>px</span>
              <datalist id="lvd-common-font-sizes">
                {COMMON_FONT_SIZES.map((size) => <option key={size} value={size} />)}
              </datalist>
            </div>
          )}
          {busy ? <span className="font-instance-status">生成中…</span> : null}
        </div>
      ) : null}
    </div>
  );
}
