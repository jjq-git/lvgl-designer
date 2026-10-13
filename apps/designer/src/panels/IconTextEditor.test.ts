import { describe, expect, it } from 'vitest';
import {
  applyLvglSymbol,
  filterPublishSafeSymbols,
  filterLvglSymbols,
  formatLvglSymbolText,
  IOT_SYMBOLS,
  isScrollInsideIconPicker,
  LVGL_BUILTIN_SYMBOLS,
  LVGL_SYMBOLS,
  parseLvglSymbolText,
  QUIET_POD_SYMBOLS,
  WF3_MATERIAL_SYMBOLS,
} from './IconTextEditor';

const LVGL_95_SYMBOL_CODE_POINTS = [
  0x2022,
  0xf001, 0xf008, 0xf00b, 0xf00c, 0xf00d, 0xf011, 0xf013, 0xf015, 0xf019,
  0xf01c, 0xf021, 0xf026, 0xf027, 0xf028, 0xf03e, 0xf043, 0xf048, 0xf04b,
  0xf04c, 0xf04d, 0xf051, 0xf052, 0xf053, 0xf054, 0xf067, 0xf068, 0xf06e,
  0xf070, 0xf071, 0xf074, 0xf077, 0xf078, 0xf079, 0xf07b, 0xf093, 0xf095,
  0xf0c4, 0xf0c5, 0xf0c7, 0xf0c9, 0xf0e0, 0xf0e7, 0xf0ea, 0xf0f3, 0xf11c,
  0xf124, 0xf158, 0xf1eb, 0xf240, 0xf241, 0xf242, 0xf243, 0xf244, 0xf287,
  0xf293, 0xf2ed, 0xf304, 0xf52b, 0xf55a, 0xf7c2, 0xf8a2,
];

describe('LVGL symbol text helpers', () => {
  it('includes every public symbol built into LVGL 9.5', () => {
    const actual = LVGL_BUILTIN_SYMBOLS
      .map((item) => item.symbol.codePointAt(0)!)
      .sort((left, right) => left - right);

    expect(actual).toEqual(LVGL_95_SYMBOL_CODE_POINTS);
    expect(new Set(LVGL_SYMBOLS.map((item) => item.name)).size).toBe(LVGL_SYMBOLS.length);
  });

  it('covers the controls and status indicators used by quiet-pod screens', () => {
    const names = new Set(QUIET_POD_SYMBOLS.map((item) => item.name));
    const requiredNames = [
      '静音仓', '噪声', 'CO₂', '温度', '湿度', '空气质量', '新风', '风扇', '风速',
      '通风', '通风增强', '灯光', '亮度', '色温', '专注模式', '会议模式', '电话模式',
      '计时', '勿扰', '人体感应', '雷达感应', '门禁', '固件', '网络在线', '重启面板',
    ];
    expect(requiredNames.filter((name) => !names.has(name))).toEqual([]);
    expect(QUIET_POD_SYMBOLS.every((item) =>
      LVGL_BUILTIN_SYMBOLS.some((builtin) => builtin.symbol === item.symbol))).toBe(true);
  });

  it('covers common IoT connectivity, sensors, devices and operations', () => {
    const names = new Set(IOT_SYMBOLS.map((item) => item.name));
    const requiredNames = [
      '物联网', '边缘网关', '设备配网', '数据上报', 'MQTT 消息', 'OTA 升级',
      '传感器', '温湿度传感器', '烟雾传感器', '水浸传感器', '能耗监测',
      '智能插座', '智能摄像头', '智能灌溉', 'Zigbee', 'LoRa', 'NB-IoT',
      'GPS 定位', '低电告警', '设备故障', '维护模式',
    ];
    expect(requiredNames.filter((name) => !names.has(name))).toEqual([]);
    expect(IOT_SYMBOLS.length).toBeGreaterThanOrEqual(60);
    expect(IOT_SYMBOLS.every((item) =>
      LVGL_BUILTIN_SYMBOLS.some((builtin) => builtin.symbol === item.symbol))).toBe(true);
  });

  it('inserts a symbol at the current selection or replaces all text', () => {
    expect(applyLvglSymbol('START', '\uf04b', 'insert', 0, 0)).toBe('\uf04bSTART');
    expect(applyLvglSymbol('AIR GOOD', '\uf00c', 'replace')).toBe('\uf00c');
    expect(applyLvglSymbol('ABCD', '\uf054', 'insert', 1, 3)).toBe('A\uf054D');
  });

  it('registers the WF3 Material Symbols used by the reference navigation', () => {
    expect(WF3_MATERIAL_SYMBOLS.map((item) => item.symbol.codePointAt(0))).toEqual([
      0xe166, 0xe5cb, 0xe335, 0xe86f, 0xefe6, 0xe915, 0xe1e0,
      0xf102, 0xec1c, 0xeb2f, 0xe322, 0xe8b8, 0xe6e1, 0xe87b, 0xe1ff,
      0xe5cc,
    ]);
    expect(WF3_MATERIAL_SYMBOLS.every((item) => item.fontFamily === 'wf3-material')).toBe(true);
    expect(filterLvglSymbols('device_hub').map((item) => item.name)).toContain('Material 设备拓扑');
    expect(filterLvglSymbols('数据线').map((item) => item.name)).toContain('Material 数据线');
  });

  it('keeps text symbols separate from image-backed Material assets', () => {
    expect(filterPublishSafeSymbols('').some((item) => item.fontFamily === 'wf3-material')).toBe(false);
    expect(filterPublishSafeSymbols('').length).toBeGreaterThan(0);
  });

  it('searches symbols by Chinese name and English keyword', () => {
    expect(filterLvglSymbols('主页').map((item) => item.name)).toContain('主页');
    expect(filterLvglSymbols('play').map((item) => item.name)).toContain('播放');
    expect(filterLvglSymbols('空气').map((item) => item.name)).toContain('刷新');
    expect(filterLvglSymbols('battery').map((item) => item.name)).toEqual(expect.arrayContaining([
      '电池满', '电池较高', '电池一半', '电池较低', '电池空',
    ]));
    expect(filterLvglSymbols('剪贴板').map((item) => item.name)).toContain('粘贴');
    expect(filterLvglSymbols('风扇').map((item) => item.name)).toContain('风扇');
    expect(filterLvglSymbols('meeting').map((item) => item.name)).toContain('会议模式');
    expect(filterLvglSymbols('网关').map((item) => item.name)).toContain('边缘网关');
    expect(filterLvglSymbols('mqtt').map((item) => item.name)).toContain('MQTT 消息');
    expect(filterLvglSymbols('漏水').map((item) => item.name)).toContain('水浸传感器');
    expect(filterLvglSymbols('lorawan').map((item) => item.name)).toContain('LoRa');
  });

  it('shows readable tokens in the editor while preserving LVGL glyphs in storage', () => {
    expect(formatLvglSymbolText('\uf054')).toBe('[图标:向右]');
    expect(formatLvglSymbolText('\uf04b START')).toBe('[图标:播放] START');
    expect(parseLvglSymbolText('[图标:确认]')).toBe('\uf00c');
    expect(parseLvglSymbolText('[图标:风扇]')).toBe('\uf021');
    expect(formatLvglSymbolText('\ue335')).toBe('[图标:Material 设备拓扑]');
    expect(parseLvglSymbolText('[图标:Material 设备拓扑]')).toBe('\ue335');
  });

  it('keeps the picker open when its own icon list scrolls', () => {
    const inside = {} as Node;
    const outside = {} as Node;
    const popup = { contains: (node: Node) => node === inside };

    expect(isScrollInsideIconPicker(popup, inside)).toBe(true);
    expect(isScrollInsideIconPicker(popup, outside)).toBe(false);
    expect(isScrollInsideIconPicker(null, inside)).toBe(false);
  });
});
