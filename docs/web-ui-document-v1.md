# WebUiDocumentV1 冻结契约

> 状态：`38_index` 发布侧契约已冻结。
>
> 版本：外层 `schemaVersion = 1`，内部 `UiProject.schemaVersion = 2`。
>
> 冻结日期：2026-09-11。

本文定义 `38_index` 导出、IoT 后端校验入库、IoT 前端安全渲染共同使用的网页 UI 文档。
它不是 Designer 工程快照，也不是 38_index Build、Artifact 或 WASM 预览地址。

## 1. 权威交付物

- JSON Schema：`packages/schema/schema/web-ui-document.v1.schema.json`；
- TypeScript 类型、创建器和 Validator：`packages/schema/src/v2/webUiDocument.ts`；
- 最小 golden：`packages/schema/schema/fixtures/web-ui-v1/minimal.json`；
- P0 控件 golden：`packages/schema/schema/fixtures/web-ui-v1/p0-widgets.json`；
- 资源 golden：`packages/schema/schema/fixtures/web-ui-v1/resource-icon.json` 和 `assets/logo.svg`；
- invalid fixtures：`packages/schema/schema/fixtures/web-ui-v1/invalid/`；
- P0 能力矩阵：`packages/schema/schema/fixtures/web-ui-v1/capabilities.v1.json`；
- golden 摘要：`packages/schema/schema/fixtures/web-ui-v1/golden-manifest.json`。

这些文件由同一 Zod/TypeScript 模型和测试生成、校验。不得只修改生成的 Schema 或 fixture；
修改源模型后执行 `corepack pnpm --filter @lvd/schema test -- --update`，再运行不带 `--update` 的测试确认无漂移。

## 2. 文档结构

```json
{
  "kind": "wf2-web-ui",
  "schemaVersion": 1,
  "source": {
    "kind": "lvgl-ui-project",
    "schemaVersion": 2,
    "projectId": "ui:example",
    "revision": 7
  },
  "uiProject": {},
  "displayProfile": {},
  "actionRegistry": {},
  "assetManifest": []
}
```

强制规则：

- `source.projectId/revision` 必须等于 `uiProject.meta.id/revision`；
- `displayProfile.id@revision` 必须等于 `uiProject.designDisplayRef`；
- `uiProject` 复用 Schema v2，但顶层及递归节点均禁止 `editor`；
- `actionRegistry` 只保留实际引用的 Action，V1 只允许能力矩阵中的本地内置 Action；
- V1 暂不发布自定义 Component；
- 禁止 Build URL、IoT 主键、脚本、可执行 HTML、`javascript:` URL、`cPatch` 和编辑/构建私有状态；
- 未知 Widget、属性、Style、Event、Action、Flag、State 和 Binding 必须返回可定位错误，不能静默忽略。

## 3. P0 能力和限制

V1 Widget 能力矩阵由完整 Widget Registry 自动生成，覆盖 35 个顶层控件及注册表声明的结构子节点。
`list`、`list-text`、`list-button` 在发布时会确定性转换为 `obj`、`label`、`button`，因此最终文档中不会出现这三个专用类型。
属性、可绑定属性、Style、Event、Action、Flag 和 State 的精确白名单见
`capabilities.v1.json`。Subject 类型固定为 `int`、`float`、`string`、`color`；当前 Schema 没有
`bool` Subject，布尔界面状态使用整数 Subject 与 state/flag Binding 表达。

Designer 中的 `list` 是可导出的复合控件，但不扩展上述交换协议白名单。导出器会确定性转换
`list → obj`、`list-text → label`、`list-button → button + label`；列表按钮的 `icon` 如存在，
转换为按钮的安全 `bg_image_src` 局部样式。转换后仍由同一 V1 Validator 校验，前端 Renderer
不需要识别 LVGL 专用的 `list-*` 节点。

固定上限：

| 项目 | V1 上限 |
| --- | ---: |
| 规范化 JSON | 1,048,576 bytes |
| Screen | 32 |
| 节点总数 | 2,000 |
| 节点深度 | 32 |
| 单节点 children | 200 |
| Action | 128 |
| 资源数 | 256 |
| 单资源 | 8,388,608 bytes |
| 资源总量 | 33,554,432 bytes |
| 单字符串 | 16,384 UTF-8 bytes |

## 4. 规范化 JSON、SHA-256 与 ETag 边界

`canonicalJson()` 使用以下固定规则：

1. UTF-8；
2. 对象键按 ECMAScript 默认的 UTF-16 code unit 字典序排列；
3. 数组顺序保持；
4. 不输出空白；
5. 不输出末尾换行；
6. 拒绝 `undefined`、非有限数和循环引用。

`createWebUiExport()` 返回上述 JSON 字节及其小写十六进制 SHA-256。`golden-manifest.json`
固定了两份 valid fixture 的摘要。

HTTP `ETag`、`If-Match`、并发覆盖、软件版本不可变性和审计属于 IoT 后端资源 API，
不由 38_index 的导出器定义。后端可以使用服务端重新计算的文档 SHA-256 生成强 ETag，
但不得信任客户端提交的摘要。此边界不阻塞 Schema 和 fixtures 的消费。

## 5. 资源交接协议

`assetManifest[]` 每项固定包含：

```text
assetId + kind + fileName + mediaType + sha256 + byteSize
```

- `assetId` 与 `uiProject.assets` 中的业务 ID 对应；
- `kind` 只允许 `font`、`image`、`icon`；
- `fileName` 必须是 basename，不能包含路径；
- `sha256` 是资源原始字节的小写 SHA-256；
- `byteSize` 是资源原始字节长度；
- 文档禁止携带 URL、38_index CAS 地址、本地路径、IoT `file_uuid` 或 base64 大文件。

Designer 导出时通过 `verifyWebUiAssets()` 从本地/平台 CAS 读取每个 blob，重新验证大小和哈希；
缺失或不一致即阻断。资源二进制与 JSON 分开交付，IoT 后端负责上传到自身 `files`、建立
`sha256 → file` 关联和授权下载；具体 HTTP/数据库关联方式由后端 API 契约定义。第一轮无资源联调可使用
`minimal.json` 和 `p0-widgets.json`；资源链路使用 `resource-icon.json` 与随附 SVG。

## 6. API 与权限边界

本契约不要求 IoT 系统连接 38_index：

- 38_index 只生成本地 JSON 和资源文件；
- IoT 后端负责 UI JSON 的读写/清空 API、权限、租户隔离、ETag、审计和文件关联；
- IoT 前端只从 IoT 后端读取，不使用 38_index Service Bearer、Build URL 或 CAS URL；
- 旧 `/api/integrations/iot/v1` Build M2M API 仅作为 38_index 内部兼容接口保留，不是新链路契约。

因此前后端可以直接把本目录的 Schema、fixtures 和能力矩阵复制或作为测试依赖使用，
不需要等待 38_index 再冻结 IoT 平台内部 API/权限。

## 7. 稳定诊断和兼容策略

`validateWebUiDocument()` 返回 `{valid, errors, warnings}`。每个错误都有稳定的 `path`、`code`、
中文 `message`。invalid fixtures 固定覆盖 `schema_invalid`、`unsupported_widget` 和
`action_missing`；资源校验固定使用 `asset_blob_missing`、`asset_size_mismatch`、
`asset_hash_mismatch`。

兼容规则：

- V1 消费者只接受 `kind=wf2-web-ui` 且 `schemaVersion=1`；
- V1 Schema 关闭未知外层和节点字段，未知能力必须拒绝或显示诊断；
- 只增加 fixture 不改变 Schema；
- 新增可选语义前仍需三方验证现有 V1 消费者；破坏性字段、含义或白名单变化发布 V2；
- 内部 UiProject 升级到 V3 时必须通过新的外层版本或明确迁移器交付，不能静默塞进 V1。

## 8. 38_index 使用方式

Designer 工具栏点击“导出网页 UI JSON”。导出器会：

1. 从当前 `ProjectSnapshotV2` 创建发布投影，并将 `list` 复合节点降级为 V1 基础控件；
2. 剔除编辑器和构建私有字段；
3. 裁剪 Action Registry；
4. 校验 P0 能力、复杂度、DisplayProfile 和资源；
5. 下载 `<project>-wf2-web-ui.v1.json`；
6. 在界面显示该文件规范化字节的 SHA-256。

代码调用：

```ts
import { createWebUiExport, validateWebUiDocument } from '@lvd/schema/v2';

const result = await createWebUiExport(snapshot, async (asset) => loadBySha256(asset.sha256));
validateWebUiDocument(JSON.parse(result.json));
```
