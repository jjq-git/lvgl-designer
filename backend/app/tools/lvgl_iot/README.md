# LVGL IoT M2M API v1

> **兼容状态（2026-09-11）：** IoT 平台新链路已退出此 Build/Artifact/Preview 接口。
> 本接口只为需要旧 Build/Artifact/Preview 契约的调用方保留，不再作为 `iot_server_backend` / `iot_server_frontend`
> 的运行依赖，也不得把 Service Bearer 或 CAS/Preview URL 交给浏览器。
>
> 新链路由 Designer 导出 `WebUiDocumentV1`，IoT 后端保存 JSON 本体。冻结 Schema、fixtures、
> 资源清单和哈希规则见 `docs/web-ui-document-v1.md`。

This API is deliberately separate from `/api/lvgl/builds`: it accepts no user
session cookie and resolves every external tenant through an explicit service
client mapping.

Provision a client from the backend directory:

```powershell
python scripts/provision_lvgl_iot_client.py create --name iot-backend --tenant tenant-a --owner-user-id 1
```

The returned bearer token is shown once. The database stores only its SHA-256
digest. Send it with both headers:

```text
Authorization: Bearer lvgl_iot_<hint>.<secret>
X-IoT-Tenant: tenant-a
```

Stable endpoints:

- `GET /api/integrations/iot/v1/builds`
- `GET /api/integrations/iot/v1/builds/{uiBuildId}`
- `GET /api/integrations/iot/v1/builds/{uiBuildId}/manifest`
- `GET /api/integrations/iot/v1/builds/{uiBuildId}/artifact`
- `GET /api/integrations/iot/v1/builds/{uiBuildId}/preview`
- `GET /api/integrations/iot/v1/builds/{uiBuildId}/preview/{sealedFile}`
- `GET /api/integrations/iot/v1/openapi.json`

Required scopes are `lvgl.build.read`, `lvgl.artifact.read`, and
`lvgl.preview.read`. New builds seal their PreviewProgram, read-only browser
host, pinned LVGL WASM runtime, runtime manifest, and preview source assets in
the same immutable ZIP. Older builds return `preview-not-available`.

The IoT backend must proxy preview resources or exchange them through a
separate browser-safe delivery mechanism. Never expose this service bearer
token to frontend JavaScript.

The canonical firmware capability object and its SHA-256 are frozen into the
build input and manifest. UI ABI `1.0.0` is currently the only accepted ABI.
