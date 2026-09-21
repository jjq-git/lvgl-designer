# LVGL 代码生成器

> 状态：LVGL 9.5.0 emitter 初版已落地；静态对账与 TypeScript/golden 测试已通过，host/ARM/ESP-IDF 真编译待具备 9.5.0 工具链后补做。
> 更新时间：2026-09-04

## 1. 边界与版本

生成链分为三层：

```text
@lvd/schema
    ↓
@lvd/compiler-core：resolveRefs / eliminateDefaults / assignNames → IR
    ↓
@lvd/codegen：emitC94（旧工程兼容）/ emitC95（产品目标）
```

`@lvd/compiler-core` 不依赖 preview runtime、XML 或 codegen。Preview 后续直接消费同一 IR；Renderer 与 C Generator 不互相引用。

公开入口：

- `emitC94(project, options?)`：保留既有 LVGL 9.4 文件集与 golden，不扩展功能。
- `emitC95(project, options?)`：生成精确面向 LVGL `9.5.0` 的产物。
- `emitC95FromIr(ir, diagnostics, options?)`：供迁移后的 v2/Preview 共用 lowering 结果。
- `options.target`：`esp-idf`（默认）、`cmake`、`bare`。
- `options.colorFormat`：发布目标的实际 Display Color Format。v1 16bpp 必须显式传入 `RGB565` 或 `RGB565_SWAPPED`；24/32bpp 可确定性派生为 `RGB888`/`XRGB8888`。
- `options.buildTarget`：已通过 v2 跨引用校验的完整 BuildTarget 快照；其 `lvglVersion` 必须与 emitter 一致。
- `options.displayProfileRef`：BuildTarget 经 Controller 间接锁定的 DisplayProfile revision；传入 BuildTarget 时必填。

9.5 emitter 复用 registry 的 C setter 模板，不复用 XML 属性或 XML parser。`registry-lvgl95-parity.test.ts` 已将 registry 引用的 197 个去重 LVGL C 符号与 v9.5.0 真实符号表逐项对账，缺失为 0。

## 2. 生成物

9.5 输出继续包含 `ui.c/h`、screen、style、subject、action、资源声明和目标构建文件，并新增 `build-manifest.json`：

```json
{
  "formatVersion": 1,
  "generator": "@lvd/codegen",
  "lvglVersion": "9.5.0",
  "target": "esp-idf",
  "display": { "width": 480, "height": 480, "colorFormat": "RGB565" },
  "profiles": {
    "buildTarget": { "id": "target:demo", "revision": 1 },
    "uiProjectRef": "ui:demo@1",
    "controllerProfileRef": "controller:screen-only-480x480-rgb565@1",
    "displayProfileRef": "display:480x480-rgb565@1",
    "themeRef": "ui:demo@1#theme:default"
  },
  "lvConf": {
    "widgets": ["LV_USE_BUTTON", "LV_USE_LABEL"],
    "montserrat": [16],
    "flex": false,
    "grid": false,
    "observer": false
  },
  "assets": { "fonts": [], "images": [] },
  "unimplementedActions": ["on_save"]
}
```

约束：

- `lvglVersion` 使用精确版本，不接受 `^9.5.0`、`~9.5.0` 或模糊的 `9.5`。
- manifest 不写有损的 `colorDepth`；16bpp 未确认字节序时 emitter 返回 `E_COLOR_FORMAT_CONFIRM_REQUIRED`，Designer 不生成下载包。
- BuildTarget 版本错配返回 `E_BUILD_TARGET_VERSION_MISMATCH`；带 BuildTarget 却未锁定 Display revision 返回 `E_DISPLAY_PROFILE_REF_REQUIRED`。
- 字体/图片记录工程中的 SHA-256 和字节数；图片同时记录转换色彩格式。
- `unimplementedActions` 是生成时发现的 callback 清单。`actions.c` 仍采用 write-if-absent，生成器不会覆盖用户实现。
- `REQUIREMENTS.txt` 给出所需 `LV_USE_*`、字体、布局、Observer 和色深配置。
- `INTEGRATION.md` 的 PlatformIO 依赖固定为 `lvgl/lvgl@9.5.0`。

## 3. 兼容策略

9.4 与 9.5 当前共享同一份生成 C，因为 registry 实际使用的 C API 在 9.4→9.5 没有消失。版本差异通过入口、说明文件和 9.5 manifest 明确表达，禁止根据 `ProjectMeta.lvglVersion` 暗中猜测发布目标。

Schema v2 接入后，发布入口必须由 `BuildTarget.lvglVersion` 选择 emitter；`UiProject` 不保存第二份 LVGL 版本。现阶段 `emitC95(LvProject)` 是 v1 迁移期间的显式桥接入口，不代表 v1 meta 已成为 9.5 权威来源。

Designer 的「导出 C 代码」已切换到 `emitC95`。v1 节点含 `cPatch` 时，9.5 emitter 返回 `E_CPATCH_FORBIDDEN`，不会将片段写入任何 C 文件；`emitC94` 只为受信任的存量工程保留历史行为。独立 trusted extension 的签名/审批链未实现前，9.5 入口不提供绕过开关。

## 4. 已验证与未完成

已验证：

- 既有 27 组 C/XML golden 产物未变化。
- 9.5 与 9.4 从同一 IR 生成的 `.c/.h` 完全一致。
- 9.5 说明文件无 9.4 残留，不使用浮动版本范围。
- manifest 的版本、目标、显示、能力、资源哈希和 Action 清单有单测。
- Designer 的 Display/Controller 选择通过 v2 `validateCrossRefs()` 后才可导出；实际 E2E zip 已锁定 BuildTarget/UI/Controller/Display/Theme revision。
- RGB565 交换版已通过浏览器 framebuffer 链路验证。
- `@lvd/compiler-core` 与 `@lvd/codegen` TypeScript 类型检查通过。

尚未验证：

- 在 LVGL 9.5.0 头文件下运行 host gcc 与 ARM 交叉编译。
- ESP-IDF 首个目标板完整编译与上板。
- 真实 Controller/Profile 的设备数据与首个产品配置；Schema v2 已接管编辑和持久化，v1 仅用于只读运行时投影与旧文件迁移。
- 发布 WASM 构建与 Designer/真机截图对拍。

这些项目完成前，只能称为「9.5 emitter 初版」，不能宣称阶段 2 垂直闭环完成。
