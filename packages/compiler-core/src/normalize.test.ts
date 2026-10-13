import { describe, expect, it } from 'vitest';
import { createEmptyProject, createNode } from '@lvd/schema';
import { normalizeProject } from './index.js';

describe('@lvd/compiler-core', () => {
  it.each(['switch', 'checkbox'])('修复 %s checked 双向绑定后的重复切换，且不修改源项目', (type) => {
    const project = createEmptyProject('checked-binding');
    project.subjects.push({ name: 'power', type: 'int', initial: 1 }, { name: 'other', type: 'int', initial: 0 });
    const toggle = createNode(type);
    toggle.bindings.push({ kind: 'prop', prop: 'checked', subject: 'power' });
    toggle.events.push(
      { kind: 'subject_toggle', trigger: 'value_changed', subject: 'power' },
      { kind: 'subject_toggle', trigger: 'clicked', subject: 'power' },
      { kind: 'subject_toggle', trigger: 'value_changed', subject: 'other' },
    );
    project.screens[0]!.root.children.push(toggle);
    const result = normalizeProject(project);
    expect(result.ir.screens[0]!.root.children[0]!.events).toEqual(toggle.events.slice(1));
    expect(result.ir.screens[0]!.root.children[0]!.bindings).toHaveLength(1);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'W_REDUNDANT_CHECKED_TOGGLE', severity: 'warning' }));
    expect(toggle.events).toHaveLength(3);
  });

  it('保留未绑定或单向 state 绑定开关的切换事件', () => {
    const project = createEmptyProject('one-way-checked');
    project.subjects.push({ name: 'power', type: 'int', initial: 0 });
    for (const bound of [false, true]) {
      const toggle = createNode('switch');
      if (bound) toggle.bindings.push({ kind: 'state', state: 'checked', op: 'eq', subject: 'power', refValue: 1 });
      toggle.events.push({ kind: 'subject_toggle', trigger: 'value_changed', subject: 'power' });
      project.screens[0]!.root.children.push(toggle);
    }
    const result = normalizeProject(project);
    expect(result.diagnostics).toEqual([]);
    for (const node of result.ir.screens[0]!.root.children) expect(node.events).toHaveLength(1);
  });

  it('只依赖 Schema/Registry 即可生成稳定 IR', () => {
    const project = createEmptyProject('core-smoke');
    const first = normalizeProject(project);
    const second = normalizeProject(project);

    expect(first.diagnostics).toEqual([]);
    expect(first.ir).toEqual(second.ir);
    expect(first.ir.name).toBe('core-smoke');
    expect(first.ir.screens).toHaveLength(1);
  });

  it('保留 LVGL 9.5 命名样式绑定并解析 style 名称', () => {
    const project = createEmptyProject('style-binding');
    project.subjects.push({ name: 'theme', type: 'int', initial: 0 });
    project.styles.push({ id: 'style-theme', name: 'theme_dark', props: { bg_color: '#101010' } });
    const button = createNode('button');
    button.bindings.push({
      kind: 'style', styleRef: 'theme_dark', selector: { states: ['pressed'] },
      subject: 'theme', refValue: 1,
    });
    project.screens[0]!.root.children.push(button);

    const result = normalizeProject(project);
    expect(result.diagnostics).toEqual([]);
    expect(result.ir.screens[0]!.root.children[0]!.bindings).toEqual([{
      kind: 'style', styleName: 'theme_dark', selector: { states: ['pressed'] },
      subject: 'theme', refValue: 1,
    }]);
  });

  it('拒绝必然无效的数据源类型和 image src 绑定', () => {
    const project = createEmptyProject('bad-binding');
    project.subjects.push({ name: 'text_value', type: 'string', initial: '1' });
    const slider = createNode('slider');
    slider.bindings.push({ kind: 'prop', prop: 'value', subject: 'text_value' });
    const image = createNode('image');
    image.bindings.push({ kind: 'prop', prop: 'src', subject: 'text_value' });
    project.screens[0]!.root.children.push(slider, image);

    const codes = normalizeProject(project).diagnostics.map((entry) => entry.code);
    expect(codes).toContain('E_BINDING_SUBJECT_TYPE');
    expect(codes).toContain('E_UNBINDABLE_PROP');
  });
});
