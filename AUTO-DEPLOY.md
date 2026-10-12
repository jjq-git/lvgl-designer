# 自动部署

两个仓库都包含 Gitea Actions 部署工作流。Runner 尚未注册或暂时离线时，`192.168.1.38` 上保留的用户级 systemd 定时器每两分钟检查内部 Gitea 中以下仓库的 `main` 分支：

- `learn_data_github/lvgl_json_lvgl`
- `learn_data_github/datasheets`

发现新提交后，服务器在隔离的检出目录中安装锁定依赖、运行测试和构建，再调用已有的原子部署与回滚脚本。Actions 和定时器使用同一控制器、成功提交状态与共享部署锁，不会重复发布同一提交或同时替换线上文件。

线上地址：

```text
http://192.168.1.38:8003/lvgl-designer/
http://192.168.1.38:8003/datasheets/
```

查看状态和日志：

```bash
systemctl --user status dengtec-auto-deploy.timer
journalctl --user -u dengtec-auto-deploy.service -n 200
```

立即检查两个仓库：

```bash
systemctl --user start dengtec-auto-deploy.service
```

失败的提交会自动退避重试。发布状态保存在：

```text
/home/jiao/.local/share/dengtec-auto-deploy/status/
```

自动发布只更新代码和构建产物，不同步本地 `lvgl_data/`、`auth_data/` 或 `.env`。本地手动部署入口 `scripts/deploy-38.ps1` 继续保留。
