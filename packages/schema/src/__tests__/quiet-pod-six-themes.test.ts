import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateProject } from '../index.js';
import {
  createPodscStaticWebUiDocument,
  isProjectSnapshotV2,
  loadStoredProjectDocument,
  validateCrossRefs,
  validateUiProjectV2,
  type ProjectSnapshotV2,
} from '../v2/index.js';

const CASES = [
  { file: 'WF2D-8620-quiet-focus', width: 240, height: 240, shape: 'round', feature: 'focus', theme: 'midnight-violet', target: 'focus' },
  { file: 'WF2D-8630-quiet-acoustics', width: 480, height: 480, shape: 'rect', feature: 'acoustics', theme: 'glacier-blue', target: 'air' },
  { file: 'WF2D-1050-quiet-lighting', width: 1024, height: 600, shape: 'rect', feature: 'lighting', theme: 'amber-studio', target: 'light' },
  { file: 'WF2D-1040-quiet-air', width: 1080, height: 720, shape: 'rect', feature: 'air', theme: 'eco-mint', target: 'air' },
  { file: 'WF2D-1030-quiet-booking', width: 1440, height: 720, shape: 'rect', feature: 'booking', theme: 'coral-schedule', target: 'focus' },
  { file: 'WF3-284x76-quiet-dnd', width: 284, height: 76, shape: 'rect', feature: 'dnd', theme: 'signal-red', target: null },
] as const;

function load(file: string): ProjectSnapshotV2 {
  const url = new URL(`../../../../examples/quiet-pod-six-themes/${file}.lvproj.json`, import.meta.url);
  const raw: unknown = JSON.parse(readFileSync(url, 'utf8'));
  expect(isProjectSnapshotV2(raw)).toBe(true);
  return raw as ProjectSnapshotV2;
}

describe('six differentiated quiet-pod interfaces', () => {
  for (const item of CASES) {
    it(`${item.file} is valid and highlights ${item.feature}`, () => {
      const snapshot = load(item.file);
      const loaded = loadStoredProjectDocument(snapshot);
      expect(loaded.snapshot).not.toBeNull();
      expect(loaded.project.display).toMatchObject({ width: item.width, height: item.height, shape: item.shape });
      expect(validateProject(loaded.project).errors).toEqual([]);
      expect(validateUiProjectV2(snapshot.uiProject, { actions: snapshot.actionRegistry }).errors).toEqual([]);
      expect(snapshot.uiProject.editor).toMatchObject({
        example: 'quiet-pod-six-themes',
        homeFeature: item.feature,
      });
      expect(snapshot.buildTarget.themeRef).toMatch(new RegExp(`#theme:${item.theme}$`));
      expect(snapshot.uiProject.themes.map((theme) => theme.id)).toEqual([item.theme]);
      if (item.file.startsWith('WF2D-')) {
        expect(() => createPodscStaticWebUiDocument(snapshot)).not.toThrow();
      }

      if (item.target) {
        const home = snapshot.uiProject.screens.find((screen) => screen.isHome);
        const target = snapshot.uiProject.screens.find((screen) => screen.codeName === item.target);
        const navigation = home?.root.children.find((node) => node.events.some((event) => (
          event.action === 'screen.open' && event.args?.screen === target?.id
        )));
        expect(navigation).toMatchObject({
          type: 'button',
          events: [{
            on: 'clicked',
            action: 'screen.open',
            args: { screen: target?.id, anim: 'fade_in', duration: 180, delay: 0 },
          }],
        });
      }

      if (item.feature === 'focus') {
        const home = snapshot.uiProject.screens.find((screen) => screen.isHome);
        const focus = snapshot.uiProject.screens.find((screen) => screen.codeName === 'focus');
        const card = home?.root.children.find((node) => node.codeName === 'home_focus_card');
        const start = home?.root.children.find((node) => node.codeName === 'home_focus_start');
        expect(card).toMatchObject({
          type: 'button',
          props: { x: 40, y: 38, width: 160, height: 132 },
          events: [{
            on: 'clicked',
            action: 'screen.open',
            args: { screen: focus?.id, anim: 'fade_in', duration: 180, delay: 0 },
          }],
        });
        expect(start?.events).toEqual([{
          on: 'clicked',
          action: 'subject.set',
          args: { subject: 'subject:pod_mode', value: '2' },
        }]);
      }

      if (snapshot.controllerProfile) {
        expect(validateCrossRefs({
          uiProject: snapshot.uiProject,
          display: snapshot.displayProfile,
          controller: snapshot.controllerProfile,
          buildTarget: {
            ...snapshot.buildTarget,
            controllerProfileRef: snapshot.buildTarget.controllerProfileRef!,
          },
        }).errors).toEqual([]);
      }
    });
  }

  it('uses six different active color systems', () => {
    const backgrounds = CASES.map(({ file }) => {
      const snapshot = load(file);
      return snapshot.uiProject.themes[0]?.tokens.find((entry) => entry.id === 'color.background')?.value;
    });
    expect(new Set(backgrounds).size).toBe(CASES.length);
  });

  it('uses readable coral navigation on every booking screen', () => {
    const snapshot = load('WF2D-1030-quiet-booking');
    const tokens = new Map(snapshot.uiProject.themes[0]!.tokens.map((entry) => [entry.id, String(entry.value)]));
    const color = (value: unknown): string => tokens.get((value as { $token: string }).$token)!;
    const luminance = (hex: string): number => {
      const rgb = [1, 3, 5].map((offset) => {
        const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
    };
    const contrast = (foreground: string, background: string): number => {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (values[0]! + 0.05) / (values[1]! + 0.05);
    };

    expect(contrast(tokens.get('color.text.onaccent')!, tokens.get('color.accent')!)).toBeGreaterThanOrEqual(4.5);
    for (const screen of snapshot.uiProject.screens.filter((candidate) => !candidate.isHome)) {
      const rail = screen.root.children.find((node) => node.codeName === `${screen.codeName}_rail`)!;
      expect(color(rail.styles[0]!.props.bg_color)).toBe(tokens.get('color.surface.subtle'));
      for (const name of ['home', 'air', 'light', 'focus', 'settings']) {
        const button = screen.root.children.find((node) => node.codeName === `${screen.codeName}_nav_${name}`)!;
        const background = color(button.styles[0]!.props.bg_color);
        const foreground = color(button.children[0]!.styles[0]!.props.text_color);
        expect(contrast(foreground, background), button.codeName).toBeGreaterThanOrEqual(4.5);
        expect(background, button.codeName).toBe(name === screen.codeName
          ? tokens.get('color.accent') : tokens.get('color.surface'));
      }
    }
  });

  it('keeps every secondary WF2D-1040 page title beside its brand icon', () => {
    const snapshot = load('WF2D-1040-quiet-air');
    for (const screen of snapshot.uiProject.screens.filter((candidate) => !candidate.isHome)) {
      const brand = screen.root.children.find((node) => node.codeName === `${screen.codeName}_brand_logo`)!;
      const title = screen.root.children.find((node) => node.codeName === `${screen.codeName}_title`)!;
      expect(brand.props, screen.codeName).toMatchObject({ x: 28, y: 23, width: 32, height: 32 });
      expect(title.props, screen.codeName).toMatchObject({ x: 78, y: 22, height: 36 });
      expect(Number(title.props.x) - (Number(brand.props.x) + Number(brand.props.width))).toBe(18);
    }
  });

  it('keeps amber navigation labels readable on every screen', () => {
    const snapshot = load('WF2D-1050-quiet-lighting');
    const tokens = new Map(snapshot.uiProject.themes[0]!.tokens.map((token) => [token.id, token.value]));
    const resolveColor = (value: unknown): string => {
      if (typeof value === 'string') return value;
      return String(tokens.get((value as { $token: string }).$token));
    };
    const luminance = (hex: string) => {
      const rgb = [1, 3, 5].map((offset) => {
        const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
    };
    let checked = 0;
    for (const screen of snapshot.uiProject.screens.filter((screen) => !screen.isHome)) {
      const buttons = screen.root.children.filter((node) => node.type === 'button' && node.codeName?.includes('_nav_'));
      expect(buttons).toHaveLength(5);
      for (const button of buttons) {
        const label = button.children[0]!;
        const bg = luminance(resolveColor(button.styles[0]!.props.bg_color));
        const fg = luminance(resolveColor(label.styles[0]!.props.text_color));
        expect((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05), button.codeName).toBeGreaterThanOrEqual(4.5);
        checked += 1;
      }
    }
    expect(checked).toBe(20);
  });
});
