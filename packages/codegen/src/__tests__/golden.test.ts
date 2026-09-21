/**
 * golden 文本快照:emitXml + emitC94 输出与 __tests__/golden/<case>/ 逐文件全等。
 * 重录:UPDATE_GOLDEN=1 pnpm --filter @lvd/codegen test
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitC94, emitXml, normalizeProject } from '../index.js';
import {
  GOLDEN_CASES, caseChart, caseKeyboard, caseNameDedup, caseTabview,
} from './cases.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_ROOT = path.join(HERE, 'golden');
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';

function generate(
  build: () => import('@lvd/schema').LvProject,
  cOptions?: import('../index.js').EmitC94Options,
): Map<string, string> {
  const project = build();
  const xml = emitXml(project);
  const c = emitC94(project, cOptions);
  const files = new Map<string, string>();

  if (xml.globalsXml) files.set('xml/globals.xml', xml.globalsXml);
  for (const s of xml.screens) files.set(`xml/${s.name}.xml`, s.xml);
  files.set('xml/meta.json', `${JSON.stringify(
    {
      screens: xml.screens.map((s) => ({
        name: s.name, lineMap: s.lineMap, previewNameToId: s.previewNameToId,
      })),
      xmlDiagnostics: xml.diagnostics,
      cDiagnostics: c.diagnostics,
    },
    null, 2,
  )}\n`);
  for (const f of c.files) files.set(`c/${f.path}`, f.content);
  return files;
}

function listFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out.sort();
}

describe('golden', () => {
  for (const gc of GOLDEN_CASES) {
    it(gc.name, () => {
      const files = generate(gc.build, gc.cOptions);
      const dir = path.join(GOLDEN_ROOT, gc.name);

      if (UPDATE) {
        fs.rmSync(dir, { recursive: true, force: true });
        for (const [rel, content] of files) {
          const p = path.join(dir, rel);
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, content, 'utf8');
        }
        return;
      }

      const expected = listFiles(dir);
      expect(expected.length, `golden 目录缺失,先 UPDATE_GOLDEN=1 重录:${dir}`).toBeGreaterThan(0);
      expect([...files.keys()].sort()).toEqual(expected);
      for (const rel of expected) {
        const got = files.get(rel);
        const want = fs.readFileSync(path.join(dir, rel), 'utf8');
        expect(got, rel).toBe(want);
      }
    });
  }
});

describe('契约细节', () => {
  it('emitXml:每节点强制 name,重名去重,匿名 _x+id8', () => {
    const r = emitXml(caseNameDedup());
    const s = r.screens[0]!;
    expect(s.xml).toContain('name="btn"');
    expect(s.xml).toContain('name="btn_2"');
    expect(s.xml).toContain('name="btn_3"');
    expect(s.xml).toContain('name="_xdeadbeef"');
    expect(s.previewNameToId['_xdeadbeef']).toBe('deadbeef-1234-4abc-8def-cafe00000001');
    expect(s.previewNameToId['main']).toBeDefined();          // 根 = screen 名
    expect(r.diagnostics.some((d) => d.code === 'W_DUP_NAME')).toBe(true);
  });

  it('emitXml:lineMap 行号指向节点开标签', () => {
    const r = emitXml(caseNameDedup());
    const s = r.screens[0]!;
    const lines = s.xml.split('\n');
    for (const { line, nodeId } of s.lineMap) {
      const text = lines[line - 1]!;
      expect(text.includes('<'), `${nodeId} @${line}`).toBe(true);
    }
  });

  it('emitC94:actions.c 标 overwrite:false,匿名节点不进 objects.h', () => {
    const r = emitC94(caseNameDedup());
    const actions = r.files.find((f) => f.path === 'actions.c')!;
    expect(actions.overwrite).toBe(false);
    expect(r.files.filter((f) => f.overwrite === false)).toHaveLength(1);
    const objects = r.files.find((f) => f.path === 'objects.h')!;
    expect(objects.content).toContain('lv_obj_t * btn_2;');
    expect(objects.content).not.toContain('_xdeadbeef');
  });

  it('emitC94:set_name 全部包 LV_USE_OBJ_NAME 守卫', () => {
    for (const gc of GOLDEN_CASES) {
      const r = emitC94(gc.build());
      for (const f of r.files) {
        const setNames = (f.content.match(/lv_obj_set_name\(/g) ?? []).length;
        const guards = (f.content.match(/#if LV_USE_OBJ_NAME/g) ?? []).length;
        expect(guards, f.path).toBe(setNames);
      }
    }
  });

  it('emitC94:c-only 属性只进 C,不进 XML', () => {
    const p = GOLDEN_CASES[0]!.build();
    const xml = emitXml(p).screens[0]!.xml;
    const c = emitC94(p);
    expect(xml).not.toContain('max_length');
    const main = c.files.find((f) => f.path === 'screens/main.c')!;
    expect(main.content).toContain('lv_textarea_set_max_length(obj, 32);');
  });
});

describe('ChildSpec 双通道', () => {
  it('XML:子元素发全名 tag,createProps 在开标签,非 obj 系不发 name', () => {
    const r = emitXml(caseChart());
    const xml = r.screens[0]!.xml;
    expect(xml).toContain('<lv_chart-series color="0x00c040" axis="secondary_y" values="5 15 10 20 15 25 20 30"/>');
    expect(xml).toContain('<lv_chart-cursor dir="ver" pos_x="3" pos_y="20"/>');
    expect(xml).toContain('<lv_chart-axis axis="secondary_y" min_value="0" max_value="60"/>');
    // series/cursor/axis 无对象句柄,不得发 name
    expect(xml).not.toMatch(/<lv_chart-(series|cursor|axis)[^>]*name=/);
    // 等于 parser 默认值的 createProp(首条 series 的 color/axis)被消除
    expect(xml).toContain('<lv_chart-series values="10 20 30 25 40 35 50 45"/>');
  });

  it('XML:tabview-tab 容器收 widget 子孙且发 name', () => {
    const r = emitXml(caseTabview());
    const xml = r.screens[0]!.xml;
    expect(xml).toContain('<lv_tabview-tab name="tab_home" text="Home">');
    expect(xml).toMatch(/<lv_tabview-tab name="tab_home"[^>]*>[\s\S]*<lv_button name="btn_go"/);
    expect(xml).toContain('<lv_tabview-tab_bar name="_x');
  });

  it('C:add 用 cCreate 实参、getter 取句柄、virtual 直调父', () => {
    const chart = emitC94(caseChart()).files.find((f) => f.path === 'screens/main.c')!.content;
    expect(chart).toContain('lv_chart_series_t * chart_series_1 = lv_chart_add_series(obj, lv_color_hex(0xff0000), LV_CHART_AXIS_PRIMARY_Y);');
    expect(chart).toContain('lv_chart_set_next_value(obj, chart_series_1, 45);');
    expect(chart).toContain('lv_chart_set_axis_max_value(obj, LV_CHART_AXIS_SECONDARY_Y, 60);');
    const tv = emitC94(caseTabview()).files.find((f) => f.path === 'screens/main.c')!.content;
    expect(tv).toContain('lv_obj_t * obj = lv_tabview_add_tab(parent, "Home");');
    expect(tv).toContain('= lv_tabview_get_tab_bar(obj);');
    expect(tv).toContain('= lv_tabview_get_tab_button(obj, 0);');
  });

  it('C:keyboard textarea 关联(c-only $ref)发 ui_<screen>.<name>', () => {
    const p = caseKeyboard();
    expect(emitXml(p).screens[0]!.xml).not.toContain('textarea=');
    const c = emitC94(p).files.find((f) => f.path === 'screens/main.c')!.content;
    expect(c).toContain('lv_keyboard_set_textarea(obj, ui_main.ta_in);');
  });

  it('normalize:非法子类型 → error', () => {
    // chart-series 挂错父节点
    const p1 = caseNameDedup();
    p1.screens[0]!.root.children.push({
      id: 'bad00001-0000-4000-8000-000000000000', type: 'chart-series',
      props: {}, styles: [], inlineStyles: [], events: [], bindings: [], children: [],
    });
    const r1 = normalizeProject(p1);
    expect(r1.diagnostics.some((d) => d.code === 'E_ILLEGAL_CHILD' && d.severity === 'error')).toBe(true);

    // 不收子 widget 的父节点(chart 里塞 button)
    const p2 = caseChart();
    p2.screens[0]!.root.children[0]!.children.push({
      id: 'bad00002-0000-4000-8000-000000000000', type: 'button',
      props: {}, styles: [], inlineStyles: [], events: [], bindings: [], children: [],
    });
    const r2 = normalizeProject(p2);
    expect(r2.diagnostics.some((d) => d.code === 'E_ILLEGAL_CHILD')).toBe(true);

    // 必填 createProp 缺失(table-cell 少 row/column)
    const p3 = caseNameDedup();
    p3.screens[0]!.root.children.push({
      id: 'bad00003-0000-4000-8000-000000000000', type: 'table',
      props: {}, styles: [], inlineStyles: [], events: [], bindings: [],
      children: [{
        id: 'bad00004-0000-4000-8000-000000000000', type: 'table-cell',
        props: { value: 'x' }, styles: [], inlineStyles: [], events: [], bindings: [], children: [],
      }],
    });
    const r3 = normalizeProject(p3);
    expect(r3.diagnostics.filter((d) => d.code === 'E_MISSING_CREATE_PROP')).toHaveLength(2);
  });
});
