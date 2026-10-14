import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SOURCE = resolve('examples/device-showcase/WF2D-1030-harbor-dispatch.lvproj.json');
const OUTPUT = resolve('examples/climate-control/WF2D-1030-climate-control.lvproj.json');
const NOW = '2026-10-14T00:00:00.000Z';
const snapshot = JSON.parse(readFileSync(SOURCE, 'utf8'));

let nextId = 1;
const id = () => `c11a7e00-0000-4000-9000-${String(nextId++).padStart(12, '0')}`;
const token = (name) => ({ $token: name });
const style = (props, selector) => selector ? { selector, props } : { props };

function node(type, codeName, props = {}, styles = [], children = [], extras = {}) {
  return {
    id: id(), type, codeName, props,
    ...((type === 'obj' || type === 'button') ? { flags: { scrollable: false } } : {}),
    styleRefs: [], styles, events: [], bindings: [], children, ...extras,
  };
}

function label(name, text, x, y, width, height, font = 18, color = 'color.text.primary', align = 'left') {
  return node('label', name, { text, x, y, width, height }, [style({
    text_color: token(color), text_font: token(`font.size.${font}`),
    text_align: align, text_opa: 255,
  })]);
}

function panel(name, x, y, width, height, children = [], options = {}) {
  return node('obj', name, { x, y, width, height }, [style({
    bg_color: token(options.fill ?? 'color.surface'), bg_opa: 255,
    border_color: token(options.border ?? 'color.border'),
    border_width: options.borderWidth ?? 1, radius: options.radius ?? 20, pad_all: 0,
    shadow_color: token('color.shadow'), shadow_width: options.shadow === false ? 0 : 12,
    shadow_opa: options.shadow === false ? 0 : 36, shadow_offset_y: options.shadow === false ? 0 : 5,
  })], children);
}

function button(name, text, x, y, width, height, options = {}) {
  const fill = options.fill ?? 'color.accent';
  const result = node('button', name, { x, y, width, height }, [
    style({
      bg_color: token(fill), bg_opa: 255,
      border_color: token(options.border ?? fill), border_width: options.borderWidth ?? 1,
      radius: options.radius ?? Math.round(height / 2), pad_all: 0,
      shadow_width: options.shadow === false ? 0 : 8,
      shadow_color: token(fill), shadow_opa: options.shadow === false ? 0 : 30,
    }),
    style({ bg_color: token(options.pressed ?? 'color.accent2') }, { states: ['pressed'] }),
  ], [label(`${name}_text`, text, 0, Math.max(0, Math.round((height - 24) / 2)), width, 24,
    options.font ?? 16, options.textColor ?? 'color.text.onaccent', 'center')]);
  if (options.event) result.events = [options.event];
  return result;
}

function progress(name, x, y, width, height, value, color = 'color.accent') {
  return node('bar', name, { x, y, width, height, min_value: 0, max_value: 100, value }, [
    style({ bg_color: token('color.track'), bg_opa: 255, radius: Math.round(height / 2) }, { part: 'main' }),
    style({ bg_color: token(color), bg_opa: 255, radius: Math.round(height / 2) }, { part: 'indicator' }),
  ]);
}

function root(name, children) {
  return node('obj', name, {}, [style({
    bg_color: token('color.background'), bg_opa: 255, border_width: 0, pad_all: 0,
  })], children);
}

function header(prefix, title, subtitle, active) {
  const nav = [
    ['HOME', 'home', '\uF015'],
    ['ZONES', 'zones', '\uF0C9'],
    ['SYSTEM', 'system', '\uF013'],
  ];
  return node('obj', `${prefix}_header`, { x: 0, y: 0, width: 1440, height: 88 }, [style({
    bg_color: token('color.header'), bg_opa: 255, border_width: 0, radius: 0, pad_all: 0,
  })], [
    label(`${prefix}_mark`, 'C', 34, 20, 48, 48, 28, 'color.text.onaccent', 'center'),
    label(`${prefix}_title`, title, 96, 18, 410, 32, 24, 'color.text.onaccent'),
    label(`${prefix}_subtitle`, subtitle, 96, 50, 430, 22, 14, 'color.text.subtle'),
    panel(`${prefix}_nav_group`, 824, 12, 584, 64,
      nav.map(([text, screen, icon], index) => button(`${prefix}_nav_${screen}`, `${icon}  ${text}`,
        8 + index * 192, 8, 184, 48, {
          fill: active === screen ? 'color.accent' : 'color.nav.surface',
          border: active === screen ? 'color.accent' : 'color.header.border',
          textColor: active === screen ? 'color.text.onaccent' : 'color.text.subtle',
          shadow: false, radius: 10, font: 14,
          event: active === screen ? undefined : {
            on: 'clicked', action: 'screen.open',
            args: { screen: SCREEN_IDS[screen], anim: 'fade_in', duration: 160, delay: 0 },
          },
        })),
      { fill: 'color.nav.surface', border: 'color.header.border', shadow: false, radius: 14 }),
  ]);
}

function metric(name, title, value, note, x, y, width, color = 'color.text.primary') {
  return panel(name, x, y, width, 132, [
    label(`${name}_title`, title, 22, 18, width - 44, 22, 14, 'color.text.muted'),
    label(`${name}_value`, value, 22, 47, width - 44, 38, 30, color),
    label(`${name}_note`, note, 22, 98, width - 44, 20, 14, 'color.text.muted'),
  ], { shadow: false, radius: 16 });
}

const SCREEN_IDS = { home: id(), zones: id(), system: id() };
const TEMP_SUBJECT = 'subject:climate-target-temperature';
const SCENE_SUBJECT = 'subject:climate-scene';

function homeScreen() {
  const value = label('climate_target_value', '22', 300, 132, 142, 62, 44, 'color.text.primary', 'right');
  value.bindings = [{ kind: 'prop', prop: 'text', subject: TEMP_SUBJECT, fmt: '%d' }];
  const unit = label('climate_target_unit', '\u00b0C', 448, 151, 72, 36, 24, 'color.text.secondary');
  const gauge = node('arc', 'climate_target_gauge', {
    x: 224, y: 62, width: 356, height: 356, min_value: 16, max_value: 30, value: 22,
    bg_start_angle: 135, bg_end_angle: 45, start_angle: 135, end_angle: 45, knob_offset: -5,
  }, [
    style({ arc_color: token('color.track'), arc_width: 20 }, { part: 'main' }),
    style({ arc_color: token('color.accent'), arc_width: 20 }, { part: 'indicator' }),
    style({
      bg_color: token('color.accent2'), bg_opa: 255, radius: 32767, pad_all: 14,
      border_color: token('color.surface'), border_opa: 255, border_width: 8,
    }, { part: 'knob' }),
  ], [], { bindings: [{ kind: 'prop', prop: 'value', subject: TEMP_SUBJECT }] });

  const decrement = button('climate_temp_down', '-  1\u00b0', 220, 432, 170, 58, {
    fill: 'color.control', border: 'color.border', textColor: 'color.text.primary', shadow: false,
    event: { on: 'clicked', action: 'subject.increment', args: { subject: TEMP_SUBJECT, step: -1, min: 16, max: 30, rollover: false } },
    font: 24,
  });
  const increment = button('climate_temp_up', '+  1\u00b0', 418, 432, 170, 58, {
    fill: 'color.control', border: 'color.border', textColor: 'color.accent2', shadow: false,
    event: { on: 'clicked', action: 'subject.increment', args: { subject: TEMP_SUBJECT, step: 1, min: 16, max: 30, rollover: false } },
    font: 24,
  });

  const sceneButton = (name, text, x, selectedValue) => {
    const result = button(name, text, x, 112, 156, 54, {
      fill: 'color.control', border: 'color.border', textColor: 'color.text.primary',
      font: 14, shadow: false, radius: 12,
      event: {
        on: 'clicked', action: 'subject.set',
        args: { subject: SCENE_SUBJECT, value: String(selectedValue) },
      },
    });
    result.styles.push(style({
      bg_color: token('color.accent'), border_color: token('color.accent'),
      text_color: token('color.text.onaccent'),
    }, { states: ['checked'] }));
    result.bindings = [{
      kind: 'state', state: 'checked', op: 'eq', subject: SCENE_SUBJECT, refValue: selectedValue,
    }];
    return result;
  };

  return {
    id: SCREEN_IDS.home, codeName: 'climate_home', displayName: 'Climate Overview', isHome: true,
    styles: [], consts: [], root: root('climate_home_root', [
      header('climate', 'CLIMATE / CONTROL', 'WEST WING  \u2022  OCCUPIED  \u2022  09:41', 'home'),
      panel('climate_temperature', 32, 112, 808, 576, [
        label('climate_temperature_eyebrow', 'TEMPERATURE', 30, 26, 260, 24, 14, 'color.accent2'),
        label('climate_temperature_title', 'Comfort setpoint', 30, 56, 430, 36, 26, 'color.text.primary'),
        label('climate_temperature_status', 'HEATING  \u2022  42%', 536, 30, 234, 26, 14, 'color.warning', 'right'),
        gauge,
        value,
        unit,
        label('climate_current_label', 'CURRENT', 324, 214, 160, 20, 12, 'color.text.muted', 'center'),
        label('climate_current_value', '21.4\u00b0C', 314, 238, 180, 30, 22, 'color.text.secondary', 'center'),
        label('climate_manual_control', 'MANUAL CONTROL', 30, 451, 180, 22, 12, 'color.text.muted'),
        decrement, increment,
        progress('climate_heat_output', 30, 522, 742, 12, 42, 'color.warning'),
        label('climate_heat_label', 'HEAT OUTPUT', 30, 544, 180, 20, 12, 'color.text.muted'),
        label('climate_heat_value', '42%', 692, 544, 80, 20, 12, 'color.warning', 'right'),
      ]),
      panel('climate_air_quality', 864, 112, 544, 260, [
        label('climate_air_title', 'AIR QUALITY', 28, 24, 220, 24, 14, 'color.accent2'),
        label('climate_air_value', 'GOOD', 28, 58, 230, 42, 32, 'color.success'),
        label('climate_air_co2', 'CO2  612 ppm', 28, 116, 190, 24, 16, 'color.text.secondary'),
        label('climate_air_humidity', 'HUMIDITY  46%', 278, 116, 228, 24, 16, 'color.text.secondary', 'right'),
        progress('climate_air_score', 28, 162, 488, 14, 78, 'color.success'),
        label('climate_air_note', 'Ventilation is operating automatically', 28, 194, 488, 22, 14, 'color.text.muted'),
      ]),
      panel('climate_scene', 864, 396, 544, 204, [
        label('climate_scene_title', 'SCENE', 28, 24, 200, 24, 14, 'color.accent2'),
        label('climate_scene_value', 'COMFORT', 28, 56, 250, 36, 26, 'color.text.primary'),
        sceneButton('climate_scene_comfort', '\uF00C  COMFORT', 28, 0),
        sceneButton('climate_scene_eco', 'ECO', 194, 1),
        sceneButton('climate_scene_away', 'AWAY', 360, 2),
      ]),
      label('climate_footer', 'SYSTEM NOMINAL   \u2022   LOCAL CONTROL', 886, 636, 500, 24, 14, 'color.text.muted', 'right'),
    ]),
  };
}

function zonesScreen() {
  const zone = (name, title, temp, humidity, x, y, color, output) => panel(name, x, y, 420, 220, [
    label(`${name}_title`, title, 24, 22, 220, 28, 20, 'color.text.primary'),
    label(`${name}_state`, output > 0 ? 'ACTIVE' : 'STANDBY', 260, 24, 136, 22, 12, color, 'right'),
    label(`${name}_temp`, `${temp}\u00b0C`, 24, 70, 180, 48, 36, color),
    label(`${name}_humidity`, `HUMIDITY  ${humidity}%`, 220, 82, 176, 24, 14, 'color.text.secondary', 'right'),
    progress(`${name}_output`, 24, 144, 372, 12, output, color),
    label(`${name}_output_label`, `OUTPUT  ${output}%`, 24, 172, 372, 20, 12, 'color.text.muted'),
  ], { radius: 18 });
  return {
    id: SCREEN_IDS.zones, codeName: 'climate_zones', displayName: 'Zone Overview',
    styles: [], consts: [], root: root('climate_zones_root', [
      header('zones', 'ZONE / OVERVIEW', '4 ZONES  \u2022  BALANCED AIRFLOW', 'zones'),
      label('zones_heading', 'Room conditions', 42, 116, 480, 38, 28, 'color.text.primary'),
      label('zones_summary', 'Average 21.8\u00b0C  \u2022  Humidity 45%', 42, 158, 520, 24, 16, 'color.text.muted'),
      zone('zone_lounge', 'LOUNGE', '22.1', 44, 42, 204, 'color.accent', 36),
      zone('zone_meeting', 'MEETING ROOM', '21.6', 48, 498, 204, 'color.success', 18),
      zone('zone_focus', 'FOCUS ROOM', '22.4', 43, 958, 204, 'color.warning', 52),
      zone('zone_cafe', 'CAFE', '21.2', 46, 42, 434, 'color.accent2', 0),
      zone('zone_corridor', 'CORRIDOR', '21.9', 41, 498, 434, 'color.success', 12),
      panel('zones_balance', 958, 434, 420, 220, [
        label('zones_balance_title', 'AIRFLOW BALANCE', 24, 22, 280, 28, 20, 'color.text.primary'),
        label('zones_balance_value', '92%', 24, 66, 180, 50, 40, 'color.accent2'),
        label('zones_balance_note', 'All dampers responding', 24, 124, 300, 22, 14, 'color.text.muted'),
        button('zones_rebalance', '\uF021  REBALANCE', 24, 158, 372, 46, { fill: 'color.control', border: 'color.accent', textColor: 'color.accent2', shadow: false, radius: 12, font: 14 }),
      ]),
      label('zones_footer', 'LIVE UPDATE   \u2022   09:41:26', 42, 680, 1336, 20, 12, 'color.text.muted', 'right'),
    ]),
  };
}

function systemScreen() {
  return {
    id: SCREEN_IDS.system, codeName: 'climate_system', displayName: 'System & Energy',
    styles: [], consts: [], root: root('climate_system_root', [
      header('system', 'SYSTEM / ENERGY', 'TODAY  \u2022  OPTIMIZATION ENABLED', 'system'),
      label('system_heading', 'Plant performance', 42, 116, 480, 38, 28, 'color.text.primary'),
      label('system_summary', 'Efficient operation with no active alarms', 42, 158, 620, 24, 16, 'color.text.muted'),
      metric('system_energy', 'ENERGY TODAY', '18.6 kWh', '12% below baseline', 42, 210, 306, 'color.accent2'),
      metric('system_runtime', 'RUNTIME', '06:42', 'Compressor cycle', 366, 210, 306, 'color.accent'),
      metric('system_filter', 'FILTER LIFE', '82%', 'Estimated 74 days', 690, 210, 306, 'color.success'),
      metric('system_service', 'NEXT SERVICE', '28 NOV', 'Preventive maintenance', 1014, 210, 364, 'color.warning'),
      panel('system_chart', 42, 372, 954, 268, [
        label('system_chart_title', '24 HOUR LOAD PROFILE', 24, 20, 360, 24, 16, 'color.text.primary'),
        label('system_chart_peak', 'PEAK  3.8 kW', 672, 20, 248, 24, 14, 'color.warning', 'right'),
        progress('system_hour_1', 28, 78, 880, 14, 26, 'color.accent'),
        progress('system_hour_2', 28, 116, 880, 14, 48, 'color.accent'),
        progress('system_hour_3', 28, 154, 880, 14, 72, 'color.warning'),
        progress('system_hour_4', 28, 192, 880, 14, 38, 'color.success'),
        label('system_chart_axis', '00:00                 06:00                 12:00                 18:00                 NOW', 28, 226, 880, 20, 12, 'color.text.muted'),
      ]),
      panel('system_actions', 1014, 372, 364, 268, [
        label('system_actions_title', 'QUICK ACTIONS', 24, 20, 280, 24, 16, 'color.text.primary'),
        button('system_optimize', '\uF0E7  RUN OPTIMIZER', 24, 62, 316, 54, { radius: 12, font: 14 }),
        button('system_schedule', 'EDIT SCHEDULE', 24, 130, 316, 54, { fill: 'color.control', border: 'color.border', textColor: 'color.text.secondary', shadow: false, radius: 12, font: 14 }),
        button('system_diagnostics', 'DIAGNOSTICS', 24, 198, 316, 46, { fill: 'color.control', border: 'color.border', textColor: 'color.text.secondary', shadow: false, radius: 12, font: 14 }),
      ]),
    ]),
  };
}

const uiId = 'ui:wf2d-1030-climate-control';
const themeId = 'climate-night';
snapshot.uiProject.meta = {
  id: uiId, revision: 1, name: 'WF2D-1030 Climate Control', appVersion: '1.0.0',
  createdAt: NOW, modifiedAt: NOW,
};
snapshot.uiProject.themes = [{
  id: themeId,
  displayName: 'Climate Night',
  tokens: [
    ['color.background', 'color', '#06181C'],
    ['color.header', 'color', '#0B252A'],
    ['color.header.border', 'color', '#21444A'],
    ['color.nav.surface', 'color', '#081E23'],
    ['color.surface', 'color', '#0C2429'],
    ['color.surface2', 'color', '#12343A'],
    ['color.control', 'color', '#153A40'],
    ['color.border', 'color', '#24474D'],
    ['color.text.primary', 'color', '#E6F0F1'],
    ['color.text.secondary', 'color', '#B6CBCD'],
    ['color.text.subtle', 'color', '#8FAEB1'],
    ['color.text.muted', 'color', '#6F9296'],
    ['color.text.onaccent', 'color', '#F5FFFF'],
    ['color.accent', 'color', '#168986'],
    ['color.accent2', 'color', '#51D6C9'],
    ['color.success', 'color', '#56D39A'],
    ['color.warning', 'color', '#F0B65B'],
    ['color.danger', 'color', '#EF6E78'],
    ['color.track', 'color', '#1A3A40'],
    ['color.shadow', 'color', '#020B0D'],
    ['font.size.12', 'fontRef', 'montserrat_12'],
    ['font.size.14', 'fontRef', 'montserrat_14'],
    ['font.size.16', 'fontRef', 'montserrat_16'],
    ['font.size.18', 'fontRef', 'montserrat_18'],
    ['font.size.20', 'fontRef', 'montserrat_20'],
    ['font.size.22', 'fontRef', 'montserrat_22'],
    ['font.size.24', 'fontRef', 'montserrat_24'],
    ['font.size.26', 'fontRef', 'montserrat_26'],
    ['font.size.28', 'fontRef', 'montserrat_28'],
    ['font.size.30', 'fontRef', 'montserrat_30'],
    ['font.size.32', 'fontRef', 'montserrat_32'],
    ['font.size.36', 'fontRef', 'montserrat_36'],
    ['font.size.40', 'fontRef', 'montserrat_40'],
    ['font.size.44', 'fontRef', 'montserrat_44'],
  ].map(([id, type, value]) => ({ id, type, value })),
}];
snapshot.uiProject.subjects = [{
  id: TEMP_SUBJECT, codeName: 'climate_target_temperature', displayName: 'Target temperature',
  type: 'int', initial: 22, min: 16, max: 30,
}, {
  id: SCENE_SUBJECT, codeName: 'climate_scene_mode', displayName: 'Climate scene',
  type: 'int', initial: 0, min: 0, max: 2,
}];
snapshot.uiProject.screens = [homeScreen(), zonesScreen(), systemScreen()];
snapshot.uiProject.editor = {
  deviceModel: 'WF2D-1030', deviceTitle: '5.9 inch ultra-wide',
  example: 'climate-control-v1', showcase: 'climate-control',
};
snapshot.buildTarget = {
  ...snapshot.buildTarget,
  id: 'target:wf2d-1030-climate-control', revision: 1,
  displayName: 'WF2D-1030 Climate Control Target',
  uiProjectRef: `${uiId}@1`, themeRef: `${uiId}@1#theme:${themeId}`,
};

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Generated ${OUTPUT}`);
