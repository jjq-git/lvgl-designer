/**
 * 舱级设置的业务 Action 白名单 —— **临时版本,待与原厂内核校准**。
 *
 * ⚠️⚠️ 这份契约不是从原厂 `host_settings_core` 导出的。
 * 原件从未提交到任何可达仓库(依据:`WF2P-0050_Knob_Display/simulator/sim_kernel/include/
 * host_settings.h:5-8` 与 `simulator/README.md:29,75` —— 现有 `sim_kernel` 是按
 * `app_ui_scenes.c` 的全部调用点**反推重建**的)。
 * 本文件是对那份反推实现的再一次转写,因此:
 *   - 字段集合、范围、步进与能力位**可能与真机不一致**;
 *   - 拿到原件后,应逐条比对并更新,而不是就地加字段;
 *   - 在校准完成前,任何依赖它的发布构建都必须标注为未校准。
 * 见 docs/PHASE0-REPORT.md §D8。
 *
 * 建模原则(方案 §5.3):照抄内核的真实契约,不发明 Action。
 * 内核是**字段式**的(按 field id 读/调),不是命令式的,所以这里也是
 * `pod.setField` / `pod.adjustField`,而不是 `light.toggle` / `fan.setSpeed` 那种
 * 看起来漂亮、却与下层对不上的动作名。Widget 只引用**语义字段 ID**,
 * CANopen index/subIndex 的映射留在固件 UI 集成层的 Binding Adapter 里。
 */
import type { ActionRegistry, ActionSpec } from '../uiProject.js';

/** 本白名单尚未与原厂内核校准 —— 发布流水线据此打标 */
export const POD_ACTIONS_PROVISIONAL = true;

/** 能力位。来源:host_settings.h 的 HOST_SETTINGS_CAP_* 掩码 */
export type PodCapability = 'fanControl' | 'localFan' | 'radar' | 'canMaster' | 'canOta';

export interface PodSettingField {
  /** 语义 ID —— UI 侧引用这个,不引用 C 枚举名 */
  id: string;
  /** 对应的 C 枚举名,供 Binding Adapter 生成映射;UI Schema 不使用 */
  kernelId: string;
  displayName: string;
  min: number;
  max: number;
  step: number;
  /** 缺少这些能力时该字段不可用(host_settings_field_is_available) */
  requiredCapabilities: readonly PodCapability[];
  /** 到边是否回绕。注意:共享内核默认循环,0050 侧到边即停,由场景层自行拦截 */
  cyclic: boolean;
  unit?: string;
}

/**
 * 字段目录。数值逐条抄自 `sim_kernel/src/host_settings.c:13-36` 的 `k_catalog[]`,
 * 顺序保持一致以便肉眼比对。
 */
export const POD_SETTING_FIELDS: readonly PodSettingField[] = [
  { id: 'mode.active', kernelId: 'HOST_SETTINGS_FIELD_ACTIVE_MODE', displayName: '当前模式槽位',
    min: 0, max: 3, step: 1, requiredCapabilities: [], cyclic: false },

  { id: 'mode.light.enabled', kernelId: 'HOST_SETTINGS_FIELD_MODE_LIGHT_ENABLED', displayName: '灯光开关',
    min: 0, max: 1, step: 1, requiredCapabilities: [], cyclic: false },
  { id: 'mode.light.brightness', kernelId: 'HOST_SETTINGS_FIELD_MODE_LIGHT_BRIGHTNESS', displayName: '灯光亮度',
    min: 0, max: 100, step: 5, requiredCapabilities: [], cyclic: false, unit: '%' },
  { id: 'mode.light.cct', kernelId: 'HOST_SETTINGS_FIELD_MODE_LIGHT_CCT', displayName: '灯光色温',
    min: 2700, max: 6500, step: 100, requiredCapabilities: [], cyclic: false, unit: 'K' },
  { id: 'mode.fan.enabled', kernelId: 'HOST_SETTINGS_FIELD_MODE_FAN_ENABLED', displayName: '风扇开关',
    min: 0, max: 1, step: 1, requiredCapabilities: ['fanControl'], cyclic: false },
  { id: 'mode.fan.speed', kernelId: 'HOST_SETTINGS_FIELD_MODE_FAN_SPEED', displayName: '风扇转速',
    min: 0, max: 100, step: 5, requiredCapabilities: ['fanControl'], cyclic: false, unit: '%' },

  { id: 'vent.enabled', kernelId: 'HOST_SETTINGS_FIELD_VENT_ENABLED', displayName: '定时通风',
    min: 0, max: 1, step: 1, requiredCapabilities: [], cyclic: false },
  { id: 'vent.startHour', kernelId: 'HOST_SETTINGS_FIELD_VENT_START_HOUR', displayName: '通风开始时刻',
    min: 0, max: 23, step: 1, requiredCapabilities: [], cyclic: true, unit: 'h' },
  { id: 'vent.endHour', kernelId: 'HOST_SETTINGS_FIELD_VENT_END_HOUR', displayName: '通风结束时刻',
    min: 0, max: 23, step: 1, requiredCapabilities: [], cyclic: true, unit: 'h' },
  { id: 'vent.intervalMin', kernelId: 'HOST_SETTINGS_FIELD_VENT_INTERVAL_MIN', displayName: '通风间隔',
    min: 5, max: 240, step: 5, requiredCapabilities: [], cyclic: false, unit: 'min' },
  { id: 'vent.durationMin', kernelId: 'HOST_SETTINGS_FIELD_VENT_DURATION_MIN', displayName: '通风时长',
    min: 1, max: 60, step: 1, requiredCapabilities: [], cyclic: false, unit: 'min' },
  { id: 'vent.fanSpeed', kernelId: 'HOST_SETTINGS_FIELD_VENT_FAN_SPEED', displayName: '通风风速',
    min: 0, max: 100, step: 5, requiredCapabilities: ['fanControl'], cyclic: false, unit: '%' },
  { id: 'vent.targetNode', kernelId: 'HOST_SETTINGS_FIELD_VENT_TARGET_NODE', displayName: '通风目标节点',
    min: 1, max: 8, step: 1, requiredCapabilities: [], cyclic: false },

  { id: 'radar.unattendedDelay', kernelId: 'HOST_SETTINGS_FIELD_RADAR_UNATTENDED_DELAY', displayName: '无人延时',
    min: 0, max: 600, step: 5, requiredCapabilities: [], cyclic: false, unit: 's' },
  { id: 'radar.moveSensitivity', kernelId: 'HOST_SETTINGS_FIELD_RADAR_MOVE_SENSITIVITY', displayName: '移动灵敏度',
    min: 0, max: 10, step: 1, requiredCapabilities: [], cyclic: false },
  { id: 'radar.stillSensitivity', kernelId: 'HOST_SETTINGS_FIELD_RADAR_STILL_SENSITIVITY', displayName: '静止灵敏度',
    min: 0, max: 10, step: 1, requiredCapabilities: [], cyclic: false },
  { id: 'radar.moveGate', kernelId: 'HOST_SETTINGS_FIELD_RADAR_MOVE_GATE', displayName: '移动检测门',
    min: 0, max: 8, step: 1, requiredCapabilities: [], cyclic: false },
  { id: 'radar.stillGate', kernelId: 'HOST_SETTINGS_FIELD_RADAR_STILL_GATE', displayName: '静止检测门',
    min: 0, max: 8, step: 1, requiredCapabilities: [], cyclic: false },
  { id: 'radar.learningDuration', kernelId: 'HOST_SETTINGS_FIELD_RADAR_LEARNING_DURATION', displayName: '学习时长',
    min: 5, max: 60, step: 5, requiredCapabilities: [], cyclic: false, unit: 's' },
];

const FIELD_IDS = POD_SETTING_FIELDS.map((f) => f.id);

export function getPodField(id: string): PodSettingField | undefined {
  return POD_SETTING_FIELDS.find((f) => f.id === id);
}

/** 目标板能力位不足时,该字段在 UI 上不该出现(对应 host_settings_field_is_available) */
export function isFieldAvailable(f: PodSettingField, caps: readonly PodCapability[]): boolean {
  return f.requiredCapabilities.every((c) => caps.includes(c));
}

const setField: ActionSpec = {
  id: 'pod.setField',
  displayName: '设置舱级字段',
  description: '对应 host_settings_pod_set;值超范围由内核返回 ERR_RANGE,UI 侧应先按 min/max 约束',
  params: [
    { name: 'field', type: 'string', required: true, enum: FIELD_IDS },
    { name: 'value', type: 'int', required: true },
  ],
};

const adjustField: ActionSpec = {
  id: 'pod.adjustField',
  displayName: '按步进调整舱级字段',
  description: '对应 host_settings_ui_adjust;delta 以 step 为单位(±1 即一步)',
  params: [
    { name: 'field', type: 'string', required: true, enum: FIELD_IDS },
    { name: 'delta', type: 'int', required: true, min: -1, max: 1 },
  ],
};

const setActiveMode: ActionSpec = {
  id: 'pod.setActiveMode',
  displayName: '切换模式槽位',
  description: '四个稳定槽位(电话/会议/放松/自定义),对应 HOST_SETTINGS_MODE_SLOT_COUNT',
  params: [{ name: 'slot', type: 'int', required: true, min: 0, max: 3 }],
};

/**
 * 传给 `validateUiProjectV2(doc, { actions: POD_ACTIONS })`。
 * 与 BUILTIN_ACTIONS 合并使用;后者只含设备无关的导航与 Subject 操作。
 */
export const POD_ACTIONS: ActionRegistry = {
  'pod.setField': setField,
  'pod.adjustField': adjustField,
  'pod.setActiveMode': setActiveMode,
};
