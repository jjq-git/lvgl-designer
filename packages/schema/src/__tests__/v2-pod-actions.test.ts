/**
 * 舱级 Action 白名单测试。
 *
 * 这份白名单是从**反推重建**的 sim_kernel 转写来的(原厂 host_settings_core 不可达),
 * 所以测试的重点有两个:
 *   1. 数值与 sim_kernel/src/host_settings.c 的 k_catalog[] 逐条一致 —— 转写不能抄错;
 *   2. 「临时、待校准」这个状态是**可编程发现**的,不能只写在注释里,
 *      否则将来发布流水线不知道该给产物打未校准标记。
 */
import { describe, expect, it } from 'vitest';
import {
  POD_ACTIONS, POD_ACTIONS_PROVISIONAL, POD_SETTING_FIELDS,
  getPodField, isFieldAvailable,
} from '../v2/actions/podSettings.js';
import { BUILTIN_ACTIONS, type UiProject, type WidgetNodeV2 } from '../v2/uiProject.js';
import { validateUiProjectV2 } from '../v2/validate.js';

describe('字段目录 ↔ sim_kernel k_catalog[]', () => {
  it('19 个字段,顺序与 host_settings.c:13-36 一致', () => {
    expect(POD_SETTING_FIELDS).toHaveLength(19);
    expect(POD_SETTING_FIELDS.map((f) => f.id)).toEqual([
      'mode.active',
      'mode.light.enabled', 'mode.light.brightness', 'mode.light.cct',
      'mode.fan.enabled', 'mode.fan.speed',
      'vent.enabled', 'vent.startHour', 'vent.endHour', 'vent.intervalMin',
      'vent.durationMin', 'vent.fanSpeed', 'vent.targetNode',
      'radar.unattendedDelay', 'radar.moveSensitivity', 'radar.stillSensitivity',
      'radar.moveGate', 'radar.stillGate', 'radar.learningDuration',
    ]);
  });

  it('抽样核对 min/max/step —— 转写错一个数,真机行为就不对', () => {
    expect(getPodField('mode.light.brightness')).toMatchObject({ min: 0, max: 100, step: 5 });
    expect(getPodField('mode.light.cct')).toMatchObject({ min: 2700, max: 6500, step: 100 });
    expect(getPodField('vent.intervalMin')).toMatchObject({ min: 5, max: 240, step: 5 });
    expect(getPodField('vent.targetNode')).toMatchObject({ min: 1, max: 8, step: 1 });
    expect(getPodField('radar.unattendedDelay')).toMatchObject({ min: 0, max: 600, step: 5 });
    expect(getPodField('radar.learningDuration')).toMatchObject({ min: 5, max: 60, step: 5 });
  });

  it('能力位:三个风扇相关字段需要 fanControl,其余无要求', () => {
    const needFan = POD_SETTING_FIELDS.filter((f) => f.requiredCapabilities.includes('fanControl'));
    expect(needFan.map((f) => f.id)).toEqual(['mode.fan.enabled', 'mode.fan.speed', 'vent.fanSpeed']);
  });

  it('只有两个通风时刻字段回绕(cyclic)', () => {
    expect(POD_SETTING_FIELDS.filter((f) => f.cyclic).map((f) => f.id))
      .toEqual(['vent.startHour', 'vent.endHour']);
  });

  it('isFieldAvailable 按能力位过滤 —— 0050 无本机风扇时不该显示风扇字段', () => {
    const fan = getPodField('mode.fan.speed')!;
    const light = getPodField('mode.light.brightness')!;
    expect(isFieldAvailable(fan, [])).toBe(false);
    expect(isFieldAvailable(fan, ['fanControl'])).toBe(true);
    expect(isFieldAvailable(light, [])).toBe(true);
  });

  it('语义 ID 与 C 枚举名分离 —— UI Schema 不引用 C 符号(§4.6)', () => {
    for (const f of POD_SETTING_FIELDS) {
      expect(f.id).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/);
      expect(f.kernelId).toMatch(/^HOST_SETTINGS_FIELD_[A-Z_]+$/);
      expect(f.id).not.toContain('HOST_SETTINGS');
    }
  });
});

describe('未校准状态可编程发现', () => {
  it('POD_ACTIONS_PROVISIONAL 为 true —— 发布流水线据此打标,而不是靠人读注释', () => {
    expect(POD_ACTIONS_PROVISIONAL).toBe(true);
  });
});

describe('Action 契约照抄内核形态,不发明动作', () => {
  it('三个 Action:setField / adjustField / setActiveMode', () => {
    expect(Object.keys(POD_ACTIONS).sort())
      .toEqual(['pod.adjustField', 'pod.setActiveMode', 'pod.setField']);
  });

  it('field 参数被约束到字段白名单', () => {
    expect(POD_ACTIONS['pod.setField']!.params[0]!.enum).toEqual(POD_SETTING_FIELDS.map((f) => f.id));
  });

  it('adjustField 的 delta 限制在 ±1 步 —— 对应 host_settings_ui_adjust 的语义', () => {
    const delta = POD_ACTIONS['pod.adjustField']!.params[1]!;
    expect(delta).toMatchObject({ min: -1, max: 1 });
  });
});

/* --------------------------------------------------- 与校验器的集成 */

function node(over: Partial<WidgetNodeV2> = {}): WidgetNodeV2 {
  return {
    id: 'n-root', type: 'obj', props: {},
    styleRefs: [], styles: [], events: [], bindings: [], children: [], ...over,
  };
}

function project(events: WidgetNodeV2['events']): UiProject {
  return {
    schemaVersion: 2, kind: 'lvgl-ui-project',
    meta: {
      id: 'ui:demo', revision: 1, name: 'demo', appVersion: '0.1.0',
      createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
    },
    designDisplayRef: 'display:240x240-rgb565@1',
    themes: [{ id: 'default', tokens: [] }],
    subjects: [],
    screens: [{ id: 'sc-home', codeName: 'home', isHome: true, styles: [], consts: [], root: node({ events }) }],
    components: [], styles: [], consts: [],
    assets: { fonts: [], images: [], icons: [] },
    translations: null,
  };
}

const actions = { ...BUILTIN_ACTIONS, ...POD_ACTIONS };
const check = (events: WidgetNodeV2['events']): string[] =>
  validateUiProjectV2(project(events), { actions }).errors.map((e) => e.code);

describe('校验器集成', () => {
  it('合法调用通过', () => {
    expect(check([
      { on: 'value_changed', action: 'pod.setField', args: { field: 'mode.light.brightness', value: 60 } },
      { on: 'clicked', action: 'pod.adjustField', args: { field: 'mode.fan.speed', delta: 1 } },
      { on: 'clicked', action: 'pod.setActiveMode', args: { slot: 2 } },
    ])).toEqual([]);
  });

  it('字段名不在白名单 → 拒绝(而不是静默透传到固件)', () => {
    expect(check([
      { on: 'clicked', action: 'pod.setField', args: { field: 'mode.light.rgb', value: 1 } },
    ])).toContain('action-arg-not-in-enum');
  });

  it('数值参数越界 → 拒绝', () => {
    const c = check([
      { on: 'clicked', action: 'pod.setActiveMode', args: { slot: 7 } },
      { on: 'clicked', action: 'pod.adjustField', args: { field: 'mode.fan.speed', delta: 5 } },
    ]);
    expect(c.filter((x) => x === 'action-arg-out-of-range')).toHaveLength(2);
  });

  it('缺必填参数 → 拒绝', () => {
    expect(check([{ on: 'clicked', action: 'pod.setField', args: { value: 1 } }]))
      .toContain('missing-action-arg');
  });

  it('不注入 POD_ACTIONS 时,pod.* 是未知 Action —— 白名单必须显式启用', () => {
    const r = validateUiProjectV2(
      project([{ on: 'clicked', action: 'pod.setActiveMode', args: { slot: 0 } }]),
      { actions: BUILTIN_ACTIONS },
    );
    expect(r.errors.map((e) => e.code)).toContain('unknown-action');
  });
});
