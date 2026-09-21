import { describe, expect, it } from 'vitest';
import { createEmptyProject, createNode } from '@lvd/schema';
import { compilePreview } from './index.js';

describe('@lvd/preview-compiler', () => {
  it('v1 16bpp 不做有损猜测，必须显式确认 colorFormat', () => {
    const result = compilePreview(createEmptyProject('preview'));
    expect(result.program).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'E_COLOR_FORMAT_CONFIRM_REQUIRED',
    }));
  });

  it('生成稳定、可 JSON 序列化的节点协议与 runtimeName 映射', () => {
    const project = createEmptyProject('preview');
    const label = createNode('label');
    label.props.text = 'Hello';
    project.screens[0]!.root.children.push(label);

    const first = compilePreview(project, { colorFormat: 'RGB565' });
    const second = compilePreview(project, { colorFormat: 'RGB565' });
    expect(first.diagnostics).toEqual([]);
    expect(first.program).toEqual(second.program);
    expect(first.program!.display.colorFormat).toBe('RGB565');
    expect(first.program!.runtimeNameToNodeId.main![`_x${label.id.replace(/-/g, '').slice(0, 8)}`])
      .toBe(label.id);
    expect(() => JSON.stringify(first.program)).not.toThrow();
  });

  it('协议不泄漏 XML 字段、C 模板或 cPatch', () => {
    const project = createEmptyProject('preview');
    const button = createNode('button');
    button.cPatch = { post: 'dangerous_call($obj);' };
    project.screens[0]!.root.children.push(button);

    const result = compilePreview(project, { colorFormat: 'RGB565' });
    expect(result.program).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_CPATCH_FORBIDDEN', nodeId: button.id,
    }));
    const text = JSON.stringify(result);
    expect(text).not.toContain('dangerous_call');
    expect(text).not.toContain('xmlTag');
    expect(text).not.toContain('cCreate');
    expect(text).not.toContain('setter');
  });

  it('拒绝 colorDepth 与 colorFormat 不匹配', () => {
    const project = createEmptyProject('preview');
    const result = compilePreview(project, { colorFormat: 'XRGB8888' });
    expect(result.program).toBeNull();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_COLOR_FORMAT_DEPTH_MISMATCH',
    }));
  });

  it('runtimeColorFormat 只描述预览 framebuffer，不替代目标格式确认', () => {
    const project = createEmptyProject('preview');
    const result = compilePreview(project, { runtimeColorFormat: 'XRGB8888' });
    expect(result.diagnostics).toEqual([]);
    expect(result.program!.display.colorFormat).toBe('XRGB8888');
    expect(compilePreview(project).program).toBeNull();
  });

  it('24/32bpp 有确定性默认映射', () => {
    const project = createEmptyProject('preview');
    project.display.colorDepth = 24;
    expect(compilePreview(project).program!.display.colorFormat).toBe('RGB888');
    project.display.colorDepth = 32;
    expect(compilePreview(project).program!.display.colorFormat).toBe('XRGB8888');
  });

  it('按 registry 顺序固化属性，避免 qrcode 的 data 被后续 size 清空', () => {
    const project = createEmptyProject('preview-qrcode-order');
    const qrcode = createNode('qrcode');
    // 故意按错误顺序写入，模拟 Object.assign/旧工程 JSON。
    qrcode.props.data = 'https://lvgl.io';
    qrcode.props.size = 80;
    project.screens[0]!.root.children.push(qrcode);

    const result = compilePreview(project, { colorFormat: 'RGB565' });
    const props = result.program!.screens[0]!.root.children[0]!.props;
    expect(Object.keys(props)).toEqual(['width', 'height', 'size', 'data']);
  });
});
