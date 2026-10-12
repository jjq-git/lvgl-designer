# Gitea Actions 自动部署

工作流文件位于 `.gitea/workflows/deploy.yml`，在 `main` 分支收到推送或手动触发时运行。

## Runner 要求

- Runner 安装在 `192.168.1.38`，以 `jiao` 用户运行。
- Runner 注册标签为 `deploy-38:host`。
- Runner 服务能够执行 `/home/jiao/.local/bin/dengtec-auto-deploy`。
- 不允许未审查的 Pull Request 使用生产 Runner；部署工作流只响应 `main` 推送和手动触发。

工作流不需要仓库 SSH 密钥、服务器密码或部署 Secret。Runner 注册令牌仅在注册阶段使用，并由服务器上的 Runner 配置保存。

## 所需 Gitea 权限

当前 `JiaoJianQi` 账号已有仓库写入权限，因此可以提交工作流，但无法查看或签发 Runner 注册令牌。启用 Runner 可任选一种授权方式：

1. **推荐：实例管理员注册一个实例级 Runner。** 需要 Gitea 实例管理员权限；一个 Runner 可服务两个仓库。
2. **仓库所有者注册用户级 Runner。** 使用 `learn_data_github` 所有者账号的用户级 Runner 注册令牌；一个 Runner 可服务该用户拥有的两个仓库。
3. **分别注册仓库级 Runner。** 将 `JiaoJianQi` 提升为两个仓库的管理员；需要分别取得两个仓库的注册令牌并运行两个 Runner 实例。

Runner 启用前，现有 systemd 定时器继续负责自动部署。Runner 启用后，两种触发方式共用控制器锁和成功提交状态，不会重复发布同一提交。
