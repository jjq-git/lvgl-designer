/**
 * 对账测试:Widget Registry 的 C API 引用 ↔ LVGL 9.5.0 真实符号表。
 *
 * 为什么需要:阶段 0 判定「9.5 移除 XML 引擎后,预览改为自有 IR 直驱 LVGL C API」可行,
 * 依据是「widget C API 在 9.5 几乎无破坏」。那是对 runtime 源码的统计;本测试换个角度证伪 ——
 * 直接拿 **registry 声明要调用的每一个 C 符号**,去 9.5 的头文件符号表里查。
 * 全部命中 = 直驱路径在 9.5 上真的走得通,不是纸面推断。
 *
 * 输入 scripts/out/lvgl-symbols.json 由 `node scripts/audit-lvgl-version-diff.mjs` 生成
 * (与 registry-parity.test.ts 读 parser-attrs.json 是同一套约定)。文件缺失时跳过,
 * 因为它需要联网下载 LVGL tarball,不该让离线开发者的测试变红。
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_WIDGETS, OBJ_BASE } from '../widgets/index.js';
import type { ChildSpec, PropSpec, WidgetSpec } from '../registryTypes.js';

const symbolsPath = fileURLToPath(
  new URL('../../../../scripts/out/lvgl-symbols.json', import.meta.url),
);
const available = existsSync(symbolsPath);
const symbols: Record<string, string[]> = available
  ? JSON.parse(readFileSync(symbolsPath, 'utf8'))
  : {};

/** 从 C 模板里抽被调用的函数名:'lv_slider_set_value($obj, $v, $anim)' → lv_slider_set_value */
function calleesOf(template: string): string[] {
  return [...template.matchAll(/\b(lv_[a-z0-9_]+)\s*\(/g)].map((m) => m[1]!);
}

interface Site { symbol: string; where: string }

/** registry 里声明要调用的全部 LVGL 符号,带出处 */
function collectSites(): Site[] {
  const sites: Site[] = [];
  const addProps = (props: PropSpec[], where: string): void => {
    for (const p of props) {
      for (const sym of calleesOf(p.c.setter)) sites.push({ symbol: sym, where: `${where}.${p.key}` });
    }
  };
  const addChild = (c: ChildSpec, where: string): void => {
    if (c.cCreate !== undefined) {
      for (const sym of calleesOf(c.cCreate)) sites.push({ symbol: sym, where: `${where}.cCreate` });
    }
    addProps(c.createProps ?? [], `${where}.createProps`);
    addProps(c.props, where);
  };

  addProps(OBJ_BASE.props, 'obj-base');
  for (const w of ALL_WIDGETS as WidgetSpec[]) {
    for (const sym of calleesOf(w.cCreate)) sites.push({ symbol: sym, where: `${w.type}.cCreate` });
    addProps(w.props, w.type);
    for (const c of w.children ?? []) addChild(c, `${w.type}>${c.type}`);
  }
  return sites;
}

const sites = collectSites();
const distinct = [...new Set(sites.map((s) => s.symbol))].sort();

describe.skipIf(!available)('Widget Registry ↔ LVGL 9.5.0 C API', () => {
  it('符号表已生成(否则跑 node scripts/audit-lvgl-version-diff.mjs)', () => {
    expect(symbols['v9.5.0']?.length ?? 0).toBeGreaterThan(3000);
  });

  it('registry 声明的每一个 C 符号在 9.5.0 中都存在 —— 直驱路径可行的直接证据', () => {
    const have = new Set(symbols['v9.5.0']);
    const missing = sites.filter((s) => !have.has(s.symbol));
    // 报出处而不只报符号名,失败时能直接定位到 registry 的哪一项
    expect(missing.map((s) => `${s.symbol} @ ${s.where}`)).toEqual([]);
  });

  it('9.4 → 9.5 之间,registry 用到的 C 符号没有一个消失', () => {
    const in94 = new Set(symbols['v9.4.0']);
    const in95 = new Set(symbols['v9.5.0']);
    const regressed = distinct.filter((s) => in94.has(s) && !in95.has(s));
    expect(regressed).toEqual([]);
  });

  it('registry 覆盖面统计(变动时更新此处,便于评审看规模)', () => {
    expect(ALL_WIDGETS.length).toBe(35);
    // 去重后的 C 符号数 = 「IR 直驱」需要在 bridge 侧分发的 API 面。
    // 这个数字是 docs/preview-architecture.md §3.2 工作量估算的依据,变了要同步改文档。
    expect(distinct.length).toBe(197);
  });
});

describe('registry C 模板自洽性(不依赖 LVGL 源码)', () => {
  /**
   * 空 setter 只有两种合法来源:
   *   a) createProps —— 它是**构造函数实参**,由父级 cCreate 以 `$key` 消费
   *      (如 chart-series 的 color/axis 进 `lv_chart_add_series($parent, $color, $axis)`)
   *   b) 少数需要 emitter 特殊形态的属性,逐个列在下面的白名单里
   * 除此以外的空 setter 就是漏填 —— IR 直驱时该属性会被静默丢弃。
   */
  const EMPTY_SETTER_ALLOWED = new Set([
    // lottie.src:C 侧走 lv_lottie_set_src_data(extern 数组),形态与普通 setter 不同,
    // 由 emitter 特判;预览侧走 lv_lottie_set_src_file(见 registry 注释)。
    'lottie.src',
  ]);

  it('非 createProps 的属性都有可调用的 c.setter(空 setter 需在白名单里)', () => {
    const bad: string[] = [];
    const check = (props: PropSpec[], where: string): void => {
      for (const p of props) {
        const id = `${where}.${p.key}`;
        if (EMPTY_SETTER_ALLOWED.has(id)) continue;
        if (calleesOf(p.c.setter).length === 0) bad.push(`${id}: ${JSON.stringify(p.c.setter)}`);
      }
    };
    check(OBJ_BASE.props, 'obj-base');
    for (const w of ALL_WIDGETS as WidgetSpec[]) {
      check(w.props, w.type);
      for (const c of w.children ?? []) check(c.props, `${w.type}>${c.type}`);
    }
    expect(bad).toEqual([]);
  });

  it('add/getter 子元素的空 setter createProp 都被 cCreate 以 $key 消费 —— 否则该属性无人接收', () => {
    const orphans: string[] = [];
    for (const w of ALL_WIDGETS as WidgetSpec[]) {
      for (const c of w.children ?? []) {
        // virtual 子元素没有 C 构造函数(chart-axis / table-column / table-cell):
        // 它们的 createProps 是**寻址参数**,由兄弟属性的 setter 消费,
        // 例如 table-cell 的 row/column 进 lv_table_set_cell_value($obj, $row, $column, $v)。
        if (c.kind === 'virtual') continue;
        for (const p of c.createProps ?? []) {
          if (calleesOf(p.c.setter).length > 0) continue;   // 有独立 setter,不必进构造
          const template = c.cCreate ?? '';
          if (!template.includes(`$${p.key}`)) {
            orphans.push(`${w.type}>${c.type}.${p.key} 未出现在 cCreate: ${JSON.stringify(template)}`);
          }
        }
      }
    }
    expect(orphans).toEqual([]);
  });

  it('virtual 子元素确实没有 cCreate —— IR 直驱时它们不产生对象,只提供寻址参数', () => {
    const bad: string[] = [];
    for (const w of ALL_WIDGETS as WidgetSpec[]) {
      for (const c of w.children ?? []) {
        if (c.kind === 'virtual' && (c.cCreate ?? '') !== '') {
          bad.push(`${w.type}>${c.type}: virtual 却带 cCreate ${JSON.stringify(c.cCreate)}`);
        }
        if (c.kind !== 'virtual' && (c.cCreate ?? '') === '') {
          bad.push(`${w.type}>${c.type}: kind=${c.kind} 却缺 cCreate`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('每个 widget 的 cCreate 都调用了 lv_*_create', () => {
    const bad = (ALL_WIDGETS as WidgetSpec[])
      .filter((w) => !calleesOf(w.cCreate).some((s) => s.endsWith('_create')))
      .map((w) => `${w.type}: ${w.cCreate}`);
    expect(bad).toEqual([]);
  });

  it('c-only 属性确实存在 —— 它们是 XML 表达不了、只能走 C 的能力', () => {
    const cOnly = (ALL_WIDGETS as WidgetSpec[]).flatMap((w) =>
      w.props.filter((p) => p.channel === 'c-only').map((p) => `${w.type}.${p.key}`));
    // 去 XML 后这些不再是「受限项」,而是普通 typed property(见 docs/preview-architecture.md §5)
    expect(cOnly.length).toBeGreaterThan(0);
  });
});
