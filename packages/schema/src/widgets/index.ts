/**
 * Widget 注册表:一份描述表驱动一切(组件面板/检查器/校验/emitters)。
 */
import type { ChildSpec, WidgetSpec } from '../registryTypes.js';
import { OBJ_BASE } from './objBase.js';
import {
  buttonSpec, checkboxSpec, imageSpec, labelSpec, objSpec, switchSpec,
} from './basic.js';
import {
  arcSpec, barSpec, dropdownSpec, qrcodeSpec, rollerSpec, scaleSpec,
  sliderSpec, spinboxSpec, textareaSpec,
} from './valueWidgets.js';
import {
  buttonmatrixSpec, calendarSpec, chartSpec, keyboardSpec,
  spangroupSpec, tableSpec, tabviewSpec,
} from './complexWidgets.js';
import {
  animimageSpec, arclabelSpec, canvasSpec, imagebuttonSpec, ledSpec,
  lineSpec, listSpec, lottieSpec, menuSpec, msgboxSpec, spinnerSpec,
  tileviewSpec, winSpec,
} from './extraWidgets.js';

export { OBJ_BASE };
export { BUTTONMATRIX_CTRL_TOKENS, TABLE_CELL_CTRL_TOKENS } from './complexWidgets.js';
export {
  CHILD_INTERACTIONS,
  SCREEN_INTERACTION,
  WIDGET_INTERACTIONS,
  getWidgetInteraction,
  type WidgetInteractionSpec,
} from './interactions.js';

/** 官方 XML parser 的 22 个(M1 15 + M2 7) */
export const OFFICIAL_WIDGETS: readonly WidgetSpec[] = [
  objSpec, labelSpec, buttonSpec, sliderSpec, switchSpec, checkboxSpec,
  barSpec, arcSpec, imageSpec, dropdownSpec, rollerSpec, textareaSpec,
  spinboxSpec, qrcodeSpec, scaleSpec,
  buttonmatrixSpec, calendarSpec, chartSpec, keyboardSpec,
  spangroupSpec, tableSpec, tabviewSpec,
];

/** 自研 parser 的 13 个(M3;事实源 runtime/src/xml_parsers_extra/manifest.json) */
export const EXTRA_WIDGETS: readonly WidgetSpec[] = [
  ledSpec, lineSpec, spinnerSpec, imagebuttonSpec, animimageSpec,
  msgboxSpec, listSpec, menuSpec, winSpec, tileviewSpec,
  arclabelSpec, canvasSpec, lottieSpec,
];

/** 全量 35 控件(官方 22 + 自研 13;唯一排除 3dtexture,GL-only) */
export const ALL_WIDGETS: readonly WidgetSpec[] = [
  ...OFFICIAL_WIDGETS,
  ...EXTRA_WIDGETS,
];

export const REGISTRY: Map<string, WidgetSpec> = new Map(
  ALL_WIDGETS.map((w) => [w.type, w]),
);

export function getWidgetSpec(type: string): WidgetSpec | undefined {
  return REGISTRY.get(type);
}

/**
 * 结构子元素查找:childType(如 'chart-series')→ 声明它的 widget 与 ChildSpec。
 * 用于"非法子类型"报错与检查器。
 */
export function findChildSpec(
  childType: string,
): { parent: WidgetSpec; child: ChildSpec } | undefined {
  for (const w of ALL_WIDGETS) {
    const child = w.children?.find((c) => c.type === childType);
    if (child) return { parent: w, child };
  }
  return undefined;
}

/** 组件面板条目(带 palette 元数据的 widget,按分类分组) */
export function paletteEntries(): { category: string; widgets: WidgetSpec[] }[] {
  const order = ['basic', 'input', 'display', 'container', 'chart', 'media'] as const;
  return order.map((category) => ({
    category,
    widgets: ALL_WIDGETS.filter((w) => w.palette?.category === category),
  }));
}
