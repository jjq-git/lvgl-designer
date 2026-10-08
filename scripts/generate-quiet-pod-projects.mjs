import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUTPUT_DIR = resolve('examples/quiet-pod');
const NOW = '2026-10-08T00:00:00.000Z';

const COLORS = {
  canvas: '#06101E',
  rail: '#0A1728',
  card: '#102238',
  card2: '#0C1B2E',
  line: '#203852',
  text: '#F4F8FC',
  muted: '#8FA7BD',
  cyan: '#32D6C6',
  blue: '#3B82F6',
  amber: '#F5B942',
  green: '#51D88A',
  red: '#FF6B6B',
};

const PRESETS = [
  {
    model: 'WF2D-8620', width: 240, height: 240, shape: 'round', layout: 'round', title: '1.28 inch round',
    frame: { width: 86, height: 86, aperture: { x: 0.234302, y: 0.234302, width: 0.531395, height: 0.531395 } },
  },
  {
    model: 'WF2D-1040', width: 1080, height: 720, shape: 'rect', layout: 'landscape', title: '6.1 inch landscape',
    frame: { width: 159, height: 97, aperture: { x: 0.086415094, y: 0.087731959, width: 0.827169811, height: 0.824536082 } },
  },
  {
    model: 'WF2D-1030', width: 1440, height: 720, shape: 'rect', layout: 'ultrawide', title: '5.9 inch ultra-wide',
    frame: { width: 159, height: 97, aperture: { x: 0.076257862, y: 0.149278351, width: 0.847484277, height: 0.701443299 } },
  },
  {
    model: 'WF2D-1050', width: 1024, height: 600, shape: 'rect', layout: 'landscape', title: '7 inch landscape',
    frame: { width: 179, height: 113, aperture: { x: 0.06924581, y: 0.119823009, width: 0.86150838, height: 0.760353982 } },
  },
  {
    model: 'WF2D-8630', width: 480, height: 480, shape: 'rect', layout: 'square', title: '3.95 inch square demo',
    frame: { width: 86, height: 86, aperture: { x: 0.0865735, y: 0.0865735, width: 0.826853, height: 0.826853 } },
  },
];

let idCounter = 0;
function id() {
  idCounter += 1;
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`;
}

function style(props, selector) {
  return selector ? { selector, props } : { props };
}

function previewFont(value, fallback) {
  const token = value ?? fallback;
  const match = /^montserrat_(\d+)$/.exec(token);
  if (!match) return token;
  const requested = Number(match[1]);
  const supported = Math.max(8, Math.min(48, Math.round(requested / 2) * 2));
  return `montserrat_${supported}`;
}

function node(type, options = {}) {
  return {
    id: id(),
    type,
    ...(options.name ? { name: options.name } : {}),
    ...(options.displayName ? { displayName: options.displayName } : {}),
    props: options.props ?? {},
    ...(options.flags ? { flags: options.flags } : {}),
    ...(options.states ? { states: options.states } : {}),
    styles: [],
    inlineStyles: options.inlineStyles ?? [],
    events: options.events ?? [],
    bindings: options.bindings ?? [],
    children: options.children ?? [],
  };
}

function box(screen, key, x, y, width, height, options = {}) {
  return node('obj', {
    name: `${screen}_${key}`,
    displayName: options.displayName,
    props: { x, y, width, height },
    flags: { scrollable: false },
    inlineStyles: [style({
      bg_color: options.color ?? COLORS.card,
      bg_opa: options.opa ?? 255,
      border_color: options.border ?? COLORS.line,
      border_width: options.borderWidth ?? 1,
      radius: options.radius ?? 18,
      pad_all: 0,
      ...(options.shadow ? {
        shadow_color: '#000000', shadow_width: 18, shadow_opa: 90,
        shadow_offset_y: 6,
      } : {}),
    })],
    children: options.children ?? [],
  });
}

function label(screen, key, text, x, y, width, options = {}) {
  return node('label', {
    name: `${screen}_${key}`,
    displayName: options.displayName,
    props: {
      text,
      x,
      y,
      width,
      height: options.height ?? 'content',
    },
    inlineStyles: [style({
      text_color: options.color ?? COLORS.text,
      text_font: previewFont(options.font, 'montserrat_18'),
      text_align: options.align ?? 'left',
      text_opa: options.opa ?? 255,
    })],
    bindings: options.binding ? [{ kind: 'prop', prop: 'text', ...options.binding }] : [],
  });
}

function button(screen, key, text, x, y, width, height, options = {}) {
  const btn = node('button', {
    name: `${screen}_${key}`,
    displayName: options.displayName,
    props: { x, y, width, height },
    flags: { scrollable: false, ...(options.checkable ? { checkable: true } : {}) },
    inlineStyles: [
      style({
        bg_color: options.color ?? COLORS.blue,
        bg_opa: 255,
        border_width: options.borderWidth ?? 0,
        border_color: options.border ?? COLORS.line,
        radius: options.radius ?? Math.min(18, Math.round(height / 2)),
        shadow_width: options.shadow === false ? 0 : 10,
        shadow_color: options.color ?? COLORS.blue,
        shadow_opa: options.shadow === false ? 0 : 55,
        pad_all: 0,
      }),
      ...(options.checkable ? [style({ bg_color: COLORS.cyan }, { states: ['checked'] })] : []),
      style({ bg_color: options.pressedColor ?? COLORS.cyan }, { states: ['pressed'] }),
    ],
    events: options.events ?? [],
    children: [node('label', {
      name: `${screen}_${key}_text`,
      props: { text, align: 'center', width: '100%', height: 'content' },
      inlineStyles: [style({
        text_color: options.textColor ?? COLORS.text,
        text_font: previewFont(options.font, 'montserrat_16'),
        text_align: 'center',
      })],
    })],
  });
  return btn;
}

function toggle(screen, key, subject, x, y, width = 58, height = 30) {
  return node('switch', {
    name: `${screen}_${key}`,
    props: { x, y, width, height },
    inlineStyles: [
      style({ bg_color: '#32465A', bg_opa: 255, radius: 20 }, { part: 'main' }),
      style({ bg_color: COLORS.cyan, bg_opa: 255, radius: 20 }, { part: 'indicator', states: ['checked'] }),
      style({ bg_color: '#FFFFFF', bg_opa: 255, radius: 20 }, { part: 'knob' }),
    ],
    events: [{ kind: 'subject_toggle', trigger: 'value_changed', subject }],
    bindings: [{ kind: 'prop', prop: 'checked', subject }],
  });
}

function slider(screen, key, subject, x, y, width, value, options = {}) {
  return node('slider', {
    name: `${screen}_${key}`,
    props: {
      x, y, width, height: options.height ?? 14,
      min_value: options.min ?? 0,
      max_value: options.max ?? 100,
      value,
    },
    inlineStyles: [
      style({ bg_color: '#29425A', bg_opa: 255, radius: 10 }, { part: 'main' }),
      style({ bg_color: options.color ?? COLORS.cyan, bg_opa: 255, radius: 10 }, { part: 'indicator' }),
      style({ bg_color: '#FFFFFF', bg_opa: 255, radius: 12, shadow_width: 8, shadow_opa: 70 }, { part: 'knob' }),
    ],
    bindings: [{ kind: 'prop', prop: 'value', subject }],
  });
}

function meterArc(screen, key, subject, x, y, size, value, options = {}) {
  return node('arc', {
    name: `${screen}_${key}`,
    props: {
      x, y, width: size, height: size,
      min_value: options.min ?? 0,
      max_value: options.max ?? 100,
      value,
      bg_start_angle: options.start ?? 135,
      bg_end_angle: options.end ?? 45,
      start_angle: options.start ?? 135,
      end_angle: options.end ?? 45,
      knob_offset: -3,
    },
    inlineStyles: [
      style({ arc_color: '#263C52', arc_width: options.arcWidth ?? 12 }, { part: 'main' }),
      style({ arc_color: options.color ?? COLORS.cyan, arc_width: options.arcWidth ?? 12 }, { part: 'indicator' }),
      style({ bg_color: options.color ?? COLORS.cyan, bg_opa: 255, radius: 12 }, { part: 'knob' }),
    ],
    bindings: [{ kind: 'prop', prop: 'value', subject }],
  });
}

function progress(screen, key, subject, x, y, width, value, color = COLORS.cyan) {
  return node('bar', {
    name: `${screen}_${key}`,
    props: { x, y, width, height: 10, min_value: 0, max_value: 100, value },
    inlineStyles: [
      style({ bg_color: '#29425A', bg_opa: 255, radius: 8 }, { part: 'main' }),
      style({ bg_color: color, bg_opa: 255, radius: 8 }, { part: 'indicator' }),
    ],
    bindings: [{ kind: 'prop', prop: 'value', subject }],
  });
}

function navEvent(screenId, anim = 'fade_on') {
  return [{ kind: 'screen_load', trigger: 'clicked', screenId, animType: anim, duration: 180, delay: 0 }];
}

function rootNode(children) {
  return node('obj', {
    props: {},
    flags: { scrollable: false },
    inlineStyles: [style({ bg_color: COLORS.canvas, bg_opa: 255, border_width: 0, pad_all: 0 })],
    children,
  });
}

function createScreen(codeName, displayName, isHome, children) {
  return {
    id: id(),
    name: codeName,
    displayName,
    isHome,
    styles: [],
    consts: [],
    root: rootNode(children),
  };
}

function subjects() {
  return [
    { name: 'pod_mode', type: 'int', initial: 0, min: 0, max: 3 },
    { name: 'pod_occupied', type: 'int', initial: 1, min: 0, max: 1 },
    { name: 'light_enabled', type: 'int', initial: 1, min: 0, max: 1 },
    { name: 'light_brightness', type: 'int', initial: 68, min: 0, max: 100 },
    { name: 'light_cct', type: 'int', initial: 4200, min: 2700, max: 6500 },
    { name: 'fan_enabled', type: 'int', initial: 1, min: 0, max: 1 },
    { name: 'fan_speed', type: 'int', initial: 36, min: 0, max: 100 },
    { name: 'vent_enabled', type: 'int', initial: 1, min: 0, max: 1 },
    { name: 'dnd_enabled', type: 'int', initial: 1, min: 0, max: 1 },
    { name: 'co2_level', type: 'int', initial: 586, min: 350, max: 2000 },
    { name: 'noise_level', type: 'int', initial: 32, min: 20, max: 90 },
    { name: 'temperature', type: 'int', initial: 24, min: 10, max: 40 },
    { name: 'humidity', type: 'int', initial: 46, min: 0, max: 100 },
  ];
}

const PAGE_KEYS = ['home', 'air', 'light', 'focus', 'settings'];
const PAGE_LABELS = ['HOME', 'AIR', 'LIGHT', 'FOCUS', 'SET'];

function addRectShell(screen, active, width, height, screenIds, options = {}) {
  const railW = options.railW ?? Math.round(width * 0.155);
  const topH = options.topH ?? Math.round(height * 0.13);
  const children = [
    box(screen, 'rail', 0, 0, railW, height, { color: COLORS.rail, borderWidth: 0, radius: 0 }),
    label(screen, 'brand', 'QUIET\nPOD', Math.round(railW * 0.18), Math.round(topH * 0.25), Math.round(railW * 0.65), {
      font: width > 1200 ? 'montserrat_28' : 'montserrat_24', color: COLORS.cyan, height: 70,
    }),
    label(screen, 'title', PAGE_LABELS[active], railW + 34, Math.round(topH * 0.32), width - railW - 230, {
      font: width > 1200 ? 'montserrat_32' : 'montserrat_28',
    }),
    label(screen, 'status', 'ONLINE  |  09:41', width - 210, Math.round(topH * 0.4), 180, {
      font: 'montserrat_14', color: COLORS.muted, align: 'right',
    }),
  ];

  const navY = Math.round(topH * 1.45);
  const gap = Math.round((height - navY - 48) / PAGE_KEYS.length);
  PAGE_KEYS.forEach((key, index) => {
    children.push(button(screen, `nav_${key}`, PAGE_LABELS[index], 18, navY + index * gap, railW - 36, Math.min(54, gap - 12), {
      color: index === active ? COLORS.blue : COLORS.rail,
      borderWidth: index === active ? 0 : 1,
      border: index === active ? COLORS.blue : COLORS.line,
      shadow: index === active,
      font: 'montserrat_14',
      events: navEvent(screenIds[index]),
    }));
  });
  return { children, contentX: railW + 34, contentY: topH, contentW: width - railW - 68, contentH: height - topH - 28 };
}

function statCard(screen, key, title, value, unit, x, y, width, height, color) {
  return box(screen, key, x, y, width, height, {
    shadow: true,
    children: [
      label(screen, `${key}_title`, title, 22, 18, width - 44, { color: COLORS.muted, font: 'montserrat_14' }),
      label(screen, `${key}_value`, value, 22, Math.round(height * 0.42), width - 44, { color, font: 'montserrat_30' }),
      label(screen, `${key}_unit`, unit, 22, height - 34, width - 44, { color: COLORS.muted, font: 'montserrat_12' }),
    ],
  });
}

function buildRectScreens(preset, screenIds) {
  const { width, height } = preset;
  const ratio = width / 1080;
  const compact = height <= 600;
  const layouts = [];

  // HOME
  {
    const shell = addRectShell('home', 0, width, height, screenIds);
    const { contentX: x, contentY: y, contentW: w, contentH: h } = shell;
    const gap = Math.max(16, Math.round(18 * ratio));
    const heroW = Math.round(w * 0.43);
    const statW = Math.floor((w - heroW - gap * 3) / 3);
    const heroH = h - (compact ? 24 : 36);
    shell.children.push(box('home', 'hero', x, y + 8, heroW, heroH, {
      color: COLORS.card2, shadow: true,
      children: [
        label('home', 'hero_kicker', 'CABIN STATUS', 28, 24, heroW - 56, { color: COLORS.muted, font: 'montserrat_14' }),
        meterArc('home', 'quiet_arc', 'fan_speed', Math.round(heroW / 2 - (compact ? 95 : 115)), compact ? 68 : 78, compact ? 190 : 230, 36, { color: COLORS.cyan, arcWidth: compact ? 14 : 18 }),
        label('home', 'quiet_state', 'QUIET', Math.round(heroW * 0.18), compact ? 132 : 158, Math.round(heroW * 0.64), { font: compact ? 'montserrat_28' : 'montserrat_36', align: 'center' }),
        label('home', 'noise', '32 dB', Math.round(heroW * 0.22), compact ? 174 : 206, Math.round(heroW * 0.56), { color: COLORS.cyan, font: 'montserrat_18', align: 'center' }),
        button('home', 'leave', 'END SESSION', Math.round(heroW * 0.18), heroH - (compact ? 82 : 96), Math.round(heroW * 0.64), 50, { color: COLORS.red, font: 'montserrat_14' }),
      ],
    }));
    const statsX = x + heroW + gap;
    shell.children.push(statCard('home', 'co2', 'CO2', '586', 'ppm / GOOD', statsX, y + 8, statW, Math.round(heroH * 0.47), COLORS.green));
    shell.children.push(statCard('home', 'temp', 'TEMP', '24.2', 'deg C', statsX + statW + gap, y + 8, statW, Math.round(heroH * 0.47), COLORS.amber));
    shell.children.push(statCard('home', 'humidity', 'HUMIDITY', '46', 'percent', statsX + (statW + gap) * 2, y + 8, statW, Math.round(heroH * 0.47), COLORS.blue));
    const quickY = y + 8 + Math.round(heroH * 0.47) + gap;
    const quickW = w - heroW - gap;
    shell.children.push(box('home', 'quick', statsX, quickY, quickW, heroH - Math.round(heroH * 0.47) - gap, {
      children: [
        label('home', 'quick_title', 'QUICK CONTROL', 24, 18, quickW - 48, { color: COLORS.muted, font: 'montserrat_14' }),
        label('home', 'light_label', 'LIGHT', 24, 58, Math.round(quickW * 0.32), { font: 'montserrat_16' }),
        toggle('home', 'light_switch', 'light_enabled', Math.round(quickW * 0.34), 52),
        label('home', 'fan_label', 'FAN', Math.round(quickW * 0.57), 58, Math.round(quickW * 0.18), { font: 'montserrat_16' }),
        toggle('home', 'fan_switch', 'fan_enabled', quickW - 84, 52),
        label('home', 'brightness_label', 'BRIGHTNESS', 24, 112, 120, { color: COLORS.muted, font: 'montserrat_12' }),
        slider('home', 'brightness', 'light_brightness', 24, 144, quickW - 48, 68, { color: COLORS.amber }),
      ],
    }));
    layouts.push(shell.children);
  }

  // AIR
  {
    const shell = addRectShell('air', 1, width, height, screenIds);
    const { contentX: x, contentY: y, contentW: w, contentH: h } = shell;
    const meterW = Math.round(w * 0.44);
    shell.children.push(box('air', 'quality', x, y + 8, meterW, h - 24, {
      shadow: true,
      children: [
        label('air', 'quality_title', 'AIR QUALITY', 28, 24, meterW - 56, { color: COLORS.muted, font: 'montserrat_14' }),
        meterArc('air', 'co2_arc', 'co2_level', Math.round(meterW / 2 - (compact ? 100 : 125)), compact ? 70 : 78, compact ? 200 : 250, 586, { min: 350, max: 2000, color: COLORS.green, arcWidth: 18 }),
        label('air', 'co2_value', '586', Math.round(meterW * 0.2), compact ? 146 : 174, Math.round(meterW * 0.6), { font: compact ? 'montserrat_32' : 'montserrat_40', align: 'center' }),
        label('air', 'co2_unit', 'ppm  /  GOOD', Math.round(meterW * 0.2), compact ? 192 : 224, Math.round(meterW * 0.6), { color: COLORS.green, font: 'montserrat_14', align: 'center' }),
      ],
    }));
    const rx = x + meterW + 20;
    const rw = w - meterW - 20;
    shell.children.push(box('air', 'controls', rx, y + 8, rw, h - 24, {
      children: [
        label('air', 'fan_title', 'FRESH AIR FAN', 28, 24, rw - 130, { font: 'montserrat_20' }),
        toggle('air', 'fan_toggle', 'fan_enabled', rw - 92, 20),
        label('air', 'fan_speed_label', 'FAN SPEED', 28, 86, 160, { color: COLORS.muted, font: 'montserrat_13' }),
        label('air', 'fan_speed_value', '36%', rw - 110, 82, 80, { color: COLORS.cyan, font: 'montserrat_18', align: 'right', binding: { subject: 'fan_speed', fmt: '%d%%' } }),
        slider('air', 'fan_speed', 'fan_speed', 28, 124, rw - 56, 36),
        label('air', 'auto_title', 'AUTO VENTILATION', 28, compact ? 190 : 214, rw - 150, { font: 'montserrat_18' }),
        toggle('air', 'vent_toggle', 'vent_enabled', rw - 92, compact ? 184 : 208),
        label('air', 'schedule', 'Every 30 min  |  Run 5 min', 28, compact ? 240 : 270, rw - 56, { color: COLORS.muted, font: 'montserrat_14' }),
        button('air', 'boost', 'VENT BOOST  10 MIN', 28, h - (compact ? 94 : 112), rw - 56, 52, { color: COLORS.cyan, textColor: COLORS.canvas }),
      ],
    }));
    layouts.push(shell.children);
  }

  // LIGHT
  {
    const shell = addRectShell('light', 2, width, height, screenIds);
    const { contentX: x, contentY: y, contentW: w, contentH: h } = shell;
    const leftW = Math.round(w * 0.56);
    shell.children.push(box('light', 'main', x, y + 8, leftW, h - 24, {
      shadow: true,
      children: [
        label('light', 'main_title', 'CABIN LIGHT', 30, 24, leftW - 150, { font: 'montserrat_22' }),
        toggle('light', 'master', 'light_enabled', leftW - 94, 20),
        label('light', 'brightness_title', 'BRIGHTNESS', 30, 96, leftW - 60, { color: COLORS.muted, font: 'montserrat_13' }),
        label('light', 'brightness_value', '68%', 30, 128, leftW - 60, { color: COLORS.amber, font: compact ? 'montserrat_36' : 'montserrat_44', binding: { subject: 'light_brightness', fmt: '%d%%' } }),
        slider('light', 'brightness_control', 'light_brightness', 30, compact ? 202 : 220, leftW - 60, 68, { color: COLORS.amber, height: 16 }),
        label('light', 'cct_title', 'COLOR TEMPERATURE', 30, compact ? 264 : 302, leftW - 60, { color: COLORS.muted, font: 'montserrat_13' }),
        label('light', 'cct_value', '4200 K', 30, compact ? 296 : 336, leftW - 60, { color: COLORS.cyan, font: 'montserrat_24', binding: { subject: 'light_cct', fmt: '%d K' } }),
        slider('light', 'cct_control', 'light_cct', 30, compact ? 348 : 392, leftW - 60, 4200, { min: 2700, max: 6500, color: COLORS.cyan, height: 16 }),
      ],
    }));
    const rx = x + leftW + 20;
    const rw = w - leftW - 20;
    shell.children.push(box('light', 'scenes', rx, y + 8, rw, h - 24, {
      children: [
        label('light', 'scenes_title', 'LIGHT SCENES', 26, 24, rw - 52, { color: COLORS.muted, font: 'montserrat_14' }),
        button('light', 'scene_work', 'WORK', 26, 78, rw - 52, 54, { color: COLORS.blue, events: [{ kind: 'subject_set', trigger: 'clicked', subject: 'light_brightness', subjectType: 'int', value: '85' }] }),
        button('light', 'scene_call', 'VIDEO CALL', 26, 150, rw - 52, 54, { color: COLORS.card2, borderWidth: 1, shadow: false, events: [{ kind: 'subject_set', trigger: 'clicked', subject: 'light_brightness', subjectType: 'int', value: '72' }] }),
        button('light', 'scene_relax', 'RELAX', 26, 222, rw - 52, 54, { color: COLORS.card2, borderWidth: 1, shadow: false, events: [{ kind: 'subject_set', trigger: 'clicked', subject: 'light_brightness', subjectType: 'int', value: '38' }] }),
        button('light', 'scene_off', 'ALL OFF', 26, 294, rw - 52, 54, { color: COLORS.card2, borderWidth: 1, shadow: false, events: [{ kind: 'subject_set', trigger: 'clicked', subject: 'light_enabled', subjectType: 'int', value: '0' }] }),
      ],
    }));
    layouts.push(shell.children);
  }

  // FOCUS
  {
    const shell = addRectShell('focus', 3, width, height, screenIds);
    const { contentX: x, contentY: y, contentW: w, contentH: h } = shell;
    shell.children.push(label('focus', 'headline', 'CHOOSE YOUR SESSION', x, y + 18, w, { font: 'montserrat_22' }));
    const gap = 18;
    const cardW = Math.floor((w - gap * 3) / 4);
    const cardY = y + 70;
    const cardH = h - 110;
    const modes = [
      ['DEEP WORK', '50 MIN', COLORS.blue],
      ['MEETING', '45 MIN', COLORS.cyan],
      ['PHONE', '30 MIN', COLORS.amber],
      ['RESET', '15 MIN', COLORS.green],
    ];
    modes.forEach(([title, duration, color], index) => {
      shell.children.push(box('focus', `mode_${index}`, x + index * (cardW + gap), cardY, cardW, cardH, {
        color: index === 0 ? '#13305A' : COLORS.card,
        border: color,
        borderWidth: index === 0 ? 2 : 1,
        shadow: index === 0,
        children: [
          label('focus', `mode_${index}_num`, `0${index + 1}`, 22, 22, cardW - 44, { color, font: 'montserrat_20' }),
          label('focus', `mode_${index}_title`, title, 22, Math.round(cardH * 0.38), cardW - 44, { font: compact ? 'montserrat_18' : 'montserrat_22', height: 60 }),
          label('focus', `mode_${index}_time`, duration, 22, Math.round(cardH * 0.58), cardW - 44, { color: COLORS.muted, font: 'montserrat_14' }),
          button('focus', `mode_${index}_start`, 'START', 22, cardH - 76, cardW - 44, 46, {
            color,
            textColor: index === 1 || index === 3 ? COLORS.canvas : COLORS.text,
            events: [{ kind: 'subject_set', trigger: 'clicked', subject: 'pod_mode', subjectType: 'int', value: String(index) }],
          }),
        ],
      }));
    });
    layouts.push(shell.children);
  }

  // SETTINGS
  {
    const shell = addRectShell('settings', 4, width, height, screenIds);
    const { contentX: x, contentY: y, contentW: w, contentH: h } = shell;
    const gap = 20;
    const colW = Math.floor((w - gap) / 2);
    const rowH = Math.floor((h - 52) / 3);
    const settingRow = (key, title, note, yPos, subject, xPos = x) => box('settings', key, xPos, yPos, colW, rowH, {
      children: [
        label('settings', `${key}_title`, title, 24, 20, colW - 130, { font: 'montserrat_17' }),
        label('settings', `${key}_note`, note, 24, 52, colW - 130, { color: COLORS.muted, font: 'montserrat_12' }),
        toggle('settings', `${key}_toggle`, subject, colW - 88, Math.round(rowH / 2 - 15)),
      ],
    });
    shell.children.push(settingRow('dnd', 'DO NOT DISTURB', 'Mute alerts while occupied', y + 8, 'dnd_enabled'));
    shell.children.push(settingRow('auto_light', 'AUTO LIGHT', 'Turn on when presence is detected', y + 8 + rowH + 14, 'light_enabled'));
    shell.children.push(settingRow('auto_vent', 'AUTO VENT', 'Fresh air on a timed schedule', y + 8 + (rowH + 14) * 2, 'vent_enabled'));
    shell.children.push(box('settings', 'system', x + colW + gap, y + 8, colW, rowH * 3 + 28, {
      children: [
        label('settings', 'system_title', 'SYSTEM', 26, 22, colW - 52, { color: COLORS.muted, font: 'montserrat_14' }),
        label('settings', 'device', preset.model, 26, 70, colW - 52, { font: 'montserrat_22' }),
        label('settings', 'display', `${width} x ${height}  ${preset.shape.toUpperCase()}`, 26, 112, colW - 52, { color: COLORS.cyan, font: 'montserrat_14' }),
        label('settings', 'firmware', 'Firmware  1.4.2', 26, 174, colW - 52, { color: COLORS.muted, font: 'montserrat_14' }),
        label('settings', 'network', 'Network   ONLINE', 26, 210, colW - 52, { color: COLORS.green, font: 'montserrat_14' }),
        button('settings', 'restart', 'RESTART PANEL', 26, rowH * 3 - 50, colW - 52, 48, { color: COLORS.card2, borderWidth: 1, border: COLORS.red, textColor: COLORS.red, shadow: false }),
      ],
    }));
    layouts.push(shell.children);
  }

  return layouts;
}

function roundChrome(screen, index, screenIds) {
  return [
    label(screen, 'page_title', PAGE_LABELS[index], 60, 18, 120, { font: 'montserrat_13', color: COLORS.muted, align: 'center' }),
    ...(index > 0 ? [button(screen, 'back', '<', 44, 27, 34, 34, { color: COLORS.card, borderWidth: 1, shadow: false, font: 'montserrat_16', events: navEvent(screenIds[index - 1], 'move_right') })] : []),
    ...(index < 4 ? [button(screen, 'next', '>', 162, 27, 34, 34, { color: COLORS.card, borderWidth: 1, shadow: false, font: 'montserrat_16', events: navEvent(screenIds[index + 1], 'move_left') })] : []),
  ];
}

function buildRoundScreens(screenIds) {
  const layouts = [];
  layouts.push([
    ...roundChrome('home', 0, screenIds),
    meterArc('home', 'quiet_arc', 'fan_speed', 48, 46, 144, 36, { color: COLORS.cyan, arcWidth: 13 }),
    label('home', 'quiet', 'QUIET', 55, 90, 130, { font: 'montserrat_26', align: 'center' }),
    label('home', 'noise', '32 dB', 70, 124, 100, { color: COLORS.cyan, font: 'montserrat_16', align: 'center' }),
    label('home', 'air', 'AIR  GOOD', 70, 151, 100, { color: COLORS.green, font: 'montserrat_12', align: 'center' }),
    button('home', 'start', 'START', 80, 182, 80, 32, { color: COLORS.blue, events: [{ kind: 'subject_set', trigger: 'clicked', subject: 'pod_mode', subjectType: 'int', value: '0' }] }),
  ]);
  layouts.push([
    ...roundChrome('air', 1, screenIds),
    meterArc('air', 'co2_arc', 'co2_level', 62, 54, 116, 586, { min: 350, max: 2000, color: COLORS.green, arcWidth: 11 }),
    label('air', 'co2', '586', 70, 92, 100, { font: 'montserrat_26', align: 'center' }),
    label('air', 'ppm', 'ppm', 70, 123, 100, { color: COLORS.green, font: 'montserrat_12', align: 'center' }),
    label('air', 'fan', 'FAN 36%', 52, 158, 136, { color: COLORS.muted, font: 'montserrat_12', align: 'center', binding: { subject: 'fan_speed', fmt: 'FAN %d%%' } }),
    slider('air', 'speed', 'fan_speed', 64, 181, 112, 36, { height: 10 }),
  ]);
  layouts.push([
    ...roundChrome('light', 2, screenIds),
    meterArc('light', 'brightness_arc', 'light_brightness', 54, 50, 132, 68, { color: COLORS.amber, arcWidth: 12 }),
    label('light', 'value', '68%', 65, 94, 110, { font: 'montserrat_26', color: COLORS.amber, align: 'center', binding: { subject: 'light_brightness', fmt: '%d%%' } }),
    label('light', 'cct_value', '4200 K', 65, 130, 110, { font: 'montserrat_13', color: COLORS.cyan, align: 'center', binding: { subject: 'light_cct', fmt: '%d K' } }),
    toggle('light', 'master', 'light_enabled', 91, 174, 58, 28),
  ]);
  layouts.push([
    ...roundChrome('focus', 3, screenIds),
    label('focus', 'prompt', 'SELECT MODE', 55, 66, 130, { font: 'montserrat_14', align: 'center' }),
    button('focus', 'deep', 'DEEP', 48, 98, 68, 40, { color: COLORS.blue, events: [{ kind: 'subject_set', trigger: 'clicked', subject: 'pod_mode', subjectType: 'int', value: '0' }] }),
    button('focus', 'meet', 'MEET', 124, 98, 68, 40, { color: COLORS.card, borderWidth: 1, shadow: false, events: [{ kind: 'subject_set', trigger: 'clicked', subject: 'pod_mode', subjectType: 'int', value: '1' }] }),
    button('focus', 'call', 'CALL', 48, 146, 68, 40, { color: COLORS.card, borderWidth: 1, shadow: false, events: [{ kind: 'subject_set', trigger: 'clicked', subject: 'pod_mode', subjectType: 'int', value: '2' }] }),
    button('focus', 'reset', 'RESET', 124, 146, 68, 40, { color: COLORS.card, borderWidth: 1, shadow: false, events: [{ kind: 'subject_set', trigger: 'clicked', subject: 'pod_mode', subjectType: 'int', value: '3' }] }),
    label('focus', 'time', '50 MIN', 70, 199, 100, { color: COLORS.cyan, font: 'montserrat_13', align: 'center' }),
  ]);
  layouts.push([
    ...roundChrome('settings', 4, screenIds),
    button('settings', 'home', 'H', 162, 27, 34, 34, { color: COLORS.card, borderWidth: 1, shadow: false, font: 'montserrat_12', events: navEvent(screenIds[0], 'fade_on') }),
    label('settings', 'dnd_label', 'DND', 54, 78, 80, { font: 'montserrat_14' }),
    toggle('settings', 'dnd', 'dnd_enabled', 130, 72, 52, 26),
    label('settings', 'vent_label', 'AUTO AIR', 54, 120, 80, { font: 'montserrat_14' }),
    toggle('settings', 'vent', 'vent_enabled', 130, 114, 52, 26),
    label('settings', 'light_label', 'AUTO LUX', 54, 162, 80, { font: 'montserrat_14' }),
    toggle('settings', 'light', 'light_enabled', 130, 156, 52, 26),
    label('settings', 'version', 'WF2D-8620  v1.4', 64, 205, 112, { color: COLORS.muted, font: 'montserrat_10', align: 'center' }),
  ]);
  return layouts;
}

function squareNav(screen, active, screenIds) {
  const items = ['H', 'AIR', 'LUX', 'FOC', 'SET'];
  return items.map((text, index) => button(screen, `nav_${PAGE_KEYS[index]}`, text, 14 + index * 92, 426, 82, 40, {
    color: index === active ? COLORS.blue : COLORS.card2,
    borderWidth: index === active ? 0 : 1,
    shadow: false,
    font: 'montserrat_11',
    events: navEvent(screenIds[index]),
  }));
}

function squareHeader(screen, title) {
  return [
    label(screen, 'brand', 'QUIET POD', 22, 20, 220, { color: COLORS.cyan, font: 'montserrat_20' }),
    label(screen, 'title', title, 250, 23, 208, { color: COLORS.muted, font: 'montserrat_14', align: 'right' }),
  ];
}

function buildSquareScreens(screenIds) {
  const layouts = [];
  layouts.push([
    ...squareHeader('home', 'HOME'),
    box('home', 'hero', 22, 64, 274, 338, { shadow: true, children: [
      meterArc('home', 'quiet_arc', 'fan_speed', 47, 30, 180, 36, { color: COLORS.cyan, arcWidth: 15 }),
      label('home', 'quiet', 'QUIET', 57, 92, 160, { font: 'montserrat_32', align: 'center' }),
      label('home', 'noise', '32 dB', 77, 136, 120, { color: COLORS.cyan, font: 'montserrat_17', align: 'center' }),
      button('home', 'end', 'END SESSION', 42, 262, 190, 50, { color: COLORS.red, font: 'montserrat_13' }),
    ] }),
    statCard('home', 'co2', 'CO2', '586', 'ppm', 314, 64, 144, 102, COLORS.green),
    statCard('home', 'temp', 'TEMP', '24.2', 'deg C', 314, 182, 144, 102, COLORS.amber),
    statCard('home', 'humidity', 'HUM', '46', 'percent', 314, 300, 144, 102, COLORS.blue),
    ...squareNav('home', 0, screenIds),
  ]);
  layouts.push([
    ...squareHeader('air', 'AIR'),
    box('air', 'quality', 22, 64, 210, 338, { shadow: true, children: [
      meterArc('air', 'co2_arc', 'co2_level', 30, 34, 150, 586, { min: 350, max: 2000, color: COLORS.green, arcWidth: 13 }),
      label('air', 'co2', '586', 45, 90, 120, { font: 'montserrat_30', align: 'center' }),
      label('air', 'ppm', 'ppm / GOOD', 45, 130, 120, { color: COLORS.green, font: 'montserrat_12', align: 'center' }),
      label('air', 'temp', '24.2 C', 26, 236, 158, { color: COLORS.amber, font: 'montserrat_18', align: 'center' }),
      label('air', 'hum', '46% RH', 26, 276, 158, { color: COLORS.blue, font: 'montserrat_18', align: 'center' }),
    ] }),
    box('air', 'control', 250, 64, 208, 338, { children: [
      label('air', 'fan_title', 'FRESH AIR', 22, 22, 120, { font: 'montserrat_17' }),
      toggle('air', 'fan', 'fan_enabled', 130, 16, 54, 28),
      label('air', 'speed_value', '36%', 22, 82, 164, { color: COLORS.cyan, font: 'montserrat_28', binding: { subject: 'fan_speed', fmt: '%d%%' } }),
      slider('air', 'speed', 'fan_speed', 22, 132, 164, 36),
      label('air', 'auto', 'AUTO VENT', 22, 192, 100, { font: 'montserrat_14' }),
      toggle('air', 'vent', 'vent_enabled', 130, 184, 54, 28),
      button('air', 'boost', 'BOOST 10 MIN', 22, 260, 164, 48, { color: COLORS.cyan, textColor: COLORS.canvas, font: 'montserrat_12' }),
    ] }),
    ...squareNav('air', 1, screenIds),
  ]);
  layouts.push([
    ...squareHeader('light', 'LIGHT'),
    box('light', 'main', 22, 64, 436, 338, { shadow: true, children: [
      label('light', 'main_title', 'CABIN LIGHT', 28, 24, 260, { font: 'montserrat_20' }),
      toggle('light', 'master', 'light_enabled', 350, 18),
      label('light', 'brightness_value', '68%', 28, 82, 180, { color: COLORS.amber, font: 'montserrat_38', binding: { subject: 'light_brightness', fmt: '%d%%' } }),
      slider('light', 'brightness_slider', 'light_brightness', 28, 144, 380, 68, { color: COLORS.amber, height: 15 }),
      label('light', 'cct_value', '4200 K', 28, 194, 180, { color: COLORS.cyan, font: 'montserrat_24', binding: { subject: 'light_cct', fmt: '%d K' } }),
      slider('light', 'cct_slider', 'light_cct', 28, 240, 380, 4200, { min: 2700, max: 6500, height: 15 }),
      button('light', 'work', 'WORK', 28, 278, 112, 42, { color: COLORS.blue, font: 'montserrat_12' }),
      button('light', 'call', 'CALL', 162, 278, 112, 42, { color: COLORS.card2, borderWidth: 1, shadow: false, font: 'montserrat_12' }),
      button('light', 'relax', 'RELAX', 296, 278, 112, 42, { color: COLORS.card2, borderWidth: 1, shadow: false, font: 'montserrat_12' }),
    ] }),
    ...squareNav('light', 2, screenIds),
  ]);
  layouts.push([
    ...squareHeader('focus', 'FOCUS'),
    label('focus', 'prompt', 'CHOOSE A SESSION', 22, 70, 436, { color: COLORS.muted, font: 'montserrat_14' }),
    ...[
      ['DEEP WORK', '50 MIN', COLORS.blue], ['MEETING', '45 MIN', COLORS.cyan],
      ['PHONE', '30 MIN', COLORS.amber], ['RESET', '15 MIN', COLORS.green],
    ].map(([title, time, color], index) => box('focus', `mode_${index}`, 22 + (index % 2) * 218, 108 + Math.floor(index / 2) * 148, 200, 128, {
      color: index === 0 ? '#13305A' : COLORS.card,
      border: color,
      children: [
        label('focus', `mode_${index}_title`, title, 18, 18, 164, { font: 'montserrat_16' }),
        label('focus', `mode_${index}_time`, time, 18, 50, 164, { color, font: 'montserrat_13' }),
        button('focus', `mode_${index}_start`, 'START', 18, 82, 164, 34, { color, font: 'montserrat_11', events: [{ kind: 'subject_set', trigger: 'clicked', subject: 'pod_mode', subjectType: 'int', value: String(index) }] }),
      ],
    })),
    ...squareNav('focus', 3, screenIds),
  ]);
  layouts.push([
    ...squareHeader('settings', 'SETTINGS'),
    ...[
      ['dnd', 'DO NOT DISTURB', 'Mute occupied alerts', 'dnd_enabled'],
      ['auto_light', 'AUTO LIGHT', 'Presence controlled', 'light_enabled'],
      ['auto_vent', 'AUTO VENT', '30 min schedule', 'vent_enabled'],
    ].map(([key, title, note, subject], index) => box('settings', key, 22, 66 + index * 96, 436, 80, { children: [
      label('settings', `${key}_title`, title, 22, 16, 270, { font: 'montserrat_15' }),
      label('settings', `${key}_note`, note, 22, 44, 270, { color: COLORS.muted, font: 'montserrat_11' }),
      toggle('settings', `${key}_toggle`, subject, 350, 24, 58, 30),
    ] })),
    box('settings', 'device', 22, 354, 436, 48, { color: COLORS.card2, children: [
      label('settings', 'device_name', 'WF2D-8630  /  480 x 480 DEMO', 18, 15, 400, { color: COLORS.cyan, font: 'montserrat_12', align: 'center' }),
    ] }),
    ...squareNav('settings', 4, screenIds),
  ]);
  return layouts;
}

function createProject(preset) {
  idCounter = 0;
  const screenIds = PAGE_KEYS.map(() => id());
  const layouts = preset.layout === 'round'
    ? buildRoundScreens(screenIds)
    : preset.layout === 'square'
      ? buildSquareScreens(screenIds)
      : buildRectScreens(preset, screenIds);
  const screenNames = {
    home: '总览', air: '空气与通风', light: '灯光', focus: '专注模式', settings: '设置',
  };
  const screens = PAGE_KEYS.map((key, index) => {
    const screen = createScreen(key, screenNames[key], index === 0, layouts[index]);
    screen.id = screenIds[index];
    return screen;
  });
  return {
    schemaVersion: 1,
    meta: {
      name: `${preset.model} 静音仓操作界面`,
      lvglVersion: '9.4',
      appVersion: '1.0.0',
      createdAt: NOW,
      modifiedAt: NOW,
    },
    display: {
      width: preset.width,
      height: preset.height,
      shape: preset.shape,
      colorDepth: 16,
      dpi: 130,
    },
    screens,
    components: [],
    styles: [],
    consts: [],
    subjects: subjects(),
    assets: { fonts: [], images: [] },
    translations: null,
    codegen: { outputDirName: 'ui', exportXml: false, userIncludes: [] },
    editor: {
      deviceModel: preset.model,
      deviceTitle: preset.title,
      example: 'quiet-pod-control-suite',
    },
  };
}

const BUILTIN_ACTIONS = {
  'screen.open': {
    id: 'screen.open', displayName: '打开屏幕',
    params: [
      { name: 'screen', type: 'screenRef', required: true },
      { name: 'anim', type: 'string' },
      { name: 'duration', type: 'int' },
      { name: 'delay', type: 'int' },
    ],
  },
  'screen.create': {
    id: 'screen.create', displayName: '创建并打开屏幕',
    description: '目标屏未创建时先创建再加载',
    params: [
      { name: 'screen', type: 'screenRef', required: true },
      { name: 'anim', type: 'string' },
      { name: 'duration', type: 'int' },
      { name: 'delay', type: 'int' },
    ],
  },
  'screen.back': { id: 'screen.back', displayName: '返回上一屏', params: [] },
  'subject.set': {
    id: 'subject.set', displayName: '设置 Subject',
    params: [
      { name: 'subject', type: 'subjectRef', required: true },
      { name: 'value', type: 'string', required: true },
    ],
  },
  'subject.toggle': {
    id: 'subject.toggle', displayName: '翻转 Subject',
    params: [{ name: 'subject', type: 'subjectRef', required: true }],
  },
  'subject.increment': {
    id: 'subject.increment', displayName: '递增 Subject',
    params: [
      { name: 'subject', type: 'subjectRef', required: true },
      { name: 'step', type: 'int' },
      { name: 'min', type: 'int' },
      { name: 'max', type: 'int' },
      { name: 'rollover', type: 'bool' },
    ],
  },
};

function migrateEvent(event) {
  if (event.kind === 'screen_load' || event.kind === 'screen_create') {
    return {
      on: event.trigger,
      action: event.kind === 'screen_load' ? 'screen.open' : 'screen.create',
      args: {
        screen: event.screenId,
        ...(event.animType === undefined ? {} : { anim: event.animType }),
        ...(event.duration === undefined ? {} : { duration: event.duration }),
        ...(event.delay === undefined ? {} : { delay: event.delay }),
      },
    };
  }
  if (event.kind === 'subject_toggle') {
    return { on: event.trigger, action: 'subject.toggle', args: { subject: `subject:${event.subject}` } };
  }
  if (event.kind === 'subject_set') {
    return {
      on: event.trigger,
      action: 'subject.set',
      args: { subject: `subject:${event.subject}`, value: event.value },
    };
  }
  if (event.kind === 'subject_increment') {
    return {
      on: event.trigger,
      action: 'subject.increment',
      args: {
        subject: `subject:${event.subject}`,
        ...(event.step === undefined ? {} : { step: event.step }),
        ...(event.min === undefined ? {} : { min: event.min }),
        ...(event.max === undefined ? {} : { max: event.max }),
        ...(event.rollover === undefined ? {} : { rollover: event.rollover }),
      },
    };
  }
  throw new Error(`Unsupported event kind ${event.kind}`);
}

function migrateBinding(binding) {
  return { ...binding, subject: `subject:${binding.subject}` };
}

function migrateNode(nodeV1) {
  return {
    id: nodeV1.id,
    type: nodeV1.type,
    ...(nodeV1.name === undefined ? {} : { codeName: nodeV1.name }),
    ...(nodeV1.displayName === undefined ? {} : { displayName: nodeV1.displayName }),
    props: nodeV1.props,
    ...(nodeV1.flags === undefined ? {} : { flags: nodeV1.flags }),
    ...(nodeV1.states === undefined ? {} : { states: nodeV1.states }),
    styleRefs: nodeV1.styles,
    styles: nodeV1.inlineStyles,
    events: nodeV1.events.map(migrateEvent),
    bindings: nodeV1.bindings.map(migrateBinding),
    children: nodeV1.children.map(migrateNode),
  };
}

function frameAssetRef(preset) {
  const framePath = resolve(`apps/designer/src/assets/device-frames/${preset.model}.svg`);
  const sha256 = createHash('sha256').update(readFileSync(framePath)).digest('hex');
  return `asset:controller/${preset.model.toLowerCase()}.svg@sha256:${sha256}`;
}

function createSnapshot(project, preset) {
  const slug = `${preset.model.toLowerCase()}-quiet-pod`;
  const displaySlug = `${preset.model.toLowerCase()}-${preset.width}x${preset.height}-rgb565`;
  const displayId = `display:${displaySlug}`;
  const displayRef = `${displayId}@1`;
  const uiId = `ui:${slug}`;
  const uiRef = `${uiId}@1`;
  const controllerId = `controller:${preset.model.toLowerCase()}`;
  const controllerRef = `${controllerId}@1`;
  const aperture = preset.frame.aperture;
  const px = (value, axis) => value * preset.frame[axis];

  const uiProject = {
    schemaVersion: 2,
    kind: 'lvgl-ui-project',
    meta: {
      id: uiId,
      revision: 1,
      name: project.meta.name,
      appVersion: project.meta.appVersion,
      createdAt: project.meta.createdAt,
      modifiedAt: project.meta.modifiedAt,
    },
    designDisplayRef: displayRef,
    themes: [{ id: 'default', displayName: '默认', tokens: [] }],
    subjects: project.subjects.map((subject) => ({
      id: `subject:${subject.name}`,
      codeName: subject.name,
      displayName: subject.name.replaceAll('_', ' '),
      type: subject.type,
      initial: subject.initial,
      ...(subject.min === undefined ? {} : { min: subject.min }),
      ...(subject.max === undefined ? {} : { max: subject.max }),
    })),
    screens: project.screens.map((screen) => ({
      id: screen.id,
      codeName: screen.name,
      displayName: screen.displayName,
      isHome: screen.isHome,
      styles: [],
      consts: [],
      root: migrateNode(screen.root),
    })),
    components: [],
    styles: [],
    consts: [],
    assets: { fonts: [], images: [], icons: [] },
    translations: null,
    editor: project.editor,
  };
  const displayProfile = {
    schemaVersion: 1,
    kind: 'display-profile',
    id: displayId,
    revision: 1,
    displayName: `${preset.model} ${preset.width}×${preset.height} ${preset.shape === 'round' ? '圆屏' : '矩形屏'} RGB565`,
    logicalSize: { width: preset.width, height: preset.height },
    shape: preset.shape,
    colorFormat: 'RGB565',
    dpi: 130,
  };
  const controllerProfile = {
    schemaVersion: 1,
    kind: 'controller-profile',
    id: controllerId,
    revision: 1,
    model: preset.model,
    displayName: `${preset.model} 设备外壳`,
    displayRef,
    frame: {
      assetRef: frameAssetRef(preset),
      viewBox: { x: 0, y: 0, width: preset.frame.width, height: preset.frame.height },
      screenViewport: {
        x: px(aperture.x, 'width'),
        y: px(aperture.y, 'height'),
        width: px(aperture.width, 'width'),
        height: px(aperture.height, 'height'),
        rotation: 0,
        clip: preset.shape === 'round'
          ? { type: 'circle' }
          : { type: 'roundedRect', radius: 0.75 },
      },
    },
  };
  return {
    kind: 'lvgl-project-snapshot',
    snapshotVersion: 1,
    uiProject,
    displayProfile,
    controllerProfile,
    buildTarget: {
      schemaVersion: 1,
      kind: 'lvgl-build-target',
      id: `target:${slug}`,
      revision: 1,
      displayName: `${preset.model} 静音仓目标`,
      uiProjectRef: uiRef,
      controllerProfileRef: controllerRef,
      themeRef: `${uiRef}#theme:default`,
      lvglVersion: '9.5.0',
    },
    actionRegistry: BUILTIN_ACTIONS,
    migrationNotes: [
      {
        severity: 'info', code: 'color-format-confirmed', path: 'display.colorFormat',
        message: `${preset.model} 示例已确认使用 RGB565。`,
      },
      {
        severity: 'info', code: 'controller-profile-selected', path: 'buildTarget.controllerProfileRef',
        message: `已绑定 ${preset.model} 设备外壳。`,
      },
    ],
    colorFormatConfirmed: true,
  };
}

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const preset of PRESETS) {
  const project = createSnapshot(createProject(preset), preset);
  const file = resolve(OUTPUT_DIR, `${preset.model}-quiet-pod.lvproj.json`);
  writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  process.stdout.write(`generated ${file}\n`);
}
