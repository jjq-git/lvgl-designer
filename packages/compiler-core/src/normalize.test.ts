import { describe, expect, it } from 'vitest';
import { createEmptyProject, createNode } from '@lvd/schema';
import { normalizeProject } from './index.js';

describe('@lvd/compiler-core', () => {
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
