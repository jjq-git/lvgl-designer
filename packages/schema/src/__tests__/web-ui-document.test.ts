import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../index.js';
import { ALL_WIDGETS } from '../widgets/index.js';
import { migrateV1ToV2 } from '../v2/migrate.js';
import { componentType } from '../v2/components.js';
import type { ProjectSnapshotV2 } from '../v2/projectSnapshot.js';
import type { WidgetNodeV2 } from '../v2/uiProject.js';
import {
  canonicalJson,
  createWebUiDocument,
  createWebUiExport,
  sha256Utf8,
  validateWebUiDocument,
  verifyWebUiAssets,
  WEB_UI_WIDGETS_V1,
  webUiCapabilitiesV1,
  type WebUiDocumentV1,
} from '../v2/webUiDocument.js';

const out = (name: string): string =>
  fileURLToPath(new URL(`../../schema/fixtures/web-ui-v1/${name}`, import.meta.url));

function node(id: string, type: string, props: WidgetNodeV2['props'] = {}): WidgetNodeV2 {
  return { id, type, props, styleRefs: [], styles: [], events: [], bindings: [], children: [] };
}

function snapshot(name: string): ProjectSnapshotV2 {
  const migrated = migrateV1ToV2(createEmptyProject(name));
  migrated.uiProject.meta = {
    ...migrated.uiProject.meta,
    id: `ui:${name}`,
    revision: 7,
    createdAt: '2026-09-11T00:00:00.000Z',
    modifiedAt: '2026-09-11T00:00:00.000Z',
  };
  migrated.uiProject.screens[0]!.id = `screen:${name}:main`;
  migrated.uiProject.screens[0]!.root.id = `node:${name}:root`;
  return {
    kind: 'lvgl-project-snapshot',
    snapshotVersion: 1,
    uiProject: migrated.uiProject,
    displayProfile: migrated.displayProfile,
    controllerProfile: null,
    buildTarget: migrated.buildTargetDraft,
    actionRegistry: {},
    migrationNotes: migrated.notes,
    colorFormatConfirmed: true,
  };
}

function minimalDocument(): WebUiDocumentV1 {
  const input = snapshot('web-minimal');
  input.uiProject.editor = { selected: 'node:label' };
  const label = node('node:label', 'label', { text: 'Hello Web UI' });
  label.editor = { locked: true };
  input.uiProject.screens[0]!.root.children = [label];
  input.actionRegistry['custom.unused'] = { id: 'custom.unused', params: [] };
  return createWebUiDocument(input);
}

function p0Document(): WebUiDocumentV1 {
  const input = snapshot('web-p0');
  const project = input.uiProject;
  project.subjects = [
    { id: 'subject:level', codeName: 'level', type: 'int', initial: 35, min: 0, max: 100 },
    { id: 'subject:title', codeName: 'title', type: 'string', initial: '客厅' },
    { id: 'subject:accent', codeName: 'accent', type: 'color', initial: '#2563EB' },
  ];
  project.styles = [{ id: 'style:card', codeName: 'card', props: { radius: 12, bg_color: '#111827' } }];

  const label = node('node:label', 'label', { text: '客厅' });
  label.bindings.push({ kind: 'prop', prop: 'text', subject: 'subject:title' });

  const button = node('node:button', 'button', { width: 120, height: 48 });
  button.styleRefs.push({ styleId: 'style:card' });
  button.events.push({ on: 'clicked', action: 'screen.open', args: { screen: project.screens[0]!.id } });

  const toggle = node('node:switch', 'switch', { orientation: 'horizontal' });
  toggle.events.push({ on: 'value_changed', action: 'subject.toggle', args: { subject: 'subject:level' } });
  toggle.bindings.push({ kind: 'state', state: 'checked', op: 'gt', subject: 'subject:level', refValue: 0 });

  const slider = node('node:slider', 'slider', { min_value: 0, max_value: 100, value: 35 });
  slider.events.push({
    on: 'value_changed', action: 'subject.set', args: { subject: 'subject:level', value: '50' },
  });
  slider.bindings.push({ kind: 'prop', prop: 'value', subject: 'subject:level' });

  const arc = node('node:arc', 'arc', { min_value: 0, max_value: 100, value: 35 });
  arc.events.push({
    on: 'clicked', action: 'subject.increment',
    args: { subject: 'subject:level', step: 5, min: 0, max: 100, rollover: false },
  });

  const bar = node('node:bar', 'bar', { min_value: 0, max_value: 100, value: 35 });
  bar.styles.push({ props: { bg_color: { $token: 'color.accent' } } });
  bar.bindings.push({ kind: 'prop', prop: 'value', subject: 'subject:level' });

  project.themes[0]!.tokens.push({ id: 'color.accent', type: 'color', value: '#2563EB' });
  project.screens[0]!.root.props = { width: '100%', height: '100%', flex_flow: 'column' };
  project.screens[0]!.root.children = [label, button, toggle, slider, arc, bar];
  return createWebUiDocument(input);
}

describe('WebUiDocumentV1 冻结契约', () => {
  it('从 ProjectSnapshotV2 裁剪私有字段、未引用 Action，并生成稳定摘要', async () => {
    const document = minimalDocument();
    expect(validateWebUiDocument(document).errors).toEqual([]);
    expect(canonicalJson(document)).not.toContain('editor');
    expect(document.actionRegistry).toEqual({});

    const first = await createWebUiExport({
      ...snapshot('web-minimal'),
      uiProject: document.uiProject,
    });
    const second = await createWebUiExport({
      ...snapshot('web-minimal'),
      uiProject: document.uiProject,
    });
    expect(second.json).toBe(first.json);
    expect(second.sha256).toBe(first.sha256);
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('将 Designer list 复合节点确定性降级为 Web V1 基础控件', () => {
    const input = snapshot('web-list');
    const list = node('node:list', 'list', { width: 200, height: 200 });
    const text = node('node:list-text', 'list-text', { text: '分组标题' });
    const button = node('node:list-button', 'list-button', { text: '设备详情' });
    button.events.push({ on: 'clicked', action: 'screen.open', args: { screen: input.uiProject.screens[0]!.id } });
    list.children = [text, button];
    input.uiProject.screens[0]!.root.children = [list];

    const document = createWebUiDocument(input);
    const exportedList = document.uiProject.screens[0]!.root.children[0]!;
    expect(exportedList.type).toBe('obj');
    expect(exportedList.props.flex_flow).toBe('column');
    expect(exportedList.children[0]!.type).toBe('label');
    expect(exportedList.children[1]!.type).toBe('button');
    expect(exportedList.children[1]!.props).not.toHaveProperty('text');
    expect(exportedList.children[1]!.children).toEqual([
      expect.objectContaining({
        id: 'node:list-button::web-label',
        type: 'label',
        props: { text: '设备详情' },
      }),
    ]);
    expect(document.actionRegistry).toHaveProperty('screen.open');
    expect(validateWebUiDocument(document).errors).toEqual([]);
    expect(canonicalJson(document)).not.toMatch(/"type":"list(?:-text|-button)?"/);
  });

  it('发布前展开关联组件，不把设计器私有定义泄漏给运行端', () => {
    const input = snapshot('web-component');
    input.uiProject.components.push({
      id: 'cmp-card', codeName: 'card', api: [], styles: [], consts: [],
      root: node('component-root', 'button', { width: 100, height: 40 }),
    });
    input.uiProject.screens[0]!.root.children.push({
      ...node('component-instance', componentType('cmp-card'), { x: 12, y: 18 }),
      codeName: 'card_1',
    });

    const document = createWebUiDocument(input);
    expect(document.uiProject.components).toEqual([]);
    expect(document.uiProject.screens[0]!.root.children[0]).toMatchObject({
      id: 'component-instance', type: 'button', codeName: 'card_1',
      props: { x: 12, y: 18, width: 100, height: 40 },
    });
    expect(validateWebUiDocument(document).errors).toEqual([]);
  });

  it('兼容导出 buttonmatrix 和 spinbox 的完整属性契约', () => {
    const input = snapshot('web-input-extensions');
    const matrix = node('node:matrix', 'buttonmatrix', {
      width: 200,
      height: 150,
      map: ['Btn1', 'Btn2', 'Btn3', '\n', 'Btn4', 'Btn5'],
      ctrl_map: ['checkable', 'disabled'],
      selected_button: 1,
      one_checked: true,
    });
    const spinbox = node('node:spinbox', 'spinbox', {
      width: 100,
      height: 40,
      value: 12,
      rollover: true,
      digit_count: 5,
      dec_point_pos: 2,
      min_value: -100,
      max_value: 100,
      step: 5,
    });
    const spinner = node('node:spinner', 'spinner', {
      width: 80,
      height: 80,
      anim_duration: 1000,
      angle: 270,
    });
    const led = node('node:led', 'led', {
      width: 40,
      height: 40,
      color: '#ff0000',
      brightness: 255,
    });
    spinbox.bindings.push({ kind: 'prop', prop: 'value', subject: 'subject:value' });
    input.uiProject.subjects.push({
      id: 'subject:value', codeName: 'value', type: 'int', initial: 12, min: -100, max: 100,
    });
    input.uiProject.screens[0]!.root.children = [matrix, spinbox, spinner, led];

    const document = createWebUiDocument(input);
    expect(validateWebUiDocument(document).errors).toEqual([]);
    expect(document.uiProject.screens[0]!.root.children).toEqual([
      expect.objectContaining({ type: 'buttonmatrix', props: matrix.props }),
      expect.objectContaining({ type: 'spinbox', props: spinbox.props, bindings: spinbox.bindings }),
      expect.objectContaining({ type: 'spinner', props: spinner.props }),
      expect.objectContaining({ type: 'led', props: led.props }),
    ]);
    expect(webUiCapabilitiesV1().widgets).toEqual(expect.objectContaining({
      buttonmatrix: expect.objectContaining({ props: expect.arrayContaining(['map', 'ctrl_map']) }),
      spinbox: expect.objectContaining({ props: expect.arrayContaining(['value', 'step']) }),
      spinner: expect.objectContaining({ props: expect.arrayContaining(['anim_duration', 'angle']) }),
      led: expect.objectContaining({ props: expect.arrayContaining(['color', 'brightness']) }),
    }));
  });

  it('最小和 P0 golden fixtures 与当前导出器逐字一致', async () => {
    const minimal = minimalDocument();
    const p0 = p0Document();
    const resourceSnapshot = snapshot('web-resource-golden');
    const resourceSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path fill="#2563eb" d="M0 0h8v8H0z"/></svg>';
    const resourceSha256 = await sha256Utf8(resourceSvg);
    resourceSnapshot.uiProject.assets.icons.push({
      id: 'icon:logo', codeName: 'logo',
      file: {
        fileName: 'logo.svg', sha256: resourceSha256,
        byteSize: new TextEncoder().encode(resourceSvg).byteLength,
      },
    });
    resourceSnapshot.uiProject.screens[0]!.root.styles.push({ props: { bg_image_src: 'icon:logo' } });
    const resource = createWebUiDocument(resourceSnapshot);
    expect(validateWebUiDocument(p0).errors).toEqual([]);
    expect(validateWebUiDocument(resource).errors).toEqual([]);

    await expect(`${JSON.stringify(minimal, null, 2)}\n`).toMatchFileSnapshot(out('minimal.json'));
    await expect(`${JSON.stringify(p0, null, 2)}\n`).toMatchFileSnapshot(out('p0-widgets.json'));
    await expect(`${JSON.stringify(resource, null, 2)}\n`).toMatchFileSnapshot(out('resource-icon.json'));
    await expect(resourceSvg).toMatchFileSnapshot(out('assets/logo.svg'));
    await expect(`${JSON.stringify({
      algorithm: 'sha256',
      canonicalization: 'UTF-8; object keys sorted by ECMAScript UTF-16 code units; array order preserved; no whitespace; no trailing newline',
      files: {
        'minimal.json': await sha256Utf8(canonicalJson(minimal)),
        'p0-widgets.json': await sha256Utf8(canonicalJson(p0)),
        'resource-icon.json': await sha256Utf8(canonicalJson(resource)),
      },
    }, null, 2)}\n`).toMatchFileSnapshot(out('golden-manifest.json'));
    await expect(`${JSON.stringify(webUiCapabilitiesV1(), null, 2)}\n`)
      .toMatchFileSnapshot(out('capabilities.v1.json'));
  });

  it('Web UI 导出能力与完整 Widget Registry 保持同步', () => {
    const lowered = new Set(['list', 'list-text', 'list-button']);
    const expected = [
      ...ALL_WIDGETS.map((widget) => widget.type),
      ...ALL_WIDGETS.flatMap((widget) => (widget.children ?? []).map((child) => child.type)),
    ]
      .filter((type, index, all) => !lowered.has(type) && all.indexOf(type) === index)
      .sort();

    expect(WEB_UI_WIDGETS_V1).toEqual(expected);
    expect(WEB_UI_WIDGETS_V1).toEqual(expect.arrayContaining([
      'spinner', 'led', 'dropdown-list', 'chart-series', 'table-cell', 'tileview-tile',
    ]));
  });

  it('invalid fixtures 固定 editor 泄漏、未知 Widget 和缺 Action 的诊断', async () => {
    const editorLeak = structuredClone(minimalDocument()) as WebUiDocumentV1 & { uiProject: { editor?: unknown } };
    editorLeak.uiProject.editor = { selected: 'node:label' };
    const unsupported = structuredClone(minimalDocument());
    unsupported.uiProject.screens[0]!.root.children[0]!.type = 'unknown-widget';
    const missingAction = structuredClone(p0Document());
    delete missingAction.actionRegistry['screen.open'];

    expect(validateWebUiDocument(editorLeak).errors.map((issue) => issue.code)).toContain('schema_invalid');
    expect(validateWebUiDocument(unsupported).errors.map((issue) => issue.code)).toContain('unsupported_widget');
    expect(validateWebUiDocument(missingAction).errors.map((issue) => issue.code)).toContain('action_missing');

    await expect(`${JSON.stringify(editorLeak, null, 2)}\n`).toMatchFileSnapshot(out('invalid/editor-leak.json'));
    await expect(`${JSON.stringify(unsupported, null, 2)}\n`).toMatchFileSnapshot(out('invalid/unsupported-widget.json'));
    await expect(`${JSON.stringify(missingAction, null, 2)}\n`).toMatchFileSnapshot(out('invalid/missing-action.json'));
  });

  it('资源 blob 必须按 byteSize 和 SHA-256 验证，文档不携带 URL 或后端主键', async () => {
    const input = snapshot('web-resource');
    input.uiProject.assets.images.push({
      id: 'image:logo', codeName: 'logo',
      file: { fileName: 'logo.png', sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', byteSize: 3 },
    });
    const document = createWebUiDocument(input);
    expect(document.assetManifest[0]).toEqual({
      assetId: 'image:logo', kind: 'image', fileName: 'logo.png', mediaType: 'image/png',
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', byteSize: 3,
    });
    expect(JSON.stringify(document.assetManifest)).not.toMatch(/url|fileUuid|path/i);
    expect((await verifyWebUiAssets(document, () => new TextEncoder().encode('abc'))).valid).toBe(true);
    expect((await verifyWebUiAssets(document, () => null)).errors[0]?.code).toBe('asset_blob_missing');
  });

  it('仓库内 fixtures 可被消费者直接读取并按同一 Validator 验证', () => {
    for (const file of ['minimal.json', 'p0-widgets.json', 'resource-icon.json']) {
      const fixture = JSON.parse(readFileSync(out(file), 'utf8')) as unknown;
      expect(validateWebUiDocument(fixture).errors).toEqual([]);
    }
  });
});
