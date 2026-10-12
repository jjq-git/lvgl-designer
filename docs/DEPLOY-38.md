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

项目界面保存在 `lvgl_data/` 的 SQLite 数据库中，不属于普通代码发布。需要把本机已经验收的项目界面和字体资产一并合并到 `.38` 时，显式运行：

```powershell
.\scripts\deploy-38.ps1 -SyncProjectData
```

该开关会先用 SQLite 在线备份导出本机数据，再按“用户 + 项目名称”合并到服务器：同名项目更新、新项目插入、服务器独有项目保留。远端原数据库会备份到 `.deploy-backups/lvgl-data-<时间>-<提交>`；同步或健康检查失败时自动恢复数据库。它不会直接用本机数据库覆盖服务器数据库。

服务器上的 `.env`、`auth_data/`、`lvgl_data/` 和 Datasheets 站点不包含在发布包中，不会被此脚本覆盖。发布备份保存在：

```text
/home/jiao/lvgl-designer/.deploy-backups/lvgl-<时间>-<提交>
```
