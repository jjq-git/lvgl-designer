/**
 * 对账测试:EXTRA_WIDGETS(自研 13)↔ runtime/src/xml_parsers_extra/manifest.json。
 * manifest 是 C 阶段唯一事实源(A 产出,已与自研 parser .c 逐字对齐):
 * 属性名 / 类型 / 枚举 token(含顺序)/ cPrefix / cSetter / 子元素 tag·kind·createAttrs
 * 双向逐字一致;约定内偏差集中在下方白名单。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXTRA_WIDGETS } from '../widgets/index.js';
import type { PropSpec, PropTypeName, WidgetSpec } from '../registryTypes.js';

const manifestPath = fileURLToPath(
  new URL('../../../../runtime/src/xml_parsers_extra/manifest.json', import.meta.url),
);

interface ManifestEnum { tokens: string[]; cPrefix: string }
interface ManifestAttr { name: string; type: string; enum?: ManifestEnum; cSetter: string }
interface ManifestChild {
  type: string; xmlTag: string; kind: 'add' | 'getter' | 'virtual';
  createAttrs?: ManifestAttr[]; attrs: ManifestAttr[];
}
interface ManifestWidget {
  type: string; xmlTag: string; attrs: ManifestAttr[];
  children?: ManifestChild[]; notes?: string;
}

const manifest: ManifestWidget[] = JSON.parse(readFileSync(manifestPath, 'utf8'));
const byType = new Map(manifest.map((m) => [m.type, m]));
const registry = new Map(EXTRA_WIDGETS.map((w) => [w.type, w]));

/**
 * 类型对账白名单:manifest 类型 → registry 可用的等价类型。
 * - line.points:manifest 记 intList(XML 通道语义),registry 用 pointList
 *   (JSON 平铺坐标对 + XML "x1,y1 x2,y2" 格式化,format.ts 专门分支)
 */
const TYPE_EQUIV: Record<string, PropTypeName[]> = {
  'line.points': ['pointList'],
};

/**
 * cSetter 对账白名单(见 extraWidgets.ts 头注):
 * - line.points:C 静态数组用 lv_line_set_points(manifest 为 _mutable,parser 堆持有)
 * - lottie.src:C 走 lv_lottie_set_src_data 特殊形态,registry setter 置空
 */
const SETTER_EXEMPT: Record<string, (regSetter: string) => boolean> = {
  'line.points': (s) => s.startsWith('lv_line_set_points('),
  'lottie.src': (s) => s === '',
};

function checkAttr(scope: string, mAttr: ManifestAttr, prop: PropSpec): void {
  const key = `${scope}.${mAttr.name}`;

  // 类型逐字一致(或白名单等价)
  if (prop.type !== mAttr.type) {
    expect(TYPE_EQUIV[key], `${key} 类型不一致:manifest=${mAttr.type} registry=${prop.type}`)
      .toContain(prop.type);
  }

  // 枚举 token 逐字逐序 + cPrefix
  if (mAttr.enum) {
    expect(prop.enum, `${key} manifest 有枚举而 registry 没有`).toBeDefined();
    expect([...prop.enum!.tokens]).toEqual(mAttr.enum.tokens);
    expect(prop.enum!.cPrefix).toBe(mAttr.enum.cPrefix);
  } else {
    expect(prop.enum, `${key} registry 有枚举而 manifest 没有`).toBeUndefined();
  }

  // cSetter:registry setter 模板以 manifest.cSetter 开头(或白名单约定偏差)
  const exempt = SETTER_EXEMPT[key];
  if (exempt) {
    expect(exempt(prop.c.setter), `${key} setter 白名单不匹配:${prop.c.setter}`).toBe(true);
  } else {
    expect(
      prop.c.setter.startsWith(`${mAttr.cSetter}(`),
      `${key} cSetter 不一致:manifest=${mAttr.cSetter} registry=${prop.c.setter}`,
    ).toBe(true);
  }

  // 全部 both 通道(自研 parser 都实现了)
  expect(prop.channel, `${key} 应为 both`).toBe('both');
}

describe('EXTRA_WIDGETS ↔ manifest.json', () => {
  it('恰好 13 个,类型集与 manifest 一致', () => {
    expect(manifest).toHaveLength(13);
    expect([...registry.keys()].sort()).toEqual([...byType.keys()].sort());
  });

  for (const m of manifest) {
    it(`${m.type}:xmlTag / 属性名序 / 类型 / 枚举 / cSetter 逐字对账`, () => {
      const spec: WidgetSpec | undefined = registry.get(m.type);
      expect(spec, `registry 缺 ${m.type}`).toBeDefined();
      expect(spec!.xmlTag).toBe(m.xmlTag);
      expect(spec!.lvUseGuard).toBe(`LV_USE_${m.type === 'animimage' ? 'ANIMIMG' : m.type.toUpperCase()}`);

      // 属性键集 + 顺序照抄 manifest
      expect(spec!.props.map((p) => p.key)).toEqual(m.attrs.map((a) => a.name));
      const propByKey = new Map(spec!.props.map((p) => [p.key, p]));
      for (const a of m.attrs) checkAttr(m.type, a, propByKey.get(a.name)!);
    });

    it(`${m.type}:children 逐字对账`, () => {
      const spec = registry.get(m.type)!;
      const mChildren = m.children ?? [];
      const rChildren = spec.children ?? [];
      expect(rChildren.map((c) => c.type)).toEqual(mChildren.map((c) => c.type));

      for (let i = 0; i < mChildren.length; i++) {
        const mc = mChildren[i]!;
        const rc = rChildren[i]!;
        expect(rc.xmlTag, `${mc.type} xmlTag`).toBe(mc.xmlTag);
        expect(rc.kind, `${mc.type} kind`).toBe(mc.kind);
        // createAttrs 名序一致;cCreate 模板含 $parent 且逐个引用 create 实参
        const mCreate = (mc.createAttrs ?? []).map((a) => a.name);
        expect((rc.createProps ?? []).map((p) => p.key)).toEqual(mCreate);
        expect(rc.cCreate, `${mc.type} cCreate`).toContain('$parent');
        for (const a of mc.createAttrs ?? []) {
          expect(rc.cCreate, `${mc.type} cCreate 缺 $${a.name}`).toContain(`$${a.name}`);
          const rp = rc.createProps!.find((p) => p.key === a.name)!;
          if (a.enum) {
            expect([...rp.enum!.tokens]).toEqual(a.enum.tokens);
            expect(rp.enum!.cPrefix).toBe(a.enum.cPrefix);
          }
        }
        // 全部 add 型 create 函数(lv_msgbox_add_footer_button 等)返回 lv_obj_t:isObj
        expect(rc.isObj, `${mc.type} 应为 isObj`).toBe(true);
        // apply 属性(manifest 里 13 控件子元素均为空)
        expect(rc.props.map((p) => p.key)).toEqual(mc.attrs.map((a) => a.name));
      }
    });
  }

  it('每个自研控件带 palette 与 defaultSize,xmlTag=lv_<type>', () => {
    for (const w of EXTRA_WIDGETS) {
      expect(w.palette, `${w.type} 缺 palette`).toBeDefined();
      expect(w.defaultSize, `${w.type} 缺 defaultSize`).toBeDefined();
      expect(w.xmlTag).toBe(`lv_${w.type}`);
    }
  });
});
