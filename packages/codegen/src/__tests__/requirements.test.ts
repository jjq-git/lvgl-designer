/**
 * REQUIREMENTS 收集逻辑 + 多目标导出单测。
 * chart+qrcode+字体工程 → 断言清单齐(含 qrcode→canvas 依赖)且无多余项。
 */
import { describe, expect, it } from 'vitest';
import { collectRequirements, emitC94, normalizeProject } from '../index.js';
import { caseRound466, caseTargets } from './cases.js';
import type { LvProject, WidgetNode } from '@lvd/schema';

let seq = 9000;
function uid(): string {
  seq += 1;
  return `${String(seq).padStart(8, '0')}-0000-4000-8000-000000000000`;
}
function n(type: string, over: Partial<WidgetNode> = {}): WidgetNode {
  return {
    id: uid(), type, props: {}, styles: [], inlineStyles: [],
    events: [], bindings: [], children: [], ...over,
  };
}

/** chart + qrcode + 内置字体(命名样式 montserrat_20 / 内联 montserrat_14) */
function chartQrFontProject(): LvProject {
  seq = 9000;
  return {
    schemaVersion: 1,
    meta: {
      name: 'req', lvglVersion: '9.4', appVersion: '0.1.0',
      createdAt: '2026-07-02T00:00:00.000Z', modifiedAt: '2026-07-02T00:00:00.000Z',
    },
    display: { width: 240, height: 320, shape: 'rect', colorDepth: 32, dpi: 130 },
    screens: [{
      id: uid(), name: 'main', styles: [], consts: [],
      root: n('obj', {
        children: [
          n('chart', { name: 'ch', props: { width: 200, height: 100 } }),
          n('qrcode', {
            name: 'qr', props: { size: 100, data: 'x' },
            inlineStyles: [{ props: { text_font: 'montserrat_14' } }],
          }),
        ],
      }),
    }],
    components: [],
    styles: [{ id: 'st-t', name: 's_t', props: { text_font: 'montserrat_20' } }],
    consts: [], subjects: [],
    assets: { fonts: [], images: [] },
    translations: null,
    codegen: { outputDirName: 'ui', exportXml: false, userIncludes: [] },
  };
}

describe('collectRequirements', () => {
  it('chart+qrcode+字体:清单齐(qrcode→canvas 依赖)且无多余', () => {
    const { ir } = normalizeProject(chartQrFontProject());
    const r = collectRequirements(ir);
    // 齐:chart、qrcode、qrcode 的 canvas 依赖(base_class = lv_canvas_class)
    expect(r.lvUse).toEqual(['LV_USE_CANVAS', 'LV_USE_CHART', 'LV_USE_QRCODE']);
    // 字体:命名样式 + 内联样式都收
    expect(r.montserrat).toEqual([14, 20]);
    // 无多余特征
    expect(r.needsFlex).toBe(false);
    expect(r.needsGrid).toBe(false);
    expect(r.needsObserver).toBe(false);
    expect(r.usesLottie).toBe(false);
    expect(r.colorDepth).toBe(32);
  });

  it('依赖闭包两跳:spinbox→textarea→label;keyboard→buttonmatrix+textarea', () => {
    const p = chartQrFontProject();
    p.screens[0]!.root.children.push(n('spinbox', { props: { value: 1 } }));
    p.screens[0]!.root.children.push(n('keyboard', {}));
    const r = collectRequirements(normalizeProject(p).ir);
    for (const g of ['LV_USE_SPINBOX', 'LV_USE_KEYBOARD', 'LV_USE_BUTTONMATRIX', 'LV_USE_TEXTAREA', 'LV_USE_LABEL']) {
      expect(r.lvUse).toContain(g);
    }
    expect(r.lvUse).not.toContain('LV_USE_SLIDER');
  });

  it('flex props + subjects → LV_USE_FLEX / LV_USE_OBSERVER', () => {
    const r = collectRequirements(normalizeProject(caseRound466()).ir);
    expect(r.needsObserver).toBe(true);
    const rt = collectRequirements(normalizeProject(caseTargets()).ir);
    expect(rt.needsFlex).toBe(true);       // root flex_flow: 'column'
    expect(rt.montserrat).toEqual([16]);   // s_title text_font
  });

  it('REQUIREMENTS.txt 逐项一行,含 LV_USE_OBJ_NAME 与色深建议', () => {
    const files = emitC94(chartQrFontProject()).files;
    const req = files.find((f) => f.path === 'REQUIREMENTS.txt')!.content;
    expect(req).toContain('\nLV_USE_CHART 1\n');
    expect(req).toContain('\nLV_USE_QRCODE 1\n');
    expect(req).toContain('\nLV_USE_CANVAS 1\n');
    expect(req).toContain('\nLV_FONT_MONTSERRAT_14 1\n');
    expect(req).toContain('\nLV_FONT_MONTSERRAT_20 1\n');
    expect(req).toContain('LV_USE_OBJ_NAME 1');
    expect(req).toContain('LV_COLOR_DEPTH 32');
    expect(req).not.toContain('LV_USE_SLIDER');
    expect(req).not.toContain('LV_USE_OBJ 1');   // 基类无 lv_conf 开关
  });
});

describe('多目标导出', () => {
  it('esp-idf(默认)= idf_component_register;cmake = add_library;bare 无 CMakeLists', () => {
    const p = caseTargets();
    const espidf = emitC94(p).files;
    expect(espidf.find((f) => f.path === 'CMakeLists.txt')!.content).toContain('idf_component_register');

    const cmake = emitC94(p, { target: 'cmake' }).files;
    const cm = cmake.find((f) => f.path === 'CMakeLists.txt')!.content;
    expect(cm).toContain('add_library(ui STATIC');
    expect(cm).toContain('target_include_directories(ui PUBLIC ${CMAKE_CURRENT_LIST_DIR})');
    expect(cm).toContain('target_link_libraries(ui PUBLIC lvgl)');

    const bare = emitC94(p, { target: 'bare' }).files;
    expect(bare.find((f) => f.path === 'CMakeLists.txt')).toBeUndefined();

    // 三种目标都有 REQUIREMENTS.txt + INTEGRATION.md,且其余文件集一致
    for (const files of [espidf, cmake, bare]) {
      expect(files.find((f) => f.path === 'REQUIREMENTS.txt')).toBeDefined();
      expect(files.find((f) => f.path === 'INTEGRATION.md')).toBeDefined();
    }
    const names = (fs: typeof bare) => fs.map((f) => f.path).filter((x) => x !== 'CMakeLists.txt').sort();
    expect(names(espidf)).toEqual(names(bare));
    expect(names(cmake)).toEqual(names(bare));
  });

  it('UI_WEAK:ui_conf.h 三分支;actions_default.c 用 UI_WEAK 且整体包 UI_NO_WEAK 守卫', () => {
    const files = emitC94(caseTargets()).files;
    const conf = files.find((f) => f.path === 'ui_conf.h')!.content;
    expect(conf).toContain('#if defined(__GNUC__) || defined(__clang__)');
    expect(conf).toContain('#define UI_WEAK __attribute__((weak))');
    expect(conf).toContain('#elif defined(__ICCARM__)');
    expect(conf).toContain('#define UI_WEAK __weak');
    expect(conf).toContain('#define UI_NO_WEAK 1');
    const def = files.find((f) => f.path === 'actions_default.c')!.content;
    expect(def).toContain('#ifndef UI_NO_WEAK');
    expect(def).toContain('#endif /* !UI_NO_WEAK */');
    expect(def).not.toContain('__attribute__((weak)) void');
    expect(def).toMatch(/UI_WEAK void on_\w+\(lv_event_t \* e\)/);
  });
});
