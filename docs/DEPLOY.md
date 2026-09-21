# DEPLOY — 部署运维手册

> 2026-07-02。两套环境共用同一份构建(`base:'./'` 相对路径,根/子路径通吃)。

## 1. 本机(WSL)

| 项 | 值 |
|---|---|
| 服务 | systemd --user `lvgl-designer.service`(开机自启,linger 已开) |
| 入口 | http://localhost:8318(无口令门) |
| 进程 | `node deploy/server-ai.mjs 8318`(静态托管 dist + `/api/deepseek/chat` 代理) |
| 环境 | `EnvironmentFile=~/.config/lvgl-designer/env`(`DS_KEY=…`,600 权限,git 外) |
| 更新 | `pnpm --filter designer build` 即生效(dist 直服);改 server-ai.mjs 才需 `systemctl --user restart lvgl-designer` |

## 2. 腾讯云 Lighthouse(124.221.248.195,考研笔记本同机)

> ⚠️ **2026-07-03 起失联**:22/80 全不通(本机外网正常、对照公网可达,排除本地网络)。SSH 别名 tencent-sh 连不上,凭据本只有 SSH 无控制台 API 密钥 → 只能去**腾讯云轻量控制台**救:查实例状态(关机→开机)、防火墙 22+80 放行、欠费/到期;进不去 SSH 可用控制台的 **OrcaTerm 网页终端**。数据在 /data 卷 + pg 库不丢。恢复后 `ssh tencent-sh 'sudo cat /opt/lvgl-designer/.admin-initial-pw'` 取初始管理员密码。

| 项 | 值 |
|---|---|
| 入口 | http://124.221.248.195/lvgl/ (**口令门**:首次 `?token=<见凭据本或 deploy/.tencent-token>`,cookie 记一年) |
| SSH | 别名 `tencent-sh`(`~/.ssh/tencent_lvgl_deploy` 免密;ubuntu 用户免密 sudo) |
| 容器 | `lvgl-designer`(node:22-alpine,`--restart unless-stopped`,网络 `exam-notebook_app-net`,**不占公网端口**);挂两个卷:`/opt/lvgl-designer:/app:ro`(代码只读)+ **`/opt/lvgl-designer/data:/data`(可写,账号库/将来数据库)** |
| 落盘 | `/opt/lvgl-designer/`(dist + server-ai.mjs + auth.mjs + login.html + env[600])；`data/`(users.json/sessions.json,700) |
| 门禁 | **账号系统**(登录+管理员/普通角色),已取代旧的单口令门 |
| 路由 | `en-caddy` 的 Caddyfile:`handle_path /lvgl/* → reverse_proxy lvgl-designer:8318`(照 `/appota/` 先例) |

### 更新流程(本机执行)

```bash
cd ~/lvgl-web-designer
pnpm --filter designer build
tar czf /tmp/lvgl-deploy.tar.gz -C apps/designer dist -C ../../deploy server-ai.mjs auth.mjs login.html
scp /tmp/lvgl-deploy.tar.gz tencent-sh:/tmp/
ssh tencent-sh 'sudo tar xzf /tmp/lvgl-deploy.tar.gz -C /opt/lvgl-designer && rm /tmp/lvgl-deploy.tar.gz && sudo docker restart lvgl-designer'
```
> tar **只解 dist + deploy 脚本,绝不碰 data/**(账号库/数据库在那)。日常更新用 `docker restart` 足够;**只有改了 env 变量(增删环境变量)才需 `docker rm -f && docker run`**——restart 不重读 env-file。


### ⚠️ 运维坑(实测踩过)

0. **账号系统的两个卷 + env 生效方式**:代码卷 `:ro` 只读,写账号库会 `EROFS` → 账号库必须放**单独可写卷 `/data`**(env `LVD_USERS_FILE=/data/users.json`)。改 env 变量后 `docker restart` **不重读 env-file**,必须 `docker rm -f && docker run`(容器建 run 命令见上「容器」行)。首次上账号系统时 bootstrap 打印初始 admin 密码到 `docker logs`,也存 `/opt/lvgl-designer/.admin-initial-pw`(600)。
1. **Caddyfile 是单文件 bind mount**:宿主机改完,`caddy reload` 无效(容器钉在旧 inode)——必须 `sudo docker restart en-caddy`,考研笔记本会闪断几秒。
2. **动 caddy 勿伤考研笔记本**:`:80` 站点里 `/appota/`(app_ops OTA)和兜底 `reverse_proxy next:3000` 是别人的业务,只在中间加/改自己的 `handle_path /lvgl/*` 块。
3. 口令门语义:`AUTH_TOKEN` 在 env 里;`?token=` 校验过即种 cookie 直接放行(不能用 302——handle_path 剥前缀会让 Location 丢 `/lvgl/`)。
4. 服务器上验证三件套:`curl localhost/`(考研笔记本 200)、`curl localhost/lvgl/`(401)、`curl "localhost/lvgl/?token=…"`(200)。

## 3. 安全清单

- DeepSeek key:仅存 ①本机 `~/.config/lvgl-designer/env` ②服务器 `/opt/lvgl-designer/env`(均 600、git 外);代理不打印任何请求头;浏览器侧 key 只进 localStorage。
- 公网侧整站(含 AI 代理)在口令门后,防 key 被白嫖。
- 待办(建议):腾讯云关闭 SSH 密码登录(现已有密钥);轮换一次曾进过对话记录的登录密码。

## 4. PostgreSQL 数据库(阶段二/三:云端工程存储 + 版本历史)

- **实例**:复用腾讯云 `en-postgres`(考研笔记本的 PG16.14),独立库 `lvgldesigner` + 用户 `lvgld`(随机强密码,`OWNER` + `GRANT ALL ON SCHEMA public`)。
- **隔离**:已 `REVOKE CONNECT ON DATABASE ennote FROM lvgld/PUBLIC` → lvgld 连考研笔记本库直接 FATAL,数据面完全隔离。建库脚本 scratchpad/pg-setup.sh(幂等,不打印密码)。
- **连接**:`DATABASE_URL=postgresql://lvgld:…@postgres:5432/lvgldesigner`(容器内网 host=postgres,不暴露公网)写在 `/opt/lvgl-designer/env`。
- **表**:users / projects(doc jsonb + version 乐观锁)/ project_versions(auto滚动留30 + manual永久 + restore备份)/ sessions。启动自动跑 migrate(幂等)。
- **pg 依赖**:node:22-alpine 无 pg,用一次性容器 `docker run --rm -v /opt/lvgl-designer:/w -w /w node:22-alpine npm install pg` 装进只读卷的 node_modules。
- **⚠️ 更新部署时**:tar 只解 dist+deploy 脚本,**绝不碰 data/**(账号库)和数据库;首次上库或改 env 变量需 `docker rm -f && docker run`(restart 不重读 env、不重装 pg)。备份:`docker exec en-postgres pg_dump "$DATABASE_URL"`。
