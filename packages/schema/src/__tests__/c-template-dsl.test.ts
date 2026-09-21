/**
 * registry 的 C 模板 DSL 分析 —— 「IR → LVGL C API」分发器的需求清单。
 *
 * 去 XML 后(docs/lvgl-version-baseline.md §2.2),预览与 C 生成都要按 registry 的
 * `c.setter` / `cCreate` 模板去调 LVGL API。动手写分发器之前必须先回答一个问题:
 *
 *   **这个模板 DSL 是封闭的吗?**
 *
 * 开放集合意味着分发器永远写不完;封闭则实现是机械的。本文件把每个占位符逐个归类,
 * 断言**没有一个落在已知类别之外**,并把各类别的数量钉住。
 * 将来谁往 registry 写了新形态的模板,这里立刻失败,而不是等到 runtime 静默少调一个 setter。
 *
 * 语法层面只有两种形态:
 *   $NAME                          —— 398 处
 *   $NAME:LV_ANIM_ON:LV_ANIM_OFF   —— 5 处(三元:companion 为真取前者)
 *
 * 复杂度全在 NAME 的语义上,见 Category。
 */
import { describe, expect, it } from 'vitest';
import { ALL_WIDGETS, OBJ_BASE } from '../widgets/index.js';
import type { ChildSpec, PropSpec, WidgetSpec } from '../registryTypes.js';

/* ------------------------------------------------------------------ 解析 */

interface Placeholder {
  name: string;
  ternary?: [string, string];
  raw: string;
}

const PLACEHOLDER_RE = /\$([a-zA-Z_][a-zA-Z0-9_]*)((?::[A-Za-z0-9_]+)*)/g;

export function parseTemplate(tpl: string): Placeholder[] {
  const out: Placeholder[] = [];
  for (const m of tpl.matchAll(PLACEHOLDER_RE)) {
    const parts = (m[2] ?? '').split(':').filter((s) => s.length > 0);
    out.push({
      name: m[1]!,
      ...(parts.length === 2 ? { ternary: [parts[0]!, parts[1]!] as [string, string] } : {}),
      raw: m[0],
    });
  }
  return out;
}

/* ------------------------------------------------------------------ 分类 */

/**
 * 占位符的语义类别 = 分发器必须实现的全部情况。
 *
 * | 类别      | 含义                                                    | 分发器要做什么 |
 * | --------- | ------------------------------------------------------- | -------------- |
 * | obj       | 目标对象句柄                                            | 从节点 id 查表 |
 * | parent    | 父对象句柄(setter 挂在父上,如 chart 操作 series)      | IR 需同时下发父句柄 |
 * | value     | 属性值本身                                              | 按 PropSpec.type 做值编组 |
 * | companion | 同 PropSpec 声明的伴生属性(如 value_animated)          | 与主值一起下发 |
 * | peerProp  | **同一 widget 上的另一个属性**                          | **多属性塌缩成一次调用**,须先聚合 |
 * | sibling   | 同级 createProp 提供的寻址参数(row/column/axis…)       | 从父元素上下文取 |
 * | listCount | 列表长度                                                | 与数组成对下发 |
 * | listArray | 列表数据指针                                            | 分发器侧分配并负责释放 |
 * | loop      | 值是列表,C 调用按元素重复                              | 展开为多次调用 |
 * | objRef    | 值是另一个节点的引用                                    | 解析为对象句柄 |
 */
type Category =
  | 'obj' | 'parent' | 'value' | 'companion' | 'peerProp'
  | 'sibling' | 'listCount' | 'listArray' | 'loop' | 'objRef';

const LIST_ARRAYS = new Set(['ptarr', 'imgarr', 'strarr']);

/** 值驱动的循环形态,逐个确认过用途 */
const LOOP_NAMES: Record<string, string> = {
  idx: 'buttonmatrix.ctrl_map:按钮下标,与 $ored 成对逐项调用',
  ored: 'buttonmatrix.ctrl_map:该下标上多个 ctrl token 或运算后的位掩码',
  each: 'chart-series.values:逐点 lv_chart_set_next_value',
};

const OBJ_REF_NAMES: Record<string, string> = {
  ref: 'keyboard.textarea:值是另一个节点的 id,须解析为 lv_obj_t*',
};

function classify(
  name: string,
  prop: PropSpec | undefined,
  peerKeys: ReadonlySet<string>,
  siblingKeys: ReadonlySet<string>,
): Category | null {
  if (name === 'obj') return 'obj';
  if (name === 'parent') return 'parent';
  if (name === 'v') return 'value';
  if (name === 'n') return 'listCount';
  if (LIST_ARRAYS.has(name)) return 'listArray';
  if (prop?.companions?.some((c) => c.key === name) === true) return 'companion';
  if (name in LOOP_NAMES) return 'loop';
  if (name in OBJ_REF_NAMES) return 'objRef';
  if (peerKeys.has(name)) return 'peerProp';
  if (siblingKeys.has(name)) return 'sibling';
  return null;
}

interface Site { where: string; template: string; ph: Placeholder; category: Category }
interface MultiProp { where: string; keys: string[]; template: string }

function collect(): { sites: Site[]; unknown: string[]; multiProp: MultiProp[] } {
  const sites: Site[] = [];
  const unknown: string[] = [];
  const multiProp: MultiProp[] = [];

  const visitProps = (props: PropSpec[], where: string, siblingKeys: ReadonlySet<string>): void => {
    const peerKeys = new Set(props.map((p) => p.key));
    const byTemplate = new Map<string, string[]>();

    for (const p of props) {
      if (p.c.setter !== '') {
        const list = byTemplate.get(p.c.setter) ?? [];
        list.push(p.key);
        byTemplate.set(p.c.setter, list);
      }
      for (const ph of parseTemplate(p.c.setter)) {
        const cat = classify(ph.name, p, peerKeys, siblingKeys);
        if (cat === null) unknown.push(`${ph.raw} @ ${where}.${p.key} in ${p.c.setter}`);
        else sites.push({ where: `${where}.${p.key}`, template: p.c.setter, ph, category: cat });
      }
    }
    for (const [template, keys] of byTemplate) {
      if (keys.length > 1) multiProp.push({ where, keys, template });
    }
  };

  const visitCreate = (tpl: string, where: string, siblingKeys: ReadonlySet<string>): void => {
    for (const ph of parseTemplate(tpl)) {
      const cat = classify(ph.name, undefined, new Set(), siblingKeys);
      if (cat === null) unknown.push(`${ph.raw} @ ${where} in ${tpl}`);
      else sites.push({ where, template: tpl, ph, category: cat });
    }
  };

  visitProps(OBJ_BASE.props, 'obj-base', new Set());
  for (const w of ALL_WIDGETS as WidgetSpec[]) {
    visitCreate(w.cCreate, `${w.type}.cCreate`, new Set());
    visitProps(w.props, w.type, new Set());
    for (const c of (w.children ?? []) as ChildSpec[]) {
      const siblingKeys = new Set((c.createProps ?? []).map((p) => p.key));
      const where = `${w.type}>${c.type}`;
      if (c.cCreate !== undefined && c.cCreate !== '') visitCreate(c.cCreate, `${where}.cCreate`, siblingKeys);
      visitProps(c.createProps ?? [], `${where}.createProps`, siblingKeys);
      visitProps(c.props, where, siblingKeys);
    }
  }
  return { sites, unknown, multiProp };
}

const { sites, unknown, multiProp } = collect();

/* ------------------------------------------------------------------ 断言 */

describe('模板 DSL 是封闭的', () => {
  it('每个占位符都能归入已知类别 —— 否则分发器写不完', () => {
    expect(unknown).toEqual([]);
  });

  it('语法只有两种形态,且三元只有「动画开关」一条规则', () => {
    const ternaries = sites.filter((s) => s.ph.ternary !== undefined);
    expect(ternaries).toHaveLength(5);
    for (const t of ternaries) {
      expect(t.ph.ternary).toEqual(['LV_ANIM_ON', 'LV_ANIM_OFF']);
      expect(t.category).toBe('companion');   // 三元只作用在 companion 上
    }
  });

  it('类别分布 —— 这就是分发器的工作量清单(变动时同步更新文档)', () => {
    const byCat: Record<string, number> = {};
    for (const s of sites) byCat[s.category] = (byCat[s.category] ?? 0) + 1;
    expect(Object.fromEntries(Object.entries(byCat).sort())).toEqual({
      companion: 7,
      listArray: 3,
      listCount: 2,
      loop: 3,
      obj: 147,
      objRef: 1,
      parent: 61,
      peerProp: 22,
      sibling: 23,
      value: 138,
    });
    expect(sites).toHaveLength(407);
  });
});

describe('分发器必须支持的非平凡形态', () => {
  /**
   * 最容易漏的一条:多个属性共用一个 C 调用。
   * 分发器不能「一个属性发一次调用」,必须先把同模板的属性聚合再发一次。
   */
  it('多属性塌缩成一次 C 调用的只有 3 组,且全部已知', () => {
    expect(multiProp.map((m) => `${m.where}: ${m.keys.join('+')}`)).toEqual([
      'spinner: anim_duration+angle',
      'imagebutton: src_released_left+src_released_mid+src_released_right',
      'imagebutton: src_pressed_left+src_pressed_mid+src_pressed_right',
    ]);
  });

  it('peerProp 只出现在上述 3 组里 —— 没有别处依赖兄弟属性', () => {
    const owners = [...new Set(sites.filter((s) => s.category === 'peerProp')
      .map((s) => s.where.split('.')[0]!))].sort();
    expect(owners).toEqual(['imagebutton', 'spinner']);
  });

  it('值驱动循环只有 2 处(buttonmatrix.ctrl_map / chart-series.values)', () => {
    const owners = [...new Set(sites.filter((s) => s.category === 'loop').map((s) => s.where))].sort();
    expect(owners).toEqual(['buttonmatrix.ctrl_map', 'chart>chart-series.values']);
  });

  it('节点引用只有 1 处(keyboard.textarea)', () => {
    const owners = sites.filter((s) => s.category === 'objRef').map((s) => s.where);
    expect(owners).toEqual(['keyboard.textarea']);
  });

  /**
   * 数组不一定带长度 —— 有的 LVGL API 靠哨兵结尾。分发器不能假设「数组必配 $n」。
   * 两处例外都是 LVGL 的既有约定,不是 registry 写漏:
   */
  it('数组传参有两种形态,例外清单是穷举的', () => {
    const withCount: string[] = [];
    const sentinel: string[] = [];
    for (const s of sites.filter((x) => x.category === 'listArray')) {
      const names = parseTemplate(s.template).map((p) => p.name);
      (names.includes('n') ? withCount : sentinel).push(s.where);
    }
    // ① 指针 + 长度
    expect([...new Set(withCount)].sort()).toEqual(['animimage.srcs', 'line.points']);
    // ② 哨兵结尾:lv_buttonmatrix_set_map 的 map 以 "" 结尾,C API 自己数长度
    expect([...new Set(sentinel)].sort()).toEqual(['buttonmatrix.map']);

    // 反向:有 $n 就必须有数组
    for (const s of sites.filter((x) => x.category === 'listCount')) {
      const names = parseTemplate(s.template).map((p) => p.name);
      expect(names.some((n) => LIST_ARRAYS.has(n)), `${s.where} 有 $n 却没有数组`).toBe(true);
    }

    // imagebutton 的 left/mid/right 不走数组,而是 6 个独立属性塞进 2 次定长调用,
    // 因此归类为 peerProp(见上一条测试),分发器按「聚合后一次调用」处理即可。
  });

  /**
   * $v 可以在一个模板里出现多次(同一个值用在不同实参位)。
   * 分发器按名字替换即可,但不能假设「$v 只出现一次」而只替换首个。
   */
  it('$v 可重复出现,当前只有 qrcode.data 一处(指针 + lv_strlen)', () => {
    const seen = new Map<string, number>();
    for (const s of sites.filter((x) => x.category === 'value')) {
      seen.set(s.where, (seen.get(s.where) ?? 0) + 1);
    }
    const repeated = [...seen].filter(([, n]) => n > 1);
    expect(repeated).toEqual([['qrcode.data', 2]]);
    expect(sites.find((s) => s.where === 'qrcode.data')!.template)
      .toBe('lv_qrcode_update($obj, $v, lv_strlen($v))');
  });

  it('loop / objRef 形态逐个有说明,且清单与现实不脱节', () => {
    const usedLoop = new Set(sites.filter((s) => s.category === 'loop').map((s) => s.ph.name));
    const usedRef = new Set(sites.filter((s) => s.category === 'objRef').map((s) => s.ph.name));
    expect([...usedLoop].sort()).toEqual(Object.keys(LOOP_NAMES).sort());
    expect([...usedRef].sort()).toEqual(Object.keys(OBJ_REF_NAMES).sort());
  });
});

describe('IR 必须携带的上下文', () => {
  it('61 处需要父句柄 —— IR 下发指令时必须带上父,不能只带自身', () => {
    const parentSites = sites.filter((s) => s.category === 'parent');
    expect(parentSites).toHaveLength(61);
    // 其中有多少是「子元素的操作挂在父 widget 上」这种真正需要双句柄的
    const childOps = parentSites.filter((s) => s.where.includes('>') && !s.where.endsWith('.cCreate'));
    expect(childOps.length).toBeGreaterThan(0);
  });

  it('23 处寻址参数来自 createProps —— virtual 子元素靠它定位,不产生对象', () => {
    const owners = [...new Set(sites.filter((s) => s.category === 'sibling')
      .map((s) => s.where.split('.')[0]!))].sort();
    expect(owners).toEqual([
      'chart>chart-axis', 'chart>chart-cursor', 'chart>chart-series',
      'list>list-button', 'list>list-text', 'menu>menu-page', 'msgbox>msgbox-button',
      'table>table-cell', 'table>table-column', 'tabview>tabview-tab',
      'tabview>tabview-tab_button', 'tileview>tileview-tile', 'win>win-button',
    ]);
  });
});
