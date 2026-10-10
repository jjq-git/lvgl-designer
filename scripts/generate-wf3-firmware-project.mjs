import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUTPUT_DIR = resolve('examples/wf3-firmware');
const FONT_FILE = resolve(OUTPUT_DIR, 'assets/NotoSansSC-WF3.ttf');
const OUTPUT_FILE = resolve(OUTPUT_DIR, 'WF3-284x76-firmware-ui.lvproj.json');
const NOW = '2026-10-09T00:00:00.000Z';
const SOURCE = {
  repository: 'http://192.168.1.88:3000/wf3/firmware.git',
  branch: 'cheng-wf3-code-cleanup-20261008',
  commit: 'a64842b8b9ea2425f235531658e31fe48635ff62',
  path: 'firmware/main/ui',
  lvglVersion: '9.4.x',
};

const COLORS = {
  bg: '#FFFFFF', card: '#FFFFFF', card2: '#F3F7F7', border: '#E5E7EB',
  outline: '#0B8583', text: '#050505', muted: '#4B5563', accent: '#0B8583',
  accent2: '#0B8583', onAccent: '#FFFFFF', warn: '#D97706', danger: '#FF3540',
  blue: '#0B8583', cyan: '#0B8583', purple: '#0B8583', orange: '#D97706',
  pink: '#DB2777', teal: '#0B8583', yellow: '#FFD166',
};

const FUNCTION_ITEMS = [
  ['\uf0e7', '电平', 'voltage'],
  ['\uf287', 'UART', 'uart'],
  ['\uf0c9', 'I2C', 'i2c'],
  ['\uf074', 'SPI', 'spi'],
  ['\uf013', 'I/O', 'io'],
  ['\uf079', 'CAN', 'can485'],
];

const PAGE_DEFS = [
  ['home', '首页', '', []],
  ['menu', '功能菜单', '', [
    ['电平', 'VD1-4', 'voltage'], ['UART', 'BUS 3', 'uart'], ['I2C', 'BUS 2', 'i2c'],
    ['SPI', 'BUS 4', 'spi'], ['IO', 'BUS 5', 'io'], ['CAN/485', 'BUS 6', 'can485'],
  ]],
  ['voltage', '接口电平', 'VD1-4', [['I2C', '3V3'], ['UART', '3V3'], ['SPI', '3V3'], ['IO', '3V3']]],
  ['uart', 'UART', 'BUS 3', [['参数', '115200', 'uart_param'], ['收发', 'FRAME', 'uart_xfer'], ['监控', 'RX/TX', 'monitor']]],
  ['uart_param', 'UART参数', '8N1', [['115200', '波特率'], ['8', '数据位'], ['N', '校验'], ['1', '停止位']]],
  ['i2c', 'I2C', 'BUS 2', [['扫描', 'BUS', 'i2c_xfer'], ['事务', 'REGISTER', 'i2c_command'], ['监控', 'RX/TX', 'monitor']]],
  ['can485', 'CAN/485', 'BUS 6', [['CAN', 'TWAI', 'can'], ['RS485', 'RTU', 'rs485']]],
  ['io', 'IO', 'BUS 5', [['IO 1', 'INPUT', 'io_detail'], ['IO 2', 'OUTPUT', 'io_detail'], ['灯带', 'WS2812', 'ws2812'], ['1-Wire', 'DALLAS', 'onewire']]],
  ['network', '网络', 'STA/AP', [['STA', '未连接'], ['AP', '配网', 'ap'], ['IP', '0.0.0.0']]],
  ['ap', 'AP配网', '192.168.4.1', []],
  ['system', '系统', 'INFO', [['v1.0', '版本'], ['8 MB', 'Flash'], ['240 KB', '内存'], ['00:00', '运行时间']]],
  ['settings', '设置', 'DEVICE', [['声音', '开启'], ['网络', 'STA/AP', 'network'], ['系统', 'INFO', 'system'], ['恢复', '出厂']]],
  ['monitor', '总线监控', 'RX/TX', [['RX 0', '接收'], ['TX 0', '发送'], ['--', '最近']]],
  ['usb', 'USB', 'CDC', [['CDC', '已连接'], ['WebSerial', 'READY'], ['USB', '2.0']]],
  ['spi', 'SPI', 'BUS 4', [['参数', 'MODE 0', 'spi_param'], ['收发', 'FULL', 'spi_xfer'], ['监控', 'RX/TX', 'monitor']]],
  ['spi_param', 'SPI参数', 'MODE', [['1 MHz', '时钟'], ['MODE 0', '模式'], ['MSB', '位序'], ['LOW', 'CS']]],
  ['spi_xfer', 'SPI收发', 'FULL', [['00', '预设'], ['FF', '预设'], ['AA55', '预设'], ['自定义', 'HEX', 'spi_custom']]],
  ['uart_xfer', 'UART收发', 'FRAME', [['AT', '文本'], ['55AA', 'HEX'], ['PING', '文本'], ['自定义', '命令', 'uart_command']]],
  ['i2c_xfer', 'I2C读取', 'REGISTER', [['扫描', 'BUS'], ['0x3C', '地址'], ['读取', '寄存器', 'i2c_command']]],
  ['io_detail', 'IO单路', 'OPEN-DRAIN', [['输入', '模式'], ['低', '电平'], ['50%', '占空比'], ['1 kHz', '频率']]],
  ['can', 'CAN', 'TWAI', [['参数', '500K', 'can_param'], ['收发', 'FRAME', 'can_xfer'], ['监控', 'RX/TX', 'monitor']]],
  ['can_param', 'CAN参数', 'BAUD', [['125K', '速率'], ['250K', '速率'], ['500K', '当前'], ['1M', '速率']]],
  ['can_xfer', 'CAN收发', 'FRAME', [['100', 'STD'], ['7DF', 'OBD'], ['123', 'TEST'], ['自定义', 'FRAME', 'can_custom']]],
  ['rs485', 'RS485', 'RTU', [['参数', '9600', 'rs485_param'], ['收发', 'FRAME', 'rs485_xfer'], ['监控', 'RX/TX', 'monitor']]],
  ['rs485_param', 'RS485参数', '8N1', [['9600', '波特率'], ['8', '数据位'], ['N', '校验'], ['1', '停止位']]],
  ['rs485_xfer', 'RS485收发', 'FRAME', [['0103', '读'], ['0106', '写'], ['自定义', '命令', 'rs485_command']]],
  ['uart_command', '串口命令', 'COMMAND', [['HEX', '格式'], ['1B', '长度', 'uart_edit'], ['CRLF', '结束符'], ['确认', '发送', 'uart_confirm']]],
  ['i2c_command', 'I2C事务', 'TRANSACTION', [['读寄存器', '写读', 'i2c_read'], ['写寄存器', '写', 'i2c_write'], ['原始事务', '高级', 'i2c_raw']]],
  ['uart_edit', '串口字节', 'BYTES', [['41', '[0]'], ['54', '[1]'], ['0D', '[2]'], ['0A', '[3]']]],
  ['uart_confirm', '串口确认', 'CHECK', [['AT CRLF', '短按发送']]],
  ['i2c_read', '读寄存器', 'REGISTER', [['3C', '地址'], ['00', '寄存器'], ['1B', '读取'], ['执行', '写读']]],
  ['i2c_write', '写寄存器', 'REGISTER', [['3C', '地址'], ['00', '寄存器'], ['7F', '数据'], ['写入', '执行']]],
  ['i2c_raw', '原始事务', 'ADVANCED', [['3C', '地址'], ['2B', '写入'], ['1B', '读取'], ['执行', '原始']]],
  ['rs485_command', '485命令', 'COMMAND', [['HEX', '格式'], ['4B', '长度', 'rs485_edit'], ['CRC', '校验'], ['确认', '发送', 'rs485_confirm']]],
  ['rs485_edit', '485字节', 'BYTES', [['01', '[0]'], ['03', '[1]'], ['00', '[2]'], ['00', '[3]']]],
  ['rs485_confirm', '485确认', 'CHECK', [['01 03 00 00', '短按发送']]],
  ['spi_custom', 'SPI事务', 'FULL', [['4B', '长度', 'spi_edit'], ['确认', '传输', 'spi_confirm']]],
  ['spi_edit', 'SPI数据', 'TX', [['9F', '[0]'], ['00', '[1]'], ['00', '[2]'], ['00', '[3]']]],
  ['spi_confirm', 'SPI确认', 'CHECK', [['9F 00 00 00', '短按传输']]],
  ['can_custom', 'CAN帧', 'FRAME', [['123', 'ID'], ['STD', '帧型'], ['8B', '长度', 'can_edit'], ['确认', '发送', 'can_confirm']]],
  ['can_edit', 'CAN数据', 'DATA', [['00', '[0]'], ['11', '[1]'], ['22', '[2]'], ['33', '[3]']]],
  ['can_confirm', 'CAN确认', 'CHECK', [['CAN 123 DLC8', '短按发送']]],
  ['ws2812', 'WS2812', '800KHZ', [['IO 1', '引脚'], ['8', '数量'], ['00FF80', '颜色'], ['发送', 'GRB']]],
  ['onewire', '1-Wire', 'DALLAS', [['IO 1', '引脚'], ['检测', 'RESET'], ['扫描', 'ROM'], ['温度', '读取']]],
  ['blockly', '积木编程', 'PROGRAM', [['程序 1', '已保存'], ['运行', 'START'], ['停止', 'SAFE'], ['删除', '确认']]],
  ['wf31', 'WF3-1温度', 'RTD/NTC', [['PT100', '通道'], ['3-wire', '模式'], ['--.-°C', '温度'], ['开始', '测量']]],
];

const PAGE_ORDER = PAGE_DEFS.map(([code]) => code);
const PAGE_BY_CODE = new Map(PAGE_DEFS.map(([code, title, kicker, items]) => [code, { code, title, kicker, items }]));
const MAIN_PAGES = new Set(['voltage', 'uart', 'i2c', 'can485', 'io', 'network', 'system', 'settings', 'monitor', 'usb', 'spi', 'can', 'rs485', 'blockly', 'wf31']);
const PARENTS = {
  uart_param: 'uart', uart_xfer: 'uart', uart_command: 'uart_xfer', uart_edit: 'uart_command', uart_confirm: 'uart_command',
  i2c_xfer: 'i2c', i2c_command: 'i2c', i2c_read: 'i2c_command', i2c_write: 'i2c_command', i2c_raw: 'i2c_command',
  io_detail: 'io', ws2812: 'io', onewire: 'io', ap: 'network',
  spi_param: 'spi', spi_xfer: 'spi', spi_custom: 'spi_xfer', spi_edit: 'spi_custom', spi_confirm: 'spi_custom',
  can_param: 'can', can_xfer: 'can', can_custom: 'can_xfer', can_edit: 'can_custom', can_confirm: 'can_custom',
  rs485_param: 'rs485', rs485_xfer: 'rs485', rs485_command: 'rs485_xfer', rs485_edit: 'rs485_command', rs485_confirm: 'rs485_command',
};

let idCounter = 0;
function id(prefix = 'node') {
  idCounter += 1;
  return `${prefix}:wf3:${String(idCounter).padStart(5, '0')}`;
}

function group(props, selector) {
  return selector ? { selector, props } : { props };
}

function node(type, options = {}) {
  return {
    id: id(type), type,
    ...(options.codeName ? { codeName: options.codeName } : {}),
    ...(options.displayName ? { displayName: options.displayName } : {}),
    props: options.props ?? {},
    ...(options.flags ? { flags: options.flags } : {}),
    styleRefs: [], styles: options.styles ?? [], events: options.events ?? [], bindings: [],
    children: options.children ?? [],
  };
}

function fontFor(text, size = 12) {
  return /[^\u0000-\u007f]/.test(text) ? `wf3_cn_${size}` : `montserrat_${Math.max(8, Math.min(20, size))}`;
}

function label(code, key, text, x, y, width, height = 'content', options = {}) {
  return node('label', {
    codeName: `wf3_${code}_${key}`,
    props: { text, x, y, width, height },
    styles: [group({
      text_color: options.color ?? COLORS.text,
      text_font: options.font ?? fontFor(text, options.size ?? 12),
      text_align: options.align ?? 'left',
      text_opa: options.opa ?? 255,
    })],
  });
}

function box(code, key, x, y, width, height, options = {}) {
  return node('obj', {
    codeName: `wf3_${code}_${key}`,
    props: { x, y, width, height },
    flags: { scrollable: false },
    styles: [group({
      bg_color: options.bg ?? COLORS.card,
      bg_opa: options.opa ?? 255,
      border_color: options.border ?? COLORS.border,
      border_width: options.borderWidth ?? 1,
      radius: options.radius ?? 5,
      pad_all: 0,
    })],
    children: options.children ?? [],
  });
}

function openEvent(target, screenIds, direction = 'move_left') {
  if (!target || !screenIds.has(target)) return [];
  return [{ on: 'clicked', action: 'screen.open', args: { screen: screenIds.get(target), anim: direction, duration: 170, delay: 0 } }];
}

function button(code, key, text, x, y, width, height, options = {}) {
  return node('button', {
    codeName: `wf3_${code}_${key}`,
    props: { x, y, width, height },
    flags: { scrollable: false },
    styles: [
      group({
        bg_color: options.bg ?? COLORS.card,
        bg_opa: 255,
        border_color: options.border ?? COLORS.border,
        border_width: options.borderWidth ?? 1,
        radius: options.radius ?? 5,
        pad_all: 0,
        shadow_width: 0,
      }),
      group({ bg_color: options.pressedBg ?? COLORS.accent, bg_opa: 255 }, { states: ['pressed'] }),
    ],
    events: options.events ?? [],
    children: [label(code, `${key}_text`, text, 0, 0, '100%', '100%', {
      align: 'center', color: options.color ?? COLORS.text, size: options.size ?? 12,
      ...(options.font ? { font: options.font } : {}),
    })],
  });
}

function root(children) {
  return node('obj', {
    props: {}, flags: { scrollable: false },
    styles: [group({ bg_color: COLORS.bg, bg_opa: 255, border_width: 0, radius: 0, pad_all: 0 })],
    children,
  });
}

function buildHome(screenIds) {
  const code = 'home';
  return [
    ...buildRail(code, screenIds),
    ...buildNavigation(code, screenIds),
  ];
}

function backTarget(code) {
  if (code === 'menu') return 'home';
  if (PARENTS[code]) return PARENTS[code];
  if (MAIN_PAGES.has(code)) return 'menu';
  return 'menu';
}

function buildRail(code, screenIds) {
  return [
    button(code, 'back', '\uf053', 0, 0, 30, 60, {
      bg: COLORS.accent, pressedBg: '#076E6D', border: COLORS.accent, borderWidth: 0,
      radius: 0, size: 20, font: 'montserrat_20', color: COLORS.onAccent,
      events: openEvent(backTarget(code), screenIds, 'move_right'),
    }),
    box(code, 'voltage', 0, 60, 30, 16, { bg: COLORS.danger, borderWidth: 0, radius: 0, children: [
      label(code, 'voltage_text', '5V3', 0, 0, 30, 16, {
        font: 'montserrat_14', align: 'center', color: COLORS.onAccent,
      }),
    ] }),
  ];
}

function buildTitle(code, title, kicker) {
  return box(code, 'titlebar', 30, 55, 254, 21, { bg: COLORS.card, borderWidth: 0, radius: 0, children: [
    label(code, 'title', title, 0, 0, 254, 21, { size: 16, align: 'center', color: COLORS.text }),
  ] });
}

function buildNavigation(code, screenIds) {
  const buttons = FUNCTION_ITEMS.map(([icon, text, target], index) => {
    const item = button(code, `menu_${index}`, '', 32 + index * 42, 1, 40, 52, {
      bg: COLORS.card,
      pressedBg: COLORS.card2,
      border: COLORS.card,
      borderWidth: 0,
      radius: 0,
      color: COLORS.accent,
      size: 20,
      font: 'montserrat_20',
      events: openEvent(target, screenIds),
    });
    item.children = [
      label(code, `menu_${index}_icon`, icon, 0, 1, 40, 27, {
        align: 'center', color: COLORS.accent, size: 20, font: 'montserrat_20',
      }),
      label(code, `menu_${index}_label`, text, 0, 30, 40, 15, {
        align: 'center', color: COLORS.text, size: 10,
        font: /[^\u0000-\u007f]/.test(text) ? 'wf3_cn_12' : 'montserrat_10',
      }),
    ];
    return item;
  });
  return [
    ...buttons,
    buildTitle(code, '功能菜单', ''),
  ];
}

function buildCells(code, items, screenIds) {
  const count = Math.max(1, items.length);
  const gap = 2;
  const usable = 250 - gap * (count - 1);
  const cellW = Math.max(36, Math.floor(usable / count));
  return items.map(([main, sub, target], index) => {
    const x = 32 + index * (cellW + gap);
    const cell = button(code, `cell_${index}`, '', x, 2, cellW, 51, {
      bg: COLORS.card,
      pressedBg: COLORS.card2,
      border: COLORS.card,
      borderWidth: 0,
      radius: 0,
      color: COLORS.accent,
      events: openEvent(target, screenIds),
    });
    cell.children = [
      label(code, `cell_${index}_main`, main, 2, 3, cellW - 4, 27, {
        align: 'center', color: COLORS.accent,
        size: main.length > 6 ? 12 : main.length > 4 ? 14 : 16,
      }),
      label(code, `cell_${index}_sub`, sub || '', 2, 31, cellW - 4, 16, {
        align: 'center', color: COLORS.text,
        size: 10, font: /[^\u0000-\u007f]/.test(sub || '') ? 'wf3_cn_12' : 'montserrat_10',
      }),
    ];
    return cell;
  });
}

function buildAp(code) {
  return [
    box(code, 'network_card', 34, 2, 158, 51, { bg: COLORS.card, border: COLORS.border, children: [
      label(code, 'ssid', 'WF3-SETUP', 8, 5, 140, 14, { font: 'montserrat_12', color: COLORS.cyan }),
      label(code, 'password', '192.168.4.1', 8, 23, 140, 14, { font: 'montserrat_10', color: COLORS.muted }),
    ] }),
    node('qrcode', {
      codeName: 'wf3_ap_qrcode',
      props: { x: 228, y: 3, width: 48, height: 48, size: 48, data: 'WIFI:T:WPA;S:WF3-SETUP;P:wf3setup;;', quiet_zone: true },
      styleRefs: [], styles: [], events: [], bindings: [], children: [],
    }),
  ];
}

function buildScreen(def, screenIds) {
  const { code, title, kicker, items } = def;
  const children = code === 'home'
    ? buildHome(screenIds)
    : code === 'menu'
      ? [...buildRail(code, screenIds), ...buildNavigation(code, screenIds)]
    : [
        ...buildRail(code, screenIds),
        buildTitle(code, title, kicker),
        ...(code === 'ap' ? buildAp(code) : buildCells(code, items, screenIds)),
      ];
  return {
    id: screenIds.get(code),
    codeName: `wf3_${code}`,
    displayName: title,
    isHome: code === 'home',
    styles: [], consts: [], root: root(children),
  };
}

function makeSnapshot(fontSha, fontSize) {
  const screenIds = new Map(PAGE_ORDER.map((code) => [code, `screen:wf3:${code}`]));
  const displayId = 'display:wf3-284x76-rgb565';
  const displayRef = `${displayId}@1`;
  const uiId = 'ui:wf3-firmware-284x76';
  const uiRef = `${uiId}@1`;
  const fontFile = { fileName: 'NotoSansSC-WF3.ttf', sha256: fontSha, byteSize: fontSize };
  return {
    kind: 'lvgl-project-snapshot', snapshotVersion: 1,
    uiProject: {
      schemaVersion: 2, kind: 'lvgl-ui-project',
      meta: { id: uiId, revision: 1, name: 'WF3 固件界面 · 284×76', appVersion: '1.0.0', createdAt: NOW, modifiedAt: NOW },
      designDisplayRef: displayRef,
      themes: [{ id: 'default', displayName: 'WF3 青绿工具主题', tokens: [] }],
      subjects: [],
      screens: PAGE_ORDER.map((code) => buildScreen(PAGE_BY_CODE.get(code), screenIds)),
      components: [], styles: [], consts: [],
      assets: {
        fonts: [12, 14, 16, 20].map((sizePx) => ({
          id: `font:wf3_cn_${sizePx}`,
          codeName: `wf3_cn_${sizePx}`,
          displayName: `WF3 中文 ${sizePx}px`,
          file: fontFile,
          conv: {
            loader: 'tiny_ttf', sizePx, bpp: 2,
            ranges: '0x20-0x7e,0x4e00-0x9fff', autoCollect: true,
            license: 'OFL-1.1', licenseUrl: 'https://openfontlicense.org',
          },
        })),
        images: [], icons: [],
      },
      translations: null,
      editor: { deviceModel: 'WF3', deviceTitle: '2.25 英寸 284×76 条形屏', example: 'wf3-firmware-import', source: SOURCE },
    },
    displayProfile: {
      schemaVersion: 1, kind: 'display-profile', id: displayId, revision: 1,
      displayName: 'WF3 2.25 英寸 284×76 RGB565', logicalSize: { width: 284, height: 76 },
      shape: 'rect', colorFormat: 'RGB565', dpi: 160,
    },
    controllerProfile: null,
    buildTarget: {
      schemaVersion: 1, kind: 'lvgl-build-target', id: 'target:wf3-firmware-284x76', revision: 1,
      uiProjectRef: uiRef, themeRef: `${uiRef}#theme:default`, lvglVersion: '9.5.0',
    },
    actionRegistry: {
      'screen.open': { id: 'screen.open', displayName: '打开屏幕', params: [
        { name: 'screen', type: 'screenRef', required: true }, { name: 'anim', type: 'string' },
        { name: 'duration', type: 'int' }, { name: 'delay', type: 'int' },
      ] },
    },
    migrationNotes: [
      { severity: 'info', code: 'wf3-source', path: 'uiProject.editor.source', message: `由 ${SOURCE.repository} ${SOURCE.branch}@${SOURCE.commit.slice(0, 12)} 的 ${SOURCE.path} 转换。` },
      { severity: 'warning', code: 'lvgl-version-upgrade', path: 'buildTarget.lvglVersion', message: '原固件固定使用 LVGL 9.4.x；Designer 工程以 9.5.0 编辑和导出，回接固件前需要完成版本兼容验证。' },
      { severity: 'warning', code: 'firmware-logic-external', path: 'uiProject.screens', message: 'NVS、旋钮导航和 UART/I2C/SPI/CAN/RS485 硬件回调继续由原固件维护；本工程导入可编辑视觉层和页面导航。' },
    ],
    colorFormatConfirmed: true,
  };
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const fontBytes = readFileSync(FONT_FILE);
const fontSha = createHash('sha256').update(fontBytes).digest('hex');
const snapshot = makeSnapshot(fontSha, statSync(FONT_FILE).size);
writeFileSync(OUTPUT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
process.stdout.write(`generated ${OUTPUT_FILE} (${snapshot.uiProject.screens.length} screens, font ${fontSha.slice(0, 12)})\n`);
