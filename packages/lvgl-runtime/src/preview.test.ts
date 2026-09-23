import { describe, expect, it } from 'vitest';
import { compilePreview, type PreviewProgram } from '@lvd/preview-compiler';
import { createEmptyProject, createNode, type WidgetNode } from '@lvd/schema';
import {
  executePreviewProgram, validatePreviewProgramSupport, type PreviewBridge,
} from './preview.js';

function program(): PreviewProgram {
  const project = createEmptyProject('driver');
  project.display.colorDepth = 32;
  const panel = createNode('obj');
  panel.name = 'panel';
  panel.props.width = 180;
  panel.props.height = 80;
  const label = createNode('label');
  label.name = 'title';
  label.props.text = 'Hello';
  panel.children.push(label);
  project.screens[0]!.root.children.push(panel);
  return compilePreview(project).program!;
}

function fakeBridge(calls: string[]): PreviewBridge {
  return {
    begin: (v, w, h, f) => (calls.push(`begin:${v}:${w}x${h}:${f}`), 0),
    createSubjectI32: (name, initial, min, hasMin, max, hasMax) =>
      (calls.push(`subject-i32:${name}:${initial}:${min}:${hasMin}:${max}:${hasMax}`), 0),
    createSubjectFloat: (name, initial, min, hasMin, max, hasMax) =>
      (calls.push(`subject-float:${name}:${initial}:${min}:${hasMin}:${max}:${hasMax}`), 0),
    createSubjectString: (name, initial, capacity) =>
      (calls.push(`subject-string:${name}:${initial}:${capacity}`), 0),
    createSubjectColor: (name, initial) => (calls.push(`subject-color:${name}:${initial}`), 0),
    createStyle: (name) => (calls.push(`create-style:${name}`), 0),
    setNamedStyleI32: (name, key, value) =>
      (calls.push(`named-style-i32:${name}:${key}:${value}`), 0),
    setNamedStyleString: (name, key, value) =>
      (calls.push(`named-style-str:${name}:${key}:${value}`), 0),
    createScreen: (name) => (calls.push(`screen:${name}`), 0),
    createNode: (parent, name, type) => (calls.push(`node:${parent}:${name}:${type}`), 0),
    createStructural: (parent, name, type, arg) =>
      (calls.push(`struct:${parent}:${name}:${type}:${arg}`), 0),
    createListItem: (parent, name, type, icon, text) =>
      (calls.push(`list-item:${parent}:${name}:${type}:${icon}:${text}`), 0),
    setTableColumn: (parent, column, width) =>
      (calls.push(`table-column:${parent}:${column}:${width}`), 0),
    setTableCellValue: (parent, row, column, value) =>
      (calls.push(`table-cell-value:${parent}:${row}:${column}:${value}`), 0),
    setTableCellCtrl: (parent, row, column, ctrl) =>
      (calls.push(`table-cell-ctrl:${parent}:${row}:${column}:${ctrl}`), 0),
    setI32: (name, key, value) => (calls.push(`i32:${name}:${key}:${value}`), 0),
    setString: (name, key, value) => (calls.push(`str:${name}:${key}:${value}`), 0),
    setPointList: (name, key, value) => (calls.push(`points:${name}:${key}:${value}`), 0),
    setStringList: (name, key, value) => (calls.push(`strings:${name}:${key}:${value}`), 0),
    setI32List: (name, key, value) => (calls.push(`i32s:${name}:${key}:${value}`), 0),
    setChartAxis: (parent, axis, key, value) =>
      (calls.push(`chart-axis:${parent}:${axis}:${key}:${value}`), 0),
    setFlag: (name, flag, value) => (calls.push(`flag:${name}:${flag}:${value}`), 0),
    setState: (name, state, value) => (calls.push(`state:${name}:${state}:${value}`), 0),
    setStyleI32: (name, key, value, part, states) =>
      (calls.push(`style-i32:${name}:${key}:${value}:${part}:${states}`), 0),
    setStyleString: (name, key, value, part, states) =>
      (calls.push(`style-str:${name}:${key}:${value}:${part}:${states}`), 0),
    addStyle: (name, styleName, part, states) =>
      (calls.push(`add-style:${name}:${styleName}:${part}:${states}`), 0),
    bindProp: (name, prop, subject, format) =>
      (calls.push(`bind-prop:${name}:${prop}:${subject}:${format}`), 0),
    bindFlag: (name, flag, op, subject, refValue) =>
      (calls.push(`bind-flag:${name}:${flag}:${op}:${subject}:${refValue}`), 0),
    bindState: (name, state, op, subject, refValue) =>
      (calls.push(`bind-state:${name}:${state}:${op}:${subject}:${refValue}`), 0),
    bindStyle: (name, styleName, part, states, subject, refValue) =>
      (calls.push(`bind-style:${name}:${styleName}:${part}:${states}:${subject}:${refValue}`), 0),
    addCallbackEvent: (name, trigger, callback, userData, hasUserData) =>
      (calls.push(`event-callback:${name}:${trigger}:${callback}:${userData}:${hasUserData}`), 0),
    addSubjectSetEvent: (name, trigger, subject, type, value) =>
      (calls.push(`event-set:${name}:${trigger}:${subject}:${type}:${value}`), 0),
    addSubjectToggleEvent: (name, trigger, subject) =>
      (calls.push(`event-toggle:${name}:${trigger}:${subject}`), 0),
    addSubjectIncrementEvent: (
      name, trigger, subject, step, min, hasMin, max, hasMax, rollover, hasRollover,
    ) => (calls.push(
      `event-inc:${name}:${trigger}:${subject}:${step}:${min}:${hasMin}:${max}:${hasMax}:${rollover}:${hasRollover}`,
    ), 0),
    addScreenEvent: (name, trigger, action, screen, anim, duration, delay) =>
      (calls.push(`event-screen:${name}:${trigger}:${action}:${screen}:${anim}:${duration}:${delay}`), 0),
    finish: (home) => (calls.push(`finish:${home}`), 0),
  };
}

describe('PreviewProgram runtime executor', () => {
  it('preflight 通过后按父先子后顺序调用受控 bridge', () => {
    const p = program();
    const calls: string[] = [];
    expect(validatePreviewProgramSupport(p)).toEqual([]);
    executePreviewProgram(p, fakeBridge(calls));

    expect(calls[0]).toBe('begin:1:240x240:XRGB8888');
    expect(calls).toContain('screen:main');
    expect(calls).toContain('node:main:panel:obj');
    expect(calls).toContain('i32:panel:width:180');
    expect(calls).toContain('node:panel:title:label');
    expect(calls).toContain('str:title:text:Hello');
    expect(calls.at(-1)).toBe('finish:main');
  });

  it('通用 align 属性通过现有 style bridge 预览并校验枚举', () => {
    const p = program();
    const label = p.screens[0]!.root.children[0]!.children[0]!;
    label.props.align = 'top_mid';
    const calls: string[] = [];
    expect(validatePreviewProgramSupport(p)).toEqual([]);
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toContain('style-str:title:align:top_mid:main:');

    label.props.align = 'not-an-align';
    expect(validatePreviewProgramSupport(p).map((entry) => entry.code))
      .toContain('E_PREVIEW_PROP_ENUM_INVALID');
  });

  it('一期常用 inline style 保留 selector 并走受控 bridge', () => {
    const p = program();
    p.screens[0]!.root.inlineStyles.push({
      selector: { part: 'main', states: ['pressed'] },
      props: { bg_color: '#112233', radius: 8, bg_opa: '50%' },
    });
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toContain('style-str:main:bg_color:#112233:main:pressed');
    expect(calls).toContain('style-i32:main:radius:8:main:pressed');
    expect(calls).toContain('style-str:main:bg_opa:50%:main:pressed');
  });

  it('命名 style 保持独立生命周期并以 selector 挂载', () => {
    const p = program();
    p.globals.styles.push({
      name: 'card',
      props: { bg_color: '#223344', radius: 12, bg_opa: '80%' },
    });
    p.screens[0]!.root.styleUses.push({
      styleName: 'card', selector: { part: 'main', states: ['pressed'] },
    });
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toContain('create-style:card');
    expect(calls).toContain('named-style-str:card:bg_color:#223344');
    expect(calls).toContain('named-style-i32:card:radius:12');
    expect(calls).toContain('named-style-str:card:bg_opa:80%');
    expect(calls).toContain('add-style:main:card:main:pressed');
    expect(calls.indexOf('create-style:card')).toBeLessThan(calls.indexOf('screen:main'));
  });

  it('命名 style 可由 int 数据源按目标值动态启用', () => {
    const p = program();
    p.globals.styles.push({ name: 'alarm', props: { bg_color: '#ff0000' } });
    p.globals.subjects.push({ name: 'alarm_on', type: 'int', initial: 0 });
    p.screens[0]!.root.children[0]!.bindings.push({
      kind: 'style', styleName: 'alarm', selector: { states: ['pressed'] },
      subject: 'alarm_on', refValue: 1,
    });
    const calls: string[] = [];
    expect(validatePreviewProgramSupport(p)).toEqual([]);
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toContain('bind-style:panel:alarm:main:pressed:alarm_on:1');

    p.globals.subjects[0] = { name: 'alarm_on', type: 'string', initial: 'no' };
    expect(validatePreviewProgramSupport(p).map((entry) => entry.code))
      .toContain('E_PREVIEW_BINDING_UNSUPPORTED');
  });

  it('执行 tabview/list add/getter 与 table virtual 结构子元素', () => {
    const makeChild = (
      id: string, type: string, props: Record<string, string | number>, children: WidgetNode[] = [],
    ): WidgetNode => ({
      id, type, props, styles: [], inlineStyles: [], events: [], bindings: [], children,
    });
    const project = createEmptyProject('structural');
    project.display.colorDepth = 32;

    const table = createNode('table');
    table.name = 'tbl';
    table.props.column_count = 2;
    table.props.row_count = 2;
    table.children.push(
      makeChild('column-0', 'table-column', { column: 0, width: 60 }),
      makeChild('cell-0-0', 'table-cell', { row: 0, column: 0, value: 'Name' }),
      makeChild('cell-0-1', 'table-cell', {
        row: 0, column: 1, value: 'Qty', ctrl: 'merge_right|text_crop',
      }),
    );

    const tabLabel = createNode('label');
    tabLabel.name = 'inside_tab';
    tabLabel.props.text = 'Hello tab';
    const tab = makeChild('tab-home', 'tabview-tab', { text: 'Home' }, [tabLabel]);
    tab.name = 'home_tab';
    const tabBar = makeChild('tab-bar', 'tabview-tab_bar', {});
    tabBar.inlineStyles.push({ props: { bg_color: '#202030' } });
    const tabButton = makeChild('tab-button', 'tabview-tab_button', { index: 0 });
    const tabview = createNode('tabview');
    tabview.name = 'tabs';
    tabview.props.active = 1;
    tabview.props.tab_bar_position = 'bottom';
    tabview.children.push(tab, tabBar, tabButton);

    const list = createNode('list');
    list.name = 'menu_list';
    const listText = makeChild('list-title', 'list-text', { text: 'Settings' });
    listText.name = 'list_title';
    const listButton = makeChild('list-wifi', 'list-button', { icon: 'wifi_icon', text: 'Wi-Fi' });
    listButton.name = 'list_wifi';
    list.children.push(listText, listButton);

    const imagebutton = createNode('imagebutton');
    imagebutton.name = 'image_action';
    imagebutton.props.src_released_left = 'button_released';
    imagebutton.props.src_pressed_left = 'button_pressed';
    imagebutton.props.state = 'released';
    project.screens[0]!.root.children.push(table, tabview, list, imagebutton);

    const p = compilePreview(project).program!;
    p.globals.subjects.push({ name: 'image_checked', type: 'int', initial: 0 });
    p.screens[0]!.root.children
      .find((node) => node.runtimeName === 'image_action')!
      .bindings.push({ kind: 'prop', prop: 'checked', subject: 'image_checked' });
    expect(validatePreviewProgramSupport(p)).toEqual([]);
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));

    expect(calls).toContain('node:main:tbl:table');
    expect(calls).toContain('table-column:tbl:0:60');
    expect(calls).toContain('table-cell-value:tbl:0:0:Name');
    expect(calls).toContain('table-cell-ctrl:tbl:0:1:merge_right|text_crop');
    expect(calls).toContain('node:main:tabs:tabview');
    expect(calls).toContain('i32:tabs:active:1');
    expect(calls).toContain('str:tabs:tab_bar_position:bottom');
    expect(calls).toContain('struct:tabs:home_tab:tabview-tab:Home');
    expect(calls).toContain('node:home_tab:inside_tab:label');
    expect(calls.some((call) => call.startsWith('struct:tabs:_x')
      && call.endsWith(':tabview-tab_bar:'))).toBe(true);
    expect(calls.some((call) => call.startsWith('struct:tabs:_x')
      && call.endsWith(':tabview-tab_button:0'))).toBe(true);
    expect(calls).toContain('node:main:menu_list:list');
    expect(calls).toContain('list-item:menu_list:list_title:list-text::Settings');
    expect(calls).toContain('list-item:menu_list:list_wifi:list-button:wifi_icon:Wi-Fi');
    expect(calls).toContain('node:main:image_action:imagebutton');
    expect(calls).toContain('str:image_action:src_released_left:button_released');
    expect(calls).toContain('str:image_action:src_pressed_left:button_pressed');
    expect(calls).toContain('bind-prop:image_action:checked:image_checked:');

    const badOrder = structuredClone(p);
    const badTabs = badOrder.screens[0]!.root.children.find((node) => node.runtimeName === 'tabs')!;
    const buttonIndex = badTabs.children.findIndex((node) => node.type === 'tabview-tab_button');
    const [button] = badTabs.children.splice(buttonIndex, 1);
    badTabs.children.unshift(button!);
    expect(validatePreviewProgramSupport(badOrder).map((entry) => entry.code))
      .toContain('E_PREVIEW_STRUCTURAL_ORDER_INVALID');
  });

  it('结构类型、父子关系、构造参数和 virtual 附加能力均在 begin 前校验', () => {
    const p = program();
    const panel = p.screens[0]!.root.children[0]!;
    panel.kind = 'getter';
    panel.type = 'tabview-tab';
    panel.createProps = { text: 'Wrong parent' };
    const virtual = structuredClone(panel.children[0]!);
    virtual.kind = 'virtual';
    virtual.type = 'table-cell';
    virtual.useObjBase = false;
    virtual.createProps = { row: 0 };
    virtual.props = { ctrl: 'unknown_ctrl' };
    virtual.events = [{ kind: 'callback', trigger: 'clicked', callback: 'bad_virtual' }];
    virtual.children = [];
    p.screens[0]!.root.children.push(virtual);

    const issues = validatePreviewProgramSupport(p);
    expect(issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'E_PREVIEW_CHILD_SHAPE_INVALID',
      'E_PREVIEW_CREATE_PROP_MISSING',
      'E_PREVIEW_PROP_ENUM_INVALID',
      'E_PREVIEW_VIRTUAL_EXTRAS_UNSUPPORTED',
    ]));
    const calls: string[] = [];
    expect(() => executePreviewProgram(p, fakeBridge(calls))).toThrow('E_PREVIEW_CHILD_SHAPE_INVALID');
    expect(calls).toEqual([]);
  });

  it('命名 style 重名或悬空引用在 begin 前失败', () => {
    const p = program();
    p.globals.styles.push({ name: 'card', props: {} });
    p.screens[0]!.styles.push({ name: 'card', props: {} });
    p.screens[0]!.root.styleUses.push({ styleName: 'missing' });
    const issues = validatePreviewProgramSupport(p);
    expect(issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'E_PREVIEW_DUPLICATE_STYLE_NAME',
      'E_PREVIEW_STYLE_MISSING',
    ]));
    const calls: string[] = [];
    expect(() => executePreviewProgram(p, fakeBridge(calls))).toThrow('E_PREVIEW_DUPLICATE_STYLE_NAME');
    expect(calls).toEqual([]);
  });

  it('按全局/屏幕作用域解析 const，并在进入 C ABI 前变成标量', () => {
    const p = program();
    p.globals.consts.push(
      { name: 'gap', type: 'int', value: '8' },
      { name: 'accent', type: 'color', value: '0x336699' },
      { name: 'half', type: 'percent', value: '50' },
      { name: 'caption', type: 'string', value: 'Const title' },
    );
    p.globals.styles.push({
      name: 'global_card',
      props: { radius: { $const: 'gap' }, bg_color: { $const: 'accent' } },
    });
    p.screens[0]!.consts.push({ name: 'gap', type: 'px', value: '12' });
    p.screens[0]!.styles.push({
      name: 'local_card', props: { radius: { $const: 'gap' } },
    });
    p.screens[0]!.root.props.width = { $const: 'half' };
    p.screens[0]!.root.children[0]!.children[0]!.props.text = { $const: 'caption' };
    p.screens[0]!.root.styleUses.push({ styleName: 'global_card' }, { styleName: 'local_card' });

    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toContain('named-style-i32:global_card:radius:8');
    expect(calls).toContain('named-style-str:global_card:bg_color:#336699');
    expect(calls).toContain('named-style-i32:local_card:radius:12');
    expect(calls).toContain('str:main:width:50%');
    expect(calls).toContain('str:title:text:Const title');
  });

  it('非法、重名、悬空和目标类型不匹配的 const 均在 begin 前失败', () => {
    const p = program();
    p.globals.consts.push(
      { name: 'bad', type: 'int', value: '1.5' },
      { name: 'gap', type: 'int', value: '8' },
      { name: 'gap', type: 'int', value: '9' },
    );
    p.globals.styles.push({
      name: 'broken',
      props: { bg_color: { $const: 'gap' }, radius: { $const: 'missing' } },
    });
    const issues = validatePreviewProgramSupport(p);
    expect(issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'E_PREVIEW_CONST_VALUE_INVALID',
      'E_PREVIEW_DUPLICATE_CONST_NAME',
      'E_PREVIEW_CONST_MISSING',
      'E_PREVIEW_CONST_TYPE_MISMATCH',
    ]));
    const calls: string[] = [];
    expect(() => executePreviewProgram(p, fakeBridge(calls))).toThrow('E_PREVIEW_CONST_VALUE_INVALID');
    expect(calls).toEqual([]);
  });

  it('初始化四类 subject，并分发 P0 prop/flag/state binding', () => {
    const p = program();
    p.globals.subjects.push(
      { name: 'volume', type: 'int', initial: 25, min: 0, max: 100 },
      { name: 'ratio', type: 'float', initial: 0.5, min: 0, max: 1 },
      { name: 'caption', type: 'string', initial: 'Volume' },
      { name: 'accent', type: 'color', initial: '#369' },
    );
    const root = p.screens[0]!.root;
    const panel = root.children[0]!;
    const label = panel.children[0]!;
    const slider = structuredClone(panel);
    slider.id = 'slider-runtime-test';
    slider.type = 'slider';
    slider.runtimeName = 'volume_slider';
    slider.props = {};
    slider.children = [];
    slider.bindings = [{ kind: 'prop', prop: 'value', subject: 'volume' }];
    root.children.push(slider);
    panel.bindings.push(
      { kind: 'prop', prop: 'checked', subject: 'volume' },
      { kind: 'flag', flag: 'hidden', op: 'gt', subject: 'volume', refValue: 90 },
    );
    label.bindings.push(
      { kind: 'prop', prop: 'text', subject: 'caption', fmt: '%s' },
      { kind: 'state', state: 'disabled', op: 'ge', subject: 'volume', refValue: 100 },
    );

    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toContain('subject-i32:volume:25:0:true:100:true');
    expect(calls).toContain('subject-float:ratio:0.5:0:true:1:true');
    expect(calls).toContain('subject-string:caption:Volume:64');
    expect(calls).toContain('subject-color:accent:#369');
    expect(calls).toContain('bind-prop:volume_slider:value:volume:');
    expect(calls).toContain('bind-prop:panel:checked:volume:');
    expect(calls).toContain('bind-prop:title:text:caption:%s');
    expect(calls).toContain('bind-flag:panel:hidden:gt:volume:90');
    expect(calls).toContain('bind-state:title:disabled:ge:volume:100');
    expect(calls.indexOf('subject-i32:volume:25:0:true:100:true')).toBeLessThan(calls.indexOf('screen:main'));
  });

  it('分发 callback、subject 与跨屏事件，并为字符串事件预留完整 UTF-8 容量', () => {
    const p = program();
    const longCaption = '音量'.repeat(40);
    p.globals.subjects.push(
      { name: 'volume', type: 'int', initial: 25, min: 0, max: 100 },
      { name: 'ratio', type: 'float', initial: 0.5 },
      { name: 'muted', type: 'int', initial: 0 },
      { name: 'caption', type: 'string', initial: 'Volume' },
    );
    const panel = p.screens[0]!.root.children[0]!;
    panel.events.push(
      { kind: 'callback', trigger: 'long_pressed', callback: 'on_long', userData: 'fast' },
      { kind: 'subject_set', trigger: 'clicked', subject: 'volume', subjectType: 'int', value: '30' },
      { kind: 'subject_set', trigger: 'pressed', subject: 'ratio', subjectType: 'float', value: '0.75' },
      { kind: 'subject_set', trigger: 'released', subject: 'caption', subjectType: 'string', value: longCaption },
      { kind: 'subject_toggle', trigger: 'double_clicked', subject: 'muted' },
      {
        kind: 'subject_increment', trigger: 'short_clicked', subject: 'volume',
        step: 5, min: 0, max: 100, rollover: false,
      },
      {
        kind: 'screen_load', trigger: 'clicked', screenName: 'settings',
        animType: 'over_right', duration: 300, delay: 10,
      },
    );
    const settingsRoot = structuredClone(p.screens[0]!.root);
    settingsRoot.id = 'settings-root';
    settingsRoot.runtimeName = 'settings';
    settingsRoot.props = {};
    settingsRoot.bindings = [];
    settingsRoot.events = [];
    settingsRoot.children = [];
    p.screens.push({ id: 'settings-screen', name: 'settings', consts: [], styles: [], root: settingsRoot });

    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toContain('event-callback:panel:long_pressed:on_long:fast:true');
    expect(calls).toContain('event-set:panel:clicked:volume:int:30');
    expect(calls).toContain('event-set:panel:pressed:ratio:float:0.75');
    expect(calls).toContain(`event-set:panel:released:caption:string:${longCaption}`);
    expect(calls).toContain('event-toggle:panel:double_clicked:muted');
    expect(calls).toContain('event-inc:panel:short_clicked:volume:5:0:true:100:true:false:true');
    expect(calls).toContain('event-screen:panel:clicked:screen_load:settings:over_right:300:10');
    expect(calls).toContain(`subject-string:caption:Volume:${new TextEncoder().encode(longCaption).byteLength + 1}`);
  });

  it('非法事件在 begin 前完整失败', () => {
    const p = program();
    p.globals.subjects.push(
      { name: 'volume', type: 'int', initial: 25 },
      { name: 'ratio', type: 'float', initial: 0.5 },
      { name: 'caption', type: 'string', initial: 'x' },
    );
    p.screens[0]!.root.events.push(
      { kind: 'subject_set', trigger: 'not_an_event', subject: 'volume', subjectType: 'float', value: 'NaN' },
      { kind: 'subject_toggle', trigger: 'clicked', subject: 'ratio' },
      { kind: 'subject_increment', trigger: 'clicked', subject: 'caption', min: 10, max: 0 },
      {
        kind: 'screen_create', trigger: 'clicked', screenName: 'missing',
        animType: 'not_an_anim', duration: -1,
      },
    );
    const issues = validatePreviewProgramSupport(p);
    expect(issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'E_PREVIEW_EVENT_TRIGGER_UNSUPPORTED',
      'E_PREVIEW_EVENT_SUBJECT_TYPE_MISMATCH',
      'E_PREVIEW_EVENT_VALUE_INVALID',
      'E_PREVIEW_EVENT_RANGE_INVALID',
      'E_PREVIEW_EVENT_SCREEN_MISSING',
      'E_PREVIEW_EVENT_ANIM_UNSUPPORTED',
      'E_PREVIEW_EVENT_TIME_INVALID',
    ]));
    const calls: string[] = [];
    expect(() => executePreviewProgram(p, fakeBridge(calls))).toThrow('E_PREVIEW_EVENT_TRIGGER_UNSUPPORTED');
    expect(calls).toEqual([]);
  });

  it('非法 subject/binding 在 begin 前失败', () => {
    const p = program();
    p.globals.subjects.push(
      { name: 'bad_range', type: 'int', initial: 5, min: 10, max: 0 },
      { name: 'ratio', type: 'float', initial: 0.5 },
      { name: 'caption', type: 'string', initial: 'x' },
    );
    const panel = p.screens[0]!.root.children[0]!;
    const label = panel.children[0]!;
    panel.bindings.push(
      { kind: 'flag', flag: 'hidden', op: 'eq', subject: 'ratio', refValue: 0 },
      { kind: 'prop', prop: 'checked', subject: 'missing' },
    );
    label.bindings.push({ kind: 'prop', prop: 'text', subject: 'caption', fmt: '%n' });
    const issues = validatePreviewProgramSupport(p);
    expect(issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'E_PREVIEW_SUBJECT_RANGE_INVALID',
      'E_PREVIEW_SUBJECT_MISSING',
      'E_PREVIEW_BINDING_UNSUPPORTED',
    ]));
    const calls: string[] = [];
    expect(() => executePreviewProgram(p, fakeBridge(calls))).toThrow('E_PREVIEW_SUBJECT_RANGE_INVALID');
    expect(calls).toEqual([]);
  });

  it('拒绝非 P0 widget 和数组属性', () => {
    const p = program();
    const node = p.screens[0]!.root.children[0]!;
    node.type = 'not-supported-widget';
    node.props.points = [1, 2];
    const issues = validatePreviewProgramSupport(p);
    expect(issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'E_PREVIEW_WIDGET_UNSUPPORTED',
      'E_PREVIEW_PROP_VALUE_UNSUPPORTED',
    ]));
  });

  it('line 点列表和 y_invert 通过受控 bridge', () => {
    const p = program();
    const line = p.screens[0]!.root.children[0]!;
    line.type = 'line';
    line.props = { points: [0, 50, 30.5, 0, 60, 40], y_invert: true };
    const calls: string[] = [];
    expect(validatePreviewProgramSupport(p)).toEqual([]);
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toContain('node:main:panel:line');
    expect(calls).toContain('points:panel:points:0,50 30.5,0 60,40');
    expect(calls).toContain('i32:panel:y_invert:1');
  });

  it('line 拒绝空、奇数长度和非有限点列表', () => {
    for (const points of [[], [1], [1, 2, Number.NaN], [1, Number.POSITIVE_INFINITY]]) {
      const p = program();
      const line = p.screens[0]!.root.children[0]!;
      line.type = 'line';
      line.props = { points };
      expect(validatePreviewProgramSupport(p).map((entry) => entry.code))
        .toContain('E_PREVIEW_POINT_LIST_INVALID');
    }
  });

  it('arclabel 的标量、布尔和枚举属性通过受控 bridge', () => {
    const p = program();
    const arcLabel = p.screens[0]!.root.children[0]!;
    arcLabel.type = 'arclabel';
    arcLabel.props = {
      text: 'Arc', angle_start: 15, angle_size: 180, radius: 60,
      dir: 'counter_clockwise', recolor: true, text_horizontal_align: 'center',
    };
    const calls: string[] = [];
    expect(validatePreviewProgramSupport(p)).toEqual([]);
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toContain('node:main:panel:arclabel');
    expect(calls).toContain('str:panel:text:Arc');
    expect(calls).toContain('i32:panel:radius:60');
    expect(calls).toContain('i32:panel:recolor:1');
    expect(calls).toContain('str:panel:dir:counter_clockwise');
    expect(calls).toContain('str:panel:text_horizontal_align:center');
  });

  it('spangroup span supports text, named style and subject text binding', () => {
    const p = program();
    p.globals.styles.push({ name: 'accent', props: { text_color: '#ff0000' } });
    p.globals.subjects.push({ name: 'message', type: 'string', initial: 'ready' });
    const group = p.screens[0]!.root.children[0]!;
    group.type = 'spangroup';
    group.runtimeName = 'rich_text';
    group.props = { width: 180, height: 'content', overflow: 'ellipsis', max_lines: 3, indent: 12 };
    const span = group.children[0]!;
    span.type = 'spangroup-span';
    span.runtimeName = 'rich_span';
    span.kind = 'add';
    span.useObjBase = false;
    span.props = {
      text: 'Hello', style: 'accent', bind_text: 'message', bind_text_fmt: '[%s]',
    };
    span.children = [];

    expect(validatePreviewProgramSupport(p)).toEqual([]);
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toContain('node:main:rich_text:spangroup');
    expect(calls).toContain('str:rich_text:overflow:ellipsis');
    expect(calls).toContain('i32:rich_text:max_lines:3');
    expect(calls).toContain('i32:rich_text:indent:12');
    expect(calls).toContain('struct:rich_text:rich_span:spangroup-span:');
    expect(calls).toContain('str:rich_span:text:Hello');
    expect(calls).toContain('str:rich_span:style:accent');
    expect(calls).toContain('bind-prop:rich_span:span_text:message:[%s]');

    const invalid = structuredClone(p);
    const invalidSpan = invalid.screens[0]!.root.children[0]!.children[0]!;
    invalidSpan.flags.push(['hidden', true]);
    invalidSpan.props.style = 'missing';
    expect(validatePreviewProgramSupport(invalid).map((entry) => entry.code))
      .toEqual(expect.arrayContaining([
        'E_PREVIEW_NON_OBJ_EXTRAS_UNSUPPORTED', 'E_PREVIEW_STYLE_MISSING',
      ]));
  });

  it('checkbox text and checked binding use controlled bridge calls', () => {
    const p = program();
    p.globals.subjects.push({ name: 'accepted', type: 'int', initial: 1 });
    const checkbox = p.screens[0]!.root.children[0]!;
    checkbox.type = 'checkbox';
    checkbox.runtimeName = 'terms';
    checkbox.props = { text: 'Accept terms' };
    checkbox.children = [];
    checkbox.bindings = [{ kind: 'prop', prop: 'checked', subject: 'accepted' }];

    expect(validatePreviewProgramSupport(p)).toEqual([]);
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toContain('node:main:terms:checkbox');
    expect(calls).toContain('str:terms:text:Accept terms');
    expect(calls).toContain('bind-prop:terms:checked:accepted:');
  });

  it('dropdown props, list getter and value binding use controlled bridge calls', () => {
    const p = program();
    p.globals.subjects.push({ name: 'choice', type: 'int', initial: 1 });
    const dropdown = p.screens[0]!.root.children[0]!;
    dropdown.type = 'dropdown';
    dropdown.runtimeName = 'choices';
    dropdown.props = { options: 'Red\nGreen', text: 'Color', selected: 1 };
    dropdown.bindings = [{ kind: 'prop', prop: 'value', subject: 'choice' }];
    const list = dropdown.children[0]!;
    list.type = 'dropdown-list';
    list.runtimeName = 'choices_list';
    list.kind = 'getter';
    list.props = {};
    list.children = [];

    expect(validatePreviewProgramSupport(p)).toEqual([]);
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toContain('node:main:choices:dropdown');
    expect(calls).toContain('str:choices:options:Red\nGreen');
    expect(calls).toContain('str:choices:text:Color');
    expect(calls).toContain('i32:choices:selected:1');
    expect(calls).toContain('bind-prop:choices:value:choice:');
    expect(calls).toContain('struct:choices:choices_list:dropdown-list:');
  });

  it('roller, textarea and spinbox map their complete scalar contracts', () => {
    const p = program();
    p.globals.subjects.push({ name: 'number', type: 'int', initial: 2 });
    const root = p.screens[0]!.root;
    const roller = root.children[0]!;
    roller.type = 'roller';
    roller.runtimeName = 'roller_1';
    roller.props = {
      options: 'One\nTwo', options_mode: 'infinite', selected: 1,
      selected_animated: true, visible_row_count: 4,
    };
    roller.children = [];
    roller.bindings = [{ kind: 'prop', prop: 'value', subject: 'number' }];

    const textarea = structuredClone(roller);
    textarea.type = 'textarea';
    textarea.runtimeName = 'textarea_1';
    textarea.props = {
      text: 'secret', placeholder_text: 'enter', one_line: true, password_mode: true,
      password_show_time: 800, text_selection: true, cursor_pos: 2, max_length: 20,
    };
    textarea.bindings = [];

    const spinbox = structuredClone(roller);
    spinbox.type = 'spinbox';
    spinbox.runtimeName = 'spinbox_1';
    spinbox.props = {
      value: 12, rollover: true, digit_count: 5, dec_point_pos: 2,
      min_value: -100, max_value: 100, step: 5,
    };
    root.children.push(textarea, spinbox);

    expect(validatePreviewProgramSupport(p)).toEqual([]);
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toEqual(expect.arrayContaining([
      'str:roller_1:options:One\nTwo', 'str:roller_1:options_mode:infinite',
      'i32:roller_1:selected:1', 'i32:roller_1:selected_animated:1',
      'i32:roller_1:visible_row_count:4', 'bind-prop:roller_1:value:number:',
      'str:textarea_1:text:secret', 'str:textarea_1:placeholder_text:enter',
      'i32:textarea_1:one_line:1', 'i32:textarea_1:password_mode:1',
      'i32:textarea_1:password_show_time:800', 'i32:textarea_1:text_selection:1',
      'i32:textarea_1:cursor_pos:2', 'i32:textarea_1:max_length:20',
      'i32:spinbox_1:value:12', 'i32:spinbox_1:rollover:1',
      'i32:spinbox_1:digit_count:5', 'i32:spinbox_1:dec_point_pos:2',
      'i32:spinbox_1:min_value:-100', 'i32:spinbox_1:max_value:100',
      'i32:spinbox_1:step:5', 'bind-prop:spinbox_1:value:number:',
    ]));
  });

  it('buttonmatrix lists and keyboard target use controlled bridge calls', () => {
    const p = program();
    const root = p.screens[0]!.root;
    const matrix = root.children[0]!;
    matrix.type = 'buttonmatrix';
    matrix.runtimeName = 'keys';
    matrix.props = {
      map: ['A', 'B', '\n', 'C'], ctrl_map: 'checkable|checked disabled none',
      selected_button: 1, one_checked: true,
    };
    matrix.children = [];

    const textarea = structuredClone(matrix);
    textarea.type = 'textarea';
    textarea.runtimeName = 'editor';
    textarea.props = { text: '' };
    const keyboard = structuredClone(matrix);
    keyboard.type = 'keyboard';
    keyboard.runtimeName = 'keyboard_1';
    keyboard.props = { mode: 'text_upper', popovers: true, textarea: 'editor' };
    root.children.push(textarea, keyboard);

    expect(validatePreviewProgramSupport(p)).toEqual([]);
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toEqual(expect.arrayContaining([
      `strings:keys:map:A\u001fB\u001f\n\u001fC`,
      'str:keys:ctrl_map:checkable|checked disabled none',
      'i32:keys:selected_button:1', 'i32:keys:one_checked:1',
      'str:keyboard_1:mode:text_upper', 'i32:keyboard_1:popovers:1',
      'str:keyboard_1:textarea:editor',
    ]));
  });

  it('led and spinner map display properties through controlled setters', () => {
    const p = program();
    const root = p.screens[0]!.root;
    const led = root.children[0]!;
    led.type = 'led';
    led.runtimeName = 'status_led';
    led.props = { color: '#00ff44', brightness: 180 };
    led.children = [];
    const spinner = structuredClone(led);
    spinner.type = 'spinner';
    spinner.runtimeName = 'busy';
    spinner.props = { anim_duration: 800, angle: 240 };
    root.children.push(spinner);

    expect(validatePreviewProgramSupport(p)).toEqual([]);
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toEqual(expect.arrayContaining([
      'str:status_led:color:#00ff44', 'i32:status_led:brightness:180',
      'i32:busy:anim_duration:800', 'i32:busy:angle:240',
    ]));
  });

  it('qrcode and scale map complete scalar contracts', () => {
    const p = program();
    const root = p.screens[0]!.root;
    const qr = root.children[0]!;
    qr.type = 'qrcode';
    qr.runtimeName = 'qr';
    qr.props = {
      size: 96, dark_color: '#112233', light_color: '#ffffff', data: 'hello', quiet_zone: true,
    };
    qr.children = [];
    const scale = structuredClone(qr);
    scale.type = 'scale';
    scale.runtimeName = 'scale_1';
    scale.props = {
      mode: 'round_inner', total_tick_count: 21, major_tick_every: 5,
      label_show: true, post_draw: false, draw_ticks_on_top: true,
      min_value: -20, max_value: 120, angle_range: 270, rotation: 45,
    };
    root.children.push(scale);

    expect(validatePreviewProgramSupport(p)).toEqual([]);
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toEqual(expect.arrayContaining([
      'i32:qr:size:96', 'str:qr:dark_color:#112233', 'str:qr:light_color:#ffffff',
      'str:qr:data:hello', 'i32:qr:quiet_zone:1',
      'str:scale_1:mode:round_inner', 'i32:scale_1:total_tick_count:21',
      'i32:scale_1:major_tick_every:5', 'i32:scale_1:label_show:1',
      'i32:scale_1:post_draw:0', 'i32:scale_1:draw_ticks_on_top:1',
      'i32:scale_1:min_value:-20', 'i32:scale_1:max_value:120',
      'i32:scale_1:angle_range:270', 'i32:scale_1:rotation:45',
    ]));
  });

  it('calendar maps dates and both header children', () => {
    const p = program();
    const calendar = p.screens[0]!.root.children[0]!;
    calendar.type = 'calendar';
    calendar.runtimeName = 'calendar_1';
    calendar.props = {
      today_year: 2026, today_month: 9, today_day: 15,
      shown_year: 2026, shown_month: 10,
    };
    calendar.children = [];
    const arrow = structuredClone(calendar);
    arrow.type = 'calendar-header_arrow';
    arrow.runtimeName = 'calendar_arrow';
    arrow.kind = 'add';
    arrow.props = {};
    arrow.children = [];
    const dropdown = structuredClone(arrow);
    dropdown.type = 'calendar-header_dropdown';
    dropdown.runtimeName = 'calendar_dropdown';
    calendar.children.push(arrow, dropdown);

    expect(validatePreviewProgramSupport(p)).toEqual([]);
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toEqual(expect.arrayContaining([
      'node:main:calendar_1:calendar',
      'i32:calendar_1:today_year:2026', 'i32:calendar_1:today_month:9',
      'i32:calendar_1:today_day:15', 'i32:calendar_1:shown_year:2026',
      'i32:calendar_1:shown_month:10',
      'struct:calendar_1:calendar_arrow:calendar-header_arrow:',
      'struct:calendar_1:calendar_dropdown:calendar-header_dropdown:',
    ]));

    calendar.props.today_month = 13;
    expect(validatePreviewProgramSupport(p).map((entry) => entry.code))
      .toContain('E_PREVIEW_PROP_RANGE_INVALID');
  });

  it('msgbox maps content, close button and footer buttons', () => {
    const p = program();
    const msgbox = p.screens[0]!.root.children[0]!;
    msgbox.type = 'msgbox';
    msgbox.runtimeName = 'dialog';
    msgbox.props = { title: 'Confirm', text: 'Continue?', close_button: true };
    msgbox.children = [];
    const button = structuredClone(msgbox);
    button.type = 'msgbox-button';
    button.runtimeName = 'dialog_ok';
    button.kind = 'add';
    button.createProps = { text: 'OK' };
    button.props = {};
    button.children = [];
    msgbox.children.push(button);

    expect(validatePreviewProgramSupport(p)).toEqual([]);
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toEqual(expect.arrayContaining([
      'node:main:dialog:msgbox', 'str:dialog:title:Confirm',
      'str:dialog:text:Continue?', 'i32:dialog:close_button:1',
      'struct:dialog:dialog_ok:msgbox-button:OK',
    ]));
  });

  it('menu maps modes and page creation', () => {
    const p = program();
    const menu = p.screens[0]!.root.children[0]!;
    menu.type = 'menu';
    menu.runtimeName = 'menu_1';
    menu.props = { mode_header: 'bottom_fixed', mode_root_back_button: 'enabled' };
    menu.children = [];
    const page = structuredClone(menu);
    page.type = 'menu-page';
    page.runtimeName = 'menu_page';
    page.kind = 'add';
    page.createProps = { title: 'Settings' };
    page.props = {};
    page.children = [];
    menu.children.push(page);

    expect(validatePreviewProgramSupport(p)).toEqual([]);
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toEqual(expect.arrayContaining([
      'node:main:menu_1:menu', 'str:menu_1:mode_header:bottom_fixed',
      'str:menu_1:mode_root_back_button:enabled',
      'struct:menu_1:menu_page:menu-page:Settings',
    ]));
  });

  it('win maps its title and encoded header button arguments', () => {
    const p = program();
    const win = p.screens[0]!.root.children[0]!;
    win.type = 'win';
    win.runtimeName = 'window_1';
    win.props = { title: 'Tools' };
    win.children = [];
    const button = structuredClone(win);
    button.type = 'win-button';
    button.runtimeName = 'window_close';
    button.kind = 'add';
    button.createProps = { width: 36 };
    button.props = {};
    button.children = [];
    win.children.push(button);

    expect(validatePreviewProgramSupport(p)).toEqual([]);
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toEqual(expect.arrayContaining([
      'node:main:window_1:win', 'str:window_1:title:Tools',
      `struct:window_1:window_close:win-button:\u001f36`,
    ]));

    button.createProps.width = 0;
    expect(validatePreviewProgramSupport(p).map((entry) => entry.code))
      .toContain('E_PREVIEW_CREATE_PROP_INVALID');
  });

  it('tileview maps bounded coordinates and direction into tile creation', () => {
    const p = program();
    const tileview = p.screens[0]!.root.children[0]!;
    tileview.type = 'tileview';
    tileview.runtimeName = 'tiles';
    tileview.props = {};
    tileview.children = [];
    const tile = structuredClone(tileview);
    tile.type = 'tileview-tile';
    tile.runtimeName = 'tile_1';
    tile.kind = 'add';
    tile.createProps = { col: 2, row: 1, dir: 'hor' };
    tile.children = [];
    tileview.children.push(tile);

    expect(validatePreviewProgramSupport(p)).toEqual([]);
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toContain(`struct:tiles:tile_1:tileview-tile:2\u001f1\u001fhor`);

    tile.createProps.col = 256;
    expect(validatePreviewProgramSupport(p).map((entry) => entry.code))
      .toContain('E_PREVIEW_CREATE_PROP_INVALID');
  });

  it('chart maps scalar settings, series values, cursor and virtual axis', () => {
    const p = program();
    const chart = p.screens[0]!.root.children[0]!;
    chart.type = 'chart';
    chart.runtimeName = 'chart_1';
    chart.props = {
      type: 'line', point_count: 4, update_mode: 'circular',
      hor_div_line_count: 3, ver_div_line_count: 5,
    };
    chart.children = [];

    const series = structuredClone(chart);
    series.type = 'chart-series';
    series.runtimeName = 'series_1';
    series.kind = 'add';
    series.useObjBase = false;
    series.createProps = { color: '#ff0000', axis: 'primary_y' };
    series.props = { values: [10, -2, 30, 40] };
    series.children = [];

    const cursor = structuredClone(series);
    cursor.type = 'chart-cursor';
    cursor.runtimeName = 'cursor_1';
    cursor.createProps = { color: '#0000ff', dir: 'all' };
    cursor.props = { pos_x: 20, pos_y: 30 };

    const axis = structuredClone(series);
    axis.type = 'chart-axis';
    axis.runtimeName = 'axis_1';
    axis.kind = 'virtual';
    axis.createProps = { axis: 'primary_y' };
    axis.props = { min_value: -10, max_value: 100 };
    chart.children.push(series, cursor, axis);

    expect(validatePreviewProgramSupport(p)).toEqual([]);
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toEqual(expect.arrayContaining([
      'node:main:chart_1:chart', 'str:chart_1:type:line',
      'i32:chart_1:point_count:4', 'str:chart_1:update_mode:circular',
      `struct:chart_1:series_1:chart-series:#ff0000\u001fprimary_y`,
      'i32s:series_1:values:10 -2 30 40',
      `struct:chart_1:cursor_1:chart-cursor:#0000ff\u001fall`,
      'i32:cursor_1:pos_x:20', 'i32:cursor_1:pos_y:30',
      'chart-axis:chart_1:primary_y:min_value:-10',
      'chart-axis:chart_1:primary_y:max_value:100',
    ]));
  });

  it('animimage maps persistent source lists and animation timing', () => {
    const p = program();
    const animimage = p.screens[0]!.root.children[0]!;
    animimage.type = 'animimage';
    animimage.runtimeName = 'frames';
    animimage.props = { srcs: ['red', 'green'], duration: 800, repeat_count: 3 };
    animimage.children = [];

    expect(validatePreviewProgramSupport(p)).toEqual([]);
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toEqual(expect.arrayContaining([
      'node:main:frames:animimage', `strings:frames:srcs:red\u001fgreen`,
      'i32:frames:duration:800', 'i32:frames:repeat_count:3',
    ]));

    animimage.props.srcs = [];
    expect(validatePreviewProgramSupport(p).map((entry) => entry.code))
      .toContain('E_PREVIEW_STRING_LIST_INVALID');
  });

  it('canvas maps numeric buffer dimensions and fill color', () => {
    const p = program();
    const canvas = p.screens[0]!.root.children[0]!;
    canvas.type = 'canvas';
    canvas.runtimeName = 'drawing';
    canvas.props = { width: 160, height: 120, fill_color: '#11aaee' };
    canvas.children = [];

    expect(validatePreviewProgramSupport(p)).toEqual([]);
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toEqual(expect.arrayContaining([
      'node:main:drawing:canvas', 'i32:drawing:width:160',
      'i32:drawing:height:120', 'str:drawing:fill_color:#11aaee',
    ]));

    canvas.props.width = '100%';
    expect(validatePreviewProgramSupport(p).map((entry) => entry.code))
      .toContain('E_PREVIEW_SIZE_UNSUPPORTED');
  });

  it('lottie maps MEMFS asset refs after bounded numeric buffer dimensions', () => {
    const p = program();
    const lottie = p.screens[0]!.root.children[0]!;
    lottie.type = 'lottie';
    lottie.runtimeName = 'motion';
    lottie.props = { width: 100, height: 100, src: 'move' };
    lottie.children = [];

    expect(validatePreviewProgramSupport(p)).toEqual([]);
    const calls: string[] = [];
    executePreviewProgram(p, fakeBridge(calls));
    expect(calls).toEqual(expect.arrayContaining([
      'node:main:motion:lottie', 'i32:motion:width:100',
      'i32:motion:height:100', 'str:motion:src:move',
    ]));
  });

  it('接受协议声明的五种目标 colorFormat', () => {
    const formats = ['RGB565', 'RGB565_SWAPPED', 'RGB888', 'XRGB8888', 'ARGB8888'] as const;
    for (const colorFormat of formats) {
      const p = program();
      p.display.colorFormat = colorFormat;
      expect(validatePreviewProgramSupport(p)).toEqual([]);
    }
  });

  it('bridge 返回码带精确操作名上抛', () => {
    const p = program();
    const calls: string[] = [];
    const bridge = fakeBridge(calls);
    bridge.createScreen = () => -4;
    expect(() => executePreviewProgram(p, bridge)).toThrow('preview.createScreen(main) rc=-4');
  });
});
