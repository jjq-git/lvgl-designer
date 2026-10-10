const COLOR_RE = /^#[0-9a-f]{6}$/i;

function visitNodeStyles(node, visit) {
  for (const style of node.styles ?? []) visit(style.props ?? {});
  for (const child of node.children ?? []) visitNodeStyles(child, visit);
}

function visitProjectStyles(project, visit) {
  for (const style of project.styles ?? []) visit(style.props ?? {});
  for (const screen of project.screens ?? []) {
    for (const style of screen.styles ?? []) visit(style.props ?? {});
    visitNodeStyles(screen.root, visit);
  }
  for (const component of project.components ?? []) {
    for (const style of component.styles ?? []) visit(style.props ?? {});
    visitNodeStyles(component.root, visit);
  }
}

function fontTokenId(fontRef) {
  const montserrat = /^montserrat_(\d+)$/.exec(fontRef);
  if (montserrat) return `font.size.${montserrat[1]}`;
  const slug = fontRef.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  return `font.asset.${slug || 'default'}`;
}

function resolvedThemeValues(themes, themeId) {
  const values = new Map();
  const visiting = new Set();
  const append = (id) => {
    if (visiting.has(id)) throw new Error(`Theme inheritance cycle: ${id}`);
    const theme = themes.find((candidate) => candidate.id === id);
    if (!theme) return;
    visiting.add(id);
    if (theme.extends) append(theme.extends);
    for (const token of theme.tokens) values.set(token.id, token.value);
    visiting.delete(id);
  };
  append(themeId);
  return values;
}

/** Resolve theme references back to literals before restyling a derived project. */
export function materializeProjectTheme(project, themeId) {
  const values = resolvedThemeValues(project.themes ?? [], themeId);
  visitProjectStyles(project, (props) => {
    for (const [key, value] of Object.entries(props)) {
      if (!value || typeof value !== 'object' || typeof value.$token !== 'string') continue;
      const resolved = values.get(value.$token);
      if (resolved !== undefined) props[key] = resolved;
    }
  });
}

/** Replace every literal style color and text font with a theme token. */
export function tokenizeProjectTheme(project, theme) {
  const tokens = theme.tokens.map((token) => ({ ...token }));
  const colorIds = new Map();
  for (const token of tokens) {
    if (token.type !== 'color' || typeof token.value !== 'string') continue;
    const color = token.value.toUpperCase();
    colorIds.set(color, [...(colorIds.get(color) ?? []), token.id]);
  }
  const fontIds = new Map(tokens
    .filter((token) => token.type === 'fontRef' && typeof token.value === 'string')
    .map((token) => [token.value, token.id]));
  const literalColors = new Set();
  const literalFonts = new Set();

  visitProjectStyles(project, (props) => {
    for (const [prop, value] of Object.entries(props)) {
      if (typeof value !== 'string') continue;
      if (COLOR_RE.test(value)) literalColors.add(value.toUpperCase());
      if (prop === 'text_font') literalFonts.add(value);
    }
  });

  for (const color of [...literalColors].sort()) {
    if (colorIds.has(color)) continue;
    const id = `color.palette.${color.slice(1).toLowerCase()}`;
    colorIds.set(color, [id]);
    tokens.push({ id, type: 'color', value: color });
  }
  for (const font of [...literalFonts].sort()) {
    if (fontIds.has(font)) continue;
    const id = fontTokenId(font);
    fontIds.set(font, id);
    tokens.push({ id, type: 'fontRef', value: font });
  }

  visitProjectStyles(project, (props) => {
    for (const [prop, value] of Object.entries(props)) {
      if (typeof value !== 'string') continue;
      const colorCandidates = COLOR_RE.test(value)
        ? colorIds.get(value.toUpperCase()) ?? []
        : [];
      const id = colorCandidates.length > 0
        ? prop === 'text_color'
          ? ['color.text.onaccent', 'color.text.primary', 'color.text.muted']
            .find((candidate) => colorCandidates.includes(candidate)) ?? colorCandidates[0]
          : prop === 'bg_color'
            ? ['color.background', 'color.surface', 'color.surface.subtle', 'color.navigation']
              .find((candidate) => colorCandidates.includes(candidate)) ?? colorCandidates[0]
            : colorCandidates[0]
        : prop === 'text_font' ? fontIds.get(value) : undefined;
      if (id) props[prop] = { $token: id };
    }
  });

  project.themes = [{ ...theme, tokens }];
  return { colorCount: colorIds.size, fontCount: fontIds.size };
}
