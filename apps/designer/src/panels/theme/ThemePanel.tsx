import { useEffect, useMemo, useRef, useState } from 'react';
import {
  isProjectSnapshotV2,
  TOKEN_ID_RE,
  resolveTheme,
  type ThemeDef,
  type ThemeToken,
  type ThemeTokenType,
} from '@lvd/schema/v2';
import { findBuiltInProject } from '../../services/builtInProjects';
import { bindLegacyPaletteToTheme } from '../../services/themeBinding';
import { useBuildTargetStore } from '../../stores/buildTargetStore';
import { useProjectStore } from '../../stores/projectStore';
import './theme.css';

const TOKEN_TYPES: ThemeTokenType[] = [
  'color', 'px', 'percent', 'int', 'opa', 'fontRef', 'imageRef',
];

const TOKEN_TYPE_LABELS: Record<ThemeTokenType, string> = {
  color: '颜色',
  px: '像素',
  percent: '百分比',
  int: '整数',
  opa: '透明度',
  fontRef: '字体',
  imageRef: '图片',
};

const TOKEN_LABELS: Record<string, string> = {
  'border.default': '默认边框宽度',
  'border.none': '无边框',
  'color.accent': '主强调色',
  'color.accent.strong': '深强调色',
  'color.background': '页面背景色',
  'color.border': '边框颜色',
  'color.navigation': '导航背景色',
  'color.selection': '选中背景色',
  'color.shadow': '阴影颜色',
  'color.track': '轨道颜色',
  'color.track.strong': '强调轨道颜色',
  'color.data.blue': '数据蓝色',
  'color.data.cyan': '数据青色',
  'color.data.indigo': '数据靛蓝色',
  'color.data.orange': '数据橙色',
  'color.data.pink': '数据粉色',
  'color.data.purple': '数据紫色',
  'color.data.teal': '数据蓝绿色',
  'color.outline': '轮廓颜色',
  'color.state.edit': '编辑状态色',
  'color.status.danger': '危险状态色',
  'color.status.danger.surface': '危险状态背景色',
  'color.status.success': '成功状态色',
  'color.status.warning': '警告状态色',
  'color.surface': '面板背景色',
  'color.surface.subtle': '次级面板背景色',
  'color.text.muted': '次要文字色',
  'color.text.onaccent': '强调色上的文字',
  'color.text.primary': '主要文字色',
  'color.voltage.v3': '3.3V 标识色',
  'color.voltage.v5': '5V 标识色',
  'effect.shadow.none': '无阴影',
  'font.text.small': '小号文字字体',
  'font.text.body': '正文文字字体',
  'font.text.title': '标题文字字体',
  'font.value.large': '大号数值字体',
  'opacity.solid': '完全不透明',
  'radius.control': '控件圆角',
  'radius.dialog': '对话框圆角',
  'radius.none': '无圆角',
  'spacing.compact': '紧凑间距',
  'spacing.control': '控件间距',
  'spacing.none': '无间距',
  'spacing.page': '页面间距',
};

export function themeTokenLabel(tokenId: string): string {
  const fontSize = tokenId.match(/^font\.size\.(\d+)$/)?.[1];
  if (fontSize) return `${fontSize}px 字体`;
  const palette = tokenId.match(/^color\.palette\.([0-9a-f]{6})$/)?.[1];
  if (palette) return `调色板 #${palette.toUpperCase()}`;
  return TOKEN_LABELS[tokenId] ?? tokenId;
}

export function embeddedThemeId(themeRef: string): string | null {
  return themeRef.match(/#theme:(.+)$/)?.[1] ?? null;
}

export function parseThemeTokenValue(
  type: ThemeTokenType,
  raw: string,
): string | number | null {
  const value = raw.trim();
  if (type === 'color') return /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : null;
  if (type === 'fontRef' || type === 'imageRef') return value.length > 0 ? value : null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if ((type === 'int' || type === 'opa') && !Number.isInteger(number)) return null;
  if (type === 'opa' && (number < 0 || number > 255)) return null;
  if (type === 'percent' && (number < 0 || number > 100)) return null;
  return number;
}

export function replaceEmptyThemesWithPreset(
  currentThemes: readonly ThemeDef[],
  presetThemes: readonly ThemeDef[],
): ThemeDef[] | null {
  const hasToken = currentThemes.some(
    (theme) => (resolveTheme(currentThemes, theme.id)?.size ?? 0) > 0,
  );
  if (hasToken || presetThemes.length === 0) return null;
  return presetThemes.map((theme) => structuredClone(theme));
}

function tokenValueText(value: string | number): string {
  return typeof value === 'number' ? String(value) : value;
}

function TokenValueEditor({
  token,
  onCommit,
}: {
  token: ThemeToken;
  onCommit: (value: string | number) => boolean;
}): JSX.Element {
  const [draft, setDraft] = useState(() => tokenValueText(token.value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(tokenValueText(token.value));
    setInvalid(false);
  }, [token.id, token.type, token.value]);

  const commit = (): void => {
    const value = parseThemeTokenValue(token.type, draft);
    if (value === null || !onCommit(value)) {
      setInvalid(true);
      return;
    }
    setDraft(tokenValueText(value));
    setInvalid(false);
  };

  return (
    <div className={`theme-value-editor ${invalid ? 'invalid' : ''}`}>
      {token.type === 'color' && (
        <input
          className="theme-color-input"
          type="color"
          aria-label={`${token.id} 颜色`}
          value={/^#[0-9a-f]{6}$/i.test(draft) ? draft : '#000000'}
          onChange={(event) => {
            const value = event.target.value.toUpperCase();
            setDraft(value);
            setInvalid(!onCommit(value));
          }}
        />
      )}
      <input
        className="ed-input theme-token-input"
        aria-label={`${token.id} 值`}
        inputMode={['px', 'percent', 'int', 'opa'].includes(token.type) ? 'decimal' : 'text'}
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const parsed = parseThemeTokenValue(token.type, next);
          if (parsed !== null) setInvalid(!onCommit(parsed));
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(tokenValueText(token.value));
            setInvalid(false);
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

export function ThemePanel(): JSX.Element {
  const uiProject = useProjectStore((state) => state.uiProject);
  const themes = uiProject.themes;
  const themeRef = useBuildTargetStore((state) => state.buildTargetDraft.themeRef);
  const displaySize = useBuildTargetStore((state) => state.displayProfile.logicalSize);
  const activeThemeId = embeddedThemeId(themeRef) ?? themes[0]?.id ?? '';
  const [selectedThemeId, setSelectedThemeId] = useState(activeThemeId);
  const [query, setQuery] = useState('');
  const [newTokenId, setNewTokenId] = useState('');
  const [newTokenType, setNewTokenType] = useState<ThemeTokenType>('color');
  const [newThemeId, setNewThemeId] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [initializingPreset, setInitializingPreset] = useState(false);
  const legacyBindingAttempted = useRef(false);

  useEffect(() => {
    if (!message?.ok) return undefined;
    const timer = window.setTimeout(() => setMessage(null), 2400);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!themes.some((theme) => theme.id === selectedThemeId)) {
      setSelectedThemeId(activeThemeId || themes[0]?.id || '');
    }
  }, [activeThemeId, selectedThemeId, themes]);

  const selectedTheme = themes.find((theme) => theme.id === selectedThemeId) ?? themes[0];
  const resolved = useMemo(
    () => selectedTheme ? resolveTheme(themes, selectedTheme.id) : null,
    [selectedTheme, themes],
  );
  const parentTokens = useMemo(
    () => selectedTheme?.extends ? resolveTheme(themes, selectedTheme.extends) : null,
    [selectedTheme, themes],
  );
  const ownIds = useMemo(
    () => new Set(selectedTheme?.tokens.map((token) => token.id) ?? []),
    [selectedTheme],
  );
  const visibleTokens = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...(resolved?.values() ?? [])]
      .filter((token) => !needle
        || token.id.includes(needle)
        || token.type.toLowerCase().includes(needle)
        || tokenValueText(token.value).toLowerCase().includes(needle))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [query, resolved]);
  const projectHasTokens = useMemo(
    () => themes.some((theme) => (resolveTheme(themes, theme.id)?.size ?? 0) > 0),
    [themes],
  );
  const isWf3Size = displaySize.width === 284 && displaySize.height === 76;
  const isWf3Project = isWf3Size
    && (uiProject.meta.name.toLowerCase().includes('wf3')
      || uiProject.editor?.example === 'wf3-firmware-import');
  const mutateTheme = (
    label: string,
    recipe: Parameters<ReturnType<typeof useProjectStore.getState>['mutateV2']>[1],
    coalesceKey?: string,
  ): boolean => {
    try {
      useProjectStore.getState().mutateV2(label, (draft) => {
        recipe(draft);
        draft.meta.modifiedAt = new Date().toISOString();
      }, coalesceKey ? { coalesceKey } : undefined);
      setMessage(null);
      return true;
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };

  const updateToken = (token: ThemeToken, value: string | number): boolean => mutateTheme(
    `修改主题 ${selectedThemeId}`,
    (draft) => {
      const theme = draft.themes.find((item) => item.id === selectedThemeId);
      if (!theme) return;
      if (isWf3Project) {
        bindLegacyPaletteToTheme(draft, selectedThemeId);
      }
      const own = theme.tokens.find((item) => item.id === token.id);
      if (own) own.value = value;
      else theme.tokens.push({ ...token, value });
    },
    `theme-token:${selectedThemeId}:${token.id}`,
  );

  const restoreInherited = (tokenId: string): void => {
    mutateTheme(`恢复继承 ${tokenId}`, (draft) => {
      const theme = draft.themes.find((item) => item.id === selectedThemeId);
      if (theme) theme.tokens = theme.tokens.filter((token) => token.id !== tokenId);
    });
  };

  const addToken = (): void => {
    const id = newTokenId.trim();
    if (!TOKEN_ID_RE.test(id)) {
      setMessage({ ok: false, text: 'Token ID 必须是点分小写语义名称，例如 color.brand.primary' });
      return;
    }
    if (resolved?.has(id)) {
      setMessage({ ok: false, text: `Token "${id}" 已存在，可直接编辑或覆盖。` });
      return;
    }
    const initial: string | number = newTokenType === 'color' ? '#000000'
      : newTokenType === 'fontRef' ? 'montserrat_14'
        : newTokenType === 'imageRef' ? 'image:replace-me'
          : 0;
    if (mutateTheme(`新增主题 token ${id}`, (draft) => {
      draft.themes.find((theme) => theme.id === selectedThemeId)?.tokens.push({
        id, type: newTokenType, value: initial,
      });
    })) {
      setNewTokenId('');
      setMessage({ ok: true, text: `已添加 ${id}` });
    }
  };

  const createDerivedTheme = (): void => {
    const id = newThemeId.trim();
    if (!/^[a-z][a-z0-9-]*$/.test(id)) {
      setMessage({ ok: false, text: 'Theme ID 只能包含小写字母、数字和连字符。' });
      return;
    }
    if (themes.some((theme) => theme.id === id)) {
      setMessage({ ok: false, text: `Theme "${id}" 已存在。` });
      return;
    }
    if (mutateTheme(`新建主题 ${id}`, (draft) => {
      draft.themes.push({
        id,
        displayName: `${selectedTheme?.displayName ?? selectedThemeId} 派生主题`,
        ...(selectedTheme ? { extends: selectedTheme.id } : {}),
        tokens: [],
      });
    })) {
      setSelectedThemeId(id);
      setNewThemeId('');
      if (!useProjectStore.getState().selectTheme(id)) {
        setMessage({ ok: false, text: `已创建 ${id}，但未能应用。` });
        return;
      }
      setMessage({ ok: true, text: `已创建并应用 ${id}。` });
    }
  };

  const applyTheme = (themeId: string): void => {
    let bound = 0;
    if (isWf3Project) {
      const repaired = mutateTheme('补全主题颜色绑定', (draft) => {
        bound = bindLegacyPaletteToTheme(draft, themeId);
      });
      if (!repaired) return;
    }
    if (!useProjectStore.getState().selectTheme(themeId)) {
      setMessage({ ok: false, text: '主题继承链无效，无法应用。' });
      return;
    }
    setMessage(bound > 0
      ? { ok: true, text: `已应用主题，并绑定 ${bound} 处固定颜色` }
      : null);
  };

  const initializePreset = async (kind: 'industrial' | 'wf3'): Promise<void> => {
    setInitializingPreset(true);
    try {
      const bundled = await findBuiltInProject('builtin:wf3-firmware-284x76')?.load();
      if (!bundled || !isProjectSnapshotV2(bundled)) {
        throw new Error('内置主题预设不可用');
      }
      const wantedIds = kind === 'wf3'
        ? new Set(['industrial-base', 'wf3-light'])
        : new Set(['industrial-base']);
      const presetThemes = bundled.uiProject.themes.filter((theme) => wantedIds.has(theme.id));
      const replacement = replaceEmptyThemesWithPreset(themes, presetThemes);
      if (!replacement) throw new Error('当前工程已有主题内容，不会自动覆盖');

      const nextThemeId = kind === 'wf3' ? 'wf3-light' : 'industrial-base';
      if (!mutateTheme(`初始化 ${kind === 'wf3' ? 'WF3' : '通用工业'}主题`, (draft) => {
        for (const preset of replacement) {
          const existingIndex = draft.themes.findIndex((theme) => theme.id === preset.id);
          if (existingIndex >= 0) draft.themes[existingIndex] = preset;
          else draft.themes.push(preset);
        }
      })) return;
      setSelectedThemeId(nextThemeId);
      if (!useProjectStore.getState().selectTheme(nextThemeId)) {
        throw new Error('主题已经写入，但未能设为当前主题');
      }
      mutateTheme('绑定现有界面颜色', (draft) => {
        if (isWf3Project) bindLegacyPaletteToTheme(draft, nextThemeId);
      });
      const previousIds = new Set(themes.map((theme) => theme.id));
      mutateTheme('清理旧空主题', (draft) => {
        draft.themes = draft.themes.filter(
          (theme) => !previousIds.has(theme.id) || wantedIds.has(theme.id),
        );
      });
      setMessage({
        ok: true,
        text: `已初始化并应用${kind === 'wf3' ? ' WF3 浅绿主题' : '通用工业主题'}。现在可点击颜色方块修改。`,
      });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setInitializingPreset(false);
    }
  };

  useEffect(() => {
    if (
      legacyBindingAttempted.current
      || !isWf3Project
      || !projectHasTokens
    ) return;
    legacyBindingAttempted.current = true;
    let bound = 0;
    try {
      const targetThemeId = resolveTheme(themes, activeThemeId)?.size
        ? activeThemeId
        : themes.find((theme) => theme.id === 'wf3-light')?.id
          ?? themes.find((theme) => theme.id === 'industrial-base')?.id
          ?? themes.find((theme) => (resolveTheme(themes, theme.id)?.size ?? 0) > 0)?.id;
      if (!targetThemeId) {
        setMessage({ ok: false, text: '当前工程没有可用的完整主题，请先初始化 WF3 主题' });
        return;
      }
      if (targetThemeId !== activeThemeId) {
        if (!useProjectStore.getState().selectTheme(targetThemeId)) {
          throw new Error(`无法切换到主题 ${targetThemeId}`);
        }
        setSelectedThemeId(targetThemeId);
      }
      useProjectStore.getState().mutateV2('绑定旧版 WF3 主题颜色', (draft) => {
        bound = bindLegacyPaletteToTheme(draft, targetThemeId);
        if (bound > 0) draft.meta.modifiedAt = new Date().toISOString();
      });
      if (bound > 0) {
        setMessage({ ok: true, text: `已将 ${bound} 处旧颜色绑定到当前主题` });
      }
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
    }
  }, [activeThemeId, isWf3Project, projectHasTokens, themes]);

  return (
    <section className="theme-side-panel" aria-label="主题配置">
      <div className="theme-side-current">
        <label htmlFor="theme-side-select">当前主题</label>
        <select
          id="theme-side-select"
          className="ed-select theme-side-select"
          value={selectedThemeId}
          onChange={(event) => {
            const themeId = event.target.value;
            setSelectedThemeId(themeId);
            applyTheme(themeId);
          }}
        >
          {themes.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.displayName ?? theme.id}{theme.id === activeThemeId ? '（使用中）' : ''}
            </option>
          ))}
        </select>
        {selectedTheme?.extends && (
          <div className="theme-side-summary">
            <span>基于</span>
            <code>{selectedTheme.extends}</code>
          </div>
        )}
      </div>

      {message && <div className={`theme-message ${message.ok ? 'ok' : 'fail'}`}>{message.text}</div>}

      {!projectHasTokens ? (
        <div className="theme-empty theme-empty-setup">
          <strong>当前工程还没有主题</strong>
          <p>先初始化预设，之后直接修改颜色。</p>
          {isWf3Size && (
            <button
              className="btn primary"
              disabled={initializingPreset}
              onClick={() => void initializePreset('wf3')}
            >
              {initializingPreset ? '正在初始化…' : '初始化 WF3 主题'}
            </button>
          )}
          <button
            className="btn"
            disabled={initializingPreset}
            onClick={() => void initializePreset('industrial')}
          >
            初始化通用工业主题
          </button>
        </div>
      ) : (
        <>
          <div className="theme-side-search-row">
            <input
              className="ed-input theme-search"
              aria-label="搜索主题项目"
              placeholder="搜索颜色或名称…"
              value={query}
              onChange={(event) => setQuery(event.target.value.toLowerCase())}
            />
            <span>{visibleTokens.length}</span>
          </div>

          <div className="theme-side-token-list">
            {visibleTokens.map((token) => {
              const own = ownIds.has(token.id);
              const canRestore = own && parentTokens?.has(token.id);
              return (
                <div
                  className="theme-side-token"
                  key={token.id}
                  title={`${token.id} · ${own ? '当前主题值' : '继承值'}`}
                >
                  <div className="theme-side-token-info">
                    <strong>{themeTokenLabel(token.id)}</strong>
                    <small>{TOKEN_TYPE_LABELS[token.type]}{own ? '' : ' · 继承'}</small>
                  </div>
                  <div className="theme-side-token-control">
                    <TokenValueEditor token={token} onCommit={(value) => updateToken(token, value)} />
                    {canRestore && (
                      <button
                        className="theme-side-restore"
                        title="删除当前覆盖，恢复继承值"
                        aria-label={`恢复 ${themeTokenLabel(token.id)} 的继承值`}
                        onClick={() => restoreInherited(token.id)}
                      >
                        ↶
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {visibleTokens.length === 0 && <div className="theme-empty">没有匹配的主题项目</div>}
          </div>

          <details className="theme-side-details">
            <summary>新建派生主题</summary>
            <div className="theme-side-form">
              <input
                className="ed-input"
                aria-label="新主题 ID"
                placeholder="例如 customer-dark"
                value={newThemeId}
                onChange={(event) => setNewThemeId(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') createDerivedTheme(); }}
              />
              <button className="btn" disabled={!newThemeId.trim()} onClick={createDerivedTheme}>
                创建并应用
              </button>
            </div>
          </details>

          <details className="theme-side-details">
            <summary>添加自定义 Token</summary>
            <div className="theme-side-form">
              <input
                className="ed-input"
                aria-label="新 Token ID"
                placeholder="color.brand.primary"
                value={newTokenId}
                onChange={(event) => setNewTokenId(event.target.value.toLowerCase())}
                onKeyDown={(event) => { if (event.key === 'Enter') addToken(); }}
              />
              <select
                className="ed-select"
                aria-label="新 Token 类型"
                value={newTokenType}
                onChange={(event) => setNewTokenType(event.target.value as ThemeTokenType)}
              >
                {TOKEN_TYPES.map((type) => (
                  <option key={type} value={type}>{TOKEN_TYPE_LABELS[type]}（{type}）</option>
                ))}
              </select>
              <button className="btn" disabled={!newTokenId.trim()} onClick={addToken}>添加</button>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
