import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE_DIR = resolve('examples/serene-pod');
const OUTPUT_DIR = resolve('examples/device-showcase');
const NOW = '2026-10-10T00:00:00.000Z';

const PRESETS = [
  { model: 'WF3-284x76', width: 284, height: 76, design: 'uart-grid', name: 'UART 总线工具台', source: 'wf3-firmware/WF3-284x76-firmware-ui.lvproj.json' },
  { model: 'WF2D-8620', width: 240, height: 240, design: 'focus-orbit', name: '专注节奏计时器' },
  { model: 'WF2D-8630', width: 480, height: 480, design: 'greenhouse', name: '智慧温室控制台' },
  { model: 'WF2D-1050', width: 1024, height: 600, design: 'ev-charge', name: '电动车充电终端' },
  { model: 'WF2D-1040', width: 1080, height: 720, design: 'factory-energy', name: '工厂能源中心' },
  { model: 'WF2D-1030', width: 1440, height: 720, design: 'harbor-dispatch', name: '港口调度台' },
];

const PALETTES = {
  'WF3-284x76': { bg: '#07191E', surface: '#0D2930', surface2: '#123943', border: '#28606B', text: '#F1FBFC', muted: '#8EB6BD', accent: '#13B8A6', accent2: '#F2C14E', success: '#45D483', warning: '#F2C14E', danger: '#FF6675', track: '#21454D', shadow: '#02090B' },
  'WF2D-8620': { bg: '#120C24', surface: '#21153D', surface2: '#302052', border: '#513C77', text: '#FFF7FF', muted: '#B6A8D2', accent: '#FF4FB3', accent2: '#8C6CFF', success: '#50E3C2', warning: '#FFC857', danger: '#FF6B7A', track: '#3A2A59', shadow: '#07030F' },
  'WF2D-8630': { bg: '#F3F0E6', surface: '#FFFDF7', surface2: '#E1E8D0', border: '#BAC6A2', text: '#243622', muted: '#6E7E67', accent: '#3D7A42', accent2: '#A6C64C', success: '#5D9D5B', warning: '#D99638', danger: '#C75C4C', track: '#D4DDC3', shadow: '#7F8A73' },
  'WF2D-1050': { bg: '#100C25', surface: '#1C1738', surface2: '#29224B', border: '#43396D', text: '#F9F6FF', muted: '#A8A0C7', accent: '#7C5CFF', accent2: '#23D5D5', success: '#45D69B', warning: '#FFBE55', danger: '#FF5470', track: '#37305B', shadow: '#05030D' },
  'WF2D-1040': { bg: '#07131F', surface: '#102436', surface2: '#173249', border: '#28506B', text: '#F0F6F8', muted: '#8CA8B8', accent: '#FF9F2F', accent2: '#30C7D9', success: '#52D273', warning: '#FFC34A', danger: '#FF6659', track: '#254158', shadow: '#02080D' },
  'WF2D-1030': { bg: '#EAF1F5', surface: '#FFFFFF', surface2: '#DDEAF1', border: '#B4CAD6', text: '#153247', muted: '#678091', accent: '#176B87', accent2: '#8BC34A', success: '#3C9B72', warning: '#E69A32', danger: '#D95858', track: '#C8D9E2', shadow: '#6D8695' },
};

let nodeCounter = 1;
function id() {
  return `10000000-0000-4000-9000-${String(nodeCounter++).padStart(12, '0')}`;
}
const token = (name) => ({ $token: name });
const st = (props, selector) => selector ? { selector, props } : { props };
const ICON = {
  home: '\uF015', refresh: '\uF021', music: '\uF001', menu: '\uF0C9',
  back: '\uF053', next: '\uF054', play: '\uF04B', stop: '\uF04D',
  check: '\uF00C', power: '\uF011', light: '\uF0E7', eye: '\uF06E',
  settings: '\uF013', wifi: '\uF1EB', volume: '\uF028', warning: '\uF071',
};
const iconText = (icon, text = '') => text ? `${icon}  ${text}` : icon;

function node(type, codeName, props, styles = [], children = [], extras = {}) {
  return {
    id: id(), type, codeName, props,
    ...(type === 'obj' || type === 'button' ? { flags: { scrollable: false } } : {}),
    styleRefs: [], styles, events: [], bindings: [], children, ...extras,
  };
}

function label(name, text, x, y, width, height, font = 18, color = 'color.text.primary', align = 'left') {
  return node('label', name, { text, x, y, width, height }, [st({
    text_color: token(color), text_font: token(`font.size.${font}`), text_align: align, text_opa: 255,
  })]);
}

function brandLogo(name, x, y) {
  return node('image', name, {
    src: 'podsc_logo', x, y, width: 32, height: 32, inner_align: 'center',
  });
}

function card(name, x, y, width, height, children = [], options = {}) {
  return node('obj', name, { x, y, width, height }, [st({
    bg_color: token(options.fill ?? 'color.surface'), bg_opa: 255,
    border_color: token(options.border ?? 'color.border'), border_width: options.borderWidth ?? 1,
    radius: options.radius ?? 18, pad_all: 0,
    shadow_color: token('color.shadow'), shadow_width: options.shadow === false ? 0 : (options.shadowWidth ?? 10),
    shadow_opa: options.shadow === false ? 0 : (options.shadowOpa ?? 24), shadow_offset_y: options.shadow === false ? 0 : 4,
  })], children);
}

function button(name, text, x, y, width, height, options = {}) {
  const fill = options.fill ?? 'color.accent';
  const control = node('button', name, { x, y, width, height }, [
    st({
      bg_color: token(fill), bg_opa: 255, border_color: token(options.border ?? fill),
      border_width: options.borderWidth ?? 1, radius: options.radius ?? Math.min(22, Math.round(height / 2)),
      pad_all: 0, shadow_width: options.shadow === false ? 0 : 8,
      shadow_color: token(fill), shadow_opa: options.shadow === false ? 0 : 28,
    }),
    st({ bg_color: token(options.pressed ?? 'color.accent2') }, { states: ['pressed'] }),
  ], [node('label', `${name}_text`, {
    text, align: 'center', width: '100%', height: 'content',
  }, [st({
    text_color: token(options.textColor ?? 'color.text.onaccent'),
    text_font: token(`font.size.${options.font ?? 18}`), text_align: 'center', text_opa: 255,
  })])]);
  if (options.target) {
    control.events = [{
      on: 'clicked', action: 'screen.open',
      args: { screen: options.target, anim: options.anim ?? 'fade_in', duration: 180, delay: 0 },
    }];
  }
  return control;
}

function progress(name, x, y, width, height, value, color = 'color.accent') {
  return node('bar', name, { x, y, width, height, min_value: 0, max_value: 100, value }, [
    st({ bg_color: token('color.track'), bg_opa: 255, radius: Math.round(height / 2) }, { part: 'main' }),
    st({ bg_color: token(color), bg_opa: 255, radius: Math.round(height / 2) }, { part: 'indicator' }),
  ]);
}

function arc(name, x, y, width, height, value, color = 'color.accent') {
  return node('arc', name, {
    x, y, width, height, min_value: 0, max_value: 100, value,
    bg_start_angle: 135, bg_end_angle: 45, start_angle: 135, end_angle: 45, knob_offset: -3,
  }, [
    st({ arc_color: token('color.track'), arc_width: Math.max(12, Math.round(width / 12)) }, { part: 'main' }),
    st({ arc_color: token(color), arc_width: Math.max(12, Math.round(width / 12)) }, { part: 'indicator' }),
    st({ bg_color: token(color), bg_opa: 0, radius: 20 }, { part: 'knob' }),
  ]);
}

function metricCard(name, title, value, unit, x, y, width, height, accent = 'color.accent') {
  return card(name, x, y, width, height, [
    label(`${name}_title`, title, 18, 14, width - 36, 24, 16, 'color.text.muted'),
    label(`${name}_value`, value, 18, 43, width - 36, 42, 30, accent),
    label(`${name}_unit`, unit, 18, height - 32, width - 36, 22, 16, 'color.text.muted'),
  ], { radius: 16 });
}

function compactMetric(name, title, value, unit, x, y, width, accent = 'color.accent') {
  return card(name, x, y, width, 56, [
    label(`${name}_title`, title, 12, 7, 72, 18, 12, 'color.text.muted'),
    label(`${name}_value`, value, 12, 25, 72, 24, 20, accent),
    label(`${name}_unit`, unit, 82, 28, width - 94, 18, 12, 'color.text.muted', 'right'),
  ], { radius: 12, shadow: false });
}

function root(width, height, children) {
  return node('obj', 'dashboard_root', {}, [st({
    bg_color: token('color.background'), bg_opa: 255, border_width: 0, pad_all: 0,
  })], children);
}

function focusOrbit(screens) {
  return root(240, 240, [
    label('focus_brand', 'FLOW', 72, 18, 96, 24, 18, 'color.text.muted', 'center'),
    button('focus_open_log', iconText(ICON.menu), 10, 94, 44, 48, { fill: 'color.surface2', border: 'color.border', textColor: 'color.text.muted', shadow: false, radius: 20, font: 16, target: screens.log }),
    button('focus_open_sound', iconText(ICON.music), 186, 94, 44, 48, { fill: 'color.surface2', border: 'color.border', textColor: 'color.text.muted', shadow: false, radius: 20, font: 16, target: screens.sound }),
    arc('focus_ring', 56, 44, 128, 128, 68, 'color.accent'),
    label('focus_time', '25:00', 62, 84, 116, 42, 36, 'color.text.primary', 'center'),
    label('focus_mode', 'DEEP FOCUS', 65, 126, 110, 22, 14, 'color.success', 'center'),
    button('focus_pause', iconText(ICON.stop, 'PAUSE'), 44, 178, 92, 42, { radius: 21, font: 12 }),
    button('focus_extend', iconText(ICON.next, '+5'), 144, 178, 52, 42, {
      fill: 'color.surface2', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 22, font: 16,
    }),
  ]);
}

function focusLog(screens) {
  return root(240, 240, [
    label('focus_log_brand', 'FLOW / LOG', 60, 16, 120, 24, 18, 'color.text.muted', 'center'),
    card('focus_log_card', 22, 50, 196, 116, [
      label('focus_log_today', 'TODAY', 16, 12, 72, 18, 12, 'color.text.muted'),
      label('focus_log_sessions', '3 SESSIONS', 16, 32, 164, 28, 22, 'color.text.primary'),
      label('focus_log_minutes', '68 MIN FOCUSED', 16, 62, 164, 22, 16, 'color.success'),
      progress('focus_log_goal', 16, 91, 164, 12, 76, 'color.accent'),
    ], { fill: 'color.surface2', radius: 20, shadow: false }),
    button('focus_log_back', iconText(ICON.back), 48, 178, 60, 42, { radius: 20, font: 16, target: screens.home, anim: 'move_right' }),
    button('focus_log_sound', iconText(ICON.music, 'SOUND'), 116, 178, 76, 42, { fill: 'color.surface2', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 20, font: 12, target: screens.sound }),
  ]);
}

function focusSound(screens) {
  return root(240, 240, [
    label('focus_sound_brand', 'SOUND SPACE', 54, 16, 132, 24, 18, 'color.text.muted', 'center'),
    card('focus_sound_card', 22, 50, 196, 116, [
      label('focus_sound_scene', 'SOFT RAIN', 16, 12, 164, 28, 22, 'color.text.primary', 'center'),
      label('focus_sound_note', 'Low distraction ambience', 16, 44, 164, 20, 12, 'color.text.muted', 'center'),
      label('focus_sound_volume', 'VOLUME  42%', 16, 70, 164, 18, 12, 'color.success'),
      progress('focus_sound_level', 16, 92, 164, 12, 42, 'color.accent2'),
    ], { fill: 'color.surface2', radius: 20, shadow: false }),
    button('focus_sound_back', iconText(ICON.back), 48, 178, 60, 42, { fill: 'color.surface2', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 20, font: 16, target: screens.home, anim: 'move_right' }),
    button('focus_sound_play', iconText(ICON.play, 'PLAY'), 116, 178, 76, 42, { radius: 20, font: 12, target: screens.home }),
  ]);
}

function wf3ButtonStyle(fill, border = '#28606B', pressed = '#1ED6B2') {
  return [
    st({
      bg_color: fill, bg_opa: 255, border_color: border, border_width: 1,
      radius: 6, pad_all: 0, shadow_width: 0, shadow_opa: 0,
    }),
    st({ bg_color: pressed, bg_opa: 255 }, { states: ['pressed'] }),
  ];
}

function restyleWf3Home(project) {
  const screen = project.uiProject.screens.find((item) => item.isHome)
    ?? project.uiProject.screens.find((item) => item.codeName === 'wf3_home');
  if (!screen) throw new Error('WF3 home screen is missing');

  screen.displayName = 'UART 总线工具台';
  screen.root.styleRefs = [];
  screen.root.styles = [st({
    bg_color: '#06181D', bg_opa: 255, border_width: 0, pad_all: 0,
  })];

  const byName = new Map(screen.root.children.map((child) => [child.codeName, child]));
  const setIconLabel = (control, color, width) => {
    const icon = control.children[0];
    if (!icon) return;
    icon.props = { ...icon.props, x: 0, y: 2, width, height: 34 };
    icon.styleRefs = [];
    icon.styles = [st({
      text_color: color, text_font: 'wf3_icons_32', text_align: 'center', text_opa: 255,
    })];
  };

  const back = byName.get('wf3_home_back');
  if (back) {
    back.props = { ...back.props, x: 0, y: 0, width: 40, height: 52 };
    back.styleRefs = [];
    back.styles = wf3ButtonStyle('#0E3B47', '#0E3B47', '#13B8A6');
    setIconLabel(back, '#FFFFFF', 40);
    if (back.children[0]) back.children[0].props.y = 9;
  }

  const voltage = byName.get('wf3_home_voltage');
  if (voltage) {
    voltage.props = { ...voltage.props, x: 0, y: 52, width: 40, height: 24 };
    voltage.styleRefs = [];
    voltage.styles = [st({
      bg_color: '#FF4D67', bg_opa: 255, border_color: '#FF4D67', border_width: 0,
      radius: 0, pad_all: 0, shadow_width: 0,
    })];
    const voltageText = voltage.children[0];
    if (voltageText) {
      voltageText.props = { ...voltageText.props, x: 0, y: 2, width: 40, height: 20 };
      voltageText.styleRefs = [];
      voltageText.styles = [st({
        text_color: '#FFFFFF', text_font: 'wf3_cn_14', text_align: 'center', text_opa: 255,
      })];
    }
  }

  const previous = byName.get('wf3_home_carousel_previous');
  if (previous) {
    previous.props = { ...previous.props, x: 40, y: 0, width: 40, height: 38 };
    previous.styleRefs = [];
    previous.styles = wf3ButtonStyle('#0D2930');
    setIconLabel(previous, '#8EB6BD', 40);
  }

  const next = byName.get('wf3_home_carousel_next');
  if (next) {
    next.props = { ...next.props, x: 230, y: 0, width: 54, height: 38 };
    next.styleRefs = [];
    next.styles = wf3ButtonStyle('#0D2930');
    setIconLabel(next, '#8EB6BD', 54);
  }

  const slotX = [80, 130, 180, 40, 100];
  const slotY = [0, 0, 0, 38, 38];
  const slotWidth = [50, 50, 50, 60, 60];
  for (const control of screen.root.children) {
    const match = control.codeName?.match(/^wf3_home_carousel_\d+_(\d+)_/);
    if (!match) continue;
    const slot = Number(match[1]);
    const active = slot === 0;
    control.props = {
      ...control.props,
      x: slotX[slot], y: slotY[slot], width: slotWidth[slot], height: 38,
    };
    control.styleRefs = [];
    control.styles = wf3ButtonStyle(
      active ? '#13B8A6' : '#0D2930',
      active ? '#13B8A6' : '#28606B',
      active ? '#1ED6B2' : '#123943',
    );
    setIconLabel(control, active ? '#FFFFFF' : '#8EB6BD', slotWidth[slot]);
  }

  const titlebar = byName.get('wf3_home_titlebar');
  if (titlebar) {
    titlebar.props = { ...titlebar.props, x: 160, y: 38, width: 124, height: 38 };
    titlebar.styleRefs = [];
    titlebar.styles = [st({
      bg_color: '#123943', bg_opa: 255, border_color: '#28606B', border_width: 1,
      radius: 6, pad_all: 0, shadow_width: 0,
    })];
    for (const title of titlebar.children) {
      title.props = { ...title.props, x: 0, y: 8, width: 124, height: 22 };
      title.styleRefs = [];
      title.styles = [st({
        text_color: '#F2C14E', text_font: 'wf3_cn_16', text_align: 'center', text_opa: 255,
      })];
    }
  }
}

function greenhouse(screens) {
  const health = card('green_health', 20, 70, 276, 190, [
    label('green_health_title', 'PLANT HEALTH', 20, 16, 236, 24, 16, 'color.text.muted'),
    arc('green_health_arc', 20, 42, 128, 128, 84, 'color.accent2'),
    label('green_health_value', '84', 48, 79, 72, 38, 30, 'color.text.primary', 'center'),
    label('green_health_unit', 'GOOD', 154, 73, 100, 28, 20, 'color.success', 'center'),
    label('green_health_zone', 'ZONE A', 148, 108, 112, 20, 16, 'color.text.muted', 'center'),
    label('green_health_crop', 'BASIL', 148, 132, 112, 20, 16, 'color.accent', 'center'),
  ], { fill: 'color.surface2', radius: 22 });
  const irrigation = card('green_irrigation', 20, 276, 440, 120, [
    label('green_irrigation_title', 'IRRIGATION', 20, 16, 180, 24, 18),
    label('green_irrigation_note', 'Next cycle  14:30', 20, 44, 220, 22, 16, 'color.text.muted'),
    progress('green_water_level', 20, 78, 250, 14, 72, 'color.accent'),
    button('green_water_now', iconText(ICON.play, 'WATER'), 296, 52, 124, 50, { font: 14, radius: 14, target: screens.water }),
  ], { radius: 20 });
  return root(480, 480, [
    brandLogo('green_brand_logo', 22, 18),
    label('green_status', 'ZONE A  /  ONLINE', 236, 23, 222, 26, 16, 'color.text.muted', 'right'),
    health,
    compactMetric('green_temp', 'AIR TEMP', '23.8', 'C', 308, 70, 152, 'color.warning'),
    compactMetric('green_soil', 'SOIL', '61', '%', 308, 136, 152, 'color.accent'),
    compactMetric('green_light', 'LIGHT', '740', 'lux', 308, 202, 152, 'color.accent2'),
    irrigation,
    button('green_nav_overview', iconText(ICON.home, 'HOME'), 20, 408, 100, 52, { radius: 14, font: 14, target: screens.home }),
    button('green_nav_zones', iconText(ICON.eye, 'ZONES'), 130, 408, 100, 52, { fill: 'color.surface', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 14, font: 14, target: screens.zones }),
    button('green_nav_water', iconText(ICON.refresh, 'WATER'), 240, 408, 100, 52, { fill: 'color.surface', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 14, font: 14, target: screens.water }),
    button('green_nav_log', iconText(ICON.menu, 'LOG'), 350, 408, 100, 52, { fill: 'color.surface', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 14, font: 14, target: screens.log }),
  ]);
}

function greenhouseZones(screens) {
  return root(480, 480, [
    label('green_zones_title', iconText(ICON.eye, 'GROW ZONES'), 22, 18, 260, 32, 24, 'color.accent'),
    button('green_zones_back', iconText(ICON.back, 'BACK'), 350, 12, 108, 44, { fill: 'color.surface', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 14, font: 14, target: screens.home, anim: 'move_right' }),
    card('green_zone_a', 20, 74, 440, 92, [
      label('green_zone_a_name', iconText(ICON.check, 'ZONE A / BASIL'), 18, 14, 230, 24, 18, 'color.success'),
      label('green_zone_a_value', '23.8 C   /   SOIL 61%', 18, 48, 260, 24, 18),
      label('green_zone_a_state', 'OPTIMAL', 318, 34, 104, 26, 16, 'color.success', 'right'),
    ], { fill: 'color.surface2', radius: 18, shadow: false }),
    card('green_zone_b', 20, 180, 440, 92, [
      label('green_zone_b_name', iconText(ICON.light, 'ZONE B / LETTUCE'), 18, 14, 240, 24, 18, 'color.accent'),
      label('green_zone_b_value', '22.6 C   /   SOIL 54%', 18, 48, 260, 24, 18),
      label('green_zone_b_state', 'LIGHT +8%', 298, 34, 124, 26, 16, 'color.warning', 'right'),
    ], { radius: 18, shadow: false }),
    card('green_zone_c', 20, 286, 440, 92, [
      label('green_zone_c_name', iconText(ICON.refresh, 'ZONE C / MINT'), 18, 14, 230, 24, 18, 'color.accent'),
      label('green_zone_c_value', '24.1 C   /   SOIL 47%', 18, 48, 260, 24, 18),
      label('green_zone_c_state', 'WATER SOON', 288, 34, 134, 26, 16, 'color.warning', 'right'),
    ], { radius: 18, shadow: false }),
    button('green_zones_water', iconText(ICON.refresh, 'IRRIGATION'), 20, 402, 210, 58, { radius: 16, font: 16, target: screens.water }),
    button('green_zones_log', iconText(ICON.menu, 'EVENT LOG'), 250, 402, 210, 58, { fill: 'color.surface', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 16, font: 16, target: screens.log }),
  ]);
}

function greenhouseWater(screens) {
  return root(480, 480, [
    label('green_water_title', iconText(ICON.refresh, 'IRRIGATION'), 22, 18, 260, 32, 24, 'color.accent'),
    button('green_water_back', iconText(ICON.back, 'BACK'), 350, 12, 108, 44, { fill: 'color.surface', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 14, font: 14, target: screens.home, anim: 'move_right' }),
    card('green_water_tank', 20, 76, 440, 132, [
      label('green_water_tank_title', 'NUTRIENT TANK', 20, 16, 200, 24, 18, 'color.text.muted'),
      label('green_water_tank_value', '72%', 20, 46, 100, 40, 30, 'color.accent'),
      progress('green_water_tank_bar', 132, 58, 284, 18, 72, 'color.accent'),
      label('green_water_tank_note', iconText(ICON.check, 'FLOW AND PH NORMAL'), 20, 98, 396, 22, 16, 'color.success'),
    ], { fill: 'color.surface2', radius: 20 }),
    card('green_water_schedule', 20, 224, 440, 132, [
      label('green_water_schedule_title', iconText(ICON.menu, 'NEXT CYCLES'), 20, 16, 200, 24, 18),
      label('green_water_schedule_a', '14:30   ZONE C   4 MIN', 20, 50, 260, 24, 18),
      label('green_water_schedule_b', '16:10   ZONE A   3 MIN', 20, 82, 260, 24, 18, 'color.text.muted'),
      button('green_water_start', iconText(ICON.play, 'START'), 300, 50, 116, 54, { radius: 14, font: 16 }),
    ], { radius: 20 }),
    button('green_water_zones', iconText(ICON.eye, 'ZONES'), 20, 382, 210, 66, { fill: 'color.surface', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 16, font: 16, target: screens.zones }),
    button('green_water_home', iconText(ICON.home, 'OVERVIEW'), 250, 382, 210, 66, { radius: 16, font: 16, target: screens.home }),
  ]);
}

function greenhouseLog(screens) {
  return root(480, 480, [
    label('green_log_title', iconText(ICON.menu, 'EVENT LOG'), 22, 18, 260, 32, 24, 'color.accent'),
    button('green_log_back', iconText(ICON.back, 'BACK'), 350, 12, 108, 44, { fill: 'color.surface', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 14, font: 14, target: screens.home, anim: 'move_right' }),
    card('green_log_list', 20, 76, 440, 292, [
      label('green_log_one_icon', ICON.check, 18, 22, 34, 34, 24, 'color.success', 'center'),
      label('green_log_one', '09:18  Zone A cycle complete', 64, 20, 338, 28, 18),
      label('green_log_one_note', '3.2 L delivered / flow normal', 64, 50, 338, 22, 14, 'color.text.muted'),
      label('green_log_two_icon', ICON.light, 18, 104, 34, 34, 24, 'color.warning', 'center'),
      label('green_log_two', '08:42  Zone B light raised', 64, 102, 338, 28, 18),
      label('green_log_two_note', 'Target restored to 760 lux', 64, 132, 338, 22, 14, 'color.text.muted'),
      label('green_log_three_icon', ICON.refresh, 18, 186, 34, 34, 24, 'color.accent', 'center'),
      label('green_log_three', '07:55  Ventilation cycle', 64, 184, 338, 28, 18),
      label('green_log_three_note', 'Humidity reduced to 58%', 64, 214, 338, 22, 14, 'color.text.muted'),
    ], { radius: 20 }),
    button('green_log_clear', iconText(ICON.check, 'MARK READ'), 20, 392, 210, 60, { fill: 'color.surface', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 16, font: 16 }),
    button('green_log_home', iconText(ICON.home, 'OVERVIEW'), 250, 392, 210, 60, { radius: 16, font: 16, target: screens.home }),
  ]);
}

function evNav(screens, active) {
  const navButton = (key, name, text, y, icon) => button(name, iconText(icon, text), 16, y, 110, 58, {
    fill: active === key ? 'color.accent' : 'color.surface2',
    border: active === key ? 'color.accent' : 'color.border',
    textColor: active === key ? 'color.text.onaccent' : 'color.text.primary',
    shadow: active === key,
    radius: 16, font: 14, target: screens[key],
  });
  return card(`ev_nav_${active}`, 0, 0, 142, 600, [
    brandLogo(`ev_${active}_brand_logo`, 55, 28),
    label(`ev_${active}_station`, iconText(ICON.wifi, '08'), 20, 64, 102, 22, 16, 'color.text.muted', 'center'),
    navButton('charge', `ev_nav_${active}_charge`, 'CHARGE', 116, ICON.light),
    navButton('sessions', `ev_nav_${active}_sessions`, 'SESSIONS', 190, ICON.menu),
    navButton('payment', `ev_nav_${active}_payment`, 'PAYMENT', 264, ICON.check),
    label(`ev_${active}_connector`, iconText(ICON.check, 'CCS2 READY'), 12, 548, 118, 24, 14, 'color.success', 'center'),
  ], { radius: 0, borderWidth: 0, shadow: false });
}

function evCharge(screens) {
  const nav = evNav(screens, 'charge');
  const hero = card('ev_charge_card', 170, 92, 526, 328, [
    label('ev_charge_title', 'ACTIVE CHARGE', 28, 22, 260, 28, 18, 'color.text.muted'),
    arc('ev_charge_arc', 28, 62, 218, 218, 72, 'color.accent2'),
    label('ev_charge_percent', '72%', 72, 126, 130, 48, 40, 'color.text.primary', 'center'),
    label('ev_charge_eta', '38 MIN LEFT', 74, 174, 126, 22, 16, 'color.accent2', 'center'),
    label('ev_vehicle', 'NOVA E6', 276, 76, 220, 38, 30, 'color.text.primary'),
    label('ev_battery', 'Battery target  90%', 276, 126, 220, 24, 18, 'color.text.muted'),
    progress('ev_battery_bar', 276, 164, 216, 16, 72, 'color.accent'),
    label('ev_power', '82.4 kW', 276, 204, 220, 42, 36, 'color.accent2'),
    label('ev_power_note', 'Charging power', 276, 248, 220, 22, 16, 'color.text.muted'),
  ], { fill: 'color.surface2', radius: 26 });
  const billing = card('ev_billing', 718, 92, 282, 328, [
    label('ev_billing_title', 'THIS SESSION', 24, 22, 234, 26, 18, 'color.text.muted'),
    label('ev_energy_value', '31.6', 24, 68, 160, 46, 40, 'color.text.primary'),
    label('ev_energy_unit', 'kWh delivered', 24, 112, 190, 24, 16, 'color.text.muted'),
    label('ev_cost_value', '$ 12.48', 24, 158, 200, 38, 30, 'color.warning'),
    label('ev_cost_note', 'Estimated total', 24, 198, 200, 22, 16, 'color.text.muted'),
    button('ev_stop', iconText(ICON.stop, 'STOP CHARGE'), 24, 250, 234, 56, { fill: 'color.danger', border: 'color.danger', radius: 18, font: 16 }),
  ], { radius: 26 });
  const footer = card('ev_footer', 170, 438, 830, 138, [
    label('ev_footer_title', 'LIVE STATUS', 24, 18, 170, 22, 16, 'color.text.muted'),
    label('ev_voltage', '398 V', 24, 54, 150, 36, 28, 'color.text.primary'),
    label('ev_current', '207 A', 220, 54, 150, 36, 28, 'color.text.primary'),
    label('ev_temp', '34 C', 416, 54, 150, 36, 28, 'color.text.primary'),
    label('ev_state', 'CONNECTED / AUTHORIZED / COOLING NORMAL', 24, 102, 740, 22, 16, 'color.success'),
  ], { radius: 22 });
  return root(1024, 600, [
    nav,
    label('ev_page_title', iconText(ICON.light, 'Fast charging'), 170, 28, 420, 40, 30),
    label('ev_clock', iconText(ICON.wifi, '18:42  /  BAY 03'), 680, 34, 320, 28, 18, 'color.text.muted', 'right'),
    hero, billing, footer,
  ]);
}

function evSessions(screens) {
  return root(1024, 600, [
    evNav(screens, 'sessions'),
    label('ev_sessions_title', iconText(ICON.menu, 'Charging sessions'), 170, 28, 500, 40, 30),
    label('ev_sessions_summary', 'TODAY  6 SESSIONS  /  184.2 kWh', 650, 36, 350, 28, 18, 'color.text.muted', 'right'),
    card('ev_sessions_active', 170, 92, 830, 112, [
      label('ev_sessions_active_icon', ICON.light, 22, 28, 56, 56, 36, 'color.accent2', 'center'),
      label('ev_sessions_active_vehicle', 'NOVA E6', 96, 20, 230, 30, 24),
      label('ev_sessions_active_note', 'BAY 03  /  31.6 kWh  /  ACTIVE', 96, 56, 330, 24, 16, 'color.success'),
      label('ev_sessions_active_cost', '$ 12.48', 620, 34, 180, 38, 30, 'color.warning', 'right'),
    ], { fill: 'color.surface2', radius: 20 }),
    card('ev_sessions_list', 170, 224, 830, 286, [
      label('ev_session_row1_icon', ICON.check, 22, 28, 40, 32, 24, 'color.success', 'center'),
      label('ev_session_row1', '17:06   AURORA S   /   BAY 01', 80, 24, 390, 30, 20),
      label('ev_session_row1_meta', '42 min   /   44.8 kWh', 80, 58, 300, 24, 16, 'color.text.muted'),
      label('ev_session_row1_cost', '$ 17.72', 640, 36, 150, 30, 22, 'color.text.primary', 'right'),
      label('ev_session_row2_icon', ICON.check, 22, 116, 40, 32, 24, 'color.success', 'center'),
      label('ev_session_row2', '14:32   CITY ONE   /   BAY 04', 80, 112, 390, 30, 20),
      label('ev_session_row2_meta', '28 min   /   27.3 kWh', 80, 146, 300, 24, 16, 'color.text.muted'),
      label('ev_session_row2_cost', '$ 10.80', 640, 124, 150, 30, 22, 'color.text.primary', 'right'),
      label('ev_session_row3_icon', ICON.check, 22, 204, 40, 32, 24, 'color.success', 'center'),
      label('ev_session_row3', '11:18   NOVA X2   /   BAY 02', 80, 200, 390, 30, 20),
      label('ev_session_row3_meta', '35 min   /   38.5 kWh', 80, 234, 300, 24, 16, 'color.text.muted'),
      label('ev_session_row3_cost', '$ 15.23', 640, 212, 150, 30, 22, 'color.text.primary', 'right'),
    ], { radius: 22 }),
    button('ev_sessions_export', iconText(ICON.next, 'EXPORT REPORT'), 762, 526, 238, 54, { fill: 'color.surface2', border: 'color.accent2', textColor: 'color.accent2', shadow: false, radius: 16, font: 16 }),
  ]);
}

function evPayment(screens) {
  return root(1024, 600, [
    evNav(screens, 'payment'),
    label('ev_payment_title', iconText(ICON.check, 'Payment & access'), 170, 28, 500, 40, 30),
    label('ev_payment_status', iconText(ICON.wifi, 'TERMINAL ONLINE'), 700, 36, 300, 28, 18, 'color.success', 'right'),
    card('ev_payment_method', 170, 92, 500, 396, [
      label('ev_payment_method_title', 'DEFAULT PAYMENT', 28, 24, 300, 26, 18, 'color.text.muted'),
      label('ev_payment_card_icon', ICON.check, 28, 78, 72, 72, 40, 'color.accent2', 'center'),
      label('ev_payment_card', 'FLEET CARD', 122, 82, 300, 36, 28),
      label('ev_payment_card_no', '••••  4821', 122, 124, 260, 26, 18, 'color.text.muted'),
      label('ev_payment_rate', 'RATE', 28, 190, 120, 24, 16, 'color.text.muted'),
      label('ev_payment_rate_value', '$0.395 / kWh', 28, 222, 300, 38, 30, 'color.warning'),
      button('ev_payment_change', iconText(ICON.settings, 'CHANGE CARD'), 28, 306, 210, 60, { fill: 'color.surface2', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 16, font: 16 }),
      button('ev_payment_receipt', iconText(ICON.menu, 'RECEIPTS'), 258, 306, 210, 60, { radius: 16, font: 16, target: screens.sessions }),
    ], { radius: 26 }),
    card('ev_payment_limits', 694, 92, 306, 396, [
      label('ev_payment_limits_title', iconText(ICON.settings, 'SESSION LIMITS'), 24, 24, 258, 26, 18),
      label('ev_payment_energy_label', 'ENERGY CAP', 24, 82, 200, 22, 16, 'color.text.muted'),
      label('ev_payment_energy_value', '60 kWh', 24, 112, 220, 36, 28),
      progress('ev_payment_energy_bar', 24, 158, 258, 16, 60, 'color.accent2'),
      label('ev_payment_cost_label', 'COST CAP', 24, 206, 200, 22, 16, 'color.text.muted'),
      label('ev_payment_cost_value', '$ 25.00', 24, 236, 220, 36, 28, 'color.warning'),
      label('ev_payment_auto', iconText(ICON.check, 'AUTO RECEIPT ENABLED'), 24, 320, 258, 24, 16, 'color.success'),
    ], { fill: 'color.surface2', radius: 26 }),
    button('ev_payment_home', iconText(ICON.home, 'BACK TO CHARGE'), 762, 512, 238, 64, { radius: 18, font: 16, target: screens.charge, anim: 'move_right' }),
  ]);
}

function factoryRail(screens, active) {
  const railButton = (key, name, text, y, icon) => button(name, iconText(icon, text), 16, y, 170, 62, {
    fill: active === key ? 'color.accent' : 'color.surface2',
    border: active === key ? 'color.accent' : 'color.border',
    textColor: active === key ? 'color.text.onaccent' : 'color.text.primary',
    shadow: false, radius: 12, font: 16, target: screens[key],
  });
  return card(`factory_rail_${active}`, 24, 88, 202, 606, [
    label(`factory_${active}_rail_title`, 'AREAS', 24, 24, 154, 24, 16, 'color.text.muted'),
    railButton('energy', `factory_nav_${active}_energy`, 'ENERGY', 66, ICON.light),
    railButton('lines', `factory_nav_${active}_lines`, 'LINES', 142, ICON.menu),
    railButton('storage', `factory_nav_${active}_storage`, 'STORAGE', 218, ICON.refresh),
    railButton('alerts', `factory_nav_${active}_alerts`, 'ALERTS 2', 294, ICON.warning),
    label(`factory_${active}_shift`, iconText(ICON.check, 'SHIFT B'), 24, 516, 154, 24, 18, 'color.accent2', 'center'),
    label(`factory_${active}_operator`, 'Operator 07', 24, 548, 154, 22, 16, 'color.text.muted', 'center'),
  ], { radius: 14, shadow: false });
}

function factoryEnergy(screens) {
  const rail = factoryRail(screens, 'energy');
  const load = card('factory_load', 250, 236, 510, 300, [
    label('factory_load_title', 'LINE DEMAND', 24, 20, 240, 28, 18),
    label('factory_line_a', 'STAMPING', 24, 72, 140, 24, 16, 'color.text.muted'),
    progress('factory_line_a_bar', 170, 76, 300, 16, 82, 'color.accent'),
    label('factory_line_b', 'PAINT', 24, 124, 140, 24, 16, 'color.text.muted'),
    progress('factory_line_b_bar', 170, 128, 300, 16, 57, 'color.accent2'),
    label('factory_line_c', 'ASSEMBLY', 24, 176, 140, 24, 16, 'color.text.muted'),
    progress('factory_line_c_bar', 170, 180, 300, 16, 71, 'color.success'),
    label('factory_peak_note', 'Peak forecast  14:20  /  1.28 MW', 24, 238, 440, 24, 18, 'color.warning'),
  ], { radius: 14, shadow: false });
  const controls = card('factory_controls', 780, 236, 274, 300, [
    label('factory_controls_title', 'LOAD CONTROL', 22, 20, 230, 28, 18),
    label('factory_mode', 'AUTO BALANCE', 22, 68, 230, 26, 20, 'color.success'),
    label('factory_limit', 'Demand limit', 22, 116, 180, 22, 16, 'color.text.muted'),
    label('factory_limit_value', '1.40 MW', 22, 146, 220, 36, 30, 'color.accent2'),
    button('factory_optimize', iconText(ICON.refresh, 'OPTIMIZE'), 22, 220, 230, 58, { radius: 12, font: 16 }),
  ], { radius: 14, shadow: false });
  const alert = card('factory_alert', 250, 554, 804, 140, [
    label('factory_alert_title', 'MAINTENANCE WINDOW', 24, 18, 300, 24, 16, 'color.text.muted'),
    label('factory_alert_text', 'Compressor 04 inspection scheduled at 22:30', 24, 54, 560, 30, 22),
    button('factory_alert_ack', iconText(ICON.check, 'ACKNOWLEDGE'), 598, 42, 180, 58, { fill: 'color.surface2', border: 'color.accent2', textColor: 'color.accent2', shadow: false, radius: 12, font: 14, target: screens.alerts }),
  ], { fill: 'color.surface2', radius: 14, shadow: false });
  return root(1080, 720, [
    brandLogo('factory_brand_logo', 28, 24),
    label('factory_status', iconText(ICON.wifi, 'PLANT 02  /  GRID CONNECTED  /  09:41'), 570, 30, 482, 28, 18, 'color.text.muted', 'right'),
    rail,
    metricCard('factory_grid', 'GRID LOAD', '1.18', 'MW', 250, 88, 180, 128, 'color.accent'),
    metricCard('factory_solar', 'SOLAR', '284', 'kW', 446, 88, 180, 128, 'color.warning'),
    metricCard('factory_battery', 'BATTERY', '76', 'percent', 642, 88, 180, 128, 'color.success'),
    metricCard('factory_efficiency', 'EFFICIENCY', '93.4', 'percent', 838, 88, 216, 128, 'color.accent2'),
    load, controls, alert,
  ]);
}

function factoryLines(screens) {
  const rows = [
    ['STAMPING A', '82%', '1.8k units', 'color.accent'],
    ['PAINT B', '57%', '1.2k units', 'color.accent2'],
    ['ASSEMBLY C', '71%', '940 units', 'color.success'],
    ['PACKING D', '44%', '1.5k units', 'color.warning'],
  ];
  const children = [
    label('factory_lines_brand', iconText(ICON.menu, 'FORGE / PRODUCTION LINES'), 250, 26, 500, 38, 28, 'color.accent'),
    label('factory_lines_status', iconText(ICON.check, '4 LINES RUNNING'), 800, 32, 254, 28, 18, 'color.success', 'right'),
    factoryRail(screens, 'lines'),
  ];
  rows.forEach(([name, load, output, color], index) => {
    const y = 88 + index * 138;
    children.push(card(`factory_line_${index}`, 250, y, 804, 120, [
      label(`factory_line_${index}_name`, name, 24, 18, 240, 30, 22),
      label(`factory_line_${index}_output`, output, 24, 56, 220, 24, 16, 'color.text.muted'),
      label(`factory_line_${index}_load`, load, 650, 20, 110, 34, 28, color, 'right'),
      progress(`factory_line_${index}_bar`, 280, 54, 350, 18, Number.parseInt(load, 10), color),
      label(`factory_line_${index}_state`, iconText(ICON.check, 'NORMAL'), 650, 66, 110, 22, 14, 'color.success', 'right'),
    ], { radius: 14, shadow: false }));
  });
  return root(1080, 720, children);
}

function factoryStorage(screens) {
  return root(1080, 720, [
    label('factory_storage_brand', iconText(ICON.refresh, 'FORGE / STORAGE'), 250, 26, 500, 38, 28, 'color.accent'),
    label('factory_storage_status', iconText(ICON.wifi, 'MICROGRID ONLINE'), 800, 32, 254, 28, 18, 'color.success', 'right'),
    factoryRail(screens, 'storage'),
    card('factory_storage_battery', 250, 88, 510, 390, [
      label('factory_storage_battery_title', 'BATTERY BANK 01', 26, 22, 300, 30, 22),
      arc('factory_storage_battery_arc', 38, 74, 220, 220, 76, 'color.success'),
      label('factory_storage_battery_value', '76%', 82, 150, 132, 44, 36, 'color.text.primary', 'center'),
      label('factory_storage_power', 'OUTPUT  186 kW', 288, 94, 190, 30, 22, 'color.accent2'),
      label('factory_storage_temp', 'TEMP  31 C', 288, 146, 190, 26, 18, 'color.text.muted'),
      label('factory_storage_cycles', 'CYCLES  1,284', 288, 190, 190, 26, 18, 'color.text.muted'),
      label('factory_storage_health', iconText(ICON.check, 'HEALTH  96%'), 288, 238, 190, 26, 18, 'color.success'),
      button('factory_storage_mode', iconText(ICON.refresh, 'AUTO BALANCE'), 288, 294, 190, 60, { radius: 12, font: 14 }),
    ], { radius: 14, shadow: false }),
    card('factory_storage_flow', 780, 88, 274, 390, [
      label('factory_storage_flow_title', iconText(ICON.light, 'POWER FLOW'), 22, 22, 230, 28, 18),
      label('factory_storage_grid', 'GRID', 22, 80, 100, 24, 16, 'color.text.muted'),
      label('factory_storage_grid_value', '+ 124 kW', 120, 76, 130, 30, 22, 'color.accent'),
      label('factory_storage_solar', 'SOLAR', 22, 136, 100, 24, 16, 'color.text.muted'),
      label('factory_storage_solar_value', '+ 284 kW', 120, 132, 130, 30, 22, 'color.warning'),
      label('factory_storage_load', 'LOAD', 22, 192, 100, 24, 16, 'color.text.muted'),
      label('factory_storage_load_value', '- 594 kW', 120, 188, 130, 30, 22, 'color.danger'),
      label('factory_storage_net', 'BATTERY', 22, 260, 100, 24, 16, 'color.text.muted'),
      label('factory_storage_net_value', '+ 186 kW', 120, 256, 130, 30, 22, 'color.success'),
    ], { fill: 'color.surface2', radius: 14, shadow: false }),
    card('factory_storage_plan', 250, 498, 804, 196, [
      label('factory_storage_plan_title', iconText(ICON.menu, 'DISPATCH PLAN'), 24, 20, 260, 28, 18),
      label('factory_storage_plan_text', 'Charge from solar until 14:20, then support Line A peak.', 24, 64, 600, 30, 20),
      label('factory_storage_plan_eta', 'RESERVE AT 18:00  /  58%', 24, 112, 400, 26, 18, 'color.accent2'),
      button('factory_storage_edit', iconText(ICON.settings, 'EDIT PLAN'), 598, 84, 180, 64, { fill: 'color.surface2', border: 'color.accent2', textColor: 'color.accent2', shadow: false, radius: 12, font: 16 }),
    ], { radius: 14, shadow: false }),
  ]);
}

function factoryAlerts(screens) {
  return root(1080, 720, [
    label('factory_alerts_brand', iconText(ICON.warning, 'FORGE / ALERT CENTER'), 250, 26, 500, 38, 28, 'color.warning'),
    label('factory_alerts_status', '2 OPEN  /  7 RESOLVED TODAY', 740, 32, 314, 28, 18, 'color.text.muted', 'right'),
    factoryRail(screens, 'alerts'),
    card('factory_alerts_one', 250, 88, 804, 170, [
      label('factory_alerts_one_icon', ICON.warning, 24, 42, 64, 64, 40, 'color.warning', 'center'),
      label('factory_alerts_one_title', 'COMPRESSOR 04 / INSPECTION DUE', 110, 24, 520, 30, 22),
      label('factory_alerts_one_note', 'Vibration trend exceeded advisory threshold at 18:34.', 110, 64, 570, 26, 18, 'color.text.muted'),
      label('factory_alerts_one_time', 'DUE 22:30', 110, 104, 220, 24, 16, 'color.warning'),
      button('factory_alerts_one_ack', iconText(ICON.check, 'ACK'), 660, 58, 118, 60, { radius: 12, font: 16 }),
    ], { fill: 'color.surface2', radius: 14, shadow: false }),
    card('factory_alerts_two', 250, 278, 804, 170, [
      label('factory_alerts_two_icon', ICON.refresh, 24, 42, 64, 64, 40, 'color.accent2', 'center'),
      label('factory_alerts_two_title', 'PAINT B / FILTER PRESSURE RISING', 110, 24, 520, 30, 22),
      label('factory_alerts_two_note', 'Pressure is 8% above baseline. Production remains stable.', 110, 64, 570, 26, 18, 'color.text.muted'),
      label('factory_alerts_two_time', 'OBSERVE NEXT SHIFT', 110, 104, 280, 24, 16, 'color.accent2'),
      button('factory_alerts_two_view', iconText(ICON.eye, 'VIEW'), 660, 58, 118, 60, { fill: 'color.surface2', border: 'color.accent2', textColor: 'color.accent2', shadow: false, radius: 12, font: 16 }),
    ], { radius: 14, shadow: false }),
    card('factory_alerts_footer', 250, 468, 804, 226, [
      label('factory_alerts_footer_title', iconText(ICON.check, 'SYSTEM STATUS'), 24, 22, 260, 28, 18),
      label('factory_alerts_safety', 'SAFETY LOOP', 24, 76, 180, 24, 16, 'color.text.muted'),
      label('factory_alerts_safety_value', 'NORMAL', 220, 72, 180, 30, 22, 'color.success'),
      label('factory_alerts_network', 'CONTROL NETWORK', 24, 124, 180, 24, 16, 'color.text.muted'),
      label('factory_alerts_network_value', 'ONLINE', 220, 120, 180, 30, 22, 'color.success'),
      button('factory_alerts_history', iconText(ICON.menu, 'HISTORY'), 598, 90, 180, 64, { fill: 'color.surface2', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 12, font: 16 }),
    ], { radius: 14, shadow: false }),
  ]);
}

function harborDispatch(screens) {
  const queueItem = (name, y, vessel, berth, eta, active = false) => card(name, 16, y, 278, 90, [
    label(`${name}_vessel`, vessel, 18, 14, 160, 26, 20, active ? 'color.text.onaccent' : 'color.text.primary'),
    label(`${name}_berth`, berth, 18, 50, 130, 22, 16, active ? 'color.text.onaccent' : 'color.text.muted'),
    label(`${name}_eta`, eta, 162, 49, 98, 22, 16, active ? 'color.text.onaccent' : 'color.accent', 'right'),
  ], { fill: active ? 'color.accent' : 'color.surface', border: active ? 'color.accent' : 'color.border', radius: 12, shadow: false });
  const queue = card('harbor_queue', 24, 96, 310, 600, [
    label('harbor_queue_title', iconText(ICON.menu, 'ARRIVAL QUEUE'), 18, 18, 250, 28, 20),
    label('harbor_queue_count', '4 VESSELS', 18, 50, 220, 22, 16, 'color.text.muted'),
    queueItem('harbor_ship_one', 86, 'NORTH STAR', 'BERTH A2', 'ETA 09:56', true),
    queueItem('harbor_ship_two', 188, 'BLUE MERIDIAN', 'ANCHORAGE', 'ETA 10:22'),
    queueItem('harbor_ship_three', 290, 'ATLAS WIND', 'BERTH C1', 'ETA 10:48'),
    queueItem('harbor_ship_four', 392, 'PACIFIC ECHO', 'CHANNEL 4', 'ETA 11:10'),
    label('harbor_queue_note', 'Pilot team P-03 assigned', 18, 528, 270, 24, 16, 'color.success'),
  ], { radius: 14 });
  const map = card('harbor_map', 354, 96, 700, 500, [
    label('harbor_map_title', iconText(ICON.eye, 'APPROACH CONTROL'), 24, 20, 320, 28, 20),
    label('harbor_map_weather', 'VISIBILITY 8.4 NM', 430, 24, 240, 24, 16, 'color.text.muted', 'right'),
    card('harbor_water', 24, 66, 652, 314, [], { fill: 'color.surface2', border: 'color.border', radius: 12, shadow: false }),
    card('harbor_route_a', 90, 222, 170, 10, [], { fill: 'color.accent', border: 'color.accent', radius: 5, shadow: false }),
    card('harbor_route_b', 250, 180, 180, 10, [], { fill: 'color.accent', border: 'color.accent', radius: 5, shadow: false }),
    card('harbor_route_c', 420, 138, 150, 10, [], { fill: 'color.accent2', border: 'color.accent2', radius: 5, shadow: false }),
    card('harbor_marker_ship', 70, 204, 36, 36, [label('harbor_marker_ship_text', 'N', 6, 7, 24, 20, 16, 'color.text.onaccent', 'center')], { fill: 'color.accent', border: 'color.accent', radius: 18, shadow: false }),
    card('harbor_marker_gate', 560, 120, 42, 42, [label('harbor_marker_gate_text', 'A2', 4, 10, 34, 20, 16, 'color.text.onaccent', 'center')], { fill: 'color.accent2', border: 'color.accent2', radius: 21, shadow: false }),
    label('harbor_distance', '3.8 NM TO PILOT POINT', 34, 398, 300, 28, 20, 'color.accent'),
    progress('harbor_progress', 34, 442, 632, 14, 64, 'color.accent2'),
  ], { radius: 14 });
  const conditions = card('harbor_conditions', 1074, 96, 342, 500, [
    label('harbor_conditions_title', iconText(ICON.wifi, 'PORT CONDITIONS'), 22, 20, 296, 28, 20),
    metricCard('harbor_tide', 'TIDE', '+1.8', 'm rising', 18, 66, 146, 126, 'color.accent'),
    metricCard('harbor_wind', 'WIND', '14', 'knots NE', 178, 66, 146, 126, 'color.warning'),
    metricCard('harbor_depth', 'DEPTH', '12.6', 'meters', 18, 208, 146, 126, 'color.success'),
    metricCard('harbor_cranes', 'CRANES', '06', 'available', 178, 208, 146, 126, 'color.accent2'),
    label('harbor_notice_title', 'CHANNEL NOTICE', 22, 364, 240, 22, 16, 'color.text.muted'),
    label('harbor_notice', 'Speed limit 8 kn after buoy 7', 22, 398, 292, 52, 18, 'color.text.primary'),
  ], { radius: 14 });
  return root(1440, 720, [
    card('harbor_header', 0, 0, 1440, 76, [
      brandLogo('harbor_brand_logo', 24, 20),
      label('harbor_header_status', iconText(ICON.check, 'TRAFFIC NORMAL  /  09:41'), 940, 24, 470, 28, 18, 'color.text.onaccent', 'right'),
    ], { fill: 'color.accent', border: 'color.accent', radius: 0, shadow: false }),
    queue, map, conditions,
    button('harbor_hold', iconText(ICON.stop, 'HOLD POSITION'), 354, 616, 220, 64, { fill: 'color.surface', border: 'color.warning', textColor: 'color.warning', shadow: false, radius: 12, font: 16 }),
    button('harbor_assign', iconText(ICON.check, 'VESSEL DETAIL'), 592, 616, 220, 64, { radius: 12, font: 16, target: screens.vessel }),
    button('harbor_clear', iconText(ICON.next, 'BERTH CONTROL'), 830, 616, 300, 64, { fill: 'color.accent2', border: 'color.accent2', textColor: 'color.text.primary', radius: 12, font: 16, target: screens.berths }),
    button('harbor_contact', iconText(ICON.volume, 'VHF 12'), 1148, 616, 268, 64, { fill: 'color.surface', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 12, font: 16, target: screens.radio }),
  ]);
}

function harborPageHeader(name, title, status, screens) {
  return card(`${name}_header`, 0, 0, 1440, 76, [
    label(`${name}_title`, title, 24, 20, 640, 36, 28, 'color.text.onaccent'),
    label(`${name}_status`, status, 820, 24, 430, 28, 18, 'color.text.onaccent', 'right'),
    button(`${name}_back`, iconText(ICON.back, 'OVERVIEW'), 1270, 12, 146, 52, { fill: 'color.surface', border: 'color.surface', textColor: 'color.accent', shadow: false, radius: 12, font: 16, target: screens.home, anim: 'move_right' }),
  ], { fill: 'color.accent', border: 'color.accent', radius: 0, shadow: false });
}

function harborVessel(screens) {
  return root(1440, 720, [
    harborPageHeader('harbor_vessel', iconText(ICON.eye, 'VESSEL / NORTH STAR'), 'ETA PILOT POINT  09:56', screens),
    card('harbor_vessel_identity', 24, 100, 420, 594, [
      label('harbor_vessel_identity_title', 'NORTH STAR', 28, 26, 360, 44, 36, 'color.accent'),
      label('harbor_vessel_identity_type', 'CONTAINER / IMO 9482217', 28, 78, 360, 28, 18, 'color.text.muted'),
      label('harbor_vessel_identity_icon', ICON.next, 126, 132, 168, 140, 44, 'color.accent2', 'center'),
      label('harbor_vessel_length_label', 'LENGTH', 28, 312, 140, 24, 16, 'color.text.muted'),
      label('harbor_vessel_length', '294 m', 190, 306, 180, 32, 24),
      label('harbor_vessel_draft_label', 'DRAFT', 28, 366, 140, 24, 16, 'color.text.muted'),
      label('harbor_vessel_draft', '11.8 m', 190, 360, 180, 32, 24),
      label('harbor_vessel_cargo_label', 'CARGO', 28, 420, 140, 24, 16, 'color.text.muted'),
      label('harbor_vessel_cargo', '4,820 TEU', 190, 414, 180, 32, 24),
      label('harbor_vessel_document_status', iconText(ICON.check, 'DOCUMENTS VERIFIED'), 28, 512, 360, 28, 18, 'color.success'),
    ], { radius: 16 }),
    card('harbor_vessel_plan', 468, 100, 948, 350, [
      label('harbor_vessel_plan_title', iconText(ICON.menu, 'ARRIVAL PLAN'), 28, 24, 340, 30, 22),
      label('harbor_vessel_step1_icon', ICON.check, 32, 84, 48, 48, 28, 'color.success', 'center'),
      label('harbor_vessel_step1', 'PILOT TEAM P-03', 98, 82, 360, 28, 20),
      label('harbor_vessel_step1_note', 'Boarding at buoy 7 / 09:56', 98, 114, 360, 24, 16, 'color.text.muted'),
      label('harbor_vessel_step2_icon', ICON.next, 32, 166, 48, 48, 28, 'color.accent', 'center'),
      label('harbor_vessel_step2', 'CHANNEL TRANSIT', 98, 164, 360, 28, 20),
      label('harbor_vessel_step2_note', 'Route N2 / speed limit 8 kn', 98, 196, 360, 24, 16, 'color.text.muted'),
      label('harbor_vessel_step3_icon', ICON.home, 32, 248, 48, 48, 28, 'color.accent2', 'center'),
      label('harbor_vessel_step3', 'BERTH A2', 98, 246, 360, 28, 20),
      label('harbor_vessel_step3_note', 'Tugs T-04 and T-07 assigned', 98, 278, 360, 24, 16, 'color.text.muted'),
      button('harbor_vessel_radio', iconText(ICON.volume, 'CONTACT VHF 12'), 650, 86, 260, 64, { fill: 'color.surface', border: 'color.accent', textColor: 'color.accent', shadow: false, radius: 12, font: 16, target: screens.radio }),
      button('harbor_vessel_berth', iconText(ICON.next, 'OPEN BERTH A2'), 650, 174, 260, 64, { radius: 12, font: 16, target: screens.berths }),
    ], { radius: 16 }),
    card('harbor_vessel_conditions', 468, 474, 948, 220, [
      label('harbor_vessel_conditions_title', iconText(ICON.wifi, 'LIVE CONDITIONS'), 28, 22, 320, 28, 20),
      metricCard('harbor_vessel_wind', 'WIND', '14', 'knots NE', 28, 66, 190, 126, 'color.warning'),
      metricCard('harbor_vessel_tide', 'TIDE', '+1.8', 'm rising', 236, 66, 190, 126, 'color.accent'),
      metricCard('harbor_vessel_depth', 'DEPTH', '12.6', 'meters', 444, 66, 190, 126, 'color.success'),
      metricCard('harbor_vessel_clearance', 'CLEARANCE', '0.8', 'meters', 652, 66, 240, 126, 'color.accent2'),
    ], { radius: 16 }),
  ]);
}

function harborBerths(screens) {
  const berthCard = (name, x, y, code, state, vessel, color) => card(name, x, y, 318, 220, [
    label(`${name}_code`, iconText(state === 'AVAILABLE' ? ICON.check : ICON.home, code), 22, 20, 170, 34, 28, color),
    label(`${name}_state`, state, 22, 66, 274, 26, 18, 'color.text.muted'),
    label(`${name}_vessel`, vessel, 22, 106, 274, 30, 22),
    progress(`${name}_progress`, 22, 154, 274, 14, state === 'AVAILABLE' ? 8 : 72, color),
    label(`${name}_eta`, state === 'AVAILABLE' ? 'READY NOW' : 'CLEAR 12:40', 22, 178, 274, 22, 16, color),
  ], { fill: state === 'AVAILABLE' ? 'color.surface2' : 'color.surface', radius: 16 });
  return root(1440, 720, [
    harborPageHeader('harbor_berths', iconText(ICON.home, 'BERTH CONTROL'), '8 BERTHS  /  3 AVAILABLE', screens),
    berthCard('harbor_berth_a1', 24, 100, 'A1', 'OCCUPIED', 'OCEAN VELA', 'color.warning'),
    berthCard('harbor_berth_a2', 366, 100, 'A2', 'AVAILABLE', 'NORTH STAR', 'color.success'),
    berthCard('harbor_berth_b1', 708, 100, 'B1', 'OCCUPIED', 'SILVER CREST', 'color.warning'),
    berthCard('harbor_berth_c1', 1050, 100, 'C1', 'AVAILABLE', 'ATLAS WIND / 10:48', 'color.accent'),
    card('harbor_berth_timeline', 24, 344, 1344, 238, [
      label('harbor_berth_timeline_title', iconText(ICON.menu, 'NEXT MOVEMENTS'), 26, 22, 340, 30, 22),
      label('harbor_berth_timeline_1', '09:56', 28, 84, 100, 30, 22, 'color.accent'),
      label('harbor_berth_timeline_1_text', 'NORTH STAR pilot boarding / route to A2', 146, 84, 520, 30, 20),
      label('harbor_berth_timeline_2', '10:48', 28, 138, 100, 30, 22, 'color.accent'),
      label('harbor_berth_timeline_2_text', 'ATLAS WIND enters south channel / berth C1', 146, 138, 560, 30, 20),
      button('harbor_berth_confirm', iconText(ICON.check, 'CONFIRM A2'), 1030, 94, 260, 66, { radius: 12, font: 18 }),
    ], { radius: 16 }),
    button('harbor_berth_vessel', iconText(ICON.eye, 'VESSEL DETAIL'), 1030, 606, 338, 72, { fill: 'color.surface', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 12, font: 18, target: screens.vessel }),
  ]);
}

function harborRadio(screens) {
  return root(1440, 720, [
    harborPageHeader('harbor_radio', iconText(ICON.volume, 'MARINE COMMUNICATIONS'), 'VHF / AIS ONLINE', screens),
    card('harbor_radio_channels', 24, 100, 396, 594, [
      label('harbor_radio_channels_title', iconText(ICON.menu, 'CHANNELS'), 24, 22, 300, 30, 22),
      button('harbor_radio_ch12', iconText(ICON.volume, 'CH 12  PORT OPS'), 20, 78, 356, 72, { radius: 12, font: 18 }),
      button('harbor_radio_ch16', iconText(ICON.warning, 'CH 16  DISTRESS'), 20, 168, 356, 72, { fill: 'color.surface', border: 'color.warning', textColor: 'color.warning', shadow: false, radius: 12, font: 18 }),
      button('harbor_radio_ch09', iconText(ICON.volume, 'CH 09  PILOTS'), 20, 258, 356, 72, { fill: 'color.surface', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 12, font: 18 }),
      button('harbor_radio_ch71', iconText(ICON.volume, 'CH 71  TUGS'), 20, 348, 356, 72, { fill: 'color.surface', border: 'color.border', textColor: 'color.text.primary', shadow: false, radius: 12, font: 18 }),
      label('harbor_radio_signal', iconText(ICON.wifi, 'SIGNAL  96%'), 24, 500, 300, 28, 18, 'color.success'),
    ], { radius: 16 }),
    card('harbor_radio_active', 444, 100, 972, 360, [
      label('harbor_radio_active_title', 'CHANNEL 12 / PORT OPERATIONS', 30, 24, 500, 34, 24),
      label('harbor_radio_active_icon', ICON.volume, 46, 96, 160, 160, 44, 'color.accent', 'center'),
      label('harbor_radio_active_vessel', 'NORTH STAR', 250, 94, 360, 42, 36, 'color.accent'),
      label('harbor_radio_active_message', 'Pilot boarding confirmed. Maintain 6 knots to buoy 7.', 250, 150, 640, 60, 22),
      label('harbor_radio_active_time', 'LAST RX  09:43:18', 250, 226, 360, 26, 18, 'color.text.muted'),
      button('harbor_radio_ptt', iconText(ICON.volume, 'PUSH TO TALK'), 650, 266, 280, 66, { radius: 16, font: 18 }),
    ], { fill: 'color.surface2', radius: 16 }),
    card('harbor_radio_log', 444, 484, 972, 210, [
      label('harbor_radio_log_title', iconText(ICON.menu, 'RECENT TRAFFIC'), 28, 22, 320, 28, 20),
      label('harbor_radio_log_one', '09:43:18   NORTH STAR   Pilot boarding confirmed', 28, 72, 720, 28, 18),
      label('harbor_radio_log_two', '09:41:04   TUG T-04      Standing by at berth A2', 28, 112, 720, 28, 18, 'color.text.muted'),
      label('harbor_radio_log_three', '09:38:22   PORT OPS      Channel traffic normal', 28, 152, 720, 28, 18, 'color.text.muted'),
      button('harbor_radio_vessel', iconText(ICON.eye, 'VESSEL'), 760, 82, 180, 64, { fill: 'color.surface', border: 'color.accent', textColor: 'color.accent', shadow: false, radius: 12, font: 16, target: screens.vessel }),
    ], { radius: 16 }),
  ]);
}

function screenDefinition(screenId, codeName, displayName, isHome, screenRoot) {
  screenRoot.codeName = `${codeName}_root`;
  return {
    id: screenId, codeName, displayName, isHome,
    styles: [], consts: [], root: screenRoot,
  };
}

function createShowcaseScreens(preset) {
  if (preset.design === 'focus-orbit') {
    const screens = { home: id(), log: id(), sound: id() };
    return [
      screenDefinition(screens.home, 'focus_home', '专注计时', true, focusOrbit(screens)),
      screenDefinition(screens.log, 'focus_log', '专注记录', false, focusLog(screens)),
      screenDefinition(screens.sound, 'focus_sound', '声音场景', false, focusSound(screens)),
    ];
  }
  if (preset.design === 'greenhouse') {
    const screens = { home: id(), zones: id(), water: id(), log: id() };
    return [
      screenDefinition(screens.home, 'greenhouse_home', '温室总览', true, greenhouse(screens)),
      screenDefinition(screens.zones, 'greenhouse_zones', '种植分区', false, greenhouseZones(screens)),
      screenDefinition(screens.water, 'greenhouse_water', '灌溉控制', false, greenhouseWater(screens)),
      screenDefinition(screens.log, 'greenhouse_log', '温室日志', false, greenhouseLog(screens)),
    ];
  }
  if (preset.design === 'ev-charge') {
    const screens = { charge: id(), sessions: id(), payment: id() };
    return [
      screenDefinition(screens.charge, 'ev_charge', '快速充电', true, evCharge(screens)),
      screenDefinition(screens.sessions, 'ev_sessions', '充电会话', false, evSessions(screens)),
      screenDefinition(screens.payment, 'ev_payment', '支付与权限', false, evPayment(screens)),
    ];
  }
  if (preset.design === 'factory-energy') {
    const screens = { energy: id(), lines: id(), storage: id(), alerts: id() };
    return [
      screenDefinition(screens.energy, 'factory_energy', '能源中心', true, factoryEnergy(screens)),
      screenDefinition(screens.lines, 'factory_lines', '生产线', false, factoryLines(screens)),
      screenDefinition(screens.storage, 'factory_storage', '储能系统', false, factoryStorage(screens)),
      screenDefinition(screens.alerts, 'factory_alerts', '告警中心', false, factoryAlerts(screens)),
    ];
  }
  if (preset.design === 'harbor-dispatch') {
    const screens = { home: id(), vessel: id(), berths: id(), radio: id() };
    return [
      screenDefinition(screens.home, 'harbor_home', '港口调度', true, harborDispatch(screens)),
      screenDefinition(screens.vessel, 'harbor_vessel', '船舶详情', false, harborVessel(screens)),
      screenDefinition(screens.berths, 'harbor_berths', '泊位控制', false, harborBerths(screens)),
      screenDefinition(screens.radio, 'harbor_radio', '海事通信', false, harborRadio(screens)),
    ];
  }
  throw new Error(`Unknown showcase design: ${preset.design}`);
}

function themeFor(preset) {
  const p = PALETTES[preset.model];
  return {
    id: `showcase-${preset.model.toLowerCase()}`,
    displayName: `${preset.model} ${preset.name}主题`,
    tokens: [
      ['color.background', 'color', p.bg], ['color.surface', 'color', p.surface],
      ['color.surface2', 'color', p.surface2], ['color.border', 'color', p.border],
      ['color.text.primary', 'color', p.text], ['color.text.muted', 'color', p.muted],
      ['color.text.onaccent', 'color', '#FFFFFF'], ['color.accent', 'color', p.accent],
      ['color.accent2', 'color', p.accent2], ['color.success', 'color', p.success],
      ['color.warning', 'color', p.warning], ['color.danger', 'color', p.danger],
      ['color.track', 'color', p.track], ['color.shadow', 'color', p.shadow],
      ...[12, 14, 16, 18, 20, 22, 24, 28, 30, 36, 40, 44].map((size) => [
        `font.size.${size}`, 'fontRef', `montserrat_${size}`,
      ]),
    ].map(([tokenId, type, value]) => ({ id: tokenId, type, value })),
  };
}

function createShowcase(preset) {
  nodeCounter = 1;
  const sourceFile = preset.source
    ? resolve('examples', preset.source)
    : resolve(SOURCE_DIR, `${preset.model}-serene-pod.lvproj.json`);
  const source = JSON.parse(readFileSync(sourceFile, 'utf8'));
  const slug = `${preset.model.toLowerCase()}-${preset.design}`;
  const uiId = `ui:${slug}`;
  if (preset.model === 'WF3-284x76') {
    restyleWf3Home(source);
    source.uiProject.meta = {
      ...source.uiProject.meta, id: uiId, revision: 1,
      name: `${preset.model} ${preset.name}`, modifiedAt: NOW, createdAt: NOW,
    };
    source.uiProject.editor = {
      ...source.uiProject.editor,
      deviceModel: preset.model,
      example: 'device-showcase-suite-v1',
      showcase: preset.design,
    };
    const themeId = source.uiProject.themes[0]?.id;
    source.buildTarget = {
      ...source.buildTarget,
      id: `target:${slug}`,
      displayName: `${preset.model} ${preset.name}目标`,
      uiProjectRef: `${uiId}@1`,
      ...(themeId ? { themeRef: `${uiId}@1#theme:${themeId}` } : {}),
    };
    source.migrationNotes = [
      ...source.migrationNotes.filter((note) => note.code !== 'device-showcase-layout-v1'),
      {
        severity: 'info', code: 'device-showcase-layout-v1', path: 'uiProject.screens[0]',
        message: `${preset.model} 保留原总线工具内容与全部内页，首页改为双层大触控导航。`,
      },
    ];
    return source;
  }
  const screens = createShowcaseScreens(preset);
  source.uiProject.meta = {
    ...source.uiProject.meta, id: uiId, revision: 1,
    name: `${preset.model} ${preset.name}`, modifiedAt: NOW, createdAt: NOW,
  };
  source.uiProject.themes = [themeFor(preset)];
  source.uiProject.subjects = [];
  source.uiProject.screens = screens;
  source.uiProject.components = [];
  source.uiProject.styles = [];
  source.uiProject.consts = [];
  source.uiProject.editor = {
    ...source.uiProject.editor,
    deviceModel: preset.model,
    example: 'device-showcase-suite-v1',
    showcase: preset.design,
  };
  source.buildTarget = {
    ...source.buildTarget,
    id: `target:${slug}`,
    displayName: `${preset.model} ${preset.name}目标`,
    uiProjectRef: `${uiId}@1`,
    themeRef: `${uiId}@1#theme:showcase-${preset.model.toLowerCase()}`,
  };
  source.migrationNotes = [
    ...source.migrationNotes.filter((note) => !String(note.code).startsWith('serene-') && note.code !== 'semantic-theme'),
    {
      severity: 'info', code: 'device-showcase-layout-v1', path: 'uiProject.screens',
      message: `${preset.model} 使用独立的 ${preset.name} 场景、视觉系统与触控布局，并包含 ${screens.length} 个可导航页面。`,
    },
  ];
  return source;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const preset of PRESETS) {
  const snapshot = createShowcase(preset);
  const file = resolve(OUTPUT_DIR, `${preset.model}-${preset.design}.lvproj.json`);
  writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  process.stdout.write(`generated ${file} (${preset.width}x${preset.height}, ${snapshot.uiProject.screens[0].root.children.length} root widgets)\n`);
}
