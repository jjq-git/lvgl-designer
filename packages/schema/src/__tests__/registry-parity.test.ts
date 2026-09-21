/**
 * 对账测试:registry ↔ scripts/out/parser-attrs.json(LVGL 9.4 XML parser 源码 ground truth)。
 *
 * 输入由 `node scripts/audit-parsers.mjs` 生成,而该脚本需要 vendor/lvgl 源码。
 * `vendor/` 在 .gitignore 里,所以刚 clone 下来的机器上这份输入是**不存在**的 ——
 * 缺失时跳过依赖它的用例,而不是让整个测试文件在收集阶段就抛异常。
 * (与 registry-lvgl95-parity.test.ts 读 lvgl-symbols.json 是同一套约定。)
 *
 * ⚠️ 本文件的 ground truth 是 **9.4 的 XML parser**。LVGL 9.5 已移除 XML 引擎
 * (见 docs/lvgl-version-baseline.md §2.2),预览改为 IR 直驱 C API 后,
 * 「registry ↔ XML parser」这条对账会失去对象,应由
 * registry-lvgl95-parity.test.ts(registry ↔ LVGL C API 符号表)接替。
 * 在 9.4 runtime 退役前本文件继续有效,不要提前删。
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALL_WIDGETS, EXTRA_WIDGETS, OBJ_BASE, OFFICIAL_WIDGETS, REGISTRY,
} from '../widgets/index.js';
import { STYLE_PROPS, M1_INSPECTOR_STYLE_KEYS } from '../styleProps.js';

const parserAttrsPath = fileURLToPath(
  new URL('../../../../scripts/out/parser-attrs.json', import.meta.url),
);

interface ParserAttr {
  name: string;
  enum?: string[];
  companions?: string[];
  via?: string;                       // 'get_value_of':apply 阶段读的构造/选择器参数
}
interface ParserData {
  widgets: Record<string, {
    create: Record<string, string[]>;
    apply: Record<string, ParserAttr[]>;
  }>;
  obj: {
    classified: {
      props: string[];
      flags: string[];
      states: string[];
      bind: string[];
      inlineStyleProps: string[];
    };
  };
}

/** 缺 vendor/lvgl 时 audit-parsers.mjs 跑不出这份输入 —— 跳过而非炸掉整个文件 */
const available = existsSync(parserAttrsPath);
const parser: ParserData = available
  ? JSON.parse(readFileSync(parserAttrsPath, 'utf8'))
  : { widgets: {}, obj: { classified: { props: [], flags: [], states: [], bind: [], inlineStyleProps: [] } } };

/** widget 主 apply 函数的属性表(name → attr) */
function mainApply(type: string): Map<string, ParserAttr> {
  const w = parser.widgets[type];
  expect(w, `parser-attrs.json 缺 widget ${type}`).toBeDefined();
  const attrs = w!.apply[`lv_xml_${type}_apply`];
  expect(attrs, `parser-attrs.json 缺 lv_xml_${type}_apply`).toBeDefined();
  return new Map(attrs!.map((a) => [a.name, a]));
}

const ALL_TYPES = [
  // M1 15 个
  'obj', 'label', 'button', 'slider', 'switch', 'checkbox', 'bar', 'arc',
  'image', 'dropdown', 'roller', 'textarea', 'spinbox', 'qrcode', 'scale',
  // M2 官方 7 个
  'buttonmatrix', 'calendar', 'chart', 'keyboard', 'spangroup', 'table', 'tabview',
];

/** parser 走 base type 转换器(lv_xml_dir_to_enum 等),audit 脚本不记录枚举 */
const BASE_TYPE_ENUM_PREFIXES = ['LV_DIR_'];

/** M3 自研 13 个(与 manifest 的对账在 manifest-parity.test.ts) */
const EXTRA_TYPES = [
  'led', 'line', 'spinner', 'imagebutton', 'animimage', 'msgbox', 'list',
  'menu', 'win', 'tileview', 'arclabel', 'canvas', 'lottie',
];

describe('REGISTRY 完整性', () => {
  it('35 控件 = 官方 22 + 自研 13(唯一排除 3dtexture)', () => {
    expect(OFFICIAL_WIDGETS.map((w) => w.type).sort()).toEqual([...ALL_TYPES].sort());
    expect(EXTRA_WIDGETS.map((w) => w.type).sort()).toEqual([...EXTRA_TYPES].sort());
    expect(ALL_WIDGETS).toHaveLength(35);
    expect([...REGISTRY.keys()].sort()).toEqual([...ALL_TYPES, ...EXTRA_TYPES].sort());
  });

  it('每个 widget 带 palette 元数据与 defaultSize', () => {
    for (const w of ALL_WIDGETS) {
      expect(w.palette, `${w.type} 缺 palette`).toBeDefined();
      expect(w.palette!.label.length).toBeGreaterThan(0);
      expect(w.defaultSize, `${w.type} 缺 defaultSize`).toBeDefined();
      expect(w.xmlTag).toBe(`lv_${w.type}`);
    }
  });
});

describe.skipIf(!available)('widget 专有属性 ↔ parser 对账', () => {
  const nonObj = ALL_TYPES.filter((t) => t !== 'obj');

  for (const type of nonObj) {
    it(`${type}:registry 每个 both 属性都在 parser 清单里,枚举 token 集相等`, () => {
      const attrs = mainApply(type);
      const spec = REGISTRY.get(type)!;

      for (const prop of spec.props) {
        if (prop.channel === 'c-only') {
          // c-only 属性不应出现在 parser 清单里(否则应改 both)
          expect(attrs.has(prop.key), `${type}.${prop.key} 标了 c-only 但 parser 有`).toBe(false);
          continue;
        }
        const attr = attrs.get(prop.key);
        expect(attr, `${type}.${prop.key} 不在 parser 清单`).toBeDefined();

        // 枚举 token 集(本体或伴生属性上的)与 parser 逐字一致
        const parserEnum = attr!.enum;
        const regEnum = prop.enum ?? prop.companions?.find((c) => c.enum)?.enum;
        if (parserEnum) {
          expect(regEnum, `${type}.${prop.key} parser 有枚举而 registry 没有`).toBeDefined();
          expect([...regEnum!.tokens].sort()).toEqual([...parserEnum].sort());
          // 顺序也一致(照抄源码)
          expect([...regEnum!.tokens]).toEqual(parserEnum);
        } else if (prop.enum) {
          // parser 走 base type 转换器(如 tabview.tab_bar_position → lv_xml_dir_to_enum),
          // audit 脚本不记录;registry 用对应 base enum 即合法
          expect(BASE_TYPE_ENUM_PREFIXES,
            `${type}.${prop.key} registry 有枚举而 parser 没有(且非 base type)`)
            .toContain(prop.enum.cPrefix);
        }

        // 伴生属性(value-animated / options-mode 等)照 parser 记录
        const parserComp = attr!.companions ?? [];
        const regComp = (prop.companions ?? []).map((c) => c.xmlAttr);
        expect(regComp.sort()).toEqual([...parserComp].sort());
      }
    });

    it(`${type}:parser 清单反向覆盖(除 bind_*,无漏项)`, () => {
      const attrs = mainApply(type);
      const spec = REGISTRY.get(type)!;
      const regKeys = new Set(spec.props.filter((p) => p.channel === 'both').map((p) => p.key));
      for (const name of attrs.keys()) {
        if (name.startsWith('bind_')) continue;   // 绑定走 bindableProps
        expect(regKeys.has(name), `parser 属性 ${type}.${name} 未进 registry`).toBe(true);
      }
    });

    it(`${type}:bindableProps 都有对应 parser bind_* 实现`, () => {
      const attrs = mainApply(type);
      const spec = REGISTRY.get(type)!;
      for (const b of spec.bindableProps) {
        if (b === 'checked') {
          // bind_checked 来自 obj 基类
          expect(parser.obj.classified.bind).toContain('bind_checked');
        } else {
          expect(attrs.has(`bind_${b}`), `${type} 宣称可绑 ${b} 但 parser 无 bind_${b}`).toBe(true);
        }
      }
    });
  }

  it('obj/button:无专有属性(仅基类)', () => {
    expect(REGISTRY.get('obj')!.props).toHaveLength(0);
    expect(REGISTRY.get('button')!.props).toHaveLength(0);
  });
});

describe.skipIf(!available)('ChildSpec ↔ parser 子元素对账(仅官方 22;自研 children 走 manifest-parity)', () => {
  const withChildren = OFFICIAL_WIDGETS.filter((w) => (w.children?.length ?? 0) > 0);

  it('声明 children 的 widget 集合正确', () => {
    expect(withChildren.map((w) => w.type).sort()).toEqual(
      ['calendar', 'chart', 'dropdown', 'spangroup', 'table', 'tabview'],
    );
    const extraWithChildren = EXTRA_WIDGETS.filter((w) => (w.children?.length ?? 0) > 0);
    expect(extraWithChildren.map((w) => w.type).sort()).toEqual(
      ['list', 'menu', 'msgbox', 'tileview', 'win'],
    );
  });

  for (const w of withChildren) {
    for (const child of w.children!) {
      it(`${child.type}:xmlTag 全名、create 实参与 apply 属性逐字对账`, () => {
        expect(child.xmlTag).toBe(`lv_${child.type}`);

        const parserWidget = parser.widgets[w.type]!;
        const fnBase = `lv_xml_${child.type.replace(/-/g, '_')}`;
        const applyAttrs = parserWidget.apply[`${fnBase}_apply`];
        expect(applyAttrs, `parser 缺 ${fnBase}_apply`).toBeDefined();
        const createArgs = parserWidget.create[`${fnBase}_create`];
        expect(createArgs, `parser 缺 ${fnBase}_create`).toBeDefined();

        // createProps ↔ create 实参 ∪ apply 里 via get_value_of 的选择器参数
        const viaNames = applyAttrs!.filter((a) => a.via === 'get_value_of').map((a) => a.name);
        const parserCreateKeys = [...createArgs!, ...viaNames].sort();
        const regCreateKeys = (child.createProps ?? []).map((p) => p.key).sort();
        expect(regCreateKeys).toEqual(parserCreateKeys);

        // props ↔ apply 属性(via 项除外),双向覆盖 + 枚举 token 逐字一致
        const attrByName = new Map(applyAttrs!.map((a) => [a.name, a]));
        for (const prop of child.props) {
          if (prop.channel === 'c-only') {
            expect(attrByName.has(prop.key), `${child.type}.${prop.key} 标了 c-only 但 parser 有`).toBe(false);
            continue;
          }
          const attr = attrByName.get(prop.key);
          expect(attr, `${child.type}.${prop.key} 不在 parser 清单`).toBeDefined();
          if (attr!.enum) {
            expect(prop.enum, `${child.type}.${prop.key} parser 有枚举而 registry 没有`).toBeDefined();
            expect([...prop.enum!.tokens]).toEqual(attr!.enum);
          } else if (prop.enum) {
            expect(['LV_DIR_']).toContain(prop.enum.cPrefix);
          }
          const parserComp = attr!.companions ?? [];
          const regComp = (prop.companions ?? []).map((c) => c.xmlAttr);
          expect(regComp.sort()).toEqual([...parserComp].sort());
        }
        const regKeys = new Set(child.props.filter((p) => p.channel === 'both').map((p) => p.key));
        for (const a of applyAttrs!) {
          if (a.via === 'get_value_of') continue;
          expect(regKeys.has(a.name), `parser 属性 ${child.type}.${a.name} 未进 registry`).toBe(true);
        }

        // kind 约束:virtual 无 cCreate;add/getter 有
        if (child.kind === 'virtual') expect(child.cCreate).toBeUndefined();
        else expect(child.cCreate).toContain('$parent');
        // 非 obj 系不可收 widget 子节点
        if (!child.isObj) expect(child.acceptsWidgetChildren).toBe(false);
      });
    }
  }
});

describe.skipIf(!available)('OBJ_BASE ↔ obj parser 节', () => {
  it('flags 25 项逐字一致', () => {
    expect(OBJ_BASE.flags).toHaveLength(25);
    expect([...OBJ_BASE.flags]).toEqual(parser.obj.classified.flags);
  });

  it('states 8 项逐字一致', () => {
    expect(OBJ_BASE.states).toHaveLength(8);
    expect([...OBJ_BASE.states]).toEqual(parser.obj.classified.states);
  });

  it('props 与 obj 清单双向一致(name 除外,单列于 WidgetNode.name)', () => {
    const parserProps = new Set(parser.obj.classified.props.filter((p) => p !== 'name'));
    const regProps = new Set(OBJ_BASE.props.map((p) => p.key));
    expect([...regProps].sort()).toEqual([...parserProps].sort());
  });
});

describe.skipIf(!available)('STYLE_PROPS ↔ 内联 style_ 清单', () => {
  it('112 项,键集(加 style_ 前缀)逐字一致', () => {
    const parserKeys = parser.obj.classified.inlineStyleProps;
    expect(parserKeys).toHaveLength(112);
    const regKeys = Object.keys(STYLE_PROPS).map((k) => `style_${k}`);
    expect(regKeys.sort()).toEqual([...parserKeys].sort());
  });

  it('m1Inspector 子集 ~25 项且都是合法键', () => {
    expect(M1_INSPECTOR_STYLE_KEYS.length).toBeGreaterThanOrEqual(20);
    expect(M1_INSPECTOR_STYLE_KEYS.length).toBeLessThanOrEqual(30);
    for (const k of M1_INSPECTOR_STYLE_KEYS) {
      expect(STYLE_PROPS[k]).toBeDefined();
    }
    // 任务点名的常用项必须在子集里
    for (const k of [
      'bg_color', 'bg_opa', 'radius', 'border_color', 'border_width',
      'pad_all', 'pad_hor', 'pad_ver', 'text_color', 'text_font', 'text_align',
      'shadow_width', 'shadow_color', 'outline_color', 'outline_width',
      'opa', 'align',
    ]) {
      expect(STYLE_PROPS[k]?.m1Inspector, `${k} 应标 m1Inspector`).toBe(true);
    }
  });

  it('每项 cSuffix == key,enum 项都带 token 表', () => {
    for (const s of Object.values(STYLE_PROPS)) {
      expect(s.cSuffix).toBe(s.key);
      if (s.type === 'enum') expect(s.enum?.tokens.length).toBeGreaterThan(0);
      else expect(s.enum).toBeUndefined();
    }
  });
});
