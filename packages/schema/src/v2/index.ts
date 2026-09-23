/**
 * @lvd/schema v2 —— 当前持久化 Schema(方案 §4)。
 *
 * ProjectSnapshotV2 已接管文件、IndexedDB、云工程和版本历史读写。根包中的
 * `LvProject` / `SCHEMA_VERSION=1` 只保留为运行时投影和旧文件兼容模型，
 * 不再由当前版本写入持久化存储；旧 v1 文件仍通过兼容入口读取并在下次保存时升级。
 *
 * 导出前缀 `v2/` 保留，用于区分当前契约与运行时/旧文件兼容 API。
 */

export * from './refs.js';
export * from './profiles.js';
export * from './theme.js';
export * from './uiProject.js';
export * from './components.js';
export * from './trustedExtension.js';
export * from './migrate.js';
export * from './projectSnapshot.js';
export * from './webUiDocument.js';

/** 业务 Action 白名单。⚠️ 临时版本,待与原厂 host_settings_core 校准 —— 见该文件头注释 */
export * from './actions/podSettings.js';
export {
  validateUiProjectV2, validateDisplayProfile, validateCrossRefs,
  type ValidateV2Options, type CrossRefInput,
} from './validate.js';
