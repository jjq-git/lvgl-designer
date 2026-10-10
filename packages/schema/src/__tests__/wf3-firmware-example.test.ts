import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateProject } from '../index.js';
import {
  isProjectSnapshotV2,
  loadStoredProjectDocument,
  resolveTheme,
  validateUiProjectV2,
  type ProjectSnapshotV2,
} from '../v2/index.js';

function loadExample(): ProjectSnapshotV2 {
  const url = new URL(
    '../../../../examples/wf3-firmware/WF3-284x76-firmware-ui.lvproj.json',
    import.meta.url,
  );
  const raw: unknown = JSON.parse(readFileSync(url, 'utf8'));
  expect(isProjectSnapshotV2(raw)).toBe(true);
  return raw as ProjectSnapshotV2;
}

type ExampleNode = {
  type?: string;
  codeName?: string;
  props?: Record<string, unknown>;
  styles?: Array<{ props?: Record<string, unknown> }>;
  children?: ExampleNode[];
};

function collectNonAsciiLabelsUsingBuiltinFonts(node: ExampleNode): string[] {
  const text = typeof node.props?.text === 'string' ? node.props.text : '';
  const font = node.styles
    ?.map((style) => style.props?.text_font)
    .find((value) => value !== undefined);
  const usesProjectFont = typeof font === 'string'
    ? font.startsWith('wf3_')
    : typeof font === 'object'
      && font !== null
      && '$token' in font
      && typeof font.$token === 'string'
      && font.$token.startsWith('font.');
  const ownFailure = node.type === 'label'
    && /[^\u0000-\u007f]/.test(text)
    && !usesProjectFont
    ? [`${node.codeName ?? '<unnamed>'}: ${text} (${font ?? 'no font'})`]
    : [];
  return ownFailure.concat(
    ...(node.children ?? []).map(collectNonAsciiLabelsUsingBuiltinFonts),
  );
}

function literalStyleColors(node: ExampleNode): string[] {
  const own = (node.styles ?? []).flatMap((style) => Object.entries(style.props ?? {}))
    .filter(([, value]) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
    .map(([, value]) => String(value));
  return own.concat(...(node.children ?? []).map(literalStyleColors));
}

describe('WF3 firmware UI import', () => {
  it('is a valid editable 284x76 project with all firmware page states', () => {
    const snapshot = loadExample();
    const loaded = loadStoredProjectDocument(snapshot);
    const theme = resolveTheme(snapshot.uiProject.themes, 'wf3-light');

    expect(loaded.project.display).toMatchObject({ width: 284, height: 76, shape: 'rect' });
    expect(snapshot.uiProject.themes.map(({ id }) => id)).toEqual([
      'industrial-base', 'wf3-light',
    ]);
    expect(snapshot.uiProject.themes[1]).toMatchObject({ extends: 'industrial-base' });
    expect(snapshot.buildTarget.themeRef).toBe(
      `${snapshot.buildTarget.uiProjectRef}#theme:wf3-light`,
    );
    expect(theme?.get('color.background')?.value).toBe('#F4F7F3');
    expect(theme?.get('color.accent')?.value).toBe('#A8E6A3');
    expect(theme?.get('color.status.danger')?.value).toBe('#C52A3A');
    expect(theme?.get('font.text.small')?.value).toBe('wf3_cn_12');
    expect(theme?.get('font.text.body')?.value).toBe('wf3_cn_14');
    expect(theme?.get('font.text.title')?.value).toBe('wf3_cn_16');
    expect(theme?.get('font.value.large')?.value).toBe('wf3_cn_20');
    expect(theme?.get('radius.control')?.value).toBe(5);
    expect(snapshot.uiProject.screens).toHaveLength(46);
    expect(snapshot.uiProject.screens.filter((screen) => screen.isHome)).toHaveLength(1);
    expect(snapshot.uiProject.screens.map((screen) => screen.codeName)).toEqual(expect.arrayContaining([
      'wf3_home', 'wf3_menu', 'wf3_uart', 'wf3_i2c', 'wf3_spi', 'wf3_can',
      'wf3_rs485', 'wf3_ws2812', 'wf3_onewire', 'wf3_blockly', 'wf3_wf31',
    ]));
    expect(snapshot.uiProject.assets.fonts.map((font) => font.codeName)).toEqual([
      'wf3_cn_12', 'wf3_cn_14', 'wf3_cn_16', 'wf3_cn_20',
      'wf3_icons_32', 'wf3_icons_36',
    ]);
    const menu = snapshot.uiProject.screens.find((screen) => screen.codeName === 'wf3_menu');
    const backButton = menu?.root.children.find((node) => node.codeName === 'wf3_menu_back');
    expect(backButton?.children[0]?.props.text).toBe('\ue166');
    expect(backButton?.styleRefs.map((ref) => ref.styleId)).toEqual([
      'style:industrial:control', 'style:industrial:control-pressed',
    ]);
    expect(backButton?.styles[0]?.props).toMatchObject({
      bg_color: { $token: 'color.accent' },
      border_width: { $token: 'border.none' },
      radius: { $token: 'radius.none' },
    });
    const home = snapshot.uiProject.screens.find((screen) => screen.codeName === 'wf3_home');
    const voltage = home?.root.children.find((node) => node.codeName === 'wf3_home_voltage');
    const title = home?.root.children.find((node) => node.codeName === 'wf3_home_titlebar');
    expect(voltage?.styles[0]?.props.bg_color).toEqual({ $token: 'color.voltage.v5' });
    expect(voltage?.children[0]?.props.text).toBe('5V3');
    expect(title?.props).toMatchObject({ x: 30, y: 60, width: 254, height: 16 });
    expect(title?.children[0]?.props.text).toBe('UART');
    expect(title?.children[0]?.styles[0]?.props.text_font)
      .toEqual({ $token: 'font.text.small' });
    expect(title?.children).toHaveLength(13);
    const previous = home?.root.children.find((node) => node.codeName === 'wf3_home_carousel_previous');
    const next = home?.root.children.find((node) => node.codeName === 'wf3_home_carousel_next');
    expect(previous?.children[0]?.props.text).toBe('\ue5cb');
    expect(previous?.events[0]).toMatchObject({
      action: 'subject.increment', args: { step: -1, min: 0, max: 12, rollover: true },
    });
    expect(next?.children[0]?.props.text).toBe('\ue5cc');
    expect(next?.events[0]).toMatchObject({
      action: 'subject.increment', args: { step: 1, min: 0, max: 12, rollover: true },
    });
    const firstWindow = home?.root.children.filter((node) => (
      node.codeName?.startsWith('wf3_home_carousel_0_')
    ));
    expect(firstWindow).toHaveLength(5);
    expect(firstWindow?.map((node) => node.children[0]?.props.text)).toEqual([
      '\ue335', '\ue86f', '\uefe6', '\ue915', '\ue1e0',
    ]);
    const secondWindow = home?.root.children.filter((node) => (
      node.codeName?.startsWith('wf3_home_carousel_5_')
    ));
    expect(secondWindow?.map((node) => node.children[0]?.props.text)).toEqual([
      '\uf102', '\uec1c', '\ueb2f', '\ue322', '\ue8b8',
    ]);
    const thirdWindow = home?.root.children.filter((node) => (
      node.codeName?.startsWith('wf3_home_carousel_10_')
    ));
    expect(thirdWindow?.map((node) => node.children[0]?.props.text)).toEqual([
      '\ue6e1', '\ue87b', '\ue1ff', '\ue335', '\ue86f',
    ]);
    expect(firstWindow?.map((node) => node.props.x)).toEqual([66, 102, 138, 174, 210]);
    expect(firstWindow?.every((node) => node.bindings[0]?.kind === 'flag')).toBe(true);
    expect(snapshot.uiProject.subjects).toContainEqual(expect.objectContaining({
      id: 'subject:wf3_nav_offset', type: 'int', initial: 0, min: 0, max: 12,
    }));
    const loadedHome = loaded.project.screens.find((screen) => screen.name === 'wf3_home');
    const loadedPrevious = loadedHome?.root.children.find(
      (node) => node.name === 'wf3_home_carousel_previous',
    );
    const loadedFirstItem = loadedHome?.root.children.find(
      (node) => node.name === 'wf3_home_carousel_0_0_uart',
    );
    expect(loadedPrevious?.events[0]).toMatchObject({
      kind: 'subject_increment', subject: 'wf3_nav_offset', step: -1,
      min: 0, max: 12, rollover: true,
    });
    expect(loadedFirstItem?.bindings[0]).toMatchObject({
      kind: 'flag', flag: 'hidden', op: 'not_eq', subject: 'wf3_nav_offset', refValue: 0,
    });
    expect(snapshot.uiProject.assets.fonts[0]?.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.uiProject.screens.flatMap((screen) => (
      collectNonAsciiLabelsUsingBuiltinFonts(screen.root as unknown as ExampleNode)
    ))).toEqual([]);
    expect([
      ...snapshot.uiProject.styles.flatMap((style) => Object.values(style.props)),
      ...snapshot.uiProject.screens.flatMap((screen) => (
        literalStyleColors(screen.root as unknown as ExampleNode)
      )),
    ].filter((value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))).toEqual([]);
    expect(validateProject(loaded.project).errors).toEqual([]);
    expect(validateUiProjectV2(snapshot.uiProject, { actions: snapshot.actionRegistry }).errors).toEqual([]);
  });

  it('records the immutable firmware source and migration boundaries', () => {
    const snapshot = loadExample();
    expect(snapshot.uiProject.editor?.source).toMatchObject({
      branch: 'cheng-wf3-code-cleanup-20261008',
      commit: 'a64842b8b9ea2425f235531658e31fe48635ff62',
      path: 'firmware/main/ui',
      lvglVersion: '9.4.x',
    });
    expect(snapshot.migrationNotes.map((note) => note.code)).toEqual(expect.arrayContaining([
      'wf3-source', 'lvgl-version-upgrade', 'firmware-logic-external',
    ]));
  });

  it('can switch between the reusable base theme and the WF3 product theme', () => {
    const snapshot = loadExample();
    const product = loadStoredProjectDocument(snapshot).project;
    const baseSnapshot = structuredClone(snapshot);
    baseSnapshot.buildTarget.themeRef = `${baseSnapshot.buildTarget.uiProjectRef}#theme:industrial-base`;
    const base = loadStoredProjectDocument(baseSnapshot).project;
    const productBack = product.screens
      .find((screen) => screen.name === 'wf3_menu')
      ?.root.children.find((node) => node.name === 'wf3_menu_back');
    const baseBack = base.screens
      .find((screen) => screen.name === 'wf3_menu')
      ?.root.children.find((node) => node.name === 'wf3_menu_back');

    expect(productBack?.inlineStyles[0]?.props.bg_color).toBe('#A8E6A3');
    expect(baseBack?.inlineStyles[0]?.props.bg_color).toBe('#0F766E');
  });
});
