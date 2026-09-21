/**
 * golden 用例工程(固定 uuid,保证输出确定性)。
 */
import type { LvProject, ScreenDef, WidgetNode } from '@lvd/schema';

let seq = 0;
function uid(): string {
  seq += 1;
  // 前 8 位随 seq 变化:previewName = '_x' + 前 8 位,fixture 不得互撞
  return `${String(seq).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

function n(type: string, over: Partial<WidgetNode> = {}): WidgetNode {
  return {
    id: uid(), type, props: {}, styles: [], inlineStyles: [],
    events: [], bindings: [], children: [], ...over,
  };
}

function screen(name: string, over: Partial<ScreenDef> = {}): ScreenDef {
  return { id: uid(), name, styles: [], consts: [], root: n('obj'), ...over };
}

function project(over: Partial<LvProject> = {}): LvProject {
  return {
    schemaVersion: 1,
    meta: {
      name: 'golden', lvglVersion: '9.4', appVersion: '0.1.0',
      createdAt: '2026-07-02T00:00:00.000Z', modifiedAt: '2026-07-02T00:00:00.000Z',
    },
    display: { width: 240, height: 320, shape: 'rect', colorDepth: 16, dpi: 130 },
    screens: [], components: [], styles: [], consts: [], subjects: [],
    assets: { fonts: [], images: [] },
    translations: null,
    codegen: { outputDirName: 'ui', exportXml: false, userIncludes: [] },
    ...over,
  };
}

/* ---------------------------------------------------- case 1: 15 widget 全用 */

export function caseWidgetsAll(): LvProject {
  seq = 0;
  return project({
    assets: {
      fonts: [],
      images: [{ name: 'logo', file: { fileName: 'logo.png', sha256: '0'.repeat(64), byteSize: 128 }, conv: { colorFormat: 'ARGB8888' } }],
    },
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('obj', { name: 'panel', props: { x: 0, y: 0, width: 240, height: 320 } }),
          n('label', {
            name: 'title',
            props: { text: 'Hello & <World>', long_mode: 'dots', width: 'content', height: 'content', align: 'top_mid', y: 4 },
          }),
          n('button', {
            name: 'btn_ok',
            props: { width: 100, height: 40, align: 'center' },
            flags: { checkable: true, hidden: false },
            states: { checked: true },
            children: [n('label', { props: { text: 'OK', align: 'center' } })],
          }),
          n('slider', {
            name: 'sld',
            props: { width: 150, height: 10, value: 35, value_animated: true, min_value: 10, mode: 'range', start_value: 20 },
            inlineStyles: [{ selector: { part: 'knob', states: ['pressed'] }, props: { bg_color: '#ff0000', radius: 2 } }],
          }),
          n('switch', { name: 'sw', props: { width: 50, height: 25, orientation: 'horizontal' } }),
          n('checkbox', { name: 'cb', props: { text: 'Agree' } }),
          n('bar', { name: 'bar_dl', props: { width: 150, height: 15, value: 66, max_value: 200 } }),
          n('arc', { name: 'arc_vol', props: { width: 150, height: 150, value: 40, rotation: 90, mode: 'reverse' } }),
          n('image', { name: 'img_logo', props: { src: 'logo', rotation: 450, scale_x: 512, pivot_x: '50%', pivot_y: 30 } }),
          n('dropdown', {
            name: 'dd',
            props: { width: 130, height: 'content', options: 'Red\nGreen\nBlue', selected: 1 },
            children: [n('dropdown-list', { inlineStyles: [{ props: { bg_color: '#202020' } }] })],
          }),
          n('roller', {
            name: 'rl',
            props: { options: 'One\nTwo\nThree', options_mode: 'infinite', selected: 2, selected_animated: true, visible_row_count: 4 },
          }),
          n('textarea', {
            name: 'ta',
            props: { width: 150, height: 70, placeholder_text: 'Type…', one_line: true, max_length: 32 },
          }),
          n('spinbox', { name: 'spin', props: { width: 100, height: 40, value: 7, digit_count: 3, step: 10, rollover: true } }),
          n('qrcode', { name: 'qr', props: { size: 100, data: 'https://lvgl.io', dark_color: '#003a57', quiet_zone: true } }),
          n('scale', {
            name: 'sc',
            props: {
              width: 200, height: 100, mode: 'round_inner', total_tick_count: 21,
              major_tick_every: 5, label_show: false, angle_range: 240, rotation: 120,
            },
          }),
        ],
      }),
    })],
  });
}

/* ------------------------------------------- case 2: flex 布局 + 样式/const */

export function caseFlexLayout(): LvProject {
  seq = 100;
  return project({
    consts: [
      { name: 'gap', type: 'int', value: '8' },
      { name: 'accent', type: 'color', value: '#00a2ff' },
    ],
    styles: [
      { id: 'st-accent', name: 's_accent', props: { bg_color: { $const: 'accent' }, radius: 8, bg_opa: '80%' } },
    ],
    screens: [screen('main', {
      styles: [{ id: 'st-card', name: 's_card', props: { border_width: 1, border_color: '#334455', pad_all: 12 } }],
      root: n('obj', {
        props: { flex_flow: 'column' },
        inlineStyles: [{ props: { bg_color: '#101418', pad_all: { $const: 'gap' }, text_font: 'montserrat_14' } }],
        children: [
          n('obj', {
            props: { width: '100%', height: 'content', flex_flow: 'row' },
            styles: [{ styleId: 'st-card' }],
            children: [
              n('label', { name: 'lbl_left', props: { text: 'L', flex_grow: 1 } }),
              n('label', { name: 'lbl_right', props: { text: 'R', width: 'content' } }),
            ],
          }),
          n('button', {
            name: 'btn_a',
            props: { width: '50%', height: 40 },
            styles: [{ styleId: 'st-accent', selector: { states: ['pressed'] } }],
            inlineStyles: [{ selector: { states: ['checked', 'pressed'] }, props: { bg_color: '#ffffff' } }],
          }),
        ],
      }),
    })],
  });
}

/* --------------------------------- case 3: 圆屏 466 + subjects/事件/绑定全家桶 */

export function caseRound466(): LvProject {
  seq = 200;
  const scrMain = screen('main', {
    isHome: true,
    root: n('obj', {
      inlineStyles: [{ props: { bg_color: '#000000' } }],
      children: [
        n('arc', { name: 'arc_vol', props: { width: 400, height: 400, align: 'center' }, bindings: [{ kind: 'prop', prop: 'value', subject: 'volume' }] }),
        n('label', {
          name: 'lbl_vol', props: { align: 'center' },
          bindings: [
            { kind: 'prop', prop: 'text', subject: 'volume', fmt: 'Vol: %d' },
            { kind: 'flag', flag: 'hidden', op: 'gt', subject: 'volume', refValue: 90 },
          ],
        }),
        n('switch', {
          name: 'sw_mute', props: { align: 'bottom_mid', y: -40 },
          bindings: [{ kind: 'prop', prop: 'checked', subject: 'muted' }],
        }),
        n('button', {
          name: 'btn_up', props: { x: 20, y: 20 },
          bindings: [{ kind: 'state', state: 'disabled', op: 'ge', subject: 'volume', refValue: 100 }],
          events: [
            { kind: 'subject_increment', trigger: 'clicked', subject: 'volume', step: 5, min: 0, max: 100, rollover: false },
            { kind: 'callback', trigger: 'long_pressed', callback: 'on_up_long', userData: 'fast' },
          ],
        }),
        n('button', {
          name: 'btn_reset',
          props: { x: 20, y: 80 },
          events: [
            { kind: 'subject_set', trigger: 'clicked', subject: 'volume', subjectType: 'int', value: '30' },
            { kind: 'subject_toggle', trigger: 'double_clicked', subject: 'muted' },
          ],
        }),
        n('button', {
          name: 'btn_settings', props: { x: 20, y: 140 },
          events: [{ kind: 'screen_load', trigger: 'clicked', screenId: 'SETTINGS_ID', animType: 'over_right', duration: 300, delay: 0 }],
        }),
      ],
    }),
  });
  const scrSettings = screen('settings', {
    root: n('obj', {
      children: [
        n('label', { name: 'lbl_msg', bindings: [{ kind: 'prop', prop: 'text', subject: 'msg' }] }),
        n('button', {
          name: 'btn_back', props: { align: 'bottom_mid' },
          events: [{ kind: 'screen_create', trigger: 'clicked', screenId: scrMain.id, animType: 'fade_in', duration: 200 }],
        }),
      ],
    }),
  });
  scrSettings.id = 'SETTINGS_ID';
  return project({
    display: { width: 466, height: 466, shape: 'round', colorDepth: 16, dpi: 130 },
    subjects: [
      { name: 'volume', type: 'int', initial: 30, min: 0, max: 100 },
      { name: 'muted', type: 'int', initial: 0 },
      { name: 'msg', type: 'string', initial: 'hi' },
      { name: 'accent_c', type: 'color', initial: '#ff8800' },
    ],
    screens: [scrMain, scrSettings],
  });
}

/* ----------------------------------------------- case 4: 重名去重 + 匿名预览名 */

export function caseNameDedup(): LvProject {
  seq = 300;
  return project({
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('button', { name: 'btn', props: { x: 0 } }),
          n('button', { name: 'btn', props: { x: 50 } }),          // → btn_2
          n('button', { name: 'btn', props: { x: 100 } }),         // → btn_3
          n('label', { id: 'deadbeef-1234-4abc-8def-cafe00000001', props: { text: 'anon' } }),
        ],
      }),
    })],
  });
}

/* ----------------------------------- case 5: buttonmatrix(map + ctrl_map) */

export function caseButtonmatrix(): LvProject {
  seq = 400;
  return project({
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('buttonmatrix', {
            name: 'bm',
            props: {
              width: 220, height: 140, align: 'center',
              map: ['1', '2', '3', '\n', 'OK', 'Cancel'],
              ctrl_map: 'width_1 width_1 width_1 checkable|checked disabled',
              selected_button: 1, one_checked: true,
            },
          }),
        ],
      }),
    })],
  });
}

/* --------------------------------------- case 6: calendar(today/shown + header) */

export function caseCalendar(): LvProject {
  seq = 500;
  return project({
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('calendar', {
            name: 'cal',
            props: {
              width: 230, height: 230, align: 'center',
              today_year: 2026, today_month: 7, today_day: 2,
              shown_year: 2026, shown_month: 7,
            },
            children: [n('calendar-header_arrow')],
          }),
        ],
      }),
    })],
  });
}

/* ------------------------------- case 7: chart(2 series + cursor + axis 范围) */

export function caseChart(): LvProject {
  seq = 600;
  return project({
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('chart', {
            name: 'ch',
            props: {
              width: 200, height: 150, align: 'center',
              type: 'line', point_count: 8, update_mode: 'circular',
              hor_div_line_count: 4,
            },
            children: [
              n('chart-series', {
                props: { color: '#ff0000', values: [10, 20, 30, 25, 40, 35, 50, 45] },
              }),
              n('chart-series', {
                props: { color: '#00c040', axis: 'secondary_y', values: [5, 15, 10, 20, 15, 25, 20, 30] },
              }),
              n('chart-cursor', { props: { color: '#0000ff', dir: 'ver', pos_x: 3, pos_y: 20 } }),
              n('chart-axis', { props: { axis: 'secondary_y', min_value: 0, max_value: 60 } }),
            ],
          }),
        ],
      }),
    })],
  });
}

/* --------------------------- case 8: keyboard(mode + c-only textarea 关联) */

export function caseKeyboard(): LvProject {
  seq = 700;
  return project({
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('textarea', {
            name: 'ta_in',
            props: { width: 200, height: 40, one_line: true, placeholder_text: 'Input…' },
          }),
          n('keyboard', {
            name: 'kb',
            props: { align: 'bottom_mid', mode: 'number', popovers: true, textarea: 'ta_in' },
          }),
        ],
      }),
    })],
  });
}

/* -------------------------- case 9: spangroup(span:text/style/bind_text) */

export function caseSpangroup(): LvProject {
  seq = 800;
  return project({
    subjects: [{ name: 'msg', type: 'string', initial: 'hello' }],
    screens: [screen('main', {
      styles: [{ id: 'st-red', name: 's_red', props: { text_color: '#ff3030' } }],
      root: n('obj', {
        children: [
          n('spangroup', {
            name: 'sg',
            props: { width: 200, height: 'content', overflow: 'ellipsis', max_lines: 3, indent: 12 },
            children: [
              n('spangroup-span', { props: { text: 'Hello, ' } }),
              n('spangroup-span', { props: { text: 'red', style: 's_red' } }),
              n('spangroup-span', { props: { bind_text: 'msg', bind_text_fmt: '[%s]' } }),
            ],
          }),
        ],
      }),
    })],
  });
}

/* ------------------------------- case 10: table(3×3 + 列宽 + cell + ctrl) */

export function caseTable(): LvProject {
  seq = 900;
  return project({
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('table', {
            name: 'tbl',
            props: { column_count: 3, row_count: 3 },
            children: [
              n('table-column', { props: { column: 0, width: 60 } }),
              n('table-column', { props: { column: 2, width: 90 } }),
              n('table-cell', { props: { row: 0, column: 0, value: 'Name' } }),
              n('table-cell', { props: { row: 0, column: 1, value: 'Qty', ctrl: 'merge_right|text_crop' } }),
              n('table-cell', { props: { row: 1, column: 0, value: 'Apple' } }),
              n('table-cell', { props: { row: 1, column: 1, value: '3' } }),
              n('table-cell', { props: { row: 2, column: 2, value: 'total: 3' } }),
            ],
          }),
        ],
      }),
    })],
  });
}

/* --------------------- case 11: tabview(2 tab 内嵌 widget + tab_bar/tab_button) */

export function caseTabview(): LvProject {
  seq = 1000;
  return project({
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('tabview', {
            name: 'tv',
            props: { width: 240, height: 320, active: 1, tab_bar_position: 'bottom' },
            children: [
              n('tabview-tab', {
                name: 'tab_home',
                props: { text: 'Home' },
                children: [
                  n('label', { props: { text: 'Welcome', align: 'top_mid' } }),
                  n('button', {
                    name: 'btn_go',
                    props: { width: 80, height: 30, align: 'center' },
                    children: [n('label', { props: { text: 'Go', align: 'center' } })],
                  }),
                ],
              }),
              n('tabview-tab', {
                props: { text: 'Settings' },
                children: [n('switch', { name: 'sw_dark', props: { align: 'center' } })],
              }),
              // getter 子元素必须放在全部 tab 之后(tab_button 依赖 tab 已创建)
              n('tabview-tab_bar', { inlineStyles: [{ props: { bg_color: '#202030' } }] }),
              n('tabview-tab_button', {
                props: { index: 0 },
                inlineStyles: [{ props: { text_color: '#ffcc00' } }],
              }),
            ],
          }),
        ],
      }),
    })],
  });
}

/* ============================== M3 自研 13 控件(各一最小 case,seq 1100+) */

/** 图片资产桩(imageRef 用例共用形状) */
function img(name: string, fileName: string): {
  name: string;
  file: { fileName: string; sha256: string; byteSize: number };
  conv: { colorFormat: 'ARGB8888' };
} {
  return { name, file: { fileName, sha256: '0'.repeat(64), byteSize: 128 }, conv: { colorFormat: 'ARGB8888' } };
}

/* -------------------------------------- case 12: led(color + brightness) */

export function caseLed(): LvProject {
  seq = 1100;
  return project({
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('led', { name: 'led_status', props: { width: 40, height: 40, align: 'center', color: '#ff3030', brightness: 180 } }),
        ],
      }),
    })],
  });
}

/* ------------------------- case 13: line(points 静态数组 + y_invert) */

export function caseLine(): LvProject {
  seq = 1200;
  return project({
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('line', {
            name: 'ln',
            props: { points: [0, 0, 50, 30, 100, 0, 150, 30], y_invert: true },
            inlineStyles: [{ props: { line_width: 4, line_color: '#00a2ff' } }],
          }),
        ],
      }),
    })],
  });
}

/* --------------------- case 14: spinner(两属性合一 setter,只发一次) */

export function caseSpinner(): LvProject {
  seq = 1300;
  return project({
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('spinner', { name: 'sp', props: { width: 100, height: 100, align: 'center', anim_duration: 800, angle: 200 } }),
        ],
      }),
    })],
  });
}

/* ------------- case 15: imagebutton(按 state 聚合 set_src,缺段 NULL) */

export function caseImagebutton(): LvProject {
  seq = 1400;
  return project({
    assets: { fonts: [], images: [img('btn_rel', 'btn_rel.png'), img('btn_prs', 'btn_prs.png')] },
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('imagebutton', {
            name: 'ibtn',
            props: {
              width: 100, height: 40, align: 'center',
              src_released_mid: 'btn_rel', src_pressed_mid: 'btn_prs', state: 'pressed',
            },
            children: [n('label', { props: { text: 'GO', align: 'center' } })],
          }),
        ],
      }),
    })],
  });
}

/* -------------- case 16: animimage(srcs 数组 + 自动 lv_animimg_start) */

export function caseAnimimage(): LvProject {
  seq = 1500;
  return project({
    assets: { fonts: [], images: [img('f1', 'f1.png'), img('f2', 'f2.png')] },
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('animimage', { name: 'anim', props: { srcs: ['f1', 'f2'], duration: 500, repeat_count: 3 } }),
        ],
      }),
    })],
  });
}

/* ------------- case 17: msgbox(title/text/close_button + footer button) */

export function caseMsgbox(): LvProject {
  seq = 1600;
  return project({
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('msgbox', {
            name: 'mb',
            props: { width: 200, align: 'center', title: 'Notice', text: 'Save changes?', close_button: true },
            children: [
              n('msgbox-button', { props: { text: 'OK' } }),
              n('msgbox-button', {
                name: 'btn_cancel',
                props: { text: 'Cancel' },
                inlineStyles: [{ props: { bg_color: '#802020' } }],
              }),
            ],
          }),
        ],
      }),
    })],
  });
}

/* -------------------- case 18: list(text + button 带/不带 icon) */

export function caseList(): LvProject {
  seq = 1700;
  return project({
    assets: { fonts: [], images: [img('ico_file', 'ico_file.png')] },
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('list', {
            name: 'lst',
            props: { width: 200, height: 200 },
            children: [
              n('list-text', { props: { text: 'Files' } }),
              n('list-button', { name: 'btn_open', props: { icon: 'ico_file', text: 'Open' } }),
              n('list-button', { props: { text: 'About' } }),   // icon 缺省 → NULL
            ],
          }),
        ],
      }),
    })],
  });
}

/* --------------- case 19: menu(mode + 2 page,首 page 自动 set_page) */

export function caseMenu(): LvProject {
  seq = 1800;
  return project({
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('menu', {
            name: 'mn',
            props: { width: 200, height: 200, mode_header: 'top_fixed', mode_root_back_button: 'enabled' },
            children: [
              n('menu-page', {
                props: { title: 'Main' },
                children: [n('label', { props: { text: 'Item 1' } })],
              }),
              n('menu-page', {                                   // title 缺省 → NULL
                children: [n('label', { props: { text: 'Item 2' } })],
              }),
            ],
          }),
        ],
      }),
    })],
  });
}

/* ------------ case 20: win(title + header button + 普通子控件落 win 上) */

export function caseWin(): LvProject {
  seq = 1900;
  return project({
    assets: { fonts: [], images: [img('ico_close', 'ico_close.png')] },
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('win', {
            name: 'wnd',
            props: { width: 240, height: 200, title: 'Window' },
            children: [
              n('win-button', { props: { icon: 'ico_close', width: 60 } }),
              n('win-button', { props: { icon: 'ico_close' } }),    // width 缺省 → 40
              // A 遗留 #1:普通子控件落在 win 对象上(header+content 之下)
              n('label', { props: { text: 'Body', align: 'center' } }),
            ],
          }),
        ],
      }),
    })],
  });
}

/* ------------------- case 21: tileview(tile 容器 + col/row/dir 实参) */

export function caseTileview(): LvProject {
  seq = 2000;
  return project({
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('tileview', {
            name: 'tvw',
            props: { width: '100%', height: '100%' },
            children: [
              n('tileview-tile', {
                props: { col: 0, row: 0, dir: 'hor' },
                children: [n('label', { props: { text: 'Tile 0,0', align: 'center' } })],
              }),
              n('tileview-tile', {
                props: { col: 1, row: 0 },                      // dir 缺省 → all
                children: [n('label', { props: { text: 'Tile 1,0', align: 'center' } })],
              }),
            ],
          }),
        ],
      }),
    })],
  });
}

/* ------------------------------------- case 22: arclabel(全属性抽样) */

export function caseArclabel(): LvProject {
  seq = 2100;
  return project({
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('arclabel', {
            name: 'arcl',
            props: {
              width: 150, height: 150, align: 'center',
              text: 'Curved Text', angle_start: 90, angle_size: 270, offset: 5,
              dir: 'counter_clockwise', recolor: true, radius: 70,
              center_offset_x: 2, center_offset_y: -2,
              text_vertical_align: 'center', text_horizontal_align: 'center',
            },
          }),
        ],
      }),
    })],
  });
}

/* ------------ case 23: canvas(静态 draw buf + fill_bg,纯 px 尺寸) */

export function caseCanvas(): LvProject {
  seq = 2200;
  return project({
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('canvas', { name: 'cv', props: { width: 80, height: 60, align: 'center', fill_color: '#00c040' } }),
        ],
      }),
    })],
  });
}

/* ------- case 24: lottie(渲染缓冲 + set_src_data extern 数组桩) */

export function caseLottie(): LvProject {
  seq = 2300;
  return project({
    assets: { fonts: [], images: [img('anim_ok', 'anim_ok.json')] },
    screens: [screen('main', {
      root: n('obj', {
        children: [
          n('lottie', { name: 'lot', props: { width: 64, height: 64, align: 'center', src: 'anim_ok' } }),
        ],
      }),
    })],
  });
}

/* ------------------------- case: 多目标导出(同一工程 × 三种 target) */

export function caseTargets(): LvProject {
  seq = 2400;
  return project({
    styles: [
      { id: 'st-title', name: 's_title', props: { text_font: 'montserrat_16', text_color: '#e0e6f0' } },
    ],
    screens: [screen('main', {
      root: n('obj', {
        props: { flex_flow: 'column' },
        children: [
          n('label', { name: 'lbl_title', props: { text: 'Target demo' }, styles: [{ styleId: 'st-title' }] }),
          n('button', {
            name: 'btn_go',
            props: { width: 100, height: 40 },
            events: [{ kind: 'callback', trigger: 'clicked', callback: 'on_go' }],
            children: [n('label', { props: { text: 'GO' } })],
          }),
          n('slider', { name: 'sld_v', props: { width: 150, height: 10, value: 30 } }),
        ],
      }),
    })],
  });
}

export const GOLDEN_CASES: {
  name: string; build: () => LvProject; cOptions?: import('../index.js').EmitC94Options;
}[] = [
  { name: 'widgets-all', build: caseWidgetsAll },
  { name: 'flex-layout', build: caseFlexLayout },
  { name: 'round-466', build: caseRound466 },
  { name: 'name-dedup', build: caseNameDedup },
  { name: 'buttonmatrix', build: caseButtonmatrix },
  { name: 'calendar', build: caseCalendar },
  { name: 'chart', build: caseChart },
  { name: 'keyboard', build: caseKeyboard },
  { name: 'spangroup', build: caseSpangroup },
  { name: 'table', build: caseTable },
  { name: 'tabview', build: caseTabview },
  { name: 'led', build: caseLed },
  { name: 'line', build: caseLine },
  { name: 'spinner', build: caseSpinner },
  { name: 'imagebutton', build: caseImagebutton },
  { name: 'animimage', build: caseAnimimage },
  { name: 'msgbox', build: caseMsgbox },
  { name: 'list', build: caseList },
  { name: 'menu', build: caseMenu },
  { name: 'win', build: caseWin },
  { name: 'tileview', build: caseTileview },
  { name: 'arclabel', build: caseArclabel },
  { name: 'canvas', build: caseCanvas },
  { name: 'lottie', build: caseLottie },
  { name: 'target-espidf', build: caseTargets, cOptions: { target: 'esp-idf' } },
  { name: 'target-cmake', build: caseTargets, cOptions: { target: 'cmake' } },
  { name: 'target-bare', build: caseTargets, cOptions: { target: 'bare' } },
];
