# UI Schema v2

> 阶段 1 交付物(对应 `LVGL-UI-需求与实施方案.md` §4、§9 阶段 1、§13 第 3/4/5/10 项)
> 状态：**v2 已冻结并接管编辑与持久化读写；v1 只保留为运行时投影和旧文件入口**
> 代码:`packages/schema/src/v2/` · 生成物:`packages/schema/schema/`
>
> IoT 网页发布投影另见 [WebUiDocumentV1 冻结契约](web-ui-document-v1.md)。

## 0. 当前生效状态

`ProjectSnapshotV2` 已接管文件导入导出、IndexedDB、云工程、版本历史和 Designer 写操作。快照只保存一份 `UiProject v2` UI 树，并并列保存 DisplayProfile、ControllerProfile、BuildTarget 与项目 Action Registry；不存在持久化 v1 副本。`SCHEMA_VERSION=1` 和 `loadProjectJson()` 仅服务旧文件迁移，旧 v1 在下次保存时自动写成 v2。

Canvas、Inspector、对象树、屏幕、剪贴板、素材和 AI 操作直接修改 v2。预览仍可生成只读 `LvProject` 投影；投影会把所选 Theme Token 解析为运行时字面值，但不会反写或丢弃 v2 中的 Token、icons 与 Action Registry。Profile、Theme 和 BuildTarget 的不可变 revision API 已接入，工程快照继续锁定构建所需的精确引用。

导入方式刻意加前缀,让「谁在用 v2」在 import 处一眼可见:

```ts
import { migrateV1ToV2, validateUiProjectV2 } from '@lvd/schema/v2';
```

## 1. 四类对象

| 对象 | 文件 | 职责 |
| --- | --- | --- |
| `UiProject` | `v2/uiProject.ts` | 页面、Widget、Theme、Subject、Action 绑定 |
| `DisplayProfile` | `v2/profiles.ts` | 逻辑分辨率、形状、色彩格式、可视区、安装旋转 |
| `ControllerProfile` | `v2/profiles.ts` | 外壳 SVG、屏幕在外壳中的视口、物理控件 |
| `BuildTarget` | `v2/profiles.ts` | 把上述三者 + 固件 + LVGL 版本绑成一次可构建目标 |

支持对象:`InputProfile`(原始触摸校准,可选)、`FirmwareProfile`、`TrustedExtensionManifest`。

### 单一事实源规则(§4.2)

已在类型层面强制:

- `UiProjectMeta` **没有** `lvglVersion` 字段。版本权威是 `BuildTarget.lvglVersion`。
- `UiProject` **没有** `display` 字段,只有 `designDisplayRef`。`ControllerProfile.displayRef` 引用同一个 Profile,`validateCrossRefs()` 校验两者一致。
- `orientation` 不持久化,由 `deriveOrientation()` 派生,且**考虑安装旋转**——不是简单比 `width > height`。

## 2. 引用格式

```
<kind>:<slug>@<revision>          例:display:480x480-rgb565@1
<uiRef>#theme:<themeId>           例:ui:ctrl-430-lighting@1#theme:customer-a-dark
```

设计要点:

- **引用一律带 revision。**Profile 是不可变快照,离线工程包据此避免「外部 Profile 更新后历史构建漂移」。
- **拒绝 revision 前导零。**`@01` 与 `@1` 会指向同一对象却字面不等,那样引用就不能当 Map key 用了。
- **slug 不受 C 标识符约束**(`480x480-rgb565` 合法),因为它是业务标识,不输出到 C。
- `themeRef` 冗余携带 `uiRef`——这是方案 §4.4 的形式。冗余本身是风险,所以 `validateCrossRefs()` 专门校验两者一致(测试:`theme-ref-ui-mismatch`)。

## 3. 标识符三职责分离(§4.6)

| 字段 | 约束 | 输出到 C? |
| --- | --- | --- |
| `id` | 业务标识,URI 风格或 UUID | 否 |
| `displayName` | 面向用户,**可为中文** | 否 |
| `codeName` | `/^[a-z][a-z0-9_]*$/`,只有需要导出符号的节点才有 | 是 |

对应到 v1:`WidgetNode.name`(既是 XML name 又是 C 标识符)→ v2 的 `codeName`;`id` 保持不变。

Theme Token 用**语义 ID**(`color.text.primary`),正则 `/^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/`,**不受 C 标识符约束**——Schema 不该被 C/XML 命名规则反向绑定。C 符号在 Lowering 阶段生成并锁定。

## 4. Theme Token

```json
{
  "id": "color.background", "type": "color", "value": "#111827"
}
```

引用时用显式包装对象,与字面值区分:

```json
{ "props": { "bg_color": { "$token": "color.background" } } }
```

规则(全部有测试):

- 引用不存在的 token → **拒绝**,不做静默回退。
- 类型不匹配 → **拒绝**。`color` token 不能赋给 `radius`(size 类)属性;映射表在 `theme.ts` 的 `TOKEN_ASSIGNABLE`。
- `extends` 支持继承,子覆盖父;**成环或父不存在返回 `null`**,调用方报错,不静默降级。

## 5. Event 与 Action 分离(§5.3)

Event 是 LVGL 事件,Action 是业务命令:

```json
{ "on": "clicked", "action": "light.toggle", "args": {} }
```

- Action 必须存在于 Action Registry,否则报 `unknown-action`。
- 必填参数缺失报 `missing-action-arg`;`screenRef`/`subjectRef` 类型的参数会做存在性校验。
- 内置 Action(`BUILTIN_ACTIONS`)只包含设备无关的导航与 Subject 操作:`screen.open` / `screen.create` / `screen.back` / `subject.set` / `subject.toggle` / `subject.increment`。
- 业务 Action 由调用方注入:`validateUiProjectV2(doc, { actions })`。Widget 不保存 CANopen index、MQTT topic 或数据库字段。

## 6. 信任边界:`cPatch` 已移除(§8)

`WidgetNodeV2` 没有 `cPatch` 字段,且 zod 模型用 `.strict()`——带 `cPatch` 的节点会被报成 **`cpatch-forbidden` 结构错误**,而不是被静默丢弃。

任意 C 片段进独立的 `TrustedExtensionManifest`(`v2/trustedExtension.ts`),与 UiProject 分文件存放,要求内容哈希 + 人工审查记录才能进发布构建(`isReleaseReady()`)。

> 阶段 0 的相关发现:v1 里 `cPatch` 的现存用途几乎全是为绕开 **XML 的表达限制**(calendar 高亮日期、chart scatter X 坐标、arc `change_rate`/`knob_offset`)。arc 两项已建模为 typed property，calendar/chart 列表类属性待补。详见 `preview-architecture.md` §5。

## 7. 校验分层(§4.7)

| 层 | 入口 | 说明 |
| --- | --- | --- |
| 1 结构 | `validateUiProjectV2()` 内的 zod | 来自 `v2/schemas.ts` 的单一模型 |
| 2 语义 | 同上 | 引用完整、ID/codeName 唯一、Selector、Action 参数、Theme 成环 |
| 3 目标能力 | `validateCrossRefs({ capability })` | colorFormat 是否在能力包内、能力包版本是否与 BuildTarget 一致 |
| 4 信任 | 结构层的 `.strict()` | `cPatch` 等越界字段 |

`errors` 阻断、`warnings` 不阻断,与 v1 的 `validate.ts` 同构。

`validateCrossRefs()` 另外做一项 §4.4 要求的检查:外壳视口旋转后的宽高比与显示可视区相差超过 2% 时告警(预览会拉伸)。注意视口单位是 SVG viewBox 单位,不是屏幕像素,所以比的是**比例**不是数值。

## 8. JSON Schema:由单一模型生成(§10.1)

`v2/schemas.ts` 的 zod 模型是结构层的唯一事实源,三处消费它:

1. 运行时校验(`validate.ts` 直接用)
2. JSON Schema(`z.toJSONSchema()` → `packages/schema/schema/*.json`)
3. TS 类型一致性(`__tests__/v2-parity.test.ts` 的编译期断言)

生成与漂移检查合一,用 `toMatchFileSnapshot`:

```bash
pnpm --filter @lvd/schema test        # zod 模型改了但 JSON Schema 没重生成 → 失败
pnpm --filter @lvd/schema test -u     # 重新生成
```

产物:`ui.schema.json`、`display-profile.schema.json`、`controller-profile.schema.json`、`input-profile.schema.json`、`build-target.schema.json`、`trusted-extension.schema.json`。

> 实现说明:zod 模型用 `zod/v4` 子路径(随 zod 3.25 一同发布),因为只有 v4 自带 `toJSONSchema()`。v1 的 `validate.ts` 继续用 zod v3 根导出,两者共存,**没有新增依赖**。

### 类型一致性断言的边界

`v2-parity.test.ts` 对多数对象做**双向**可赋值断言。但 `BuildTarget` 和 `ControllerProfile` 只做单向(interface → zod),因为 interface 侧用了模板字面量类型(`ui:${string}@${number}`、`asset:${string}@sha256:${string}`),zod 推导只到 `string`。

这不是妥协,是分工:引用格式的收窄靠运行时正则(`schemas.ts` 的 `refPattern`)与语义层的 `parseRef()`,不靠 `z.infer`。断言只保证「代码构造得出的对象一定能通过结构校验」。

## 9. v1 → v2 迁移

```ts
const r = migrateV1ToV2(v1Project, { hash: sha256Hex });
// r.uiProject / r.displayProfile / r.buildTargetDraft / r.trustedExtension / r.notes
```

设计原则:**有损的地方必须说出来,不静默取默认值。**

### 字段映射

| v1 | v2 |
| --- | --- |
| `meta.lvglVersion: '9.4'` | **删除**,移入 `BuildTarget.lvglVersion`(草稿默认 `9.5.0`) |
| `display: {...}` | 派生并锁定一个 `DisplayProfile`;UiProject 只留 `designDisplayRef` |
| `display.colorDepth: 16/24/32` | `colorFormat: RGB565 / RGB888 / XRGB8888` |
| `WidgetNode.name` | `codeName` |
| `WidgetNode.styles`(引用) | `styleRefs` |
| `WidgetNode.inlineStyles` | `styles` |
| `WidgetNode.cPatch` | 抽入 `TrustedExtensionManifest` |
| `EventAction`(6 种 kind) | `UiEvent` + 内置 Action |
| `Binding.subject: CName` | `subject: BizId`(`subject:<name>`) |
| `Binding.styleRef: CName` | `styleId: BizId` |
| `consts` | **原样保留**,不自动转 Theme Token |

### 必须人工确认的项(`severity: 'must-confirm'`)

| code | 为什么不能自动决定 |
| --- | --- |
| `color-format-ambiguous` | v1 只存 `colorDepth: 16`,无法区分 `RGB565` 与 `RGB565_SWAPPED`——那是面板走线决定的,v1 根本没存。默认值取自 LVGL 自己的 `LV_COLOR_FORMAT_NATIVE` 表(`src/misc/lv_color.h:202-219`),但仍须对照驱动确认 |
| `cpatch-extracted` | 片段已抽入 trusted extension,需权限 + 哈希 + 审查 |
| `callback-needs-action` | v1 直接挂 C 回调名;v2 要求 Action 有强类型契约 |
| `controller-profile-missing` | v1 无外壳概念,`controllerProfileRef` 编不出来 |
| `ui-slug-fallback` | 工程名全非 ASCII 时派生不出合法 slug,回落值会让多个工程 id 冲突 |
| `export-xml-obsolete` | v1 开了 `exportXml`,但目标 9.5 已无 XML 引擎,产物没有运行时能加载 |
| `event-subject-missing` / `binding-subject-missing` / `binding-style-missing` | 悬空引用被丢弃,而不是生成一个坏产物 |

`hasBlockingNotes(r)` 为 `true` 时,**迁移完成不等于可发布**。

### 刻意不做的事

- **不自动把颜色常量转成 Theme Token。**const 是值级 IR、token 是设计语义,自动转换会编造语义 ID。迁移器只发一条 `info` 提示哪些常量值得提升。
- **不编造 `visibleRect`。**v1 没有该概念,留空(视为全屏)。条屏工程迁移后必须人工补,否则产品预览会画错开孔。
- **v1→v2 迁移器不自带哈希实现。**迁移 `cPatch` 的 `sha256` 只在调用方提供 `hash` 函数时填充。独立的网页发布导出器使用 Web Crypto 计算规范化 `WebUiDocumentV1` 和资源 SHA-256，不改变迁移器的同步接口。

## 10. Fixtures

| 文件 | 内容 |
| --- | --- |
| `schema/fixtures/v1-migration-input.json` | 存量 v1 迁移输入,刻意覆盖每一条有损分支(colorDepth 16、cPatch、callback 事件、4 种 subject/screen 事件、style 绑定、颜色常量、lottie、exportXml)。普通 v1 入口会仅因 `cpatch-forbidden` 拒绝,但迁移器可将其抽入 trusted extension manifest |
| `schema/fixtures/v2-migrated-from-v1.json` | 上者的迁移产物(含 notes),由 `toMatchFileSnapshot` 生成,**不要手改** |
| `schema/fixtures/web-ui-v1/minimal.json` | 无外部资源的最小 `WebUiDocumentV1` golden |
| `schema/fixtures/web-ui-v1/p0-widgets.json` | 覆盖 obj/label/button/switch/slider/arc/bar、Style、Subject、Binding 和本地 Action 的 P0 golden |
| `schema/fixtures/web-ui-v1/resource-icon.json` | 含独立 SVG blob 的资源清单与 SHA-256 golden |
| `schema/fixtures/web-ui-v1/invalid/` | editor 泄漏、未知 Widget、缺 Action 的稳定 invalid fixtures |
| `schema/fixtures/web-ui-v1/capabilities.v1.json` | Widget/属性/Style/Event/Action/Binding 白名单与复杂度上限 |
| `schema/fixtures/web-ui-v1/golden-manifest.json` | 规范化 JSON 的 SHA-256 和哈希规则 |

工程 Schema invalid 用例写在 `__tests__/v2-validate.test.ts`；网页发布 invalid 用例同时固化为跨仓可消费文件。测试断言稳定 error code，而不是依赖文案。

## 11. 未完成 / 待评审

| # | 项 | 说明 |
| --- | --- | --- |
| 1 | 接入 `MIGRATIONS` 链 | 等评审通过。届时 `SCHEMA_VERSION` 改 2,`loadProjectJson()` 自动走迁移 |
| 2 | `ComponentDefV2` 未闭环 | 与 v1 一致,仍未打通 Preview/Codegen/Editor(方案放阶段 3)。迁移器会转换,但 v1 的 `ComponentApiProp.type` 是自由字符串,迁移时一律降为 `'string'` |
| 3 | Action Registry 的业务条目 | 内置只有导航与 Subject 操作。业务 Action 白名单原计划从 `host_settings_core` 选取,但该组件不可达(见 `PHASE0-REPORT.md` §D8) |
| 4 | `FirmwareProfile.lvConf` 的校验 | 类型已定,第 3 层校验尚未消费它 |
| 5 | 多 Theme 工程的 token 校验 | 当前 `validateUiProjectV2()` 只按 `themes[0]` 校验 token 引用完整性。严格做法是按 `BuildTarget` 选中的 Theme 校验,属跨对象层 |
