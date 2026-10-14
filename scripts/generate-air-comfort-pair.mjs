import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const NOW = '2026-10-14T00:00:00.000Z';
const token = (name) => ({ $token: name });
const style = (props, selector) => selector ? { selector, props } : { props };

function createKit(idPrefix) {
  let nextId = 1;
  const id = () => `${idPrefix}-0000-4000-9000-${String(nextId++).padStart(12, '0')}`;
  const node = (type, codeName, props = {}, styles = [], children = [], extras = {}) => ({
    id: id(), type, codeName, props,
    ...((type === 'obj' || type === 'button') ? { flags: { scrollable: false } } : {}),
    styleRefs: [], styles, events: [], bindings: [], children, ...extras,
  });
  const label = (name, text, x, y, width, height, font = 16, color = 'color.text.primary', align = 'left') => {
    const resolvedFont = Math.min(48, font % 2 === 0 ? font : font + 1);
    return node('label', name, { text, x, y, width, height }, [style({
      text_color: token(color), text_font: token(`font.size.${resolvedFont}`), text_align: align, text_opa: 255,
    })]);
  };
  const panel = (name, x, y, width, height, children = [], options = {}) => node(
    'obj', name, { x, y, width, height }, [style({
      bg_color: token(options.fill ?? 'color.surface'), bg_opa: 255,
      border_color: token(options.border ?? 'color.border'), border_width: options.borderWidth ?? 1,
      radius: options.radius ?? 16, pad_all: 0,
      shadow_color: token('color.shadow'), shadow_width: options.shadow ? 10 : 0,
      shadow_opa: options.shadow ? 32 : 0, shadow_offset_y: options.shadow ? 4 : 0,
    })], children,
  );
  const button = (name, text, x, y, width, height, options = {}) => {
    const fill = options.fill ?? 'color.accent';
    const result = node('button', name, { x, y, width, height }, [
      style({
        bg_color: token(fill), bg_opa: 255, border_color: token(options.border ?? fill),
        border_width: options.borderWidth ?? 1, radius: options.radius ?? Math.round(height / 2),
        pad_all: 0, shadow_width: 0,
      }),
      style({ bg_color: token(options.pressed ?? 'color.accent2') }, { states: ['pressed'] }),
    ], [label(`${name}_text`, text, 0, Math.max(0, Math.round((height - 22) / 2)), width, 22,
      options.font ?? 14, options.textColor ?? 'color.text.onaccent', 'center')]);
    if (options.event) result.events = [options.event];
    return result;
  };
  const bar = (name, x, y, width, height, value, color = 'color.accent') => node(
    'bar', name, { x, y, width, height, min_value: 0, max_value: 100, value }, [
      style({ bg_color: token('color.track'), bg_opa: 255, radius: 32767 }, { part: 'main' }),
      style({ bg_color: token(color), bg_opa: 255, radius: 32767 }, { part: 'indicator' }),
    ],
  );
  const root = (name, children) => node('obj', name, {}, [style({
    bg_color: token('color.background'), bg_opa: 255, border_width: 0, pad_all: 0,
  })], children);
  return { id, node, label, panel, button, bar, root };
}

const fonts = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48]
  .map((size) => [`font.size.${size}`, 'fontRef', `montserrat_${size}`]);

function theme(id, displayName, colors) {
  return {
    id, displayName,
    tokens: [...Object.entries(colors).map(([name, value]) => [name, 'color', value]), ...fonts]
      .map(([tokenId, type, value]) => ({ id: tokenId, type, value })),
  };
}

function build1050() {
  const source = resolve('examples/device-showcase/WF2D-1050-ev-charge.lvproj.json');
  const snapshot = JSON.parse(readFileSync(source, 'utf8'));
  const output = resolve('examples/air-comfort/WF2D-1050-air-comfort.lvproj.json');
  const k = createKit('a1050000');
  const screens = { home: k.id(), air: k.id(), scenes: k.id() };
  const fanSubject = 'subject:air1050-fan-speed';
  const sceneSubject = 'subject:air1050-scene';

  const header = (prefix, title, subtitle, active) => {
    const items = [['OVERVIEW', 'home'], ['AIR DATA', 'air'], ['SCENES', 'scenes']];
    return k.node('obj', `${prefix}_header`, { x: 0, y: 0, width: 1024, height: 76 }, [style({
      bg_color: token('color.header'), bg_opa: 255, border_width: 0, radius: 0, pad_all: 0,
    })], [
      k.label(`${prefix}_mark`, 'A', 26, 16, 42, 42, 24, 'color.text.onaccent', 'center'),
      k.label(`${prefix}_title`, title, 78, 13, 330, 28, 22, 'color.text.onaccent'),
      k.label(`${prefix}_subtitle`, subtitle, 78, 41, 380, 20, 12, 'color.text.muted'),
      k.panel(`${prefix}_nav`, 548, 12, 452, 52, items.map(([text, key], index) => k.button(
        `${prefix}_nav_${key}`, text, 6 + index * 148, 6, 142, 40, {
          fill: active === key ? 'color.accent' : 'color.nav',
          border: active === key ? 'color.accent' : 'color.header.border',
          textColor: active === key ? 'color.text.onaccent' : 'color.text.muted',
          radius: 10, font: 12,
          event: active === key ? undefined : {
            on: 'clicked', action: 'screen.open',
            args: { screen: screens[key], anim: 'fade_in', duration: 140, delay: 0 },
          },
        },
      )), { fill: 'color.nav', border: 'color.header.border', radius: 13 }),
    ]);
  };

  const sceneButton = (name, text, x, selectedValue) => {
    const result = k.button(name, text, x, 118, 110, 44, {
      fill: 'color.control', border: 'color.border', textColor: 'color.text.secondary', radius: 10,
      event: { on: 'clicked', action: 'subject.set', args: { subject: sceneSubject, value: String(selectedValue) } },
    });
    result.styles.push(style({ bg_color: token('color.accent'), border_color: token('color.accent') }, { states: ['checked'] }));
    result.bindings = [{ kind: 'state', state: 'checked', op: 'eq', subject: sceneSubject, refValue: selectedValue }];
    return result;
  };

  const fanValue = k.label('air1050_fan_value', '60', 162, 112, 120, 58, 48, 'color.text.primary', 'right');
  fanValue.bindings = [{ kind: 'prop', prop: 'text', subject: fanSubject, fmt: '%d' }];
  const fanArc = k.node('arc', 'air1050_fan_arc', {
    x: 100, y: 54, width: 250, height: 250, min_value: 0, max_value: 100, value: 60,
    bg_start_angle: 140, bg_end_angle: 40, start_angle: 140, end_angle: 40, knob_offset: -4,
  }, [
    style({ arc_color: token('color.track'), arc_width: 18 }, { part: 'main' }),
    style({ arc_color: token('color.accent'), arc_width: 18 }, { part: 'indicator' }),
    style({
      bg_color: token('color.accent2'), bg_opa: 255, radius: 32767, pad_all: 11,
      border_color: token('color.surface'), border_opa: 255, border_width: 7,
    }, { part: 'knob' }),
  ], [], { bindings: [{ kind: 'prop', prop: 'value', subject: fanSubject }] });

  const adjust = (name, text, x, step) => k.button(name, text, x, 324, 146, 52, {
    fill: 'color.control', border: 'color.border', textColor: step > 0 ? 'color.accent2' : 'color.text.primary',
    font: 20, radius: 12,
    event: { on: 'clicked', action: 'subject.increment', args: {
      subject: fanSubject, step, min: 0, max: 100, rollover: false,
    } },
  });

  const home = {
    id: screens.home, codeName: 'air1050_home', displayName: 'Air Comfort Overview', isHome: true,
    styles: [], consts: [], root: k.root('air1050_home_root', [
      header('air1050_home', 'AIR / COMFORT', 'WEST WING  •  AUTO  •  09:41', 'home'),
      k.panel('air1050_fan_panel', 24, 96, 590, 478, [
        k.label('air1050_fan_eyebrow', 'FAN SPEED', 24, 22, 180, 22, 13, 'color.accent2'),
        k.label('air1050_fan_mode', 'AUTO BALANCE', 352, 22, 210, 22, 13, 'color.success', 'right'),
        fanArc, fanValue,
        k.label('air1050_fan_percent', '%', 288, 130, 40, 32, 24, 'color.text.secondary'),
        k.label('air1050_fan_caption', 'SUPPLY AIR', 175, 177, 110, 18, 11, 'color.text.muted', 'center'),
        k.label('air1050_fan_airflow', '428 m3/h', 152, 200, 156, 28, 20, 'color.text.secondary', 'center'),
        k.label('air1050_manual', 'MANUAL CONTROL', 24, 298, 220, 18, 11, 'color.text.muted'),
        adjust('air1050_fan_down', '- 5', 24, -5), adjust('air1050_fan_up', '+ 5', 186, 5),
        k.panel('air1050_energy_badge', 358, 324, 204, 52, [
          k.label('air1050_energy_icon', 'ECO', 14, 8, 52, 20, 12, 'color.success'),
          k.label('air1050_energy_value', '1.2 kW', 72, 8, 116, 22, 16, 'color.text.primary', 'right'),
          k.label('air1050_energy_note', 'CURRENT DRAW', 72, 29, 116, 16, 10, 'color.text.muted', 'right'),
        ], { fill: 'color.surface2', border: 'color.border', radius: 10 }),
        k.bar('air1050_output', 24, 406, 538, 12, 60, 'color.accent'),
        k.label('air1050_output_label', 'AIRFLOW OUTPUT', 24, 429, 220, 18, 11, 'color.text.muted'),
        k.label('air1050_output_value', '60%', 482, 429, 80, 18, 11, 'color.accent2', 'right'),
      ]),
      k.panel('air1050_quality_panel', 634, 96, 366, 222, [
        k.label('air1050_quality_title', 'INDOOR AIR QUALITY', 22, 20, 260, 20, 12, 'color.accent2'),
        k.label('air1050_quality_value', 'GOOD', 22, 52, 190, 38, 30, 'color.success'),
        k.label('air1050_co2', 'CO2  612 ppm', 22, 100, 150, 22, 14, 'color.text.secondary'),
        k.label('air1050_humidity', '46% RH', 210, 100, 134, 22, 14, 'color.text.secondary', 'right'),
        k.bar('air1050_quality_score', 22, 140, 322, 12, 78, 'color.success'),
        k.label('air1050_quality_note', 'Fresh-air loop is operating normally', 22, 170, 322, 20, 12, 'color.text.muted'),
      ]),
      k.panel('air1050_scene_panel', 634, 338, 366, 188, [
        k.label('air1050_scene_title', 'ACTIVE SCENE', 22, 18, 180, 20, 12, 'color.accent2'),
        k.label('air1050_scene_value', 'COMFORT', 22, 46, 210, 34, 24, 'color.text.primary'),
        k.label('air1050_scene_note', 'Balanced temperature and fresh air', 22, 80, 322, 20, 11, 'color.text.muted'),
        sceneButton('air1050_scene_comfort', 'COMFORT', 14, 0),
        sceneButton('air1050_scene_eco', 'ECO', 128, 1),
        sceneButton('air1050_scene_boost', 'BOOST', 242, 2),
      ]),
      k.label('air1050_footer', 'SYSTEM NOMINAL  •  LOCAL CONTROL', 634, 548, 366, 18, 11, 'color.text.muted', 'right'),
    ]),
  };

  const metric = (name, title, value, note, x, y, width, color) => k.panel(name, x, y, width, 150, [
    k.label(`${name}_title`, title, 18, 16, width - 36, 20, 12, 'color.text.muted'),
    k.label(`${name}_value`, value, 18, 47, width - 36, 38, 28, color),
    k.label(`${name}_note`, note, 18, 104, width - 36, 22, 12, 'color.text.secondary'),
  ]);
  const air = {
    id: screens.air, codeName: 'air1050_air_data', displayName: 'Air Data',
    styles: [], consts: [], root: k.root('air1050_air_root', [
      header('air1050_air', 'AIR / DATA', 'LIVE SENSOR NETWORK  •  09:41:26', 'air'),
      k.label('air1050_air_heading', 'Indoor air at a glance', 28, 96, 520, 32, 26, 'color.text.primary'),
      k.label('air1050_air_intro', 'All monitored values remain inside the comfort envelope', 28, 132, 620, 22, 13, 'color.text.muted'),
      metric('air1050_metric_co2', 'CARBON DIOXIDE', '612 ppm', 'Target below 800 ppm', 28, 174, 224, 'color.success'),
      metric('air1050_metric_pm', 'PM2.5', '7 ug/m3', 'Clean indoor air', 268, 174, 224, 'color.accent2'),
      metric('air1050_metric_rh', 'HUMIDITY', '46%', 'Comfort band 40-60%', 508, 174, 224, 'color.accent'),
      metric('air1050_metric_voc', 'VOC INDEX', '82', 'Low emissions', 748, 174, 248, 'color.success'),
      k.panel('air1050_ventilation', 28, 344, 704, 216, [
        k.label('air1050_vent_title', 'VENTILATION DISTRIBUTION', 20, 18, 360, 22, 14, 'color.text.primary'),
        k.label('air1050_vent_total', '428 m3/h TOTAL', 470, 18, 210, 22, 12, 'color.accent2', 'right'),
        k.label('air1050_zone_lounge', 'LOUNGE', 20, 62, 120, 18, 11, 'color.text.muted'),
        k.bar('air1050_zone_lounge_bar', 132, 65, 526, 10, 72, 'color.accent'),
        k.label('air1050_zone_meeting', 'MEETING', 20, 100, 120, 18, 11, 'color.text.muted'),
        k.bar('air1050_zone_meeting_bar', 132, 103, 526, 10, 48, 'color.accent2'),
        k.label('air1050_zone_focus', 'FOCUS', 20, 138, 120, 18, 11, 'color.text.muted'),
        k.bar('air1050_zone_focus_bar', 132, 141, 526, 10, 61, 'color.success'),
        k.label('air1050_zone_cafe', 'CAFE', 20, 176, 120, 18, 11, 'color.text.muted'),
        k.bar('air1050_zone_cafe_bar', 132, 179, 526, 10, 35, 'color.warning'),
      ]),
      k.panel('air1050_filter', 748, 344, 248, 216, [
        k.label('air1050_filter_title', 'FILTER HEALTH', 18, 18, 212, 22, 14, 'color.text.primary'),
        k.label('air1050_filter_value', '82%', 18, 54, 212, 46, 36, 'color.success'),
        k.bar('air1050_filter_bar', 18, 112, 212, 12, 82, 'color.success'),
        k.label('air1050_filter_note', 'Estimated 74 days remaining', 18, 142, 212, 20, 11, 'color.text.muted'),
        k.button('air1050_filter_details', 'VIEW DETAILS', 18, 174, 212, 30, {
          fill: 'color.control', border: 'color.border', textColor: 'color.text.secondary', radius: 8, font: 11,
        }),
      ]),
    ]),
  };

  const preset = (name, title, detail, x, color, selectedValue) => {
    const item = k.panel(name, x, 188, 298, 244, [
      k.label(`${name}_tag`, selectedValue === 0 ? 'ACTIVE' : 'PRESET', 20, 18, 120, 20, 11, color),
      k.label(`${name}_title`, title, 20, 54, 258, 34, 26, 'color.text.primary'),
      k.label(`${name}_detail`, detail, 20, 98, 258, 42, 12, 'color.text.muted'),
      k.bar(`${name}_bar`, 20, 156, 258, 10, [58, 34, 92][selectedValue], color),
      k.button(`${name}_apply`, selectedValue === 0 ? 'SELECTED' : 'APPLY SCENE', 20, 184, 258, 42, {
        fill: selectedValue === 0 ? 'color.accent' : 'color.control',
        border: selectedValue === 0 ? 'color.accent' : 'color.border',
        textColor: selectedValue === 0 ? 'color.text.onaccent' : 'color.text.secondary', radius: 10,
        event: { on: 'clicked', action: 'subject.set', args: { subject: sceneSubject, value: String(selectedValue) } },
      }),
    ], { border: selectedValue === 0 ? 'color.accent' : 'color.border' });
    item.bindings = [{
      kind: 'style', styleId: [
        'style:air1050-scene-comfort-selected',
        'style:air1050-scene-eco-selected',
        'style:air1050-scene-boost-selected',
      ][selectedValue], subject: sceneSubject, refValue: selectedValue,
    }];
    return item;
  };
  const scenesPage = {
    id: screens.scenes, codeName: 'air1050_scenes', displayName: 'Comfort Scenes',
    styles: [
      { id: 'style:air1050-scene-comfort-selected', codeName: 'air1050_scene_comfort_selected', displayName: 'Comfort selected', props: { border_color: token('color.accent'), border_width: 2 } },
      { id: 'style:air1050-scene-eco-selected', codeName: 'air1050_scene_eco_selected', displayName: 'Eco selected', props: { border_color: token('color.success'), border_width: 2 } },
      { id: 'style:air1050-scene-boost-selected', codeName: 'air1050_scene_boost_selected', displayName: 'Boost selected', props: { border_color: token('color.warning'), border_width: 2 } },
    ], consts: [], root: k.root('air1050_scenes_root', [
      header('air1050_scenes', 'COMFORT / SCENES', 'ONE-TOUCH ENVIRONMENT PRESETS', 'scenes'),
      k.label('air1050_scenes_heading', 'Choose how the room should feel', 40, 108, 720, 38, 28, 'color.text.primary'),
      k.label('air1050_scenes_intro', 'Each scene coordinates fan speed, fresh air and target temperature.', 40, 148, 760, 22, 13, 'color.text.muted'),
      preset('air1050_scene_comfort_card', 'COMFORT', 'Balanced airflow\n22°C target • quiet response', 40, 'color.accent2', 0),
      preset('air1050_scene_eco_card', 'ECO', 'Energy-aware operation\nReduced airflow • 24°C target', 363, 'color.success', 1),
      preset('air1050_scene_boost_card', 'BOOST', 'Rapid fresh-air exchange\nMaximum airflow • 20 minutes', 686, 'color.warning', 2),
      k.panel('air1050_schedule_strip', 40, 454, 944, 94, [
        k.label('air1050_schedule_title', 'NEXT AUTOMATION', 18, 16, 190, 18, 11, 'color.text.muted'),
        k.label('air1050_schedule_time', '18:30', 18, 42, 110, 30, 22, 'color.text.primary'),
        k.label('air1050_schedule_action', 'ECO scene  •  End of occupied hours', 146, 44, 480, 24, 14, 'color.text.secondary'),
        k.button('air1050_schedule_edit', 'EDIT SCHEDULE', 744, 24, 180, 46, {
          fill: 'color.control', border: 'color.border', textColor: 'color.text.secondary', radius: 10,
        }),
      ]),
    ]),
  };

  const uiId = 'ui:wf2d-1050-air-comfort';
  const themeId = 'air1050-midnight';
  snapshot.uiProject.meta = { id: uiId, revision: 1, name: 'WF2D-1050 Air & Comfort', appVersion: '1.0.0', createdAt: NOW, modifiedAt: NOW };
  snapshot.uiProject.themes = [theme(themeId, 'Air Comfort Midnight', {
    'color.background': '#071522', 'color.header': '#0A1B2A', 'color.header.border': '#23445E',
    'color.nav': '#0C2131', 'color.surface': '#10263A', 'color.surface2': '#162E45',
    'color.control': '#1A3852', 'color.border': '#294B65', 'color.track': '#1E3B50',
    'color.text.primary': '#ECF5F8', 'color.text.secondary': '#BCD0DA', 'color.text.muted': '#7898A8',
    'color.text.onaccent': '#F8FFFF', 'color.accent': '#237FC1', 'color.accent2': '#61B9F2',
    'color.success': '#53D69B', 'color.warning': '#F2B95F', 'color.danger': '#EF6E78', 'color.shadow': '#02080E',
  })];
  snapshot.uiProject.subjects = [
    { id: fanSubject, codeName: 'air1050_fan_speed', displayName: 'Fan speed', type: 'int', initial: 60, min: 0, max: 100 },
    { id: sceneSubject, codeName: 'air1050_scene_mode', displayName: 'Comfort scene', type: 'int', initial: 0, min: 0, max: 2 },
  ];
  snapshot.uiProject.screens = [home, air, scenesPage];
  snapshot.uiProject.editor = { deviceModel: 'WF2D-1050', deviceTitle: '7 inch 1024×600', example: 'air-comfort-v1', showcase: 'air-comfort' };
  snapshot.buildTarget = { ...snapshot.buildTarget, id: 'target:wf2d-1050-air-comfort', revision: 1,
    displayName: 'WF2D-1050 Air & Comfort Target', uiProjectRef: `${uiId}@1`, themeRef: `${uiId}@1#theme:${themeId}` };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`);
  return output;
}

function build8630() {
  const source = resolve('examples/device-showcase/WF2D-8630-greenhouse.lvproj.json');
  const snapshot = JSON.parse(readFileSync(source, 'utf8'));
  const output = resolve('examples/air-comfort/WF2D-8630-room-climate.lvproj.json');
  const k = createKit('a8630000');
  const screens = { home: k.id(), air: k.id(), schedule: k.id() };
  const tempSubject = 'subject:room8630-temperature';

  const top = (prefix, title, active) => k.node('obj', `${prefix}_header`, { x: 0, y: 0, width: 480, height: 68 }, [style({
    bg_color: token('color.header'), bg_opa: 255, border_width: 0, radius: 0, pad_all: 0,
  })], [
    k.label(`${prefix}_mark`, 'R', 18, 14, 40, 40, 22, 'color.text.onaccent', 'center'),
    k.label(`${prefix}_title`, title, 68, 13, 250, 26, 20, 'color.text.onaccent'),
    k.label(`${prefix}_subtitle`, 'ROOM 03  •  OCCUPIED', 68, 40, 250, 18, 11, 'color.text.muted'),
    k.label(`${prefix}_status`, active === 'home' ? 'COMFORT' : active === 'air' ? 'LIVE' : 'AUTO', 360, 23, 98, 22, 11,
      active === 'air' ? 'color.success' : 'color.accent2', 'right'),
  ]);

  const bottomNav = (prefix, active) => {
    const items = [['HOME', 'home'], ['AIR', 'air'], ['PLAN', 'schedule']];
    return k.node('obj', `${prefix}_bottom_nav`, { x: 0, y: 424, width: 480, height: 56 }, [style({
      bg_color: token('color.header'), bg_opa: 255, border_width: 0, radius: 0, pad_all: 0,
    })], items.map(([text, key], index) => k.button(`${prefix}_nav_${key}`, text, 12 + index * 156, 8, 144, 40, {
      fill: active === key ? 'color.accent' : 'color.header',
      border: active === key ? 'color.accent' : 'color.header',
      textColor: active === key ? 'color.text.onaccent' : 'color.text.muted', radius: 10, font: 12,
      event: active === key ? undefined : { on: 'clicked', action: 'screen.open', args: {
        screen: screens[key], anim: 'fade_in', duration: 120, delay: 0,
      } },
    })));
  };

  const tempValue = k.label('room8630_target_value', '25', 128, 76, 144, 66, 56, 'color.text.primary', 'right');
  tempValue.bindings = [{ kind: 'prop', prop: 'text', subject: tempSubject, fmt: '%d' }];
  const tempButton = (name, text, x, step) => k.button(name, text, x, 166, 186, 54, {
    fill: 'color.control', border: 'color.border', textColor: step > 0 ? 'color.accent2' : 'color.text.primary',
    font: 22, radius: 12, event: { on: 'clicked', action: 'subject.increment', args: {
      subject: tempSubject, step, min: 16, max: 30, rollover: false,
    } },
  });
  const home = {
    id: screens.home, codeName: 'room8630_home', displayName: 'Room Climate', isHome: true,
    styles: [], consts: [], root: k.root('room8630_home_root', [
      top('room8630_home', 'ROOM CLIMATE', 'home'),
      k.panel('room8630_temperature', 18, 84, 444, 238, [
        k.label('room8630_target_title', 'TARGET TEMPERATURE', 24, 20, 396, 22, 13, 'color.accent2', 'center'),
        tempValue,
        k.label('room8630_target_unit', '°C', 280, 94, 58, 34, 26, 'color.text.secondary'),
        k.label('room8630_current', 'CURRENT  21.4°C', 24, 136, 396, 20, 12, 'color.text.muted', 'center'),
        tempButton('room8630_temp_down', '- 1', 24, -1),
        tempButton('room8630_temp_up', '+ 1', 234, 1),
      ]),
      k.panel('room8630_air_tile', 18, 340, 214, 66, [
        k.label('room8630_air_label', 'AIR QUALITY', 14, 10, 118, 18, 10, 'color.text.muted'),
        k.label('room8630_air_value', 'GOOD', 14, 30, 118, 24, 18, 'color.success'),
        k.label('room8630_air_co2', '612', 138, 16, 60, 22, 16, 'color.text.primary', 'right'),
        k.label('room8630_air_unit', 'ppm', 138, 39, 60, 16, 9, 'color.text.muted', 'right'),
      ]),
      k.panel('room8630_humidity_tile', 248, 340, 214, 66, [
        k.label('room8630_humidity_label', 'HUMIDITY', 14, 10, 118, 18, 10, 'color.text.muted'),
        k.label('room8630_humidity_value', '46%', 14, 30, 118, 24, 18, 'color.accent2'),
        k.label('room8630_humidity_note', 'COMFORT', 116, 27, 82, 18, 10, 'color.success', 'right'),
      ]),
      bottomNav('room8630_home', 'home'),
    ]),
  };

  const air = {
    id: screens.air, codeName: 'room8630_air', displayName: 'Room Air',
    styles: [], consts: [], root: k.root('room8630_air_root', [
      top('room8630_air', 'AIR QUALITY', 'air'),
      k.panel('room8630_air_score', 18, 84, 444, 164, [
        k.label('room8630_air_score_label', 'ROOM AIR SCORE', 22, 18, 180, 20, 11, 'color.text.muted'),
        k.label('room8630_air_score_value', '92', 22, 48, 122, 64, 56, 'color.success'),
        k.label('room8630_air_score_unit', '/100', 146, 78, 64, 28, 18, 'color.text.secondary'),
        k.label('room8630_air_score_state', 'HEALTHY', 262, 52, 154, 30, 22, 'color.success', 'right'),
        k.label('room8630_air_score_note', 'Fresh-air loop active', 226, 88, 190, 20, 11, 'color.text.muted', 'right'),
        k.bar('room8630_air_score_bar', 22, 128, 394, 12, 92, 'color.success'),
      ]),
      k.panel('room8630_air_co2_card', 18, 266, 136, 132, [
        k.label('room8630_air_co2_title', 'CO2', 14, 14, 108, 18, 11, 'color.text.muted'),
        k.label('room8630_air_co2_value', '612', 14, 44, 108, 34, 26, 'color.text.primary'),
        k.label('room8630_air_co2_unit2', 'ppm', 14, 82, 108, 18, 10, 'color.text.muted'),
        k.bar('room8630_air_co2_bar', 14, 108, 108, 8, 61, 'color.accent'),
      ]),
      k.panel('room8630_air_pm_card', 172, 266, 136, 132, [
        k.label('room8630_air_pm_title', 'PM2.5', 14, 14, 108, 18, 11, 'color.text.muted'),
        k.label('room8630_air_pm_value', '7', 14, 44, 108, 34, 26, 'color.accent2'),
        k.label('room8630_air_pm_unit', 'ug/m3', 14, 82, 108, 18, 10, 'color.text.muted'),
        k.bar('room8630_air_pm_bar', 14, 108, 108, 8, 28, 'color.accent2'),
      ]),
      k.panel('room8630_air_rh_card', 326, 266, 136, 132, [
        k.label('room8630_air_rh_title', 'HUMIDITY', 14, 14, 108, 18, 11, 'color.text.muted'),
        k.label('room8630_air_rh_value', '46%', 14, 44, 108, 34, 26, 'color.success'),
        k.label('room8630_air_rh_unit', 'COMFORT', 14, 82, 108, 18, 10, 'color.text.muted'),
        k.bar('room8630_air_rh_bar', 14, 108, 108, 8, 46, 'color.success'),
      ]),
      bottomNav('room8630_air', 'air'),
    ]),
  };

  const slot = (name, time, title, note, y, active = false) => k.panel(name, 18, y, 444, 72, [
    k.label(`${name}_time`, time, 16, 14, 76, 28, 20, active ? 'color.accent2' : 'color.text.primary'),
    k.label(`${name}_title`, title, 106, 10, 218, 22, 14, 'color.text.primary'),
    k.label(`${name}_note`, note, 106, 36, 250, 18, 10, 'color.text.muted'),
    k.label(`${name}_state`, active ? 'NOW' : 'AUTO', 360, 24, 66, 20, 10, active ? 'color.success' : 'color.text.muted', 'right'),
  ], { fill: active ? 'color.surface2' : 'color.surface', border: active ? 'color.accent' : 'color.border', radius: 12 });
  const schedule = {
    id: screens.schedule, codeName: 'room8630_schedule', displayName: 'Climate Schedule',
    styles: [], consts: [], root: k.root('room8630_schedule_root', [
      top('room8630_schedule', 'DAILY PLAN', 'schedule'),
      k.label('room8630_schedule_date', 'TODAY  •  WED 14 OCT', 18, 84, 444, 24, 12, 'color.accent2'),
      slot('room8630_slot_arrive', '08:00', 'ARRIVAL', 'Comfort • 23°C', 118, false),
      slot('room8630_slot_work', '09:30', 'FOCUS HOURS', 'Quiet fan • 22°C', 200, true),
      slot('room8630_slot_eco', '18:30', 'ECO MODE', 'Reduced airflow • 25°C', 282, false),
      k.panel('room8630_schedule_next', 18, 374, 444, 34, [
        k.label('room8630_schedule_next_label', 'NEXT CHANGE', 12, 8, 110, 18, 10, 'color.text.muted'),
        k.label('room8630_schedule_next_value', '18:30  •  ECO', 128, 7, 298, 20, 12, 'color.text.secondary', 'right'),
      ], { fill: 'color.control', border: 'color.control', radius: 9 }),
      bottomNav('room8630_schedule', 'schedule'),
    ]),
  };

  const uiId = 'ui:wf2d-8630-room-climate';
  const themeId = 'room8630-slate';
  snapshot.uiProject.meta = { id: uiId, revision: 1, name: 'WF2D-8630 Room Climate', appVersion: '1.0.0', createdAt: NOW, modifiedAt: NOW };
  snapshot.uiProject.themes = [theme(themeId, 'Room Climate Slate', {
    'color.background': '#0C1423', 'color.header': '#111C2D', 'color.header.border': '#2D4058',
    'color.nav': '#111C2D', 'color.surface': '#1B293B', 'color.surface2': '#22354A',
    'color.control': '#30445E', 'color.border': '#344A63', 'color.track': '#2A3C51',
    'color.text.primary': '#ECF1F8', 'color.text.secondary': '#C1CDDB', 'color.text.muted': '#8797AA',
    'color.text.onaccent': '#FFFFFF', 'color.accent': '#3A71B7', 'color.accent2': '#8FC5FF',
    'color.success': '#62D89A', 'color.warning': '#F1B65A', 'color.danger': '#EF7180', 'color.shadow': '#030711',
  })];
  snapshot.uiProject.subjects = [
    { id: tempSubject, codeName: 'room8630_target_temperature', displayName: 'Target temperature', type: 'int', initial: 25, min: 16, max: 30 },
  ];
  snapshot.uiProject.screens = [home, air, schedule];
  snapshot.uiProject.editor = { deviceModel: 'WF2D-8630', deviceTitle: '3.95 inch 480×480', example: 'room-climate-v1', showcase: 'room-climate' };
  snapshot.buildTarget = { ...snapshot.buildTarget, id: 'target:wf2d-8630-room-climate', revision: 1,
    displayName: 'WF2D-8630 Room Climate Target', uiProjectRef: `${uiId}@1`, themeRef: `${uiId}@1#theme:${themeId}` };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`);
  return output;
}

for (const output of [build1050(), build8630()]) console.log(`Generated ${output}`);
