import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUTPUT_DIR = resolve('examples/quiet-pod-six-themes');
const QUIET_POD_ICON = '\uf52a';

const PRESETS = [
  {
    model: 'WF2D-8620', width: 240, height: 240, feature: 'focus', featureName: '专注计时',
    themeId: 'midnight-violet', themeName: '午夜紫罗兰',
    source: 'examples/serene-pod/WF2D-8620-serene-pod.lvproj.json',
    palette: { bg: '#0C071A', surface: '#19112F', subtle: '#271A45', border: '#49356F', text: '#FFF7FF', muted: '#AE9CC8', accent: '#B56CFF', strong: '#E29BFF', success: '#64E6B5', warning: '#FFD166', danger: '#FF6B8A', track: '#35244F', shadow: '#030106' },
  },
  {
    model: 'WF2D-8630', width: 480, height: 480, feature: 'acoustics', featureName: '声学降噪',
    themeId: 'glacier-blue', themeName: '冰川声场',
    source: 'examples/serene-pod/WF2D-8630-serene-pod.lvproj.json',
    palette: { bg: '#EAF8FC', surface: '#FFFFFF', subtle: '#D6F1F7', border: '#A9DCE7', text: '#103B4B', muted: '#668995', accent: '#007F9E', strong: '#00B8D4', success: '#16A085', warning: '#F3A712', danger: '#EA5B62', track: '#C4E8EF', shadow: '#6FA6B2' },
  },
  {
    model: 'WF2D-1050', width: 1024, height: 600, feature: 'lighting', featureName: '灯光场景',
    themeId: 'amber-studio', themeName: '琥珀光域',
    source: 'examples/serene-pod/WF2D-1050-serene-pod.lvproj.json',
    palette: { bg: '#19120C', surface: '#2A1E14', subtle: '#3A291A', border: '#60452B', text: '#FFF7E8', muted: '#C9AE87', accent: '#FF9F43', strong: '#FFD166', success: '#7ED6A5', warning: '#FFB347', danger: '#FF6B5E', track: '#57402A', shadow: '#050301' },
  },
  {
    model: 'WF2D-1040', width: 1080, height: 720, feature: 'air', featureName: '空气质量',
    themeId: 'eco-mint', themeName: '生态薄荷',
    source: 'examples/serene-pod/WF2D-1040-serene-pod.lvproj.json',
    palette: { bg: '#F1FAF4', surface: '#FFFFFF', subtle: '#DCF4E6', border: '#B5DEC7', text: '#173C2A', muted: '#688575', accent: '#1C9B67', strong: '#42C98B', success: '#21A366', warning: '#E9A23B', danger: '#DD5F67', track: '#CDE8D8', shadow: '#7DA48E' },
  },
  {
    model: 'WF2D-1030', width: 1440, height: 720, feature: 'booking', featureName: '舱位预约',
    themeId: 'coral-schedule', themeName: '珊瑚日程',
    source: 'examples/serene-pod/WF2D-1030-serene-pod.lvproj.json',
    palette: { bg: '#FFF6F1', surface: '#FFFFFF', subtle: '#FFE7DD', border: '#F0C6B7', text: '#472B2A', muted: '#94726C', accent: '#C04E3E', strong: '#FF9B7D', success: '#42A982', warning: '#E7A33E', danger: '#D94B58', track: '#F4D8CE', shadow: '#B78A7E' },
  },
  {
    model: 'WF3-284x76', width: 284, height: 76, feature: 'dnd', featureName: '一键静音',
    themeId: 'signal-red', themeName: '信号红黑',
    source: 'examples/wf3-firmware/WF3-284x76-firmware-ui.lvproj.json',
    palette: { bg: '#090A0C', surface: '#17191E', subtle: '#23262C', border: '#353942', text: '#F7F8FA', muted: '#9AA0AA', accent: '#FF3B4F', strong: '#FF6675', success: '#3DDC97', warning: '#FFC857', danger: '#FF3B4F', track: '#2B2E35', shadow: '#000000' },
  },
];

const token = ($token) => ({ $token });
let sequence = 900000;
const id = () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`;
const style = (props, selector) => selector ? { selector, props } : { props };

function base(type, codeName, props, styles = [], children = []) {
  return { id: id(), type, codeName, props, ...(type === 'obj' || type === 'button' ? { flags: { scrollable: false } } : {}), styleRefs: [], styles, events: [], bindings: [], children };
}

function label(codeName, text, x, y, width, height, font = 'font.size.18', color = 'color.text.primary', align = 'left') {
  return base('label', codeName, { text, x, y, width, height }, [style({ text_color: token(color), text_font: token(font), text_align: align, text_opa: 255 })]);
}

function panel(codeName, x, y, width, height, children = [], options = {}) {
  return base('obj', codeName, { x, y, width, height }, [style({
    bg_color: token(options.color ?? 'color.surface'), bg_opa: options.opa ?? 255,
    border_color: token(options.border ?? 'color.border'), border_width: options.borderWidth ?? 1,
    radius: options.radius ?? 20, pad_all: 0,
    shadow_color: token('color.shadow'), shadow_width: options.shadow ?? 0,
    shadow_opa: options.shadow ? 24 : 0, shadow_offset_y: options.shadow ? 5 : 0,
  })], children);
}

function button(codeName, text, x, y, width, height, event, options = {}) {
  const node = base('button', codeName, { x, y, width, height }, [
    style({ bg_color: token(options.color ?? 'color.accent'), bg_opa: 255, border_width: options.borderWidth ?? 0, border_color: token(options.border ?? 'color.accent'), radius: options.radius ?? 18, shadow_width: options.shadow ?? 0, shadow_color: token(options.color ?? 'color.accent'), shadow_opa: options.shadow ? 40 : 0, pad_all: 0 }),
    style({ bg_color: token(options.pressed ?? 'color.accent.strong') }, { states: ['pressed'] }),
  ], [label(`${codeName}_text`, text, 0, 0, '100%', 'content', options.font ?? 'font.size.16', options.textColor ?? 'color.text.onaccent', 'center')]);
  node.children[0].props.align = 'center';
  if (event) node.events = [event];
  return node;
}

function navigationOverlay(codeName, x, y, width, height, screen) {
  const node = base('button', codeName, { x, y, width, height }, [
    style({ bg_opa: 0, border_width: 0, shadow_width: 0, radius: Math.floor(Math.min(width, height) / 2), pad_all: 0 }),
    style({ bg_color: token('color.accent'), bg_opa: 24 }, { states: ['pressed'] }),
  ]);
  node.flags = { ...node.flags, clickable: true };
  node.events = [{
    on: 'clicked',
    action: 'screen.open',
    args: { screen, anim: 'fade_in', duration: 180, delay: 0 },
  }];
  return node;
}

function arc(codeName, x, y, size, value, width = 14, binding) {
  const node = base('arc', codeName, { x, y, width: size, height: size, min_value: 0, max_value: 100, value, bg_start_angle: 135, bg_end_angle: 45, start_angle: 135, end_angle: 45, knob_offset: -3 }, [
    style({ arc_color: token('color.track'), arc_width: width }, { part: 'main' }),
    style({ arc_color: token('color.accent'), arc_width: width }, { part: 'indicator' }),
    style({ bg_color: token('color.accent'), bg_opa: 0, radius: 12 }, { part: 'knob' }),
  ]);
  if (binding) node.bindings = [{ kind: 'prop', prop: 'value', subject: binding }];
  return node;
}

function slider(codeName, x, y, width, value, binding) {
  const node = base('slider', codeName, { x, y, width, height: 18, min_value: 0, max_value: 100, value }, [
    style({ bg_color: token('color.track'), bg_opa: 255, radius: 10 }, { part: 'main' }),
    style({ bg_color: token('color.accent'), bg_opa: 255, radius: 10 }, { part: 'indicator' }),
    style({ bg_color: token('color.text.onaccent'), bg_opa: 255, radius: 12, shadow_width: 6, shadow_opa: 55 }, { part: 'knob' }),
  ]);
  if (binding) node.bindings = [{ kind: 'prop', prop: 'value', subject: binding }];
  return node;
}

function root(children) {
  return base('obj', 'home_root', {}, [style({ bg_color: token('color.background'), bg_opa: 255, border_width: 0, pad_all: 0 })], children);
}

/** Keep the examples publishable by replacing the PNG brand mark with an LVGL built-in glyph. */
function replacePodscLogoWithQuietPodIcon(project) {
  const replaceNode = (node) => {
    const children = (node.children ?? []).map(replaceNode);
    if (node.type === 'label' && node.codeName?.endsWith('_brand_logo') && node.props?.text === '\uf52b') {
      return { ...node, props: { ...node.props, text: QUIET_POD_ICON }, children };
    }
    if (node.type !== 'image' || node.props?.src !== 'podsc_logo') return { ...node, children };
    const { src: _src, inner_align: _innerAlign, ...position } = node.props;
    return {
      ...node,
      type: 'label',
      props: { ...position, text: QUIET_POD_ICON },
      styles: [style({
        text_color: token('color.accent'),
        text_font: token('font.size.20'),
        text_align: 'center',
        text_opa: 255,
      })],
      children,
    };
  };
  project.screens = project.screens.map((screen) => ({ ...screen, root: replaceNode(screen.root) }));
  project.components = project.components.map((component) => ({ ...component, root: replaceNode(component.root) }));
  project.assets.images = project.assets.images.filter((asset) => asset.codeName !== 'podsc_logo');
}

function focusHome({ featureScreenId }) {
  const kicker = label('home_kicker', 'DEEP FOCUS', 58, 18, 124, 24, 'font.size.14', 'color.text.muted', 'center');
  const focusArc = arc('home_focus_arc', 40, 38, 160, 75, 13);
  const timer = label('home_timer', '25:00', 56, 82, 128, 38, 'font.size.28', 'color.text.primary', 'center');
  const cycle = label('home_cycle', 'CYCLE  3 / 4', 64, 124, 112, 20, 'font.size.14', 'color.accent.strong', 'center');
  const start = button('home_focus_start', 'START', 72, 178, 96, 42, { on: 'clicked', action: 'subject.set', args: { subject: 'subject:pod_mode', value: '2' } }, { radius: 22, shadow: 8 });
  const card = navigationOverlay('home_focus_card', 40, 38, 160, 132, featureScreenId);
  return root([
    kicker,
    focusArc,
    timer,
    cycle,
    card,
    start,
  ]);
}

function acousticsHome({ featureScreenId }) {
  const bars = [38, 62, 92, 128, 82, 54, 34].map((h, index) => panel(`home_wave_${index}`, 44 + index * 30, 146 - h / 2, 14, h, [], { color: index === 3 ? 'color.accent' : 'color.track', border: index === 3 ? 'color.accent' : 'color.track', borderWidth: 0, radius: 7 }));
  return root([
    label('home_title', 'ACOUSTIC SHIELD', 24, 22, 300, 30, 'font.size.20'),
    label('home_status', 'LIVE', 374, 26, 78, 24, 'font.size.14', 'color.status.success', 'right'),
    panel('home_acoustic_hero', 18, 66, 444, 222, [
      ...bars,
      label('home_noise_value', '26', 278, 54, 92, 64, 'font.size.38', 'color.text.primary', 'right'),
      label('home_noise_unit', 'dB', 374, 84, 42, 26, 'font.size.18', 'color.text.muted'),
      label('home_reduction', '-18 dB  REDUCTION', 274, 132, 142, 24, 'font.size.14', 'color.accent', 'right'),
      label('home_spectrum', 'VOICE BAND ISOLATED', 44, 184, 372, 22, 'font.size.14', 'color.text.muted', 'center'),
    ], { color: 'color.surface', radius: 24, shadow: 8 }),
    panel('home_anc_card', 18, 304, 214, 76, [
      label('home_anc_label', 'ACTIVE SHIELD', 18, 14, 178, 20, 'font.size.14', 'color.text.muted'),
      label('home_anc_value', '72%', 18, 38, 178, 28, 'font.size.20', 'color.accent', 'right'),
    ], { color: 'color.surface.subtle', radius: 18 }),
    panel('home_seal_card', 248, 304, 214, 76, [
      label('home_seal_label', 'DOOR SEAL', 18, 14, 178, 20, 'font.size.14', 'color.text.muted'),
      label('home_seal_value', 'SECURE', 18, 38, 178, 28, 'font.size.18', 'color.status.success', 'right'),
    ], { color: 'color.surface.subtle', radius: 18 }),
    navigationOverlay('home_acoustic_card', 18, 66, 444, 222, featureScreenId),
    button('home_anc_toggle', 'BOOST NOISE CONTROL', 18, 398, 444, 58, { on: 'clicked', action: 'subject.toggle', args: { subject: 'subject:vent_enabled' } }, { radius: 18, shadow: 8 }),
  ]);
}

function lightingHome({ featureScreenId }) {
  return root([
    label('home_title', 'LIGHT STUDIO', 34, 24, 400, 38, 'font.size.28'),
    label('home_subtitle', 'Shape the mood inside your pod', 36, 64, 460, 24, 'font.size.16', 'color.text.muted'),
    panel('home_light_hero', 28, 104, 590, 460, [
      arc('home_light_arc', 38, 54, 260, 68, 20, 'subject:light_brightness'),
      label('home_light_value', '68%', 82, 144, 172, 48, 'font.size.38', 'color.text.primary', 'center'),
      label('home_light_mode', 'WARM GLOW', 326, 76, 220, 32, 'font.size.20', 'color.accent', 'right'),
      label('home_light_temp', '3200 K', 326, 118, 220, 50, 'font.size.30', 'color.text.primary', 'right'),
      label('home_brightness_label', 'BRIGHTNESS', 326, 194, 220, 22, 'font.size.14', 'color.text.muted'),
      slider('home_brightness', 326, 230, 220, 68, 'subject:light_brightness'),
      label('home_cct_label', 'COLOR TEMPERATURE', 326, 282, 220, 22, 'font.size.14', 'color.text.muted'),
      slider('home_cct', 326, 318, 220, 42, 'subject:light_cct'),
      button('home_light_power', 'LIGHT ON', 326, 374, 220, 54, { on: 'clicked', action: 'subject.toggle', args: { subject: 'subject:light_enabled' } }, { radius: 16 }),
    ], { color: 'color.surface', radius: 28, shadow: 10 }),
    label('home_scenes_title', 'SCENES', 660, 106, 320, 28, 'font.size.18', 'color.text.muted'),
    button('home_scene_focus', 'FOCUS  /  5000 K', 650, 148, 342, 82, { on: 'clicked', action: 'subject.set', args: { subject: 'subject:light_cct', value: '5000' } }, { color: 'color.surface.subtle', textColor: 'color.text.primary', borderWidth: 1, border: 'color.border', radius: 20 }),
    button('home_scene_calm', 'CALM  /  3200 K', 650, 246, 342, 82, { on: 'clicked', action: 'subject.set', args: { subject: 'subject:light_cct', value: '3200' } }, { color: 'color.accent', radius: 20, shadow: 7 }),
    button('home_scene_video', 'VIDEO  /  4200 K', 650, 344, 342, 82, { on: 'clicked', action: 'subject.set', args: { subject: 'subject:light_cct', value: '4200' } }, { color: 'color.surface.subtle', textColor: 'color.text.primary', borderWidth: 1, border: 'color.border', radius: 20 }),
    panel('home_scene_footer', 650, 448, 342, 116, [
      label('home_scene_footer_label', 'AUTO AMBIENCE', 22, 18, 298, 22, 'font.size.14', 'color.text.muted'),
      label('home_scene_footer_value', 'SUNSET SYNC', 22, 52, 298, 34, 'font.size.20', 'color.accent.strong', 'right'),
    ], { color: 'color.surface', radius: 20 }),
    navigationOverlay('home_light_card', 28, 104, 290, 300, featureScreenId),
  ]);
}

function airHome({ featureScreenId }) {
  return root([
    label('home_title', 'AIR QUALITY', 34, 28, 360, 40, 'font.size.30'),
    label('home_status', 'OPTIMAL  /  AUTO VENTILATION', 660, 34, 386, 26, 'font.size.16', 'color.status.success', 'right'),
    panel('home_air_hero', 28, 92, 650, 410, [
      label('home_air_kicker', 'CABIN CO2', 32, 28, 220, 24, 'font.size.16', 'color.text.muted'),
      label('home_co2_value', '468', 30, 82, 270, 86, 'font.size.38', 'color.text.primary'),
      label('home_co2_unit', 'ppm', 238, 128, 74, 28, 'font.size.18', 'color.text.muted'),
      arc('home_air_arc', 338, 60, 240, 46, 20, 'subject:co2_level'),
      label('home_air_grade', 'A+', 382, 142, 152, 52, 'font.size.38', 'color.status.success', 'center'),
      label('home_air_message', 'Fresh air exchange is balancing silently', 32, 206, 556, 30, 'font.size.18', 'color.text.muted'),
      slider('home_vent_slider', 32, 278, 556, 64, 'subject:fan_speed'),
      label('home_vent_low', 'SILENT', 32, 316, 110, 22, 'font.size.14', 'color.text.muted'),
      label('home_vent_high', 'FRESH', 478, 316, 110, 22, 'font.size.14', 'color.text.muted', 'right'),
      button('home_air_boost', 'FRESH AIR BOOST', 32, 352, 556, 42, { on: 'clicked', action: 'subject.set', args: { subject: 'subject:fan_speed', value: '88' } }, { radius: 14 }),
    ], { color: 'color.surface', radius: 28, shadow: 8 }),
    panel('home_temp_card', 704, 92, 348, 118, [
      label('home_temp_label', 'TEMPERATURE', 24, 20, 300, 24, 'font.size.14', 'color.text.muted'),
      label('home_temp_value', '23.6 C', 24, 54, 300, 42, 'font.size.28', 'color.text.primary', 'right'),
    ], { color: 'color.surface.subtle', radius: 22 }),
    panel('home_humidity_card', 704, 226, 348, 118, [
      label('home_humidity_label', 'HUMIDITY', 24, 20, 300, 24, 'font.size.14', 'color.text.muted'),
      label('home_humidity_value', '48%', 24, 54, 300, 42, 'font.size.28', 'color.accent', 'right'),
    ], { color: 'color.surface.subtle', radius: 22 }),
    panel('home_filter_card', 704, 360, 348, 142, [
      label('home_filter_label', 'FILTER LIFE', 24, 20, 300, 24, 'font.size.14', 'color.text.muted'),
      label('home_filter_value', '92%', 24, 52, 300, 36, 'font.size.28', 'color.status.success', 'right'),
      slider('home_filter_bar', 24, 102, 300, 92),
    ], { color: 'color.surface', radius: 22 }),
    panel('home_air_footer', 28, 532, 1024, 156, [
      label('home_air_footer_title', '24 HOUR AIR TRACE', 24, 20, 280, 24, 'font.size.14', 'color.text.muted'),
      label('home_air_footer_data', 'CO2  -12%     VOC  LOW     PM2.5  4', 330, 18, 660, 28, 'font.size.18', 'color.text.primary', 'right'),
      ...[42, 54, 36, 68, 48, 72, 58, 44, 62, 38, 52, 34].map((h, index) => panel(`home_air_trace_${index}`, 26 + index * 80, 126 - h, 52, h, [], { color: index > 8 ? 'color.accent' : 'color.track', border: 'color.track', borderWidth: 0, radius: 8 })),
    ], { color: 'color.surface', radius: 22 }),
    navigationOverlay('home_air_card', 352, 136, 286, 250, featureScreenId),
  ]);
}

function bookingHome({ featureScreenId }) {
  const slots = [
    ['09:00', 'PRODUCT SYNC', '45 MIN', 'color.accent'],
    ['10:30', 'AVAILABLE', '90 MIN', 'color.surface'],
    ['12:30', 'CLIENT CALL', '60 MIN', 'color.surface.subtle'],
    ['14:00', 'AVAILABLE', '120 MIN', 'color.surface'],
  ];
  return root([
    panel('home_booking_rail', 18, 18, 250, 684, [
      label('home_brand', 'POD / 06', 24, 30, 202, 34, 'font.size.20', 'color.text.primary'),
      label('home_day', 'MONDAY', 24, 96, 202, 24, 'font.size.14', 'color.text.muted'),
      label('home_date', '12 OCT', 24, 126, 202, 44, 'font.size.28', 'color.accent'),
      panel('home_occupancy', 24, 212, 202, 126, [
        label('home_occupancy_label', 'OCCUPANCY', 18, 18, 166, 22, 'font.size.14', 'color.text.muted'),
        label('home_occupancy_value', '62%', 18, 54, 166, 42, 'font.size.28', 'color.text.primary', 'right'),
      ], { color: 'color.surface.subtle', radius: 18 }),
      label('home_next_label', 'NEXT FREE', 24, 380, 202, 22, 'font.size.14', 'color.text.muted'),
      label('home_next_value', '10:30', 24, 414, 202, 42, 'font.size.28', 'color.status.success'),
      button('home_quick_book', 'BOOK 30 MIN', 24, 582, 202, 62, { on: 'clicked', action: 'subject.toggle', args: { subject: 'subject:pod_occupied' } }, { radius: 18, shadow: 7 }),
    ], { color: 'color.surface', radius: 26, shadow: 8 }),
    label('home_title', 'TODAY IN THE POD', 308, 34, 640, 38, 'font.size.30'),
    label('home_timezone', 'LOCAL TIME  08:42', 1110, 40, 290, 24, 'font.size.16', 'color.text.muted', 'right'),
    ...slots.map(([time, title, duration, color], index) => panel(`home_slot_${index}`, 308, 104 + index * 128, 1092, 104, [
      label(`home_slot_time_${index}`, time, 26, 30, 150, 42, 'font.size.28', index === 0 ? 'color.text.onaccent' : 'color.text.primary'),
      label(`home_slot_title_${index}`, title, 210, 24, 520, 30, 'font.size.20', index === 0 ? 'color.text.onaccent' : (title === 'AVAILABLE' ? 'color.status.success' : 'color.text.primary')),
      label(`home_slot_duration_${index}`, duration, 210, 58, 300, 24, 'font.size.14', index === 0 ? 'color.text.onaccent' : 'color.text.muted'),
      label(`home_slot_state_${index}`, index === 0 ? 'IN PROGRESS' : (title === 'AVAILABLE' ? 'BOOK NOW' : 'RESERVED'), 830, 38, 224, 28, 'font.size.16', index === 0 ? 'color.text.onaccent' : (title === 'AVAILABLE' ? 'color.accent' : 'color.text.muted'), 'right'),
    ], { color, border: color === 'color.surface' ? 'color.border' : color, borderWidth: color === 'color.surface' ? 1 : 0, radius: 20 })),
    panel('home_booking_footer', 308, 624, 1092, 78, [
      label('home_booking_footer_text', 'QUIET MODE AUTO-ENABLED FOR EVERY RESERVATION', 24, 25, 1044, 28, 'font.size.16', 'color.text.muted', 'center'),
    ], { color: 'color.surface.subtle', radius: 18 }),
    navigationOverlay('home_booking_card', 308, 104, 1092, 104, featureScreenId),
  ]);
}

function dndHome() {
  return root([
    panel('home_dnd_status', 4, 4, 56, 68, [
      label('home_dnd_icon', 'DND', 0, 10, 56, 20, 'font.size.14', 'color.text.onaccent', 'center'),
      label('home_dnd_state', 'ON', 0, 34, 56, 24, 'font.size.16', 'color.text.onaccent', 'center'),
    ], { color: 'color.accent', border: 'color.accent', borderWidth: 0, radius: 8 }),
    label('home_dnd_title', 'QUIET MODE', 72, 10, 122, 22, 'font.size.16', 'color.text.primary'),
    label('home_dnd_timer', '00:45', 72, 38, 122, 26, 'font.size.20', 'color.accent.strong'),
    button('home_dnd_toggle', 'MUTE', 204, 8, 74, 60, { on: 'clicked', action: 'subject.toggle', args: { subject: 'subject:dnd_enabled' } }, { radius: 8, font: 'font.size.16', shadow: 0 }),
  ]);
}

const HOME_BUILDERS = { focus: focusHome, acoustics: acousticsHome, lighting: lightingHome, air: airHome, booking: bookingHome, dnd: dndHome };

function recolorTheme(theme, preset) {
  const values = {
    'color.background': preset.palette.bg,
    'color.surface': preset.palette.surface,
    'color.surface.subtle': preset.palette.subtle,
    'color.border': preset.palette.border,
    'color.outline': preset.palette.border,
    'color.text.primary': preset.palette.text,
    'color.text.muted': preset.palette.muted,
    'color.text.onaccent': '#FFFFFF',
    'color.accent': preset.palette.accent,
    'color.accent.strong': preset.palette.strong,
    'color.status.success': preset.palette.success,
    'color.status.warning': preset.palette.warning,
    'color.status.danger': preset.palette.danger,
    'color.track': preset.palette.track,
    'color.track.strong': preset.palette.border,
    'color.shadow': preset.palette.shadow,
    'color.palette.263c52': preset.palette.track,
  };
  if (preset.feature === 'lighting') {
    // The source theme's cream navigation colors must follow the dark palette
    // too; its labels already use the recolored (light) primary text token.
    values['color.palette.fff8ee'] = preset.palette.subtle;
    values['color.palette.f1d8b8'] = preset.palette.surface;
    values['color.palette.e1bd8f'] = preset.palette.border;
  }
  if (preset.feature === 'booking') {
    // The source's forest-green sidebar uses palette tokens instead of the
    // semantic theme colors. Give it the same warm palette as the content.
    values['color.palette.234a35'] = preset.palette.subtle;
    values['color.palette.315c43'] = preset.palette.surface;
    values['color.palette.4f765e'] = preset.palette.border;
    values['color.palette.f0c987'] = preset.palette.accent;
  }
  const seen = new Set();
  theme.tokens = theme.tokens.map((entry) => {
    seen.add(entry.id);
    return Object.hasOwn(values, entry.id) ? { ...entry, value: values[entry.id] } : entry;
  });
  for (const [tokenId, value] of Object.entries(values)) {
    if (!seen.has(tokenId)) theme.tokens.push({ id: tokenId, type: 'color', value });
  }
  const fontTokens = preset.feature === 'dnd'
    ? { 'font.size.14': 'montserrat_14', 'font.size.16': 'montserrat_16', 'font.size.20': 'montserrat_20' }
    : { 'font.size.14': 'montserrat_14', 'font.size.16': 'montserrat_16', 'font.size.18': 'montserrat_18', 'font.size.20': 'montserrat_20', 'font.size.28': 'montserrat_28', 'font.size.30': 'montserrat_30', 'font.size.38': 'montserrat_38' };
  for (const [tokenId, value] of Object.entries(fontTokens)) {
    if (!theme.tokens.some((entry) => entry.id === tokenId)) theme.tokens.push({ id: tokenId, type: 'fontRef', value });
  }
  return theme;
}

function recolorBookingNavigation(project) {
  for (const screen of project.screens.filter((candidate) => !candidate.isHome)) {
    const prefix = screen.codeName;
    const nodes = screen.root.children;
    const brand = nodes.find((node) => node.codeName === `${prefix}_brand_logo`);
    if (brand) brand.styles[0].props.text_color = token('color.accent');
    for (const name of ['home', 'air', 'light', 'focus', 'settings']) {
      const button = nodes.find((node) => node.codeName === `${prefix}_nav_${name}`);
      if (!button) continue;
      const pressed = button.styles.find((entry) => entry.selector?.states?.includes('pressed'));
      if (pressed) pressed.props.bg_color = token(name === prefix ? 'color.accent' : 'color.surface.subtle');
      button.children[0].styles[0].props.text_color = token(name === prefix ? 'color.text.onaccent' : 'color.text.primary');
    }
  }
}

function generate(preset) {
  sequence = 900000;
  const snapshot = JSON.parse(readFileSync(resolve(preset.source), 'utf8'));
  const slug = `${preset.model.toLowerCase()}-quiet-${preset.feature}`;
  const projectId = `ui:${slug}`;
  const oldThemeId = snapshot.buildTarget.themeRef.match(/#theme:(.+)$/)?.[1];
  const sourceTheme = preset.feature === 'dnd'
    ? snapshot.uiProject.themes.find((theme) => theme.id === 'industrial-base') ?? snapshot.uiProject.themes[0]
    : snapshot.uiProject.themes.find((theme) => theme.id === oldThemeId) ?? snapshot.uiProject.themes[0];
  const theme = recolorTheme(structuredClone(sourceTheme), preset);
  delete theme.extends;
  theme.id = preset.themeId;
  theme.displayName = `${preset.model} · ${preset.themeName}`;
  snapshot.uiProject.themes = [theme];
  snapshot.uiProject.meta = {
    ...snapshot.uiProject.meta,
    id: projectId,
    name: `${preset.model} 静音舱 · ${preset.featureName}`,
    modifiedAt: '2026-10-12T00:00:00.000Z',
  };
  const featureTargetCodeName = {
    focus: 'focus',
    acoustics: 'air',
    lighting: 'light',
    air: 'air',
    booking: 'focus',
  }[preset.feature];
  const featureScreenId = featureTargetCodeName
    ? snapshot.uiProject.screens.find((screen) => screen.codeName === featureTargetCodeName)?.id
    : undefined;
  if (featureTargetCodeName && !featureScreenId) {
    throw new Error(`${preset.model} ${featureTargetCodeName} screen is missing`);
  }
  snapshot.uiProject.screens[0] = {
    ...snapshot.uiProject.screens[0],
    displayName: preset.featureName,
    codeName: 'home',
    isHome: true,
    root: HOME_BUILDERS[preset.feature]({ featureScreenId }),
  };
  replacePodscLogoWithQuietPodIcon(snapshot.uiProject);
  if (preset.feature === 'booking') recolorBookingNavigation(snapshot.uiProject);
  if (preset.feature === 'dnd') {
    snapshot.uiProject.screens = [snapshot.uiProject.screens[0]];
    snapshot.uiProject.subjects = [{ id: 'subject:dnd_enabled', codeName: 'dnd_enabled', displayName: 'Do not disturb', type: 'int', initial: 1, min: 0, max: 1 }];
  }
  snapshot.uiProject.editor = { ...(snapshot.uiProject.editor ?? {}), example: 'quiet-pod-six-themes', homeFeature: preset.feature, themeConcept: preset.themeName };
  snapshot.buildTarget = {
    ...snapshot.buildTarget,
    id: `target:${slug}`,
    displayName: `${preset.model} ${preset.featureName}目标`,
    uiProjectRef: `${projectId}@1`,
    themeRef: `${projectId}@1#theme:${preset.themeId}`,
  };
  snapshot.migrationNotes = [
    ...(snapshot.migrationNotes ?? []),
    { code: 'six-quiet-pod-home', path: 'uiProject.screens[0]', message: `首页突出${preset.featureName}，使用${preset.themeName}主题。` },
  ];
  const file = resolve(OUTPUT_DIR, `${preset.model}-quiet-${preset.feature}.lvproj.json`);
  writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`generated ${file}`);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const requestedModels = new Set(process.argv.slice(2));
for (const preset of PRESETS) {
  if (requestedModels.size === 0 || requestedModels.has(preset.model)) generate(preset);
}
