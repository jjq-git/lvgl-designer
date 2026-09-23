import { describe, expect, it } from 'vitest';
import {
  ALL_WIDGETS,
  CHILD_INTERACTIONS,
  TRIGGER_TOKENS,
  WIDGET_INTERACTIONS,
} from '../index.js';

describe('组件交互能力矩阵', () => {
  it('35 个组件逐一声明能力，不允许新增组件时静默套用通用交互', () => {
    expect(Object.keys(WIDGET_INTERACTIONS).sort()).toEqual(
      ALL_WIDGETS.map((widget) => widget.type).sort(),
    );
  });

  it('所有对象型结构子元素逐一声明能力，非对象句柄不暴露事件', () => {
    const objectChildren = ALL_WIDGETS
      .flatMap((widget) => widget.children ?? [])
      .filter((child) => child.isObj)
      .map((child) => child.type)
      .sort();
    expect(Object.keys(CHILD_INTERACTIONS).sort()).toEqual(objectChildren);
  });

  it('矩阵中的事件全部属于 LVGL 9.5 支持的 trigger token', () => {
    const known = new Set<string>(TRIGGER_TOKENS);
    for (const [type, interaction] of Object.entries({
      ...WIDGET_INTERACTIONS,
      ...CHILD_INTERACTIONS,
    })) {
      for (const event of interaction.events) {
        expect(known.has(event), `${type}.${event}`).toBe(true);
      }
    }
  });

  it('关键组件按自身语义区分，而不是共用一份交互菜单', () => {
    expect(WIDGET_INTERACTIONS['button']?.events[0]).toBe('clicked');
    expect(WIDGET_INTERACTIONS['slider']?.events[0]).toBe('value_changed');
    expect(WIDGET_INTERACTIONS['textarea']?.events).toContain('insert');
    expect(WIDGET_INTERACTIONS['keyboard']?.events).toContain('cancel');
    expect(WIDGET_INTERACTIONS['chart']?.events).toContain('value_changed');
    expect(WIDGET_INTERACTIONS['menu']?.events).toEqual(['value_changed']);
    expect(WIDGET_INTERACTIONS['tileview']?.events).toContain('scroll_end');
    expect(WIDGET_INTERACTIONS['label']?.events).toEqual([]);
    expect(WIDGET_INTERACTIONS['spinner']?.events).toEqual([]);
    expect(WIDGET_INTERACTIONS['msgbox']?.events).toEqual([]);
    expect(CHILD_INTERACTIONS['msgbox-button']?.events[0]).toBe('clicked');
  });
});
