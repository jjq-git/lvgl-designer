import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUTPUT_DIR = resolve('examples/wf3-firmware');
const FONT_FILE = resolve(OUTPUT_DIR, 'assets/NotoSansSC-WF3.ttf');
const ICON_FONT_32_FILE = resolve(OUTPUT_DIR, 'assets/MaterialSymbolsOutlined-WF3-32.ttf');
const ICON_FONT_36_FILE = resolve(OUTPUT_DIR, 'assets/MaterialSymbolsOutlined-WF3-36.ttf');
const OUTPUT_FILE = resolve(OUTPUT_DIR, 'WF3-284x76-firmware-ui.lvproj.json');
const NOW = '2026-10-09T00:00:00.000Z';
const BUILT_IN_REVISION = 9;
const SOURCE = {
  repository: 'http://192.168.1.88:3000/wf3/firmware.git',
  branch: 'cheng-wf3-code-cleanup-20261008',
  commit: 'a64842b8b9ea2425f235531658e31fe48635ff62',
  path: 'firmware/main/ui',
  lvglVersion: '9.4.x',
};

const token = (id) => ({ $token: id });

// Device-independent semantic contract. Other projects can inherit this theme and
// override only their product palette while keeping components/styles reusable.
const INDUSTRIAL_BASE_THEME = {
  id: 'industrial-base',
  displayName: '通用工业基础主题',
  tokens: [
    { id: 'color.background', type: 'color', value: '#F5F7F7' },
    { id: 'color.surface', type: 'color', value: '#FFFFFF' },
    { id: 'color.surface.subtle', type: 'color', value: '#EEF2F2' },
    { id: 'color.border', type: 'color', value: '#D8E2E2' },
    { id: 'color.outline', type: 'color', value: '#64748B' },
    { id: 'color.text.primary', type: 'color', value: '#1F2937' },
    { id: 'color.text.muted', type: 'color', value: '#64748B' },
    { id: 'color.text.onaccent', type: 'color', value: '#FFFFFF' },
    { id: 'color.accent', type: 'color', value: '#0F766E' },
    { id: 'color.accent.strong', type: 'color', value: '#115E59' },
    { id: 'color.status.warning', type: 'color', value: '#B45309' },
    { id: 'color.status.danger', type: 'color', value: '#C2414B' },
    { id: 'color.status.danger.surface', type: 'color', value: '#FDECEC' },
    { id: 'color.status.success', type: 'color', value: '#15803D' },
    { id: 'color.state.edit', type: 'color', value: '#FACC15' },
    { id: 'color.data.blue', type: 'color', value: '#2563EB' },
    { id: 'color.data.cyan', type: 'color', value: '#0891B2' },
    { id: 'color.data.purple', type: 'color', value: '#7C3AED' },
    { id: 'color.data.indigo', type: 'color', value: '#4F46E5' },
    { id: 'color.data.orange', type: 'color', value: '#C2410C' },
    { id: 'color.data.pink', type: 'color', value: '#DB2777' },
    { id: 'color.data.teal', type: 'color', value: '#0F766E' },
    { id: 'color.voltage.v3', type: 'color', value: '#C65A5A' },
    { id: 'color.voltage.v5', type: 'color', value: '#A83E3E' },
    { id: 'font.text.small', type: 'fontRef', value: 'wf3_cn_12' },
    { id: 'font.text.body', type: 'fontRef', value: 'wf3_cn_14' },
    { id: 'font.text.title', type: 'fontRef', value: 'wf3_cn_16' },
    { id: 'font.value.large', type: 'fontRef', value: 'wf3_cn_20' },
    { id: 'opacity.solid', type: 'opa', value: 255 },
    { id: 'border.none', type: 'px', value: 0 },
    { id: 'border.default', type: 'px', value: 1 },
    { id: 'radius.none', type: 'px', value: 0 },
    { id: 'radius.control', type: 'px', value: 5 },
    { id: 'radius.dialog', type: 'px', value: 10 },
    { id: 'spacing.none', type: 'px', value: 0 },
    { id: 'spacing.compact', type: 'px', value: 2 },
    { id: 'spacing.control', type: 'px', value: 4 },
    { id: 'spacing.page', type: 'px', value: 5 },
    { id: 'effect.shadow.none', type: 'px', value: 0 },
  ],
};

// Current firmware palette from firmware/main/ui/ui_internal.h at SOURCE.commit.
const WF3_LIGHT_THEME = {
  id: 'wf3-light',
  displayName: 'WF3 浅绿仪器主题',
  extends: INDUSTRIAL_BASE_THEME.id,
  tokens: [
    { id: 'color.background', type: 'color', value: '#F4F7F3' },
    { id: 'color.surface', type: 'color', value: '#FFFFFF' },
    { id: 'color.surface.subtle', type: 'color', value: '#EDF3ED' },
    { id: 'color.border', type: 'color', value: '#D5E0D5' },
    { id: 'color.outline', type: 'color', value: '#739878' },
    { id: 'color.text.primary', type: 'color', value: '#26332A' },
    { id: 'color.text.muted', type: 'color', value: '#5F7165' },
    { id: 'color.text.onaccent', type: 'color', value: '#17321D' },
    { id: 'color.accent', type: 'color', value: '#A8E6A3' },
    { id: 'color.accent.strong', type: 'color', value: '#3D7D43' },
    { id: 'color.status.warning', type: 'color', value: '#9A6100' },
    { id: 'color.status.danger', type: 'color', value: '#C52A3A' },
    { id: 'color.status.danger.surface', type: 'color', value: '#FBE5E7' },
    { id: 'color.status.success', type: 'color', value: '#3D7D43' },
    { id: 'color.state.edit', type: 'color', value: '#FFD166' },
    { id: 'color.data.blue', type: 'color', value: '#2563EB' },
    { id: 'color.data.cyan', type: 'color', value: '#087C98' },
    { id: 'color.data.purple', type: 'color', value: '#6D28D9' },
    { id: 'color.data.indigo', type: 'color', value: '#4338CA' },
    { id: 'color.data.orange', type: 'color', value: '#B45309' },
    { id: 'color.data.pink', type: 'color', value: '#BE185D' },
    { id: 'color.data.teal', type: 'color', value: '#0F766E' },
    { id: 'color.voltage.v3', type: 'color', value: '#C65A5A' },
    { id: 'color.voltage.v5', type: 'color', value: '#A83E3E' },
  ],
};

const COLORS = {
  bg: token('color.background'),
  card: token('color.surface'),
  card2: token('color.surface.subtle'),
  border: token('color.border'),
  outline: token('color.outline'),
  text: token('color.text.primary'),
  muted: token('color.text.muted'),
  accent: token('color.accent'),
  accent2: token('color.accent.strong'),
  onAccent: token('color.text.onaccent'),
  warn: token('color.status.warning'),
  danger: token('color.status.danger'),
  dangerBg: token('color.status.danger.surface'),
  ok: token('color.status.success'),
  blue: token('color.data.blue'),
  cyan: token('color.data.cyan'),
  purple: token('color.data.purple'),
  indigo: token('color.data.indigo'),
  orange: token('color.data.orange'),
  pink: token('color.data.pink'),
  teal: token('color.data.teal'),
  yellow: token('color.state.edit'),
  voltage3v3: token('color.voltage.v3'),
  voltage5v: token('color.voltage.v5'),
};

const FONTS = {
  small: token('font.text.small'),
  body: token('font.text.body'),
  title: token('font.text.title'),
  valueLarge: token('font.value.large'),
};

const STYLE_IDS = {
  screen: 'style:industrial:screen',
  surface: 'style:industrial:surface',
  control: 'style:industrial:control',
  controlPressed: 'style:industrial:control-pressed',
};

const INDUSTRIAL_STYLES = [
  {
    id: STYLE_IDS.screen,
    codeName: 'industrial_screen',
    displayName: 'Industrial Screen',
    props: {
      bg_color: COLORS.bg,
      bg_opa: token('opacity.solid'),
      border_width: token('border.none'),
      radius: token('radius.none'),
      pad_all: token('spacing.none'),
    },
  },
  {
    id: STYLE_IDS.surface,
    codeName: 'industrial_surface',
    displayName: 'Industrial Surface',
    props: {
      bg_color: COLORS.card,
      bg_opa: token('opacity.solid'),
      border_color: COLORS.border,
      border_width: token('border.default'),
      radius: token('radius.control'),
      pad_all: token('spacing.none'),
    },
  },
  {
    id: STYLE_IDS.control,
    codeName: 'industrial_control',
    displayName: 'Industrial Control',
    props: {
      bg_color: COLORS.card,
      bg_opa: token('opacity.solid'),
      border_color: COLORS.border,
      border_width: token('border.default'),
      radius: token('radius.control'),
      pad_all: token('spacing.none'),
      shadow_width: token('effect.shadow.none'),
    },
  },
  {
    id: STYLE_IDS.controlPressed,
    codeName: 'industrial_control_pressed',
    displayName: 'Industrial Control Pressed',
    props: {
      bg_color: COLORS.accent,
      bg_opa: token('opacity.solid'),
    },
  },
];

const NAV_SUBJECT_ID = 'subject:wf3_nav_offset';
const NAV_VISIBLE_COUNT = 5;
const REFERENCE_NAV_ITEMS = [
  { content: '\ue335', target: 'uart', title: 'UART', font: 'wf3_icons_36' },
  { content: '\ue86f', target: 'i2c', title: 'I2C', font: 'wf3_icons_36' },
  { content: '\uefe6', target: 'spi', title: 'SPI', font: 'wf3_icons_36' },
  { content: '\ue915', target: 'io', title: 'IO', font: 'wf3_icons_36' },
  { content: '\ue1e0', target: 'usb', title: 'USB', font: 'wf3_icons_36' },
  { content: '\uf102', target: 'can485', title: 'CAN/485', font: 'wf3_icons_36' },
  { content: '\uec1c', target: 'voltage', title: '接口电平', font: 'wf3_icons_36' },
  { content: '\ueb2f', target: 'network', title: '网络', font: 'wf3_icons_36' },
  { content: '\ue322', target: 'system', title: '系统', font: 'wf3_icons_36' },
  { content: '\ue8b8', target: 'settings', title: '设置', font: 'wf3_icons_36' },
  { content: '\ue6e1', target: 'monitor', title: '监控', font: 'wf3_icons_36' },
  { content: '\ue87b', target: 'blockly', title: '积木编程', font: 'wf3_icons_36' },
  { content: '\ue1ff', target: 'wf31', title: 'WF3-1 温度', font: 'wf3_icons_36' },
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

function borderWidth(value) {
  if (value === 0) return token('border.none');
  if (value === 1) return token('border.default');
  return value;
}

function radius(value) {
  if (value === 0) return token('radius.none');
  if (value === 5) return token('radius.control');
  if (value === 10) return token('radius.dialog');
  return value;
}

function opacity(value) {
  return value === 255 ? token('opacity.solid') : value;
}

function node(type, options = {}) {
  return {
    id: id(type), type,
    ...(options.codeName ? { codeName: options.codeName } : {}),
    ...(options.displayName ? { displayName: options.displayName } : {}),
    props: options.props ?? {},
    ...(options.flags ? { flags: options.flags } : {}),
    styleRefs: options.styleRefs ?? [], styles: options.styles ?? [], events: options.events ?? [], bindings: options.bindings ?? [],
    children: options.children ?? [],
  };
}

function fontFor(_text, size = 12) {
  if (size <= 12) return FONTS.small;
  if (size <= 14) return FONTS.body;
  if (size <= 16) return FONTS.title;
  return FONTS.valueLarge;
}

function label(code, key, text, x, y, width, height = 'content', options = {}) {
  return node('label', {
    codeName: `wf3_${code}_${key}`,
    props: { text, x, y, width, height },
    styles: [group({
      text_color: options.color ?? COLORS.text,
      text_font: options.font ?? fontFor(text, options.size ?? 12),
      text_align: options.align ?? 'left',
      text_opa: opacity(options.opa ?? 255),
    })],
  });
}

function box(code, key, x, y, width, height, options = {}) {
  const overrides = {
    ...(options.bg === undefined ? {} : { bg_color: options.bg }),
    ...(options.opa === undefined ? {} : { bg_opa: opacity(options.opa) }),
    ...(options.border === undefined ? {} : { border_color: options.border }),
    ...(options.borderWidth === undefined ? {} : { border_width: borderWidth(options.borderWidth) }),
    ...(options.radius === undefined ? {} : { radius: radius(options.radius) }),
  };
  return node('obj', {
    codeName: `wf3_${code}_${key}`,
    props: { x, y, width, height },
    flags: { scrollable: false },
    styleRefs: [{ styleId: STYLE_IDS.surface }],
    styles: Object.keys(overrides).length > 0 ? [group(overrides)] : [],
    children: options.children ?? [],
  });
}

function openEvent(target, screenIds, direction = 'move_left') {
  if (!target || !screenIds.has(target)) return [];
  return [{ on: 'clicked', action: 'screen.open', args: { screen: screenIds.get(target), anim: direction, duration: 170, delay: 0 } }];
}

function incrementEvent(step) {
  return [{
    on: 'clicked',
    action: 'subject.increment',
    args: {
      subject: NAV_SUBJECT_ID,
      step,
      min: 0,
      max: REFERENCE_NAV_ITEMS.length - 1,
      rollover: true,
    },
  }];
}

function visibleAtOffset(offset) {
  return [{ kind: 'flag', flag: 'hidden', op: 'not_eq', subject: NAV_SUBJECT_ID, refValue: offset }];
}

function button(code, key, text, x, y, width, height, options = {}) {
  const overrides = {
    ...(options.bg === undefined ? {} : { bg_color: options.bg }),
    ...(options.border === undefined ? {} : { border_color: options.border }),
    ...(options.borderWidth === undefined ? {} : { border_width: borderWidth(options.borderWidth) }),
    ...(options.radius === undefined ? {} : { radius: radius(options.radius) }),
  };
  return node('button', {
    codeName: `wf3_${code}_${key}`,
    props: { x, y, width, height },
    flags: { scrollable: false },
    styleRefs: [
      { styleId: STYLE_IDS.control },
      { styleId: STYLE_IDS.controlPressed, selector: { states: ['pressed'] } },
    ],
    styles: [
      ...(Object.keys(overrides).length > 0 ? [group(overrides)] : []),
      ...(options.pressedBg === undefined ? [] : [
        group({ bg_color: options.pressedBg, bg_opa: token('opacity.solid') }, { states: ['pressed'] }),
      ]),
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
    styleRefs: [{ styleId: STYLE_IDS.screen }],
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
  const back = button(code, 'back', '', 0, 0, 30, 60, {
    bg: COLORS.accent, pressedBg: COLORS.accent2, border: COLORS.accent, borderWidth: 0,
    radius: 0, events: openEvent(backTarget(code), screenIds, 'move_right'),
  });
  back.children = [label(code, 'back_icon', '\ue166', 0, 13, 30, 34, {
    font: 'wf3_icons_32', align: 'center', color: COLORS.onAccent,
  })];
  return [
    back,
    box(code, 'voltage', 0, 60, 30, 16, { bg: COLORS.voltage5v, borderWidth: 0, radius: 0, children: [
      label(code, 'voltage_text', '5V3', 0, 0, 30, 16, {
        font: FONTS.body, align: 'center', color: COLORS.onAccent,
      }),
    ] }),
  ];
}

function buildTitle(code, title, kicker) {
  return box(code, 'titlebar', 30, 60, 254, 16, { bg: COLORS.card, borderWidth: 0, radius: 0, children: [
    label(code, 'title', title, 0, 0, 254, 16, {
      size: 12, align: 'center', color: COLORS.text,
    }),
  ] });
}

function buildNavigation(code, screenIds) {
  const previous = button(code, 'carousel_previous', '', 30, 0, 36, 60, {
    bg: COLORS.card,
    pressedBg: COLORS.card2,
    border: COLORS.card,
    borderWidth: 0,
    radius: 0,
    events: incrementEvent(-1),
  });
  previous.children = [
    label(code, 'carousel_previous_icon', '\ue5cb', 0, 5, 36, 50, {
      align: 'center', color: COLORS.accent, font: 'wf3_icons_36',
    }),
  ];

  const next = button(code, 'carousel_next', '', 246, 0, 38, 60, {
    bg: COLORS.card,
    pressedBg: COLORS.card2,
    border: COLORS.card,
    borderWidth: 0,
    radius: 0,
    events: incrementEvent(1),
  });
  next.children = [
    label(code, 'carousel_next_icon', '\ue5cc', 0, 5, 38, 50, {
      align: 'center', color: COLORS.accent, font: 'wf3_icons_36',
    }),
  ];

  const buttons = REFERENCE_NAV_ITEMS.flatMap((_, offset) => (
    Array.from({ length: NAV_VISIBLE_COUNT }, (_, slot) => {
      const itemIndex = (offset + slot) % REFERENCE_NAV_ITEMS.length;
      const nav = REFERENCE_NAV_ITEMS[itemIndex];
      const item = button(code, `carousel_${offset}_${slot}_${nav.target}`, '', 66 + slot * 36, 0, 36, 60, {
        bg: COLORS.card,
        pressedBg: COLORS.card2,
        border: COLORS.card,
        borderWidth: 0,
        radius: 0,
        events: openEvent(nav.target, screenIds),
      });
      item.bindings = visibleAtOffset(offset);
      item.children = [
        label(code, `carousel_${offset}_${slot}_${nav.target}_content`, nav.content, 0, 5, 36, 50, {
          align: 'center', color: COLORS.accent, font: nav.font,
        }),
      ];
      return item;
    })
  ));

  const titleBar = buildTitle(code, '', '');
  titleBar.children = REFERENCE_NAV_ITEMS.map((nav, offset) => {
    const title = label(code, `carousel_title_${offset}`, nav.title, 0, 0, 254, 16, {
      size: 12, align: 'center', color: COLORS.text,
    });
    title.bindings = visibleAtOffset(offset);
    return title;
  });

  return [previous, ...buttons, next, titleBar];
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
        size: 10,
      }),
    ];
    return cell;
  });
}

function buildAp(code) {
  return [
    box(code, 'network_card', 34, 2, 158, 51, { bg: COLORS.card, border: COLORS.border, children: [
      label(code, 'ssid', 'WF3-SETUP', 8, 5, 140, 14, { size: 12, color: COLORS.cyan }),
      label(code, 'password', '192.168.4.1', 8, 23, 140, 14, { size: 10, color: COLORS.muted }),
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

function makeSnapshot(fontSha, fontSize, iconFont32, iconFont36) {
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
      themes: [INDUSTRIAL_BASE_THEME, WF3_LIGHT_THEME],
      subjects: [{
        id: NAV_SUBJECT_ID,
        codeName: 'wf3_nav_offset',
        displayName: 'WF3 功能导航位置',
        type: 'int',
        initial: 0,
        min: 0,
        max: REFERENCE_NAV_ITEMS.length - 1,
      }],
      screens: PAGE_ORDER.map((code) => buildScreen(PAGE_BY_CODE.get(code), screenIds)),
      components: [], styles: INDUSTRIAL_STYLES, consts: [],
      assets: {
        fonts: [...[12, 14, 16, 20].map((sizePx) => ({
          id: `font:wf3_cn_${sizePx}`,
          codeName: `wf3_cn_${sizePx}`,
          displayName: `WF3 中文 ${sizePx}px`,
          file: fontFile,
          conv: {
            loader: 'tiny_ttf', sizePx, bpp: 2,
            ranges: '0x20-0x7e,0x4e00-0x9fff', autoCollect: true,
            license: 'OFL-1.1', licenseUrl: 'https://openfontlicense.org',
          },
        })), ...[
          ['wf3_icons_32', 32, iconFont32],
          ['wf3_icons_36', 36, iconFont36],
        ].map(([codeName, sizePx, file]) => ({
          id: `font:${codeName}`,
          codeName,
          displayName: `WF3 Material Symbols Outlined ${sizePx}px`,
          file,
          conv: {
            loader: 'tiny_ttf', sizePx, bpp: 4,
            ranges: '0xe166,0xe1e0,0xe1ff,0xe322,0xe335,0xe5cb-0xe5cc,0xe6e1,0xe86f,0xe87b,0xe8b8,0xe915,0xeb2f,0xec1c,0xefe6,0xf102',
            autoCollect: true,
            license: 'Apache-2.0',
            licenseUrl: 'https://github.com/google/material-design-icons/blob/master/LICENSE',
          },
        }))],
        images: [], icons: [],
      },
      translations: null,
      editor: {
        deviceModel: 'WF3',
        deviceTitle: '2.25 英寸 284×76 条形屏',
        example: 'wf3-firmware-import',
        builtInRevision: BUILT_IN_REVISION,
        source: SOURCE,
      },
    },
    displayProfile: {
      schemaVersion: 1, kind: 'display-profile', id: displayId, revision: 1,
      displayName: 'WF3 2.25 英寸 284×76 RGB565', logicalSize: { width: 284, height: 76 },
      shape: 'rect', colorFormat: 'RGB565', dpi: 160,
    },
    controllerProfile: null,
    buildTarget: {
      schemaVersion: 1, kind: 'lvgl-build-target', id: 'target:wf3-firmware-284x76', revision: 1,
      uiProjectRef: uiRef, themeRef: `${uiRef}#theme:${WF3_LIGHT_THEME.id}`, lvglVersion: '9.5.0',
    },
    actionRegistry: {
      'screen.open': { id: 'screen.open', displayName: '打开屏幕', params: [
        { name: 'screen', type: 'screenRef', required: true }, { name: 'anim', type: 'string' },
        { name: 'duration', type: 'int' }, { name: 'delay', type: 'int' },
      ] },
      'subject.increment': { id: 'subject.increment', displayName: '递增 Subject', params: [
        { name: 'subject', type: 'subjectRef', required: true },
        { name: 'step', type: 'int' }, { name: 'min', type: 'int' },
        { name: 'max', type: 'int' }, { name: 'rollover', type: 'bool' },
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
const iconFont32Bytes = readFileSync(ICON_FONT_32_FILE);
const iconFont36Bytes = readFileSync(ICON_FONT_36_FILE);
const iconFont32Sha = createHash('sha256').update(iconFont32Bytes).digest('hex');
const iconFont36Sha = createHash('sha256').update(iconFont36Bytes).digest('hex');
const snapshot = makeSnapshot(
  fontSha,
  statSync(FONT_FILE).size,
  {
    fileName: 'MaterialSymbolsOutlined-WF3-32.ttf',
    sha256: iconFont32Sha,
    byteSize: statSync(ICON_FONT_32_FILE).size,
  },
  {
    fileName: 'MaterialSymbolsOutlined-WF3-36.ttf',
    sha256: iconFont36Sha,
    byteSize: statSync(ICON_FONT_36_FILE).size,
  },
);
writeFileSync(OUTPUT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
process.stdout.write(`generated ${OUTPUT_FILE} (${snapshot.uiProject.screens.length} screens, fonts ${fontSha.slice(0, 12)}/${iconFont32Sha.slice(0, 12)}/${iconFont36Sha.slice(0, 12)})\n`);
