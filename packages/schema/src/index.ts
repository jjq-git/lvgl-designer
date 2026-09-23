/**
 * @lvd/schema — 工程 Schema 与 Widget 注册表(单一事实源)。
 * 跨包契约见 docs/ARCHITECTURE.md §3,禁止私改。
 */

// 全部类型
export * from './project.js';
export * from './registryTypes.js';

// 枚举 token 表
export * from './enums.js';

// 值格式化(emitters / L1 热重载共用)
export {
  formatValueForXml, formatValueForC, formatEnumForC,
  constMacroName, isConstRef, isColorHex,
  type FormatOpts,
} from './format.js';

// ID / 命名
export {
  newUuid, checkCName, isValidCName, autoName, previewName,
  CNAME_RE, CNAME_MAX_LEN, type CNameError,
} from './ids.js';

// registry
export {
  REGISTRY, OBJ_BASE, ALL_WIDGETS, OFFICIAL_WIDGETS, EXTRA_WIDGETS,
  getWidgetSpec, findChildSpec, paletteEntries,
  BUTTONMATRIX_CTRL_TOKENS, TABLE_CELL_CTRL_TOKENS,
  CHILD_INTERACTIONS, SCREEN_INTERACTION, WIDGET_INTERACTIONS, getWidgetInteraction,
  type WidgetInteractionSpec,
} from './widgets/index.js';

// 样式属性表
export {
  STYLE_PROPS, M1_INSPECTOR_STYLE_KEYS, M1_TEXT_FONTS,
  type StylePropSpec, type StylePropType,
} from './styleProps.js';

// 校验
export { validateProject, type ValidationResult, type ValidationIssue } from './validate.js';

// 迁移 / 载入
export {
  loadProjectJson, MIGRATIONS,
  ProjectFormatError, ProjectTooNewError, ProjectValidationError,
  type Migration,
} from './migrations.js';

// 工厂
export { createEmptyProject, createNode, APP_VERSION } from './factory.js';
