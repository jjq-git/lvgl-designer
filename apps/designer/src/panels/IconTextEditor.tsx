import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface LvglSymbolOption {
  name: string;
  symbol: string;
  keywords: string;
  fontFamily?: 'lvgl' | 'wf3-material';
}

/** Material Symbols used by the WF3 firmware UI reference design. */
export const WF3_MATERIAL_SYMBOLS: readonly LvglSymbolOption[] = [
  { name: 'Material 返回', symbol: '\ue166', keywords: 'undo return back 返回 撤销', fontFamily: 'wf3-material' },
  { name: 'Material 左箭头', symbol: '\ue5cb', keywords: 'chevron_left left previous 向左 上一个', fontFamily: 'wf3-material' },
  { name: 'Material 设备拓扑', symbol: '\ue335', keywords: 'device_hub topology node 设备 拓扑 节点', fontFamily: 'wf3-material' },
  { name: 'Material 代码', symbol: '\ue86f', keywords: 'code source brackets 代码 源码', fontFamily: 'wf3-material' },
  { name: 'Material 数据线', symbol: '\uefe6', keywords: 'cable wire connector 数据线 连接线', fontFamily: 'wf3-material' },
  { name: 'Material 双向传输', symbol: '\ue915', keywords: 'compare_arrows exchange transfer 双向 传输 交换', fontFamily: 'wf3-material' },
  { name: 'Material USB', symbol: '\ue1e0', keywords: 'usb device interface 接口 设备', fontFamily: 'wf3-material' },
  { name: 'Material CAN 总线', symbol: '\uf102', keywords: 'electrical_services can rs485 bus 总线 接口', fontFamily: 'wf3-material' },
  { name: 'Material 电压', symbol: '\uec1c', keywords: 'electric_bolt voltage 电压 电平 闪电', fontFamily: 'wf3-material' },
  { name: 'Material 网络', symbol: '\ueb2f', keywords: 'lan network ethernet 网络 网口', fontFamily: 'wf3-material' },
  { name: 'Material 系统芯片', symbol: '\ue322', keywords: 'memory chip system 系统 芯片 内存', fontFamily: 'wf3-material' },
  { name: 'Material 设置', symbol: '\ue8b8', keywords: 'settings gear 设置 齿轮', fontFamily: 'wf3-material' },
  { name: 'Material 监控', symbol: '\ue6e1', keywords: 'show_chart monitor chart 监控 图表', fontFamily: 'wf3-material' },
  { name: 'Material 积木', symbol: '\ue87b', keywords: 'extension block puzzle 积木 扩展', fontFamily: 'wf3-material' },
  { name: 'Material 温度', symbol: '\ue1ff', keywords: 'device_thermostat temperature 温度 测温', fontFamily: 'wf3-material' },
  { name: 'Material 右箭头', symbol: '\ue5cc', keywords: 'chevron_right right next 向右 下一个', fontFamily: 'wf3-material' },
];

export const LVGL_BUILTIN_SYMBOLS: readonly LvglSymbolOption[] = [
  { name: '主页', symbol: '\uf015', keywords: 'home 首页' },
  { name: '向左', symbol: '\uf053', keywords: 'left back 返回 上一页' },
  { name: '向右', symbol: '\uf054', keywords: 'right next 下一页 前进' },
  { name: '向上', symbol: '\uf077', keywords: 'up' },
  { name: '向下', symbol: '\uf078', keywords: 'down' },
  { name: '确认', symbol: '\uf00c', keywords: 'ok check good 成功' },
  { name: '关闭', symbol: '\uf00d', keywords: 'close cancel 取消' },
  { name: '播放', symbol: '\uf04b', keywords: 'play start 开始' },
  { name: '暂停', symbol: '\uf04c', keywords: 'pause' },
  { name: '停止', symbol: '\uf04d', keywords: 'stop' },
  { name: '上一个', symbol: '\uf048', keywords: 'previous prev' },
  { name: '下一个', symbol: '\uf051', keywords: 'next' },
  { name: '电源', symbol: '\uf011', keywords: 'power off 开关' },
  { name: '设置', symbol: '\uf013', keywords: 'settings gear' },
  { name: '刷新', symbol: '\uf021', keywords: 'refresh air fan ventilation 循环 空气 风扇' },
  { name: '静音', symbol: '\uf026', keywords: 'mute dnd 勿扰' },
  { name: '中等音量', symbol: '\uf027', keywords: 'volume audio 声音' },
  { name: '高音量', symbol: '\uf028', keywords: 'volume audio 声音 boost' },
  { name: '音频', symbol: '\uf001', keywords: 'audio sound' },
  { name: '视频', symbol: '\uf008', keywords: 'video meeting camera 会议' },
  { name: '查看/专注', symbol: '\uf06e', keywords: 'eye focus view 专注' },
  { name: '电话', symbol: '\uf095', keywords: 'call phone' },
  { name: '照明/闪电', symbol: '\uf0e7', keywords: 'charge light lamp brightness 灯光' },
  { name: '水滴', symbol: '\uf043', keywords: 'tint water humidity 湿度' },
  { name: '无线网络', symbol: '\uf1eb', keywords: 'wifi network online 网络' },
  { name: '蓝牙', symbol: '\uf293', keywords: 'bluetooth' },
  { name: '通知', symbol: '\uf0f3', keywords: 'bell notification 提醒' },
  { name: '列表', symbol: '\uf00b', keywords: 'list menu' },
  { name: '菜单', symbol: '\uf0c9', keywords: 'bars menu' },
  { name: '保存', symbol: '\uf0c7', keywords: 'save' },
  { name: '编辑', symbol: '\uf304', keywords: 'edit pencil' },
  { name: '删除', symbol: '\uf2ed', keywords: 'trash delete' },
  { name: '上传', symbol: '\uf093', keywords: 'upload' },
  { name: '下载', symbol: '\uf019', keywords: 'download' },
  { name: '加号', symbol: '\uf067', keywords: 'plus add 增加' },
  { name: '减号', symbol: '\uf068', keywords: 'minus remove 减少' },
  { name: '警告', symbol: '\uf071', keywords: 'warning alert' },
  { name: '循环', symbol: '\uf079', keywords: 'loop repeat' },
  { name: '项目符号', symbol: '\u2022', keywords: 'bullet dot point 圆点' },
  { name: '存储盘', symbol: '\uf01c', keywords: 'drive disk storage 磁盘 存储' },
  { name: '图片', symbol: '\uf03e', keywords: 'image photo picture 图像 照片' },
  { name: '弹出', symbol: '\uf052', keywords: 'eject media 退出介质' },
  { name: '隐藏', symbol: '\uf070', keywords: 'eye close hidden invisible 不可见' },
  { name: '随机播放', symbol: '\uf074', keywords: 'shuffle random 随机' },
  { name: '文件夹', symbol: '\uf07b', keywords: 'directory folder 目录' },
  { name: '剪切', symbol: '\uf0c4', keywords: 'cut scissors 剪刀' },
  { name: '复制', symbol: '\uf0c5', keywords: 'copy duplicate 副本' },
  { name: '邮件', symbol: '\uf0e0', keywords: 'envelope mail email 消息' },
  { name: '粘贴', symbol: '\uf0ea', keywords: 'paste clipboard 剪贴板' },
  { name: '键盘', symbol: '\uf11c', keywords: 'keyboard input 输入' },
  { name: '定位', symbol: '\uf124', keywords: 'gps location navigation 位置 导航' },
  { name: '文件', symbol: '\uf158', keywords: 'file document 文档' },
  { name: '电池满', symbol: '\uf240', keywords: 'battery full 100 charge 电量满' },
  { name: '电池较高', symbol: '\uf241', keywords: 'battery 75 three quarters 电量' },
  { name: '电池一半', symbol: '\uf242', keywords: 'battery 50 half 电量' },
  { name: '电池较低', symbol: '\uf243', keywords: 'battery 25 one quarter low 电量低' },
  { name: '电池空', symbol: '\uf244', keywords: 'battery empty zero low 没电' },
  { name: 'USB', symbol: '\uf287', keywords: 'usb device 设备 接口' },
  { name: '退格', symbol: '\uf55a', keywords: 'backspace erase delete 删除字符' },
  { name: 'SD 卡', symbol: '\uf7c2', keywords: 'sd card memory storage 存储卡 内存卡' },
  { name: '换行', symbol: '\uf8a2', keywords: 'new line enter return 回车' },
];

/**
 * Quiet-pod controls use semantic aliases of LVGL's built-in glyphs. Keeping
 * the underlying code points in the built-in set guarantees that WASM preview
 * and generated firmware render the same icon without an extra font asset.
 */
export const QUIET_POD_SYMBOLS: readonly LvglSymbolOption[] = [
  { name: '静音仓', symbol: '\uf015', keywords: 'quiet pod cabin booth 舱体 空间' },
  { name: '安静模式', symbol: '\uf026', keywords: 'quiet silent silence mute 静音 降噪' },
  { name: '噪声', symbol: '\uf001', keywords: 'noise sound audio 声音' },
  { name: '分贝', symbol: '\uf027', keywords: 'decibel db noise level 音量 噪声值' },
  { name: 'CO₂', symbol: '\uf0c9', keywords: 'co2 carbon dioxide air 二氧化碳 空气' },
  { name: '温度', symbol: '\uf043', keywords: 'temperature temp celsius heat cold 冷热 摄氏度' },
  { name: '湿度', symbol: '\uf043', keywords: 'humidity water moisture rh 水分' },
  { name: '空气质量', symbol: '\uf00c', keywords: 'air quality good fresh aq 空气 优良' },
  { name: '新风', symbol: '\uf021', keywords: 'fresh air ventilation intake 换气 进风' },
  { name: '风扇', symbol: '\uf021', keywords: 'fan blower rotate 风机' },
  { name: '风速', symbol: '\uf028', keywords: 'fan speed airflow wind 风量' },
  { name: '通风', symbol: '\uf079', keywords: 'vent ventilation circulate air 换气 循环' },
  { name: '通风增强', symbol: '\uf028', keywords: 'vent boost turbo strong air 强力 新风增强' },
  { name: '自动通风', symbol: '\uf079', keywords: 'auto ventilation schedule 自动换气' },
  { name: '灯光', symbol: '\uf0e7', keywords: 'light lamp lighting cabin light 照明' },
  { name: '亮度', symbol: '\uf06e', keywords: 'brightness light level dim 明暗' },
  { name: '色温', symbol: '\uf043', keywords: 'cct kelvin warm cool light 冷暖光' },
  { name: '灯光场景', symbol: '\uf00b', keywords: 'light scene preset mode 情景 预设' },
  { name: '自动灯光', symbol: '\uf0e7', keywords: 'auto light presence 自动照明 感应灯' },
  { name: '工作模式', symbol: '\uf304', keywords: 'work deep focus office 工作场景' },
  { name: '放松模式', symbol: '\uf070', keywords: 'relax rest calm 休息 舒缓' },
  { name: '专注模式', symbol: '\uf06e', keywords: 'focus deep work 专注工作' },
  { name: '会议模式', symbol: '\uf008', keywords: 'meeting conference people 会议' },
  { name: '视频会议', symbol: '\uf008', keywords: 'video call camera meeting 视频通话' },
  { name: '电话模式', symbol: '\uf095', keywords: 'phone call telephone 通话' },
  { name: '开始会话', symbol: '\uf04b', keywords: 'start session play begin 开始使用' },
  { name: '结束会话', symbol: '\uf011', keywords: 'end session finish power stop 结束使用' },
  { name: '计时', symbol: '\uf079', keywords: 'timer duration countdown time 时长 倒计时' },
  { name: '日程', symbol: '\uf00b', keywords: 'schedule calendar plan 时间表 计划' },
  { name: '预约', symbol: '\uf0f3', keywords: 'booking reservation calendar bell 预订 提醒' },
  { name: '勿扰', symbol: '\uf026', keywords: 'dnd do not disturb mute 免打扰' },
  { name: '有人/占用', symbol: '\uf06e', keywords: 'occupied presence person people 有人 在用' },
  { name: '人体感应', symbol: '\uf124', keywords: 'presence sensor person occupancy 人感' },
  { name: '雷达感应', symbol: '\uf1eb', keywords: 'radar sensor presence motion 毫米波' },
  { name: '移动检测', symbol: '\uf074', keywords: 'motion movement detect radar 移动感应' },
  { name: '灵敏度', symbol: '\uf013', keywords: 'sensitivity sensor level radar 感应设置' },
  { name: '自动模式', symbol: '\uf021', keywords: 'auto automatic smart mode 自动控制' },
  { name: '门禁', symbol: '\uf00c', keywords: 'door access entry lock 开门 门锁' },
  { name: '隐私', symbol: '\uf070', keywords: 'privacy hidden private eye 私密 遮挡' },
  { name: '系统', symbol: '\uf013', keywords: 'system settings control 系统设置' },
  { name: '设备', symbol: '\uf01c', keywords: 'device hardware panel terminal 终端 硬件' },
  { name: '显示屏', symbol: '\uf03e', keywords: 'display screen monitor panel 屏幕' },
  { name: '固件', symbol: '\uf158', keywords: 'firmware file version software 版本' },
  { name: '网络在线', symbol: '\uf1eb', keywords: 'network online wifi connected 联网 连接' },
  { name: '重启面板', symbol: '\uf021', keywords: 'restart reboot panel reset 重启设备' },
  { name: '告警', symbol: '\uf071', keywords: 'alarm alert warning fault 故障 警报' },
  { name: '通知提醒', symbol: '\uf0f3', keywords: 'notification reminder bell message 提醒' },
  { name: '保存场景', symbol: '\uf0c7', keywords: 'save scene preset 保存模式' },
];

/**
 * IoT-oriented aliases for LVGL's built-in symbols. These cover common
 * connectivity, sensor, smart-device, telemetry and maintenance concepts
 * without adding a second icon font to the preview or generated firmware.
 */
export const IOT_SYMBOLS: readonly LvglSymbolOption[] = [
  { name: '物联网', symbol: '\uf1eb', keywords: 'iot internet of things 万物互联' },
  { name: '云平台', symbol: '\uf093', keywords: 'cloud platform service 云端 云服务' },
  { name: '云同步', symbol: '\uf079', keywords: 'cloud sync synchronize 云端同步' },
  { name: '边缘网关', symbol: '\uf01c', keywords: 'edge gateway hub 网关 中控' },
  { name: '边缘计算', symbol: '\uf013', keywords: 'edge computing compute 边缘节点' },
  { name: '设备配网', symbol: '\uf1eb', keywords: 'provision pairing wifi setup 配置网络' },
  { name: '设备绑定', symbol: '\uf00c', keywords: 'bind pair claim add 添加设备' },
  { name: '设备解绑', symbol: '\uf00d', keywords: 'unbind unpair remove 移除设备' },
  { name: '设备在线', symbol: '\uf1eb', keywords: 'device online connected 在线 已连接' },
  { name: '设备离线', symbol: '\uf070', keywords: 'device offline disconnected 离线 断开' },
  { name: '信号强度', symbol: '\uf1eb', keywords: 'signal rssi strength wireless 信号 网络质量' },
  { name: '远程控制', symbol: '\uf124', keywords: 'remote control telemetry command 遥控' },
  { name: '数据上报', symbol: '\uf093', keywords: 'telemetry upload report publish 上行 采集数据' },
  { name: '指令下发', symbol: '\uf019', keywords: 'command download dispatch subscribe 下行 控制指令' },
  { name: 'MQTT 消息', symbol: '\uf0e0', keywords: 'mqtt message broker topic publish subscribe 消息队列' },
  { name: 'OTA 升级', symbol: '\uf093', keywords: 'ota update upgrade firmware 远程升级 固件升级' },
  { name: '运行日志', symbol: '\uf158', keywords: 'log event record runtime 事件日志' },
  { name: '历史数据', symbol: '\uf07b', keywords: 'history data archive trend 历史曲线' },
  { name: '实时数据', symbol: '\uf021', keywords: 'realtime live data refresh 实时监测' },
  { name: '仪表盘', symbol: '\uf03e', keywords: 'dashboard panel overview monitor 看板 总览' },
  { name: '自动化', symbol: '\uf079', keywords: 'automation automatic smart linkage 自动执行' },
  { name: '联动规则', symbol: '\uf0c9', keywords: 'rule scene linkage trigger ifttt 触发器 条件' },
  { name: '定时任务', symbol: '\uf0f3', keywords: 'timer schedule cron task 计划任务' },
  { name: '设备分组', symbol: '\uf07b', keywords: 'device group zone room 分组 区域 房间' },
  { name: '传感器', symbol: '\uf124', keywords: 'sensor probe detector 感知 探头' },
  { name: '温湿度传感器', symbol: '\uf043', keywords: 'temperature humidity sensor th 温湿度检测' },
  { name: '烟雾传感器', symbol: '\uf071', keywords: 'smoke fire sensor detector 烟感 火灾' },
  { name: '燃气传感器', symbol: '\uf071', keywords: 'gas methane leak sensor 燃气泄漏 甲烷' },
  { name: '水浸传感器', symbol: '\uf043', keywords: 'water leak flood sensor 漏水 水浸' },
  { name: '光照传感器', symbol: '\uf06e', keywords: 'light lux illuminance sensor 光强 照度' },
  { name: '压力传感器', symbol: '\uf027', keywords: 'pressure sensor kpa bar 压力检测' },
  { name: '门磁传感器', symbol: '\uf00c', keywords: 'door contact magnetic sensor open close 门窗检测' },
  { name: '智能电表', symbol: '\uf0e7', keywords: 'smart meter electricity power meter 电量计量' },
  { name: '能耗监测', symbol: '\uf0e7', keywords: 'energy consumption power monitor 用电统计' },
  { name: '电压', symbol: '\uf0e7', keywords: 'voltage volt v 电压检测' },
  { name: '电流', symbol: '\uf0e7', keywords: 'current ampere amp a 电流检测' },
  { name: '智能插座', symbol: '\uf011', keywords: 'smart plug socket outlet power 插座开关' },
  { name: '智能开关', symbol: '\uf011', keywords: 'smart switch relay power 继电器' },
  { name: '智能灯', symbol: '\uf0e7', keywords: 'smart light bulb lamp lighting 灯泡 照明' },
  { name: '智能门锁', symbol: '\uf00c', keywords: 'smart lock door lock access 锁 门禁' },
  { name: '智能摄像头', symbol: '\uf008', keywords: 'smart camera ipc cctv video 监控摄像头' },
  { name: '智能音箱', symbol: '\uf001', keywords: 'smart speaker voice audio 语音助手' },
  { name: '空调', symbol: '\uf021', keywords: 'air conditioner ac hvac climate 制冷 制热' },
  { name: '加湿器', symbol: '\uf043', keywords: 'humidifier mist moisture 加湿 雾化' },
  { name: '智能窗帘', symbol: '\uf077', keywords: 'smart curtain blind shade motor 窗帘电机' },
  { name: '智能阀门', symbol: '\uf011', keywords: 'smart valve pipe control 阀门开关' },
  { name: '水泵', symbol: '\uf043', keywords: 'water pump motor pump 泵站' },
  { name: '智能灌溉', symbol: '\uf043', keywords: 'irrigation watering agriculture farm 农业灌溉' },
  { name: 'Zigbee', symbol: '\uf1eb', keywords: 'zigbee mesh wireless protocol 紫蜂 协议' },
  { name: 'LoRa', symbol: '\uf1eb', keywords: 'lora lorawan lpwan wireless 低功耗广域网' },
  { name: 'NB-IoT', symbol: '\uf1eb', keywords: 'nbiot cellular operator wireless 窄带物联网' },
  { name: '4G / 5G', symbol: '\uf1eb', keywords: '4g 5g cellular mobile network 移动网络' },
  { name: '以太网', symbol: '\uf287', keywords: 'ethernet lan wired rj45 有线网络' },
  { name: 'GPS 定位', symbol: '\uf124', keywords: 'gps gnss location geofence 位置 轨迹 电子围栏' },
  { name: '蓝牙设备', symbol: '\uf293', keywords: 'bluetooth ble beacon device 蓝牙低功耗' },
  { name: 'RFID 门禁', symbol: '\uf00c', keywords: 'rfid nfc access card badge 刷卡 身份识别' },
  { name: '太阳能', symbol: '\uf0e7', keywords: 'solar photovoltaic pv energy 光伏 发电' },
  { name: '充电中', symbol: '\uf0e7', keywords: 'charging charger battery energy 充电桩' },
  { name: '低电告警', symbol: '\uf243', keywords: 'low battery alert warning 低电量 欠压' },
  { name: '电池供电', symbol: '\uf240', keywords: 'battery powered supply 电池模式' },
  { name: '设备故障', symbol: '\uf071', keywords: 'device fault error failure alarm 异常 故障' },
  { name: '告警恢复', symbol: '\uf00c', keywords: 'alarm cleared recovered normal 恢复正常' },
  { name: '维护模式', symbol: '\uf013', keywords: 'maintenance service repair mode 检修 运维' },
];

export const LVGL_SYMBOLS: readonly LvglSymbolOption[] = [
  ...WF3_MATERIAL_SYMBOLS,
  ...IOT_SYMBOLS,
  ...QUIET_POD_SYMBOLS,
  ...LVGL_BUILTIN_SYMBOLS,
];

const EDITOR_SYMBOLS: readonly LvglSymbolOption[] = [
  ...WF3_MATERIAL_SYMBOLS,
  ...LVGL_BUILTIN_SYMBOLS,
];

function symbolPreview(option: LvglSymbolOption): string {
  return option.symbol;
}

function symbolClassName(option: LvglSymbolOption): string {
  return option.fontFamily === 'wf3-material'
    ? 'lvgl-symbol-glyph wf3-material-symbol-glyph'
    : 'lvgl-symbol-glyph';
}

function symbolToken(option: LvglSymbolOption): string {
  return `[图标:${option.name}]`;
}

export function formatLvglSymbolText(value: string): string {
  return EDITOR_SYMBOLS.reduce(
    (text, option) => text.replaceAll(option.symbol, symbolToken(option)),
    value,
  );
}

export function parseLvglSymbolText(value: string): string {
  return LVGL_SYMBOLS.reduce(
    (text, option) => text.replaceAll(symbolToken(option), option.symbol),
    value,
  );
}

export function applyLvglSymbol(
  value: string,
  symbol: string,
  mode: 'insert' | 'replace',
  start = value.length,
  end = start,
): string {
  if (mode === 'replace') return symbol;
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  return `${value.slice(0, from)}${symbol}${value.slice(to)}`;
}

export function filterLvglSymbols(query: string): readonly LvglSymbolOption[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === '') return LVGL_SYMBOLS;
  return LVGL_SYMBOLS.filter((option) =>
    `${option.name} ${option.keywords}`.toLowerCase().includes(normalized));
}

interface PickerPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export function isScrollInsideIconPicker(
  popup: Pick<Node, 'contains'> | null,
  target: EventTarget | null,
): boolean {
  return target !== null && popup?.contains(target as Node) === true;
}

export function IconTextEditor(props: {
  ariaLabel?: string;
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'insert' | 'replace'>('insert');
  const [position, setPosition] = useState<PickerPosition>({ left: 0, top: 0, width: 320, maxHeight: 360 });
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formattedValue = formatLvglSymbolText(props.value);
  const textRef = useRef(formattedValue);
  const selectionRef = useRef({ start: formattedValue.length, end: formattedValue.length });
  const options = useMemo(() => filterLvglSymbols(query), [query]);

  const current = draft ?? formattedValue;
  textRef.current = current;

  const updatePickerPosition = useCallback((): void => {
    const root = rootRef.current;
    const popup = popupRef.current;
    if (!root || !popup) return;
    const trigger = root.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const maxHeight = Math.min(360, window.innerHeight - margin * 2);
    const height = Math.min(popup.scrollHeight, maxHeight);
    const below = trigger.bottom + gap + height <= window.innerHeight - margin;
    const top = below ? trigger.bottom + gap : Math.max(margin, trigger.top - gap - height);
    const width = Math.min(340, window.innerWidth - margin * 2);
    const left = Math.max(margin, Math.min(trigger.right - width, window.innerWidth - width - margin));
    setPosition({ left, top, width, maxHeight });
  }, []);

  const rememberSelection = (): void => {
    const input = inputRef.current;
    if (!input) return;
    selectionRef.current = {
      start: input.selectionStart ?? input.value.length,
      end: input.selectionEnd ?? input.value.length,
    };
  };
  const commit = (): void => {
    if (draft === null) return;
    props.onCommit(parseLvglSymbolText(draft));
    setDraft(null);
  };
  const openPicker = (): void => {
    rememberSelection();
    const trimmed = textRef.current.trim();
    setMode(LVGL_SYMBOLS.some((option) => trimmed === symbolToken(option)) ? 'replace' : 'insert');
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(340, window.innerWidth - 16);
      setPosition({
        left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        top: rect.bottom + 4,
        width,
        maxHeight: 360,
      });
    }
    setOpen((value) => !value);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    let animationFrame = 0;
    const schedulePositionUpdate = (): void => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(updatePickerPosition);
    };
    const onScroll = (event: Event): void => {
      if (isScrollInsideIconPicker(popupRef.current, event.target)) return;
      schedulePositionUpdate();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', schedulePositionUpdate);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', schedulePositionUpdate);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, updatePickerPosition]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePickerPosition();
  }, [open, options.length, updatePickerPosition]);

  const choose = (option: LvglSymbolOption): void => {
    const { start, end } = selectionRef.current;
    const next = applyLvglSymbol(textRef.current, symbolToken(option), mode, start, end);
    props.onCommit(parseLvglSymbolText(next));
    setDraft(null);
    setOpen(false);
  };

  const currentSymbols = EDITOR_SYMBOLS.filter((option) =>
    props.value.includes(option.symbol) || current.includes(symbolToken(option)));
  return (
    <div className="icon-text-editor" ref={rootRef}>
      <input
        ref={inputRef}
        aria-label={props.ariaLabel}
        className="ed-text"
        placeholder={props.placeholder}
        value={current}
        onChange={(event) => {
          setDraft(event.target.value);
          textRef.current = event.target.value;
        }}
        onSelect={rememberSelection}
        onClick={rememberSelection}
        onKeyUp={rememberSelection}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
      <button
        type="button"
        className="icon-text-picker-btn"
        aria-label="选择 LVGL 图标"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={currentSymbols.length > 0
          ? `已使用：${currentSymbols.map((option) => option.name).join('、')}`
          : '选择 LVGL 内置图标'}
        onMouseDown={(event) => event.preventDefault()}
        onClick={openPicker}
      >
        {currentSymbols[0]
          ? <span className={symbolClassName(currentSymbols[0])}>{symbolPreview(currentSymbols[0])}</span>
          : '图标'}
      </button>
      {open && createPortal(
        <div ref={popupRef} className="lvgl-symbol-pop" role="dialog" aria-label="LVGL 图标选择器" style={position}>
          <div className="lvgl-symbol-head">
            <strong>LVGL 与物联网图标</strong>
            <span>{IOT_SYMBOLS.length} 个物联网 · {QUIET_POD_SYMBOLS.length} 个静音仓 · {LVGL_BUILTIN_SYMBOLS.length} 个内置，固件可直接使用</span>
          </div>
          <input
            className="ed-text lvgl-symbol-search"
            aria-label="搜索 LVGL 图标"
            value={query}
            placeholder="搜索：网关、传感器、MQTT、灯光…"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="lvgl-symbol-mode" role="group" aria-label="图标插入方式">
            <button type="button" className={mode === 'insert' ? 'active' : ''} onClick={() => setMode('insert')}>插入到光标</button>
            <button type="button" className={mode === 'replace' ? 'active' : ''} onClick={() => setMode('replace')}>仅使用图标</button>
          </div>
          <div className="lvgl-symbol-grid" role="listbox" aria-label="可用的 LVGL 图标">
            {options.map((option) => {
              const preview = symbolPreview(option);
              return (
                <button
                  key={option.name}
                  type="button"
                  role="option"
                  aria-selected={false}
                  aria-label={`${mode === 'replace' ? '仅使用' : '插入'}图标 ${option.name}`}
                  title={`${option.name} · U+${option.symbol.codePointAt(0)!.toString(16).toUpperCase()}`}
                  onClick={() => choose(option)}
                >
                  <span className={symbolClassName(option)} aria-hidden="true">{preview}</span>
                  <span>{option.name}</span>
                </button>
              );
            })}
            {options.length === 0 && <div className="lvgl-symbol-empty">没有匹配的图标</div>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
