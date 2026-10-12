import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateProject, type LvProject } from '../index.js';
import {
  isProjectSnapshotV2,
  loadStoredProjectDocument,
  validateCrossRefs,
  validateUiProjectV2,
  type ProjectSnapshotV2,
  type WidgetNodeV2,
} from '../v2/index.js';

const PRESETS = [
  { model: 'WF2D-8620', width: 240, height: 240, shape: 'round', bg: '#071A1B' },
  { model: 'WF2D-1040', width: 1080, height: 720, shape: 'rect', bg: '#EEF7F3' },
  { model: 'WF2D-1030', width: 1440, height: 720, shape: 'rect', bg: '#F3F0E7' },
  { model: 'WF2D-1050', width: 1024, height: 600, shape: 'rect', bg: '#FFF7EA' },
  { model: 'WF2D-8630', width: 480, height: 480, shape: 'rect', bg: '#EAF4FA' },
] as const;

function loadExample(model: string): { project: LvProject; snapshot: ProjectSnapshotV2 } {
  const url = new URL(`../../../../examples/serene-pod/${model}-serene-pod.lvproj.json`, import.meta.url);
  const raw: unknown = JSON.parse(readFileSync(url, 'utf8'));
  expect(isProjectSnapshotV2(raw)).toBe(true);
  const loaded = loadStoredProjectDocument(raw);
  expect(loaded.snapshot).not.toBeNull();
  return { project: loaded.project, snapshot: loaded.snapshot! };
}

function findNode(root: WidgetNodeV2, codeName: string): WidgetNodeV2 | undefined {
  if (root.codeName === codeName) return root;
  for (const child of root.children) {
    const found = findNode(child, codeName);
    if (found) return found;
  }
  return undefined;
}

function collectNodes(root: WidgetNodeV2): WidgetNodeV2[] {
  return [root, ...root.children.flatMap(collectNodes)];
}

function activeThemeValues(snapshot: ProjectSnapshotV2): Map<string, string | number> {
  const themeId = snapshot.buildTarget.themeRef.match(/#theme:(.+)$/)?.[1];
  const theme = snapshot.uiProject.themes.find((candidate) => candidate.id === themeId);
  return new Map(theme?.tokens.map((token) => [token.id, token.value]) ?? []);
}

function resolveThemeValue(snapshot: ProjectSnapshotV2, value: unknown): unknown {
  if (value && typeof value === 'object' && '$token' in value) {
    const tokenId = (value as { $token?: unknown }).$token;
    if (typeof tokenId === 'string') return activeThemeValues(snapshot).get(tokenId);
  }
  return value;
}

function collectUnthemedVisualValues(node: WidgetNodeV2): string[] {
  const own = node.styles.flatMap((entry) => Object.entries(entry.props)
    .filter(([prop, value]) => (
      (prop === 'text_font' && typeof value === 'string')
      || (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
    ))
    .map(([prop]) => `${node.codeName ?? node.type}.${prop}`));
  return [...own, ...node.children.flatMap(collectUnthemedVisualValues)];
}

describe('serene pod example projects', () => {
  for (const preset of PRESETS) {
    it(`${preset.model} is a valid device-specific five-screen project`, () => {
      const { project, snapshot } = loadExample(preset.model);
      expect(project.display).toMatchObject({
        width: preset.width,
        height: preset.height,
        shape: preset.shape,
      });
      expect(project.screens.map((screen) => screen.name)).toEqual([
        'home', 'air', 'light', 'focus', 'settings',
      ]);
      expect(project.screens.filter((screen) => screen.isHome)).toHaveLength(1);
      expect(validateProject(project).errors).toEqual([]);
      expect(validateUiProjectV2(snapshot.uiProject, { actions: snapshot.actionRegistry }).errors).toEqual([]);
      expect(validateCrossRefs({
        uiProject: snapshot.uiProject,
        display: snapshot.displayProfile,
        controller: snapshot.controllerProfile!,
        buildTarget: {
          ...snapshot.buildTarget,
          controllerProfileRef: snapshot.buildTarget.controllerProfileRef!,
        },
      }).errors).toEqual([]);
      expect(snapshot.uiProject.meta.id).toBe(`ui:${preset.model.toLowerCase()}-serene-pod`);
      expect(snapshot.buildTarget.themeRef).toMatch(
        new RegExp(`#theme:serene-${preset.model.toLowerCase()}$`),
      );
      expect(snapshot.uiProject.themes.map((theme) => theme.id)).toEqual([
        `serene-${preset.model.toLowerCase()}`,
      ]);
      expect(resolveThemeValue(
        snapshot,
        snapshot.uiProject.screens[0]?.root.styles[0]?.props.bg_color,
      )).toBe(preset.bg);
      expect(activeThemeValues(snapshot).get('color.background')).toBe(preset.bg);
      expect(snapshot.uiProject.screens.flatMap((screen) => (
        collectUnthemedVisualValues(screen.root)
      ))).toEqual([]);
    });
  }

  it('uses a distinct touch-first composition for every display family', () => {
    const wide = loadExample('WF2D-1040').snapshot.uiProject.screens.find((screen) => screen.codeName === 'home')!;
    expect(findNode(wide.root, 'home_rail')?.props).toMatchObject({ x: 18, y: 626, width: 1044, height: 82 });
    expect(findNode(wide.root, 'home_nav_home')?.props.height).toBe(66);

    const ultra = loadExample('WF2D-1030').snapshot.uiProject.screens.find((screen) => screen.codeName === 'home')!;
    expect(findNode(ultra.root, 'home_rail')?.props).toMatchObject({ x: 18, y: 18, width: 212, height: 684 });
    expect(findNode(ultra.root, 'home_nav_home')?.props).toMatchObject({ x: 34, y: 132, width: 180, height: 78 });

    const compact = loadExample('WF2D-1050').snapshot.uiProject.screens.find((screen) => screen.codeName === 'home')!;
    expect(findNode(compact.root, 'home_rail')?.props).toMatchObject({ x: 18, y: 62, width: 988, height: 76 });
    expect(findNode(compact.root, 'home_nav_home')?.props.y).toBe(70);

    const { snapshot } = loadExample('WF2D-8630');
    const home = snapshot.uiProject.screens.find((screen) => screen.codeName === 'home')!;
    expect(findNode(home.root, 'home_nav_home')?.props).toMatchObject({
      x: 8, y: 420, width: 88, height: 52,
    });
    expect(findNode(home.root, 'home_brand_logo')?.props).toMatchObject({
      src: 'podsc_logo', x: 18, y: 15, width: 32, height: 32,
    });
    expect(findNode(home.root, 'home_hero')?.props.width).toBe(444);
    expect(findNode(home.root, 'home_co2')?.props.y).toBe(276);
  });

  it('keeps five independent visual systems instead of recoloring one shared theme', () => {
    const themeCases = [
      ['WF2D-1030', 'home_rail', '#234A35', 'home_nav_home', '#F0C987', 8],
      ['WF2D-1040', 'home_rail', '#FFFFFF', 'home_nav_home', '#178A7E', 20],
      ['WF2D-1050', 'home_rail', '#F1D8B8', 'home_nav_home', '#C96F43', 24],
      ['WF2D-8630', null, null, 'home_nav_home', '#397FA8', 12],
    ] as const;
    for (const [model, railName, railColor, navName, navColor, radius] of themeCases) {
      const { snapshot } = loadExample(model);
      const home = snapshot.uiProject.screens.find((screen) => screen.codeName === 'home')!;
      if (railName) {
        expect(resolveThemeValue(
          snapshot,
          findNode(home.root, railName)?.styles[0]?.props.bg_color,
        )).toBe(railColor);
      }
      const nav = findNode(home.root, navName)!;
      expect(resolveThemeValue(snapshot, nav.styles[0]?.props.bg_color)).toBe(navColor);
      expect(nav.styles[0]?.props.radius).toBe(radius);
    }

    const roundSnapshot = loadExample('WF2D-8620').snapshot;
    const round = roundSnapshot.uiProject.screens.find((screen) => screen.codeName === 'home')!;
    expect(resolveThemeValue(roundSnapshot, round.root.styles[0]?.props.bg_color)).toBe('#071A1B');
    expect(resolveThemeValue(
      roundSnapshot,
      findNode(round.root, 'home_page_title')?.styles[0]?.props.text_color,
    )).toBe('#9BB6AF');
  });

  it('keeps every button large enough for physical touch use', () => {
    for (const preset of PRESETS) {
      const { snapshot } = loadExample(preset.model);
      for (const screen of snapshot.uiProject.screens) {
        for (const button of collectNodes(screen.root).filter((node) => node.type === 'button')) {
          expect(Number(button.props.width), button.codeName).toBeGreaterThanOrEqual(44);
          expect(Number(button.props.height), button.codeName).toBeGreaterThanOrEqual(40);
        }
      }
    }
  });

  it('preserves internal spacing and control proportions on compact displays', () => {
    const compact = loadExample('WF2D-1050').snapshot.uiProject.screens.find((screen) => screen.codeName === 'home')!;
    expect(findNode(compact.root, 'home_co2_unit')?.props.y).toBe(92);
    expect(findNode(compact.root, 'home_light_switch')?.props).toMatchObject({ width: 64, height: 38 });
    expect(findNode(compact.root, 'home_fan_switch')?.props).toMatchObject({ width: 64, height: 38 });

    const square = loadExample('WF2D-8630').snapshot.uiProject.screens.find((screen) => screen.codeName === 'home')!;
    expect(findNode(square.root, 'home_humidity_title')?.props.text).toBe('HUMIDITY');
    expect(findNode(square.root, 'home_quiet_arc')?.props).toMatchObject({ x: 92, y: 28, width: 124, height: 124 });
    expect(findNode(square.root, 'home_quiet')?.props).toMatchObject({ x: 220, y: 58, width: 132, height: 34 });
    expect(findNode(square.root, 'home_noise')?.props).toMatchObject({ x: 220, y: 104, width: 132, height: 26 });

    const round = loadExample('WF2D-8620').snapshot.uiProject.screens.find((screen) => screen.codeName === 'home')!;
    expect(findNode(round.root, 'home_page_title')?.props.text).toBe('');
    const featureCard = findNode(round.root, 'home_feature_card')!;
    expect(featureCard.props).toMatchObject({ x: 45, y: 48, width: 150, height: 116 });
    expect(featureCard.children).toEqual([]);
    expect(featureCard.styles[0]?.props).toMatchObject({ bg_opa: 0, border_width: 0, shadow_width: 0 });
    expect(featureCard.events[0]).toMatchObject({
      on: 'clicked', action: 'screen.open',
      args: { screen: '00000000-0000-4000-8000-000000000002' },
    });

    const roundFocus = loadExample('WF2D-8620').snapshot.uiProject.screens.find((screen) => screen.codeName === 'focus')!;
    expect(findNode(roundFocus.root, 'focus_back')?.props).toMatchObject({ x: 40, y: 174, width: 48, height: 48 });
    expect(findNode(roundFocus.root, 'focus_next')?.props).toMatchObject({ x: 152, y: 174, width: 48, height: 48 });
    expect(findNode(roundFocus.root, 'focus_time')?.props).toMatchObject({ x: 88, y: 176, width: 64, height: 22 });

    const roundSettings = loadExample('WF2D-8620').snapshot.uiProject.screens.find((screen) => screen.codeName === 'settings')!;
    expect(findNode(roundSettings.root, 'settings_light')?.props).toMatchObject({ y: 114, height: 28 });
    expect(findNode(roundSettings.root, 'settings_version')?.props).toMatchObject({ y: 146, height: 22 });

    const roundLight = loadExample('WF2D-8620').snapshot.uiProject.screens.find((screen) => screen.codeName === 'light')!;
    expect(findNode(roundLight.root, 'light_brightness_arc')?.props).toMatchObject({ x: 66, y: 46, width: 108, height: 108 });
    expect(findNode(roundLight.root, 'light_master_label')?.props).toMatchObject({ y: 154, height: 18 });
  });
});
