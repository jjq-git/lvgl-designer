import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_DIR = resolve('examples/quiet-pod');
const OUTPUT_DIR = resolve('examples/serene-pod');
const NOW = '2026-10-09T00:00:00.000Z';

const PRESETS = [
  { model: 'WF2D-8620', width: 240, layout: 'round' },
  { model: 'WF2D-1040', width: 1080, layout: 'landscape' },
  { model: 'WF2D-1030', width: 1440, layout: 'ultrawide' },
  { model: 'WF2D-1050', width: 1024, layout: 'landscape' },
  { model: 'WF2D-8630', width: 480, layout: 'square' },
];

const COLOR_MAP = new Map([
  ['#06101E', '#F4F1EA'],
  ['#0A1728', '#DDE8E6'],
  ['#102238', '#FFFFFF'],
  ['#0C1B2E', '#E9EFED'],
  ['#203852', '#C9D6D2'],
  ['#F4F8FC', '#163033'],
  ['#8FA7BD', '#61777A'],
  ['#32D6C6', '#1B9AAA'],
  ['#3B82F6', '#167D83'],
  ['#F5B942', '#D99A2B'],
  ['#51D88A', '#2E9D75'],
  ['#FF6B6B', '#D85C4A'],
  ['#29425A', '#CFDBD8'],
  ['#32465A', '#C6D3CF'],
  ['#13305A', '#CFE6E3'],
  ['#000000', '#78908D'],
]);

const SOLID_BUTTONS = new Set(['#167D83', '#1B9AAA', '#D99A2B', '#2E9D75', '#D85C4A']);

function remapStyle(entry) {
  for (const [key, value] of Object.entries(entry.props ?? {})) {
    if (typeof value === 'string' && COLOR_MAP.has(value.toUpperCase())) {
      entry.props[key] = COLOR_MAP.get(value.toUpperCase());
    }
  }
  if ('shadow_opa' in (entry.props ?? {}) && entry.props.shadow_opa > 40) {
    entry.props.shadow_opa = 32;
  }
  if ('shadow_width' in (entry.props ?? {}) && entry.props.shadow_width > 0) {
    entry.props.shadow_width = Math.min(12, entry.props.shadow_width);
  }
}

function baseStyle(node) {
  return node.styles?.find((entry) => !entry.selector || entry.selector.part === 'main');
}

function restyleNode(node) {
  for (const entry of node.styles ?? []) remapStyle(entry);

  if (node.type === 'obj' || node.type === 'button') {
    const style = baseStyle(node);
    if (style?.props && typeof style.props.radius === 'number' && style.props.radius > 0) {
      style.props.radius = Math.min(24, style.props.radius + 4);
    }
  }

  if (node.type === 'button') {
    const background = baseStyle(node)?.props?.bg_color;
    const color = SOLID_BUTTONS.has(background) ? '#FFFFFF' : '#163033';
    for (const child of node.children ?? []) {
      if (child.type !== 'label') continue;
      const style = child.styles?.find((entry) => !entry.selector);
      if (style?.props) style.props.text_color = color;
    }
  }

  if (typeof node.props?.text === 'string') {
    node.props.text = node.props.text
      .replaceAll('BRAND A', 'BRAND B')
      .replaceAll('CABIN STATUS', 'COMFORT OVERVIEW')
      .replaceAll('QUIET', 'CALM')
      .replaceAll('ppm / GOOD', 'ppm OK')
      .replaceAll('END SESSION', 'FINISH');
  }

  for (const child of node.children ?? []) restyleNode(child);
}

function mirrorRectScreen(screen, displayWidth) {
  for (const child of screen.root.children) {
    const { x, width } = child.props ?? {};
    if (typeof x === 'number' && typeof width === 'number') {
      child.props.x = displayWidth - x - width;
    }
  }

  const status = screen.root.children.find((child) => child.codeName?.endsWith('_status'));
  if (status) {
    status.props.x = 32;
    status.props.width = 132;
    const style = status.styles?.find((entry) => !entry.selector);
    if (style?.props) style.props.text_align = 'left';
  }
}

function moveSquareNavigation(screen) {
  for (const child of screen.root.children) {
    const name = child.codeName ?? '';
    if (name.includes('_nav_')) child.props.y = 14;
    if (name.endsWith('_brand') || name.endsWith('_title')) child.props.y = 447;
  }
}

function transformSnapshot(source, preset) {
  const snapshot = structuredClone(source);
  const slug = `${preset.model.toLowerCase()}-serene-pod`;
  const uiId = `ui:${slug}`;

  snapshot.uiProject.meta.id = uiId;
  snapshot.uiProject.meta.revision = 1;
  snapshot.uiProject.meta.name = `${preset.model} 自然舒适舱界面`;
  snapshot.uiProject.meta.createdAt = NOW;
  snapshot.uiProject.meta.modifiedAt = NOW;
  snapshot.uiProject.editor.example = 'serene-pod-control-suite';

  for (const screen of snapshot.uiProject.screens) {
    restyleNode(screen.root);
    if (preset.layout === 'landscape' || preset.layout === 'ultrawide') {
      mirrorRectScreen(screen, preset.width);
    } else if (preset.layout === 'square') {
      moveSquareNavigation(screen);
    }
  }

  snapshot.buildTarget.id = `target:${slug}`;
  snapshot.buildTarget.revision = 1;
  snapshot.buildTarget.displayName = `${preset.model} 自然舒适舱目标`;
  snapshot.buildTarget.uiProjectRef = `${uiId}@1`;
  snapshot.buildTarget.themeRef = `${uiId}@1#theme:default`;
  snapshot.migrationNotes = [
    ...(snapshot.migrationNotes ?? []),
    {
      severity: 'info',
      code: 'serene-device-layout',
      path: 'uiProject.screens',
      message: `${preset.model} 使用自然舒适主题与设备专属布局。`,
    },
  ];
  return snapshot;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const preset of PRESETS) {
  const sourceFile = resolve(SOURCE_DIR, `${preset.model}-quiet-pod.lvproj.json`);
  const outputFile = resolve(OUTPUT_DIR, `${preset.model}-serene-pod.lvproj.json`);
  const source = JSON.parse(readFileSync(sourceFile, 'utf8'));
  const project = transformSnapshot(source, preset);
  writeFileSync(outputFile, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  process.stdout.write(`generated ${outputFile}\n`);
}
