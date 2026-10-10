import {
  isTokenRef,
  resolveTheme,
  type LocalStyleGroup,
  type NamedStyleV2,
  type PropValueV2,
  type ThemeToken,
  type UiProject,
  type WidgetNodeV2,
} from '@lvd/schema/v2';

const LEGACY_COLOR_TOKENS: Readonly<Record<string, string>> = {
  '#0B8583': 'color.accent',
  '#050505': 'color.text.primary',
  '#4B5563': 'color.text.muted',
  '#E5E7EB': 'color.border',
  '#F3F7F7': 'color.surface.subtle',
  '#D97706': 'color.status.warning',
  '#FF3540': 'color.status.danger',
  '#DB2777': 'color.data.pink',
  '#FFD166': 'color.state.edit',
  '#C65A5A': 'color.voltage.v3',
  '#A83E3E': 'color.voltage.v5',

  // WF3 light palette. Some saved projects contain a mixture of token refs
  // and these literal colors because an older migration stopped too early.
  '#F4F7F3': 'color.background',
  '#EDF3ED': 'color.surface.subtle',
  '#D5E0D5': 'color.border',
  '#739878': 'color.outline',
  '#26332A': 'color.text.primary',
  '#5F7165': 'color.text.muted',
  '#17321D': 'color.text.onaccent',
  '#A8E6A3': 'color.accent',
  '#3D7D43': 'color.accent.strong',
  '#9A6100': 'color.status.warning',
  '#C52A3A': 'color.status.danger',
  '#FBE5E7': 'color.status.danger.surface',
  '#087C98': 'color.data.cyan',
  '#6D28D9': 'color.data.purple',
  '#4338CA': 'color.data.indigo',
  '#B45309': 'color.data.orange',
  '#BE185D': 'color.data.pink',

  // Industrial base palette. This repairs remaining literals in projects
  // that were saved while the base theme was active as well.
  '#F5F7F7': 'color.background',
  '#EEF2F2': 'color.surface.subtle',
  '#D8E2E2': 'color.border',
  '#1F2937': 'color.text.primary',
  '#115E59': 'color.accent.strong',
  '#C2414B': 'color.status.danger',
  '#FDECEC': 'color.status.danger.surface',
  '#15803D': 'color.status.success',
  '#FACC15': 'color.state.edit',
  '#0891B2': 'color.data.cyan',
  '#7C3AED': 'color.data.purple',
  '#4F46E5': 'color.data.indigo',
  '#C2410C': 'color.data.orange',
};

const LEGACY_FONT_TOKENS: Readonly<Record<string, string>> = {
  montserrat_8: 'font.text.small',
  montserrat_10: 'font.text.small',
  montserrat_12: 'font.text.small',
  montserrat_14: 'font.text.body',
  montserrat_16: 'font.text.title',
  montserrat_18: 'font.value.large',
  montserrat_20: 'font.value.large',
  wf3_cn_12: 'font.text.small',
  wf3_cn_14: 'font.text.body',
  wf3_cn_16: 'font.text.title',
  wf3_cn_20: 'font.value.large',
};

function semanticToken(prop: string, value: PropValueV2, isScreenRoot: boolean): string | null {
  if (prop === 'text_font' && typeof value === 'string') {
    return LEGACY_FONT_TOKENS[value] ?? null;
  }
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return null;
  const normalized = value.toUpperCase();
  if (normalized === '#FFFFFF') {
    if (prop === 'text_color') return 'color.text.onaccent';
    if (isScreenRoot && prop === 'bg_color') return 'color.background';
    return 'color.surface';
  }
  if (normalized === '#64748B') {
    return prop === 'text_color' ? 'color.text.muted' : 'color.outline';
  }
  if (normalized === '#0F766E') return 'color.accent';
  return LEGACY_COLOR_TOKENS[normalized] ?? null;
}

function bindProps(
  props: Record<string, PropValueV2>,
  availableTokens: ReadonlySet<string>,
  isScreenRoot: boolean,
): number {
  let count = 0;
  for (const [prop, value] of Object.entries(props)) {
    const tokenId = semanticToken(prop, value, isScreenRoot);
    if (!tokenId || !availableTokens.has(tokenId)) continue;
    props[prop] = { $token: tokenId };
    count += 1;
  }
  return count;
}

function bindNamedStyles(
  styles: NamedStyleV2[],
  availableTokens: ReadonlySet<string>,
): number {
  return styles.reduce(
    (count, style) => count + bindProps(style.props, availableTokens, false),
    0,
  );
}

function bindLocalStyles(
  styles: LocalStyleGroup[],
  availableTokens: ReadonlySet<string>,
  isScreenRoot: boolean,
): number {
  return styles.reduce(
    (count, style) => count + bindProps(style.props, availableTokens, isScreenRoot),
    0,
  );
}

function bindNode(
  node: WidgetNodeV2,
  availableTokens: ReadonlySet<string>,
  isScreenRoot: boolean,
): number {
  return bindLocalStyles(node.styles, availableTokens, isScreenRoot)
    + node.children.reduce((count, child) => count + bindNode(child, availableTokens, false), 0);
}

/** Convert hard-coded colors and text fonts in early WF3 drafts into semantic Theme references. */
export function bindLegacyPaletteToTheme(project: UiProject, themeId: string): number {
  const resolved = resolveTheme(project.themes, themeId);
  if (!resolved) return 0;
  const availableTokens = new Set(resolved.keys());
  let count = bindNamedStyles(project.styles, availableTokens);
  for (const screen of project.screens) {
    count += bindNamedStyles(screen.styles, availableTokens);
    count += bindNode(screen.root, availableTokens, true);
  }
  for (const component of project.components) {
    count += bindNamedStyles(component.styles, availableTokens);
    count += bindNode(component.root, availableTokens, false);
  }
  return count;
}

function countProps(props: Record<string, PropValueV2>): number {
  return Object.values(props).filter(isTokenRef).length;
}

function countNamedStyles(styles: readonly NamedStyleV2[]): number {
  return styles.reduce((count, style) => count + countProps(style.props), 0);
}

function countNode(node: WidgetNodeV2): number {
  return node.styles.reduce((count, style) => count + countProps(style.props), 0)
    + node.children.reduce((count, child) => count + countNode(child), 0);
}

export function countThemeStyleRefs(project: UiProject): number {
  let count = countNamedStyles(project.styles);
  for (const screen of project.screens) {
    count += countNamedStyles(screen.styles) + countNode(screen.root);
  }
  for (const component of project.components) {
    count += countNamedStyles(component.styles) + countNode(component.root);
  }
  return count;
}

function visitAllStyleProps(
  project: UiProject,
  visit: (props: Record<string, PropValueV2>, isScreenRoot: boolean) => void,
): void {
  for (const style of project.styles) visit(style.props, false);
  const visitNode = (node: WidgetNodeV2, isScreenRoot: boolean): void => {
    for (const style of node.styles) visit(style.props, isScreenRoot);
    for (const child of node.children) visitNode(child, false);
  };
  for (const screen of project.screens) {
    for (const style of screen.styles) visit(style.props, false);
    visitNode(screen.root, true);
  }
  for (const component of project.components) {
    for (const style of component.styles) visit(style.props, false);
    visitNode(component.root, false);
  }
}

function generatedFontTokenId(fontRef: string): string {
  const size = /^montserrat_(\d+)$/.exec(fontRef)?.[1];
  if (size) return `font.size.${size}`;
  const slug = fontRef.toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return `font.asset.${slug || 'default'}`;
}

/**
 * Upgrade an old project whose only theme is empty. Every existing literal
 * color and text font becomes an editable token while the rendered result is
 * kept pixel-for-pixel identical.
 */
export function generateThemeFromCurrentStyles(
  project: UiProject,
  preferredThemeId = 'default',
): { themeId: string; tokenCount: number; bindingCount: number } | null {
  if (project.themes.some((theme) => (resolveTheme(project.themes, theme.id)?.size ?? 0) > 0)) {
    return null;
  }

  const colors = new Set<string>();
  const fonts = new Set<string>();
  let screenBackground: string | null = null;
  visitAllStyleProps(project, (props, isScreenRoot) => {
    for (const [prop, value] of Object.entries(props)) {
      if (typeof value !== 'string') continue;
      if (/^#[0-9a-f]{6}$/i.test(value)) {
        const normalized = value.toUpperCase();
        colors.add(normalized);
        if (isScreenRoot && prop === 'bg_color' && screenBackground === null) {
          screenBackground = normalized;
        }
      } else if (prop === 'text_font') {
        fonts.add(value);
      }
    }
  });
  if (colors.size === 0 && fonts.size === 0) return null;

  const colorTokens = new Map<string, string>();
  const fontTokens = new Map<string, string>();
  const tokens: ThemeToken[] = [];
  for (const color of [...colors].sort()) {
    const id = color === screenBackground
      ? 'color.background'
      : `color.palette.${color.slice(1).toLowerCase()}`;
    colorTokens.set(color, id);
    tokens.push({ id, type: 'color', value: color });
  }
  for (const font of [...fonts].sort()) {
    let id = generatedFontTokenId(font);
    let suffix = 2;
    while (tokens.some((token) => token.id === id)) {
      id = `${generatedFontTokenId(font)}.${suffix}`;
      suffix += 1;
    }
    fontTokens.set(font, id);
    tokens.push({ id, type: 'fontRef', value: font });
  }

  let bindingCount = 0;
  visitAllStyleProps(project, (props) => {
    for (const [prop, value] of Object.entries(props)) {
      if (typeof value !== 'string') continue;
      const tokenId = /^#[0-9a-f]{6}$/i.test(value)
        ? colorTokens.get(value.toUpperCase())
        : prop === 'text_font' ? fontTokens.get(value) : undefined;
      if (!tokenId) continue;
      props[prop] = { $token: tokenId };
      bindingCount += 1;
    }
  });

  const theme = project.themes.find((candidate) => candidate.id === preferredThemeId)
    ?? project.themes[0];
  const themeId = theme?.id ?? preferredThemeId;
  const generated = {
    id: themeId,
    displayName: theme?.displayName && theme.displayName !== '默认'
      ? theme.displayName
      : `${project.meta.name} 主题`,
    tokens,
  };
  if (theme) {
    const index = project.themes.indexOf(theme);
    project.themes[index] = generated;
  } else {
    project.themes.push(generated);
  }
  return { themeId, tokenCount: tokens.length, bindingCount };
}
