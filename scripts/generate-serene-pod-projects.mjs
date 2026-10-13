import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { materializeProjectTheme, tokenizeProjectTheme } from './theme-tokenize.mjs';

const SOURCE_DIR = resolve('examples/quiet-pod');
const OUTPUT_DIR = resolve('examples/serene-pod');
const NOW = '2026-10-10T00:00:00.000Z';

const PRESETS = [
  { model: 'WF2D-8620', width: 240, height: 240, layout: 'round' },
  { model: 'WF2D-1040', width: 1080, height: 720, layout: 'landscape' },
  { model: 'WF2D-1030', width: 1440, height: 720, layout: 'ultrawide' },
  { model: 'WF2D-1050', width: 1024, height: 600, layout: 'landscape' },
  { model: 'WF2D-8630', width: 480, height: 480, layout: 'square' },
];

const COLOR_MAP = new Map([
  ['#06101E', '#EEF7F3'], ['#0A1728', '#FFFFFF'], ['#102238', '#FFFFFF'],
  ['#0C1B2E', '#DFF1EA'], ['#203852', '#C9DED7'], ['#F4F8FC', '#153C3A'],
  ['#8FA7BD', '#66827D'], ['#32D6C6', '#2BB7A3'], ['#3B82F6', '#178A7E'],
  ['#F5B942', '#E2A93B'], ['#51D88A', '#3BA77C'], ['#FF6B6B', '#E46F61'],
  ['#29425A', '#D6E8E2'], ['#32465A', '#C8DDD6'], ['#13305A', '#D7EEE7'],
  ['#000000', '#78908D'],
]);
const SOLID_BUTTONS = new Set(['#178A7E', '#2BB7A3', '#E2A93B', '#3BA77C', '#E46F61']);

const DEVICE_THEMES = {
  'WF2D-1030': {
    bg: '#F3F0E7', surface: '#FFFDF7', soft: '#E3E9DD', border: '#BFCBB9',
    text: '#23382A', muted: '#6F7F70', accent: '#356B4A', accent2: '#7BAE79',
    warning: '#C9903D', success: '#5D8D65', danger: '#B96755', track: '#D8E0D3', shadow: '#777D73',
  },
  'WF2D-1040': {
    bg: '#EEF7F3', surface: '#FFFFFF', soft: '#DFF1EA', border: '#C9DED7',
    text: '#153C3A', muted: '#66827D', accent: '#178A7E', accent2: '#2BB7A3',
    warning: '#E2A93B', success: '#3BA77C', danger: '#E46F61', track: '#D6E8E2', shadow: '#78908D',
  },
  'WF2D-1050': {
    bg: '#FFF7EA', surface: '#FFFDF8', soft: '#F4E2C5', border: '#E5CBA3',
    text: '#4A3426', muted: '#8F725C', accent: '#C96F43', accent2: '#E39A63',
    warning: '#DDA23F', success: '#879B68', danger: '#C95F55', track: '#F0DFC6', shadow: '#A98264',
  },
  'WF2D-8630': {
    bg: '#EAF4FA', surface: '#FFFFFF', soft: '#DCECF5', border: '#B9D4E4',
    text: '#173A50', muted: '#6A8291', accent: '#397FA8', accent2: '#68B6C8',
    warning: '#E5A944', success: '#4F9E8A', danger: '#E16F6F', track: '#D4E7F1', shadow: '#7695A8',
  },
  'WF2D-8620': {
    bg: '#071A1B', surface: '#102E2D', soft: '#153C39', border: '#2A5953',
    text: '#F0F7F3', muted: '#9BB6AF', accent: '#42D0AF', accent2: '#6CE0C3',
    warning: '#F0B85B', success: '#52C48A', danger: '#F0766B', track: '#234A46', shadow: '#000000',
  },
};

function createSereneTheme(preset) {
  const palette = DEVICE_THEMES[preset.model];
  return {
    id: `serene-${preset.model.toLowerCase()}`,
    displayName: `${preset.model} 自然舒适主题`,
    tokens: [
      { id: 'color.background', type: 'color', value: palette.bg },
      { id: 'color.surface', type: 'color', value: palette.surface },
      { id: 'color.surface.subtle', type: 'color', value: palette.soft },
      { id: 'color.border', type: 'color', value: palette.border },
      { id: 'color.text.primary', type: 'color', value: palette.text },
      { id: 'color.text.muted', type: 'color', value: palette.muted },
      { id: 'color.text.onaccent', type: 'color', value: '#FFFFFF' },
      { id: 'color.accent', type: 'color', value: palette.accent },
      { id: 'color.accent.strong', type: 'color', value: palette.accent2 },
      { id: 'color.status.warning', type: 'color', value: palette.warning },
      { id: 'color.status.success', type: 'color', value: palette.success },
      { id: 'color.status.danger', type: 'color', value: palette.danger },
      { id: 'color.track', type: 'color', value: palette.track },
      { id: 'color.shadow', type: 'color', value: palette.shadow },
    ],
  };
}

function baseStyle(node) {
  return node.styles?.find((entry) => !entry.selector || entry.selector.part === 'main');
}

function patchStyle(node, props) {
  if (!node) return;
  const style = baseStyle(node);
  if (style?.props) Object.assign(style.props, props);
}

function remapStyle(entry) {
  for (const [key, value] of Object.entries(entry.props ?? {})) {
    if (typeof value === 'string' && COLOR_MAP.has(value.toUpperCase())) {
      entry.props[key] = COLOR_MAP.get(value.toUpperCase());
    }
  }
  if ('shadow_opa' in (entry.props ?? {}) && entry.props.shadow_opa > 40) entry.props.shadow_opa = 24;
  if ('shadow_width' in (entry.props ?? {}) && entry.props.shadow_width > 0) {
    entry.props.shadow_width = Math.min(10, entry.props.shadow_width);
  }
}

function restyleNode(node) {
  for (const entry of node.styles ?? []) remapStyle(entry);
  if (node.type === 'obj' || node.type === 'button') {
    const style = baseStyle(node);
    if (style?.props && typeof style.props.radius === 'number' && style.props.radius > 0) {
      style.props.radius = Math.min(26, style.props.radius + 5);
    }
  }
  if (node.type === 'button') {
    const color = SOLID_BUTTONS.has(baseStyle(node)?.props?.bg_color) ? '#FFFFFF' : '#153C3A';
    for (const child of node.children ?? []) {
      if (child.type === 'label') patchStyle(child, { text_color: color });
    }
  }
  if (typeof node.props?.text === 'string') {
    node.props.text = node.props.text
      .replaceAll('CABIN STATUS', 'WELLNESS')
      .replaceAll('QUIET', 'CALM')
      .replaceAll('ppm / GOOD', 'ppm  GOOD')
      .replaceAll('END SESSION', 'COMPLETE');
  }
  for (const child of node.children ?? []) restyleNode(child);
}

function findNode(screen, codeName) {
  return screen.root.children.find((node) => node.codeName === codeName);
}

function findBrand(screen) {
  return findNode(screen, `${screen.codeName}_brand_logo`)
    ?? findNode(screen, `${screen.codeName}_brand`);
}

function setRect(node, x, y, width, height) {
  if (!node) return;
  Object.assign(node.props, { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
}

function scaleChildren(node, sx, sy) {
  for (const child of node.children ?? []) {
    for (const key of ['x', 'width']) {
      if (typeof child.props?.[key] === 'number') child.props[key] = Math.round(child.props[key] * sx);
    }
    for (const key of ['y', 'height']) {
      if (typeof child.props?.[key] === 'number') child.props[key] = Math.round(child.props[key] * sy);
    }
    scaleChildren(child, sx, sy);
  }
}

function fitNode(node, x, y, width, height) {
  if (!node) return;
  const oldWidth = Number(node.props.width) || width;
  const oldHeight = Number(node.props.height) || height;
  scaleChildren(node, width / oldWidth, height / oldHeight);
  setRect(node, x, y, width, height);
}

function setLabelColor(node, color) {
  for (const child of node.children ?? []) {
    if (child.type === 'label') patchStyle(child, { text_color: color });
  }
}

function walkNodes(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walkNodes(child, visit);
}

function applyDeviceTheme(screen, preset) {
  const theme = DEVICE_THEMES[preset.model];
  const replacements = new Map([
    ['#EEF7F3', theme.bg], ['#FFFFFF', theme.surface], ['#DFF1EA', theme.soft],
    ['#C9DED7', theme.border], ['#153C3A', theme.text], ['#66827D', theme.muted],
    ['#178A7E', theme.accent], ['#2BB7A3', theme.accent2], ['#E2A93B', theme.warning],
    ['#3BA77C', theme.success], ['#E46F61', theme.danger], ['#D6E8E2', theme.track],
    ['#C8DDD6', theme.track], ['#D7EEE7', theme.soft], ['#78908D', theme.shadow],
  ]);
  walkNodes(screen.root, (node) => {
    for (const entry of node.styles ?? []) {
      for (const [key, value] of Object.entries(entry.props ?? {})) {
        const next = typeof value === 'string' ? replacements.get(value.toUpperCase()) : undefined;
        if (next) entry.props[key] = next;
      }
    }
  });

  const prefix = screen.codeName;
  const rail = findNode(screen, `${prefix}_rail`);
  const brand = findBrand(screen);
  if (preset.model === 'WF2D-1030') {
    patchStyle(rail, { bg_color: '#234A35', border_color: '#234A35', radius: 10, shadow_width: 0 });
    patchStyle(brand, { text_color: '#F0C987' });
    ['home', 'air', 'light', 'focus', 'settings'].forEach((name) => {
      const button = findNode(screen, `${prefix}_nav_${name}`);
      const active = name === prefix;
      patchStyle(button, {
        bg_color: active ? '#F0C987' : '#315C43', border_color: active ? '#F0C987' : '#4F765E',
        radius: 8, shadow_width: 0,
      });
      setLabelColor(button, active ? '#23382A' : '#FFFDF7');
    });
    for (const child of screen.root.children) {
      if (child.type === 'obj' && child !== rail) patchStyle(child, { radius: 10, shadow_width: 0, border_width: 1 });
    }
  } else if (preset.model === 'WF2D-1050') {
    patchStyle(rail, { bg_color: '#F1D8B8', border_color: '#E1BD8F', radius: 30 });
    patchStyle(brand, { text_color: '#C96F43' });
    ['home', 'air', 'light', 'focus', 'settings'].forEach((name) => {
      const button = findNode(screen, `${prefix}_nav_${name}`);
      const active = name === prefix;
      patchStyle(button, {
        bg_color: active ? '#C96F43' : '#FFF8EE', border_color: active ? '#C96F43' : '#E5CBA3', radius: 24,
      });
      setLabelColor(button, active ? '#FFFDF8' : '#4A3426');
    });
    for (const child of screen.root.children) {
      if (child.type === 'obj' && child !== rail) patchStyle(child, { radius: 30, shadow_width: 8, shadow_opa: 16 });
    }
  } else if (preset.model === 'WF2D-8630') {
    patchStyle(brand, { text_color: '#397FA8' });
    ['home', 'air', 'light', 'focus', 'settings'].forEach((name) => {
      const button = findNode(screen, `${prefix}_nav_${name}`);
      if (!button) return;
      const active = name === prefix;
      patchStyle(button, {
        bg_color: active ? '#397FA8' : '#F7FBFE', border_color: '#B9D4E4', radius: 12,
      });
      setLabelColor(button, active ? '#FFFFFF' : '#173A50');
    });
    for (const child of screen.root.children) {
      if (child.type === 'obj') patchStyle(child, { radius: 18, border_width: 2, shadow_width: 6, shadow_opa: 16 });
    }
  } else if (preset.model === 'WF2D-8620') {
    walkNodes(screen.root, (node) => {
      if (node.type === 'button') patchStyle(node, { shadow_width: 0, border_color: '#2A5953' });
    });
  }
}

function layoutDock(screen, width, height, compact = false) {
  const prefix = screen.codeName;
  const rail = findNode(screen, `${prefix}_rail`);
  const dockX = compact ? 12 : 18;
  const dockH = compact ? 74 : 82;
  const dockY = height - dockH - (compact ? 8 : 12);
  const dockW = width - dockX * 2;
  setRect(rail, dockX, dockY, dockW, dockH);
  patchStyle(rail, {
    bg_color: '#FFFFFF', border_color: '#C9DED7', border_width: 1, radius: 26,
    shadow_color: '#78908D', shadow_width: 10, shadow_opa: 22, shadow_offset_y: 4,
  });
  const names = ['home', 'air', 'light', 'focus', 'settings'];
  const gap = compact ? 7 : 10;
  const buttonW = Math.floor((dockW - 20 - gap * 4) / 5);
  const buttonH = dockH - 16;
  names.forEach((name, index) => {
    const button = findNode(screen, `${prefix}_nav_${name}`);
    setRect(button, dockX + 10 + index * (buttonW + gap), dockY + 8, buttonW, buttonH);
    const active = name === prefix;
    patchStyle(button, {
      bg_color: active ? '#178A7E' : '#EEF7F3', border_color: active ? '#178A7E' : '#C9DED7',
      border_width: 1, radius: 20, shadow_width: active ? 8 : 0,
      shadow_color: '#178A7E', shadow_opa: active ? 24 : 0,
    });
    setLabelColor(button, active ? '#FFFFFF' : '#153C3A');
  });
  return { y: dockY, height: dockH };
}

function layoutHeader(screen, width, compact = false) {
  const prefix = screen.codeName;
  const top = compact ? 15 : 18;
  const brandX = compact ? 22 : 28;
  const brandSize = 32;
  const titleGap = compact ? 14 : 18;
  const titleX = brandX + brandSize + titleGap;
  const statusX = width - (compact ? 172 : 210);
  setRect(findBrand(screen), brandX, top + 5, brandSize, brandSize);
  setRect(findNode(screen, `${prefix}_title`), titleX, top + 4, statusX - titleX - 24, 36);
  const status = findNode(screen, `${prefix}_status`);
  if (status) {
    setRect(status, statusX, top + 7, compact ? 148 : 180, 30);
    patchStyle(status, { text_align: 'right' });
  }
}

function relayoutFocusCard(card) {
  if (!card) return;
  const w = Number(card.props.width);
  const h = Number(card.props.height);
  const compact = h <= 170;
  setRect(card.children.find((node) => node.codeName?.endsWith('_num')), 22, compact ? 12 : 18, Math.max(68, w - 44), 30);
  setRect(card.children.find((node) => node.codeName?.endsWith('_title')), 22, compact ? 46 : Math.round(h * 0.34), Math.max(100, w - 44), compact ? 30 : 44);
  setRect(card.children.find((node) => node.codeName?.endsWith('_time')), 22, compact ? 102 : Math.round(h * 0.62), Math.max(64, w - 178), 26);
  const start = card.children.find((node) => node.codeName?.endsWith('_start'));
  setRect(start, compact ? w - 120 : w - 142, h - 58, compact ? 98 : 120, 42);
  patchStyle(start, { radius: 18 });
}

function relayoutStatCard(card) {
  if (!card) return;
  const width = Number(card.props.width);
  const height = Number(card.props.height);
  const title = card.children.find((node) => node.codeName?.endsWith('_title'));
  const value = card.children.find((node) => node.codeName?.endsWith('_value'));
  const unit = card.children.find((node) => node.codeName?.endsWith('_unit'));
  setRect(title, 22, Math.max(14, Math.round(height * 0.10)), width - 44, 26);
  setRect(value, 22, Math.round(height * 0.38), width - 44, 38);
  setRect(unit, 22, height - 42, width - 44, 28);
}

function layoutBottomDockScreen(screen, preset) {
  const { width, height } = preset;
  const compact = height < 650;
  layoutHeader(screen, width, compact);
  const dock = layoutDock(screen, width, height, compact);
  const x = compact ? 20 : 24;
  const top = compact ? 70 : 78;
  const gap = compact ? 14 : 18;
  const bottom = dock.y - (compact ? 10 : 14);
  const contentW = width - x * 2;
  const contentH = bottom - top;
  const prefix = screen.codeName;

  if (prefix === 'home') {
    const heroW = Math.round(contentW * 0.40);
    const rightX = x + heroW + gap;
    const rightW = contentW - heroW - gap;
    const statsH = Math.round(contentH * 0.34);
    const hero = findNode(screen, 'home_hero');
    fitNode(hero, x, top, heroW, contentH);
    const heroArc = Math.min(240, heroW - 120);
    setRect(hero.children.find((node) => node.codeName === 'home_hero_kicker'), 32, 24, heroW - 64, 28);
    setRect(hero.children.find((node) => node.codeName === 'home_quiet_arc'), (heroW - heroArc) / 2, 76, heroArc, heroArc);
    setRect(hero.children.find((node) => node.codeName === 'home_quiet_state'), 54, 166, heroW - 108, 40);
    setRect(hero.children.find((node) => node.codeName === 'home_noise'), 64, 210, heroW - 128, 28);
    setRect(hero.children.find((node) => ['home_leave', 'home_end'].includes(node.codeName)), 74, contentH - 90, heroW - 148, 48);
    const statW = Math.floor((rightW - gap * 2) / 3);
    ['home_co2', 'home_temp', 'home_humidity'].forEach((name, index) => {
      const card = findNode(screen, name);
      fitNode(card, rightX + index * (statW + gap), top, statW, statsH);
      relayoutStatCard(card);
    });
    fitNode(findNode(screen, 'home_quick'), rightX, top + statsH + gap, rightW, contentH - statsH - gap);
    const quick = findNode(screen, 'home_quick');
    const quickH = contentH - statsH - gap;
    setRect(quick.children.find((node) => node.codeName === 'home_quick_title'), 32, 24, rightW - 64, 28);
    setRect(quick.children.find((node) => node.codeName === 'home_light_label'), 32, 78, 120, 28);
    setRect(quick.children.find((node) => node.codeName === 'home_light_switch'), 174, 68, 64, 38);
    setRect(quick.children.find((node) => node.codeName === 'home_fan_label'), rightW - 244, 78, 100, 28);
    setRect(quick.children.find((node) => node.codeName === 'home_fan_switch'), rightW - 104, 68, 64, 38);
    setRect(quick.children.find((node) => node.codeName === 'home_brightness_label'), 32, Math.min(146, quickH - 92), 180, 28);
    setRect(quick.children.find((node) => node.codeName === 'home_brightness'), 32, Math.min(190, quickH - 48), rightW - 64, 18);
  } else if (prefix === 'air') {
    const leftW = Math.round((contentW - gap) * 0.46);
    const quality = findNode(screen, 'air_quality');
    fitNode(quality, x, top, leftW, contentH);
    const arcSize = Math.min(300, leftW - 120, contentH - 150);
    setRect(quality.children.find((node) => node.codeName === 'air_quality_title'), 34, 24, leftW - 68, 28);
    setRect(quality.children.find((node) => node.codeName === 'air_co2_arc'), (leftW - arcSize) / 2, 78, arcSize, arcSize);
    setRect(quality.children.find((node) => node.codeName === 'air_co2_value'), 70, 184, leftW - 140, 44);
    setRect(quality.children.find((node) => node.codeName === 'air_co2_unit'), 70, 244, leftW - 140, 28);
    fitNode(findNode(screen, 'air_controls'), x + leftW + gap, top, contentW - leftW - gap, contentH);
  } else if (prefix === 'light') {
    const mainW = Math.round((contentW - gap) * 0.58);
    fitNode(findNode(screen, 'light_main'), x, top, mainW, contentH);
    fitNode(findNode(screen, 'light_scenes'), x + mainW + gap, top, contentW - mainW - gap, contentH);
  } else if (prefix === 'focus') {
    setRect(findNode(screen, 'focus_headline'), x + 4, top, contentW - 8, 34);
    const gridTop = top + 48;
    const cardW = Math.floor((contentW - gap) / 2);
    const cardH = Math.floor((contentH - 48 - gap) / 2);
    for (let index = 0; index < 4; index += 1) {
      const card = findNode(screen, `focus_mode_${index}`);
      fitNode(card, x + (index % 2) * (cardW + gap), gridTop + Math.floor(index / 2) * (cardH + gap), cardW, cardH);
      relayoutFocusCard(card);
    }
  } else if (prefix === 'settings') {
    const topH = Math.round(contentH * 0.34);
    const cardW = Math.floor((contentW - gap * 2) / 3);
    ['settings_dnd', 'settings_auto_light', 'settings_auto_vent'].forEach((name, index) => {
      fitNode(findNode(screen, name), x + index * (cardW + gap), top, cardW, topH);
    });
    const system = findNode(screen, 'settings_system');
    const systemH = contentH - topH - gap;
    fitNode(system, x, top + topH + gap, contentW, systemH);
    setRect(system.children.find((node) => node.codeName === 'settings_system_title'), 40, 24, 240, 28);
    setRect(system.children.find((node) => node.codeName === 'settings_device'), 40, 68, 260, 34);
    setRect(system.children.find((node) => node.codeName === 'settings_display'), 40, 110, 260, 28);
    setRect(system.children.find((node) => node.codeName === 'settings_firmware'), 360, 68, 260, 28);
    setRect(system.children.find((node) => node.codeName === 'settings_network'), 360, 110, 260, 28);
    setRect(system.children.find((node) => node.codeName === 'settings_restart'), 32, systemH - 64, contentW - 64, 48);
  }
}

function styleNavButton(button, active, radius = 20) {
  patchStyle(button, {
    bg_color: active ? '#178A7E' : '#EEF7F3',
    border_color: active ? '#178A7E' : '#C9DED7',
    border_width: 1,
    radius,
    shadow_width: active ? 8 : 0,
    shadow_color: '#178A7E',
    shadow_opa: active ? 24 : 0,
  });
  setLabelColor(button, active ? '#FFFFFF' : '#153C3A');
}

function layoutUltrawideSideScreen(screen, preset) {
  const { width, height } = preset;
  const prefix = screen.codeName;
  const rail = findNode(screen, `${prefix}_rail`);
  setRect(rail, 18, 18, 212, height - 36);
  patchStyle(rail, {
    bg_color: '#FFFFFF', border_color: '#C9DED7', border_width: 1, radius: 28,
    shadow_color: '#78908D', shadow_width: 10, shadow_opa: 22, shadow_offset_y: 4,
  });
  setRect(findBrand(screen), 108, 46, 32, 32);
  setRect(findNode(screen, `${prefix}_title`), 258, 26, 820, 40);
  const status = findNode(screen, `${prefix}_status`);
  setRect(status, width - 220, 30, 184, 32);
  patchStyle(status, { text_align: 'right' });

  ['home', 'air', 'light', 'focus', 'settings'].forEach((name, index) => {
    const button = findNode(screen, `${prefix}_nav_${name}`);
    setRect(button, 34, 132 + index * 102, 180, 78);
    styleNavButton(button, name === prefix, 22);
  });

  const x = 252;
  const top = 82;
  const gap = 18;
  const contentW = width - x - 24;
  const contentH = height - top - 24;
  if (prefix === 'home') {
    const leftW = 390;
    const heroW = 430;
    const statX = x + leftW + heroW + gap * 2;
    const statW = contentW - leftW - heroW - gap * 2;
    const quick = findNode(screen, 'home_quick');
    fitNode(quick, x, top, leftW, contentH);
    setRect(quick.children.find((node) => node.codeName === 'home_quick_title'), 28, 28, leftW - 56, 28);
    setRect(quick.children.find((node) => node.codeName === 'home_light_label'), 28, 118, 96, 28);
    setRect(quick.children.find((node) => node.codeName === 'home_light_switch'), 134, 106, 64, 42);
    setRect(quick.children.find((node) => node.codeName === 'home_fan_label'), 224, 118, 72, 28);
    setRect(quick.children.find((node) => node.codeName === 'home_fan_switch'), 300, 106, 64, 42);
    setRect(quick.children.find((node) => node.codeName === 'home_brightness_label'), 28, 250, 210, 28);
    setRect(quick.children.find((node) => node.codeName === 'home_brightness'), 28, 306, leftW - 56, 18);
    const hero = findNode(screen, 'home_hero');
    fitNode(hero, x + leftW + gap, top, heroW, contentH);
    setRect(hero.children.find((node) => node.codeName === 'home_hero_kicker'), 30, 24, heroW - 60, 28);
    setRect(hero.children.find((node) => node.codeName === 'home_quiet_arc'), 90, 86, 250, 250);
    setRect(hero.children.find((node) => node.codeName === 'home_quiet_state'), 70, 178, heroW - 140, 42);
    setRect(hero.children.find((node) => node.codeName === 'home_noise'), 80, 226, heroW - 160, 28);
    setRect(hero.children.find((node) => ['home_leave', 'home_end'].includes(node.codeName)), 78, contentH - 104, heroW - 156, 56);
    ['home_co2', 'home_temp', 'home_humidity'].forEach((name, index) => {
      const card = findNode(screen, name);
      fitNode(card, statX, top + index * 210, statW, 192);
      relayoutStatCard(card);
    });
  } else if (prefix === 'air') {
    const controlsW = 510;
    fitNode(findNode(screen, 'air_controls'), x, top, controlsW, contentH);
    fitNode(findNode(screen, 'air_quality'), x + controlsW + gap, top, contentW - controlsW - gap, contentH);
  } else if (prefix === 'light') {
    const scenesW = 390;
    fitNode(findNode(screen, 'light_scenes'), x, top, scenesW, contentH);
    fitNode(findNode(screen, 'light_main'), x + scenesW + gap, top, contentW - scenesW - gap, contentH);
  } else if (prefix === 'focus') {
    setRect(findNode(screen, 'focus_headline'), x + 4, top, contentW - 8, 36);
    const cardTop = top + 52;
    const cardW = Math.floor((contentW - gap * 3) / 4);
    for (let index = 0; index < 4; index += 1) {
      const card = findNode(screen, `focus_mode_${index}`);
      fitNode(card, x + index * (cardW + gap), cardTop, cardW, contentH - 52);
      relayoutFocusCard(card);
    }
  } else if (prefix === 'settings') {
    const systemW = 500;
    fitNode(findNode(screen, 'settings_system'), x, top, systemW, contentH);
    const rightX = x + systemW + gap;
    const rightW = contentW - systemW - gap;
    const cardH = Math.floor((contentH - gap * 2) / 3);
    ['settings_dnd', 'settings_auto_light', 'settings_auto_vent'].forEach((name, index) => {
      fitNode(findNode(screen, name), rightX, top + index * (cardH + gap), rightW, cardH);
    });
  }
}

function layoutCompactTopDockScreen(screen, preset) {
  const { width } = preset;
  const prefix = screen.codeName;
  setRect(findBrand(screen), 24, 17, 32, 32);
  setRect(findNode(screen, `${prefix}_title`), 180, 17, 560, 34);
  const status = findNode(screen, `${prefix}_status`);
  setRect(status, width - 174, 19, 150, 30);
  patchStyle(status, { text_align: 'right' });

  const rail = findNode(screen, `${prefix}_rail`);
  setRect(rail, 18, 62, width - 36, 76);
  patchStyle(rail, {
    bg_color: '#FFFFFF', border_color: '#C9DED7', border_width: 1, radius: 24,
    shadow_color: '#78908D', shadow_width: 8, shadow_opa: 20, shadow_offset_y: 3,
  });
  const gap = 8;
  const buttonW = Math.floor((width - 56 - gap * 4) / 5);
  ['home', 'air', 'light', 'focus', 'settings'].forEach((name, index) => {
    const button = findNode(screen, `${prefix}_nav_${name}`);
    setRect(button, 28 + index * (buttonW + gap), 70, buttonW, 60);
    styleNavButton(button, name === prefix, 18);
  });

  const x = 20;
  const top = 152;
  const contentW = width - 40;
  const contentH = 428;
  if (prefix === 'home') {
    const statW = 150;
    const heroW = 340;
    ['home_co2', 'home_temp', 'home_humidity'].forEach((name, index) => {
      const card = findNode(screen, name);
      fitNode(card, x, top + index * 146, statW, 134);
      relayoutStatCard(card);
    });
    const hero = findNode(screen, 'home_hero');
    fitNode(hero, x + statW + 14, top, heroW, contentH);
    setRect(hero.children.find((node) => node.codeName === 'home_hero_kicker'), 28, 22, heroW - 56, 28);
    setRect(hero.children.find((node) => node.codeName === 'home_quiet_arc'), 75, 62, 190, 190);
    setRect(hero.children.find((node) => node.codeName === 'home_quiet_state'), 54, 128, heroW - 108, 40);
    setRect(hero.children.find((node) => node.codeName === 'home_noise'), 64, 174, heroW - 128, 28);
    setRect(hero.children.find((node) => ['home_leave', 'home_end'].includes(node.codeName)), 62, contentH - 74, heroW - 124, 48);
    const quick = findNode(screen, 'home_quick');
    const quickW = contentW - statW - heroW - 28;
    fitNode(quick, x + statW + heroW + 28, top, quickW, contentH);
    setRect(quick.children.find((node) => node.codeName === 'home_quick_title'), 26, 28, quickW - 52, 30);
    setRect(quick.children.find((node) => node.codeName === 'home_light_label'), 28, 98, 126, 28);
    setRect(quick.children.find((node) => node.codeName === 'home_light_switch'), 158, 88, 64, 38);
    setRect(quick.children.find((node) => node.codeName === 'home_fan_label'), quickW - 202, 98, 108, 28);
    setRect(quick.children.find((node) => node.codeName === 'home_fan_switch'), quickW - 88, 88, 64, 38);
    setRect(quick.children.find((node) => node.codeName === 'home_brightness_label'), 28, 202, 180, 28);
    setRect(quick.children.find((node) => node.codeName === 'home_brightness'), 28, 250, quickW - 56, 18);
  } else if (prefix === 'air') {
    const quality = findNode(screen, 'air_quality');
    fitNode(quality, x, top, contentW, 196);
    setRect(quality.children.find((node) => node.codeName === 'air_quality_title'), 34, 18, 260, 28);
    setRect(quality.children.find((node) => node.codeName === 'air_co2_arc'), 250, 42, 124, 124);
    setRect(quality.children.find((node) => node.codeName === 'air_co2_value'), 440, 54, 190, 46);
    setRect(quality.children.find((node) => node.codeName === 'air_co2_unit'), 440, 108, 190, 28);
    const controls = findNode(screen, 'air_controls');
    fitNode(controls, x, top + 210, contentW, 218);
    setRect(controls.children.find((node) => node.codeName === 'air_fan_title'), 36, 18, 260, 28);
    setRect(controls.children.find((node) => node.codeName === 'air_fan_toggle'), contentW - 104, 14, 64, 38);
    setRect(controls.children.find((node) => node.codeName === 'air_fan_speed_label'), 36, 62, 180, 26);
    setRect(controls.children.find((node) => node.codeName === 'air_fan_speed_value'), contentW - 120, 58, 80, 28);
    setRect(controls.children.find((node) => node.codeName === 'air_fan_speed'), 36, 92, contentW - 76, 16);
    setRect(controls.children.find((node) => node.codeName === 'air_auto_title'), 36, 126, 250, 28);
    setRect(controls.children.find((node) => node.codeName === 'air_vent_toggle'), 306, 120, 64, 38);
    setRect(controls.children.find((node) => node.codeName === 'air_schedule'), 36, 166, 390, 26);
    setRect(controls.children.find((node) => node.codeName === 'air_boost'), contentW - 410, 154, 370, 48);
  } else if (prefix === 'light') {
    const main = findNode(screen, 'light_main');
    fitNode(main, x, top, contentW, 258);
    setRect(main.children.find((node) => node.codeName === 'light_main_title'), 40, 18, 300, 30);
    setRect(main.children.find((node) => node.codeName === 'light_master'), contentW - 104, 14, 64, 38);
    setRect(main.children.find((node) => node.codeName === 'light_brightness_title'), 40, 62, 250, 26);
    setRect(main.children.find((node) => node.codeName === 'light_brightness_value'), 40, 90, 140, 38);
    setRect(main.children.find((node) => node.codeName === 'light_brightness_control'), 190, 102, contentW - 230, 16);
    setRect(main.children.find((node) => node.codeName === 'light_cct_title'), 40, 150, 300, 26);
    setRect(main.children.find((node) => node.codeName === 'light_cct_value'), 40, 178, 140, 34);
    setRect(main.children.find((node) => node.codeName === 'light_cct_control'), 190, 188, contentW - 230, 16);
    const scenes = findNode(screen, 'light_scenes');
    fitNode(scenes, x, top + 272, contentW, 156);
    setRect(scenes.children.find((node) => node.codeName === 'light_scenes_title'), 24, 14, contentW - 48, 30);
    ['work', 'call', 'relax', 'off'].forEach((name, index) => {
      const buttonW = Math.floor((contentW - 84) / 4);
      setRect(scenes.children.find((node) => node.codeName === `light_scene_${name}`), 24 + index * (buttonW + 12), 62, buttonW, 58);
    });
  } else if (prefix === 'focus') {
    setRect(findNode(screen, 'focus_headline'), x + 4, top, contentW - 8, 32);
    const cardTop = top + 46;
    const cardW = Math.floor((contentW - 42) / 4);
    for (let index = 0; index < 4; index += 1) {
      const card = findNode(screen, `focus_mode_${index}`);
      fitNode(card, x + index * (cardW + 14), cardTop, cardW, contentH - 46);
      relayoutFocusCard(card);
    }
  } else if (prefix === 'settings') {
    const cardW = Math.floor((contentW - 14) / 2);
    const cardH = 196;
    fitNode(findNode(screen, 'settings_dnd'), x, top, cardW, cardH);
    fitNode(findNode(screen, 'settings_auto_light'), x + cardW + 14, top, cardW, cardH);
    fitNode(findNode(screen, 'settings_auto_vent'), x, top + cardH + 14, cardW, cardH);
    const system = findNode(screen, 'settings_system');
    fitNode(system, x + cardW + 14, top + cardH + 14, cardW, cardH);
    setRect(system.children.find((node) => node.codeName === 'settings_system_title'), 30, 14, 180, 26);
    setRect(system.children.find((node) => node.codeName === 'settings_device'), 30, 44, 190, 30);
    setRect(system.children.find((node) => node.codeName === 'settings_display'), 30, 76, 190, 26);
    setRect(system.children.find((node) => node.codeName === 'settings_firmware'), 250, 44, 200, 26);
    setRect(system.children.find((node) => node.codeName === 'settings_network'), 250, 76, 200, 26);
    setRect(system.children.find((node) => node.codeName === 'settings_restart'), cardW - 224, cardH - 62, 200, 46);
  }
}

function layoutWideScreen(screen, preset) {
  if (preset.model === 'WF2D-1030') layoutUltrawideSideScreen(screen, preset);
  else if (preset.model === 'WF2D-1050') layoutCompactTopDockScreen(screen, preset);
  else layoutBottomDockScreen(screen, preset);
}

function layoutSquareScreen(screen) {
  const prefix = screen.codeName;
  setRect(findBrand(screen), 18, 15, 32, 32);
  setRect(findNode(screen, `${prefix}_title`), 198, 16, 264, 32);
  const names = ['home', 'air', 'light', 'focus', 'settings'];
  names.forEach((name, index) => {
    const button = findNode(screen, `${prefix}_nav_${name}`);
    setRect(button, 8 + index * 93, 420, 88, 52);
    const active = name === prefix;
    patchStyle(button, {
      bg_color: active ? '#178A7E' : '#FFFFFF', border_color: '#C9DED7', border_width: 1,
      radius: 18, shadow_width: active ? 7 : 0, shadow_color: '#178A7E', shadow_opa: active ? 22 : 0,
    });
    setLabelColor(button, active ? '#FFFFFF' : '#153C3A');
  });
  const x = 18;
  const top = 58;
  const gap = 12;
  const contentW = 444;
  if (prefix === 'home') {
    const hero = findNode(screen, 'home_hero');
    fitNode(hero, x, top, contentW, 206);
    setRect(hero.children.find((node) => node.codeName === 'home_hero_kicker'), 22, 16, 180, 26);
    setRect(hero.children.find((node) => node.codeName === 'home_quiet_arc'), 92, 28, 124, 124);
    setRect(hero.children.find((node) => node.codeName === 'home_quiet'), 220, 58, 132, 34);
    setRect(hero.children.find((node) => node.codeName === 'home_noise'), 220, 104, 132, 26);
    setRect(hero.children.find((node) => ['home_leave', 'home_end'].includes(node.codeName)), 68, 154, 308, 44);
    const statW = 140;
    ['home_co2', 'home_temp', 'home_humidity'].forEach((name, index) => {
      const card = findNode(screen, name);
      fitNode(card, x + index * (statW + gap), top + 218, statW, 130);
      relayoutStatCard(card);
      const title = card.children.find((node) => node.codeName?.endsWith('_title'));
      if (title) title.props.width = 112;
    });
    const humidityTitle = findNode(screen, 'home_humidity')?.children.find((node) => node.codeName === 'home_humidity_title');
    if (humidityTitle) humidityTitle.props.text = 'HUMIDITY';
  } else if (prefix === 'air') {
    const quality = findNode(screen, 'air_quality');
    fitNode(quality, x, top, contentW, 190);
    setRect(quality.children.find((node) => node.codeName === 'air_co2_arc'), 42, 26, 130, 130);
    setRect(quality.children.find((node) => node.codeName === 'air_co2'), 210, 34, 188, 38);
    setRect(quality.children.find((node) => node.codeName === 'air_ppm'), 210, 72, 188, 26);
    setRect(quality.children.find((node) => node.codeName === 'air_temp'), 210, 108, 188, 26);
    setRect(quality.children.find((node) => node.codeName === 'air_hum'), 210, 142, 188, 26);
    const control = findNode(screen, 'air_control');
    fitNode(control, x, top + 202, contentW, 146);
    setRect(control.children.find((node) => node.codeName === 'air_fan_title'), 24, 14, 180, 26);
    setRect(control.children.find((node) => node.codeName === 'air_fan'), 354, 10, 58, 32);
    setRect(control.children.find((node) => node.codeName === 'air_speed_value'), 24, 48, 100, 30);
    setRect(control.children.find((node) => node.codeName === 'air_speed'), 126, 56, 286, 14);
    setRect(control.children.find((node) => node.codeName === 'air_auto'), 24, 92, 130, 26);
    setRect(control.children.find((node) => node.codeName === 'air_vent'), 166, 88, 58, 32);
    setRect(control.children.find((node) => node.codeName === 'air_boost'), 244, 86, 168, 42);
  } else if (prefix === 'light') {
    fitNode(findNode(screen, 'light_main'), x, top, contentW, 348);
  } else if (prefix === 'focus') {
    setRect(findNode(screen, 'focus_prompt'), x + 4, top, contentW - 8, 28);
    const cardW = 216;
    const cardH = 148;
    for (let index = 0; index < 4; index += 1) {
      const card = findNode(screen, `focus_mode_${index}`);
      fitNode(card, x + (index % 2) * (cardW + gap), top + 34 + Math.floor(index / 2) * (cardH + gap), cardW, cardH);
      relayoutFocusCard(card);
    }
  } else if (prefix === 'settings') {
    ['settings_dnd', 'settings_auto_light', 'settings_auto_vent'].forEach((name, index) => {
      fitNode(findNode(screen, name), x, top + index * 82, contentW, 70);
    });
    fitNode(findNode(screen, 'settings_device'), x, top + 246, contentW, 102);
  }
}

function layoutRoundScreen(screen) {
  const prefix = screen.codeName;
  const title = findNode(screen, `${prefix}_page_title`);
  setRect(title, 70, 14, 100, 32);
  patchStyle(title, { text_align: 'center' });
  const back = findNode(screen, `${prefix}_back`);
  const next = findNode(screen, `${prefix}_next`);
  const home = findNode(screen, `${prefix}_home`);
  if (back) setRect(back, 40, 174, 48, 48);
  if (next) setRect(next, 152, 174, 48, 48);
  if (home) setRect(home, 152, 174, 48, 48);
  for (const button of [back, next, home].filter(Boolean)) {
    patchStyle(button, { bg_color: '#FFFFFF', border_color: '#C9DED7', border_width: 1, radius: 24 });
    setLabelColor(button, '#153C3A');
  }
  if (prefix === 'home') {
    title.props.text = '';
    setRect(title, 96, 16, 48, 32);
    if (next) {
      next.codeName = 'home_feature_card';
      next.props = { x: 45, y: 48, width: 150, height: 116 };
      next.styles = [
        { props: { bg_opa: 0, border_width: 0, shadow_width: 0, radius: 58, pad_all: 0 } },
        { selector: { states: ['pressed'] }, props: { bg_opa: 0 } },
      ];
      next.children = [];
      const currentIndex = screen.root.children.indexOf(next);
      if (currentIndex >= 0) screen.root.children.splice(currentIndex, 1);
      const startIndex = screen.root.children.findIndex((node) => node.codeName === 'home_start');
      screen.root.children.splice(startIndex >= 0 ? startIndex : screen.root.children.length, 0, next);
    }
    setRect(findNode(screen, 'home_quiet_arc'), 58, 54, 124, 124);
    setRect(findNode(screen, 'home_quiet'), 60, 86, 120, 28);
    setRect(findNode(screen, 'home_noise'), 70, 118, 100, 24);
    setRect(findNode(screen, 'home_air'), 64, 144, 112, 22);
    setRect(findNode(screen, 'home_start'), 76, 170, 88, 42);
  } else if (prefix === 'air') {
    setRect(findNode(screen, 'air_co2_arc'), 58, 48, 124, 124);
    setRect(findNode(screen, 'air_co2'), 68, 80, 104, 28);
    setRect(findNode(screen, 'air_ppm'), 72, 108, 96, 22);
    setRect(findNode(screen, 'air_quality'), 84, 130, 72, 22);
    setRect(findNode(screen, 'air_fan'), 48, 152, 144, 20);
    setRect(findNode(screen, 'air_speed'), 74, 174, 92, 8);
  } else if (prefix === 'light') {
    setRect(findNode(screen, 'light_brightness_arc'), 66, 46, 108, 108);
    setRect(findNode(screen, 'light_value'), 65, 82, 110, 28);
    setRect(findNode(screen, 'light_cct_value'), 65, 116, 110, 24);
    setRect(findNode(screen, 'light_master_label'), 50, 154, 82, 18);
    setRect(findNode(screen, 'light_master'), 136, 140, 64, 34);
  } else if (prefix === 'focus') {
    setRect(findNode(screen, 'focus_prompt'), 60, 52, 120, 24);
    setRect(findNode(screen, 'focus_deep'), 38, 78, 78, 44);
    setRect(findNode(screen, 'focus_meet'), 124, 78, 78, 44);
    setRect(findNode(screen, 'focus_call'), 38, 128, 78, 44);
    setRect(findNode(screen, 'focus_reset'), 124, 128, 78, 44);
    setRect(findNode(screen, 'focus_time'), 88, 176, 64, 22);
  } else if (prefix === 'settings') {
    const rows = [
      ['settings_dnd_label', 'settings_dnd'], ['settings_vent_label', 'settings_vent'],
      ['settings_light_label', 'settings_light'],
    ];
    rows.forEach(([labelName, switchName], index) => {
      setRect(findNode(screen, labelName), 42, 46 + index * 34, 96, 22);
      setRect(findNode(screen, switchName), 142, 46 + index * 34, 54, 28);
    });
    setRect(findNode(screen, 'settings_version'), 58, 146, 124, 22);
  }
}

function transformSnapshot(source, preset) {
  const snapshot = structuredClone(source);
  const sourceThemeId = snapshot.buildTarget.themeRef.match(/#theme:(.+)$/)?.[1]
    ?? snapshot.uiProject.themes[0]?.id;
  if (sourceThemeId) materializeProjectTheme(snapshot.uiProject, sourceThemeId);
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
    if (preset.layout === 'landscape' || preset.layout === 'ultrawide') layoutWideScreen(screen, preset);
    else if (preset.layout === 'square') layoutSquareScreen(screen);
    else layoutRoundScreen(screen);
    applyDeviceTheme(screen, preset);
  }
  const sereneTheme = createSereneTheme(preset);
  tokenizeProjectTheme(snapshot.uiProject, sereneTheme);
  snapshot.buildTarget.id = `target:${slug}`;
  snapshot.buildTarget.revision = 1;
  snapshot.buildTarget.displayName = `${preset.model} 自然舒适舱目标`;
  snapshot.buildTarget.uiProjectRef = `${uiId}@1`;
  snapshot.buildTarget.themeRef = `${uiId}@1#theme:${sereneTheme.id}`;
  snapshot.migrationNotes = [
    ...(snapshot.migrationNotes ?? []).filter((note) => note.code !== 'semantic-theme'),
    { severity: 'info', code: 'serene-device-layout-v2', path: 'uiProject.screens',
      message: `${preset.model} 使用自然舒适舱独立视觉体系与大触控布局。` },
    { severity: 'info', code: 'semantic-theme', path: 'uiProject.themes',
      message: `${preset.model} 的颜色、阴影、边框和文字字体已绑定自然舒适主题 Token。` },
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
