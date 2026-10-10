# 独立部署到 192.168.1.38:8003

LVGL Designer 与 Datasheets 保持两个独立仓库，也分别发布。此仓库只负责：

- `/lvgl-designer/` 的前端构建产物；
- 构建 Worker 与独立预览 Host 的构建产物；
- 统一入口、账号、权限和 LVGL API 后端；
- `lvgl-designer-api` 与 `lvgl-designer-worker` 用户服务。

在 PR 合并到 `main`、本地拉取最新提交后运行：

```powershell
Set-Location F:\dengtec\lvgl-designer
.\scripts\deploy-38.ps1
```

脚本默认要求工作区干净、当前分支为 `main`，并且 `HEAD` 与 `origin/main` 完全一致。随后它会运行测试和构建，将发布包上传到 `.38`，获取共享部署锁，备份现有版本，替换 Designer 与后端，重启两个用户服务并检查 `/api/health`。健康检查失败时会自动恢复上一版本。

紧急情况下可以显式使用 `-SkipTests`、`-AllowDirty` 或 `-AllowNonMain`，但常规发布不应使用这些开关。

服务器上的 `.env`、`auth_data/`、`lvgl_data/` 和 Datasheets 站点不包含在发布包中，不会被此脚本覆盖。发布备份保存在：

```text
/home/jiao/lvgl-designer/.deploy-backups/lvgl-<时间>-<提交>
```
