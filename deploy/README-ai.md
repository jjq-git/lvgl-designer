# AI 代理服务 (server-ai.mjs)

`server-ai.mjs` = `serve.mjs` 静态托管(逻辑原样保留) + `POST /api/deepseek/chat` DeepSeek 代理
+ **账号鉴权系统**(`auth.mjs`)。只监听 127.0.0.1。前端请求带 `x-ds-key` 头 → 代理转成
`Authorization: Bearer <key>` 后转发 `https://api.deepseek.com/chat/completions`,key 不落盘、不进日志。

> **鉴权已换代:旧的 `AUTH_TOKEN` 单口令门已被账号系统(登录名 + 密码)取代,`AUTH_TOKEN` 不再读取。**
> 本地开发想临时关掉鉴权,设 `AUTH_DISABLED=1`。

## 账号鉴权 (auth.mjs)

零第三方依赖,只用 node 内置 `crypto`/`fs`。用户与会话落盘到 `LVD_USERS_FILE` 所在目录
(部署指向 `/opt/lvgl-designer/users.json`,则会话为同目录 `sessions.json`,两文件均 `chmod 0600`)。

- **密码哈希**:`scryptSync(password, salt, 64)`,`salt = randomBytes(16)`;校验用 `timingSafeEqual`。用户不存在与密码错返回同一 401,防枚举。
- **会话**:`sessionId = randomBytes(32).hex`,cookie `lvd_session`(HttpOnly + SameSite=Lax + Path=/ + Max-Age 30 天),存盘(容器重启不掉线),读盘清过期项。
- **首启 Bootstrap**:`users.json` 不存在或空时,建管理员。用户名 `LVD_ADMIN_USER||'admin'`,密码 `LVD_ADMIN_PASS`;未设则随机生成并**打印一次到 stdout**:`===== 初始管理员 admin / <密码> ,请尽快登录后修改 =====`。
- **门禁**:每请求解析 `lvd_session`。未登录 + 页面导航(`Accept: text/html`)→ 直出内联登录页 `login.html`;未登录 + 静态/API → `401 {"error":"unauthorized"}`(不下发任何 SPA 资源)。DeepSeek 代理同样需登录后才可用。

### 相关环境变量

| 变量 | 作用 |
|---|---|
| `LVD_USERS_FILE` | 用户库路径(默认 = server-ai.mjs 所在目录 `users.json`);`sessions.json` 取其同目录 |
| `LVD_ADMIN_USER` | 首启管理员用户名(默认 `admin`) |
| `LVD_ADMIN_PASS` | 首启管理员密码(不设则随机生成并打印一次) |
| `AUTH_DISABLED=1` | 本地开发逃生舱:完全跳过鉴权 |

### 鉴权端点(全部 JSON)

| 端点 | 说明 |
|---|---|
| `POST /api/auth/login` `{username,password}` | 成功 `200 {username,role}` + `Set-Cookie: lvd_session=…`;失败 `401 {"error":"invalid credentials"}` |
| `POST /api/auth/logout` | `200 {ok:true}`,删会话 + 清 cookie(Max-Age=0) |
| `GET /api/auth/me` | 已登录 `200 {username,role}`;否则 `401 {"error":"unauthorized"}` |
| `POST /api/auth/password` `{oldPassword,newPassword}` | 改自己密码,`newPassword` ≥6;成功 `200`;旧密码错 `401`、太短 `400` |
| `GET /api/admin/users` | 管理员;`200 {users:[{id,username,role,createdAt}]}`(绝不含 salt/hash) |
| `POST /api/admin/users` `{username,password,role}` | 管理员;唯一/非空、`password`≥6、`role∈{admin,normal}`;`201 {id,username,role}`;重复 `409` |
| `DELETE /api/admin/users/:id` | 管理员;`200`;删自己 `400 cannot delete self`;删最后一个 admin `400 cannot delete last admin` |
| `POST /api/admin/users/:id/password` `{newPassword}` | 管理员;≥6;`200` |
| `POST /api/admin/users/:id/role` `{role}` | 管理员;`200`;把最后一个 admin 降级 `400` |

非管理员打 `/api/admin/*` 一律 `403 {"error":"forbidden"}`;未登录打 `/api/admin/*` 或 `/api/auth/me|password` 为 `401`。

## 路由行为

| 请求 | 行为 |
|---|---|
| 未登录 `GET /*`(Accept: text/html) | `200` 内联登录页 login.html |
| 未登录 静态资源 / API | `401 {"error":"unauthorized"}`(不下发 SPA) |
| 已登录 `GET /*` | 静态托管 dist/(SPA fallback、缓存策略与 serve.mjs 一致) |
| `POST /api/deepseek/chat` 未登录 | `401 {"error":"unauthorized"}`(防盗刷) |
| `POST /api/deepseek/chat` 已登录 无 `x-ds-key` | `401 {"error":"missing key"}` |
| `POST /api/deepseek/chat` 已登录 带 key | body 原样转发上游;状态码+body 原样透传(含上游 4xx/5xx);SSE 逐块透传;client abort → 中断上游 fetch |
| 其他 method 打该路由 | `405 {"error":"method not allowed"}` |
| 上游连不上 | `502 {"error":"upstream unreachable"}` |
| 上游超 120s | `504 {"error":"upstream timeout"}` |

调试可用环境变量 `DS_UPSTREAM` 覆盖上游地址(默认 DeepSeek 官方)。

## 切换 systemd 服务到 server-ai.mjs

服务是 **user 级** 单元(`~/.config/systemd/user/lvgl-designer.service`),两条命令:

```bash
sed -i 's|deploy/serve\.mjs|deploy/server-ai.mjs|' ~/.config/systemd/user/lvgl-designer.service
systemctl --user daemon-reload && systemctl --user restart lvgl-designer.service
```

回滚:把 `server-ai.mjs` sed 回 `serve.mjs`,再 daemon-reload + restart。

验证:`curl -s -X POST http://localhost:8318/api/deepseek/chat` 应返回 401 missing key(旧 serve.mjs 会返回 index.html)。

## vite dev 场景 (apps/designer/vite.config.ts 的 server.proxy)

dev 时让 vite 把 `/api` 转给本代理(代理另起一个端口跑,如 8319):

```ts
// vite.config.ts → defineConfig({ server: { ... } })
server: {
  proxy: {
    '/api/deepseek': {
      target: 'http://localhost:8319', // node deploy/server-ai.mjs 8319
      changeOrigin: true,
    },
  },
},
```

前端代码无论 dev / 生产都只请求同源 `/api/deepseek/chat`,不需要区分环境。

## 数据层 (PostgreSQL) —— 工程存储 + 版本历史

新增 `db.mjs` / `migrate.mjs` / `projects.mjs`,给部署服务器加 **云端工程存储 + 版本历史**。
`pg`(node-postgres,纯 JS)是 `deploy/` 的第一个运行时依赖,见 `deploy/package.json`,装法:

```bash
cd deploy && pnpm install --ignore-workspace   # deploy 不属根 workspace,须 --ignore-workspace
```

### 优雅降级(硬约束)

- **有 `DATABASE_URL`**:启动时自动跑 `migrate()`(幂等建表);用户落 `users` 表、工程/版本落库。
- **无 `DATABASE_URL`**(本机开发):不连库、账号系统走文件式旧行为;`/api/projects*` 一律
  `503 {"error":"storage not configured"}`(前端据此 fallback 本地 IndexedDB)。**进程绝不因缺库/连库失败而崩**
  —— `getPool()` 返回 `null`、`query()` 抛 `DB_DISABLED`(由 handler 转 503)、pool 级错误只记日志。

### Schema(`migrate.mjs`,全部 `IF NOT EXISTS`,可重复执行)

| 表 | 关键列 |
|---|---|
| `users` | `id` PK, `username` UNIQUE, `role`, `salt`, `hash`, `created_at` |
| `projects` | `id` PK, `owner_id`→users(ON DELETE CASCADE), `name`, `doc jsonb`, `version int`, `updated_at`, `created_at` |
| `project_versions` | `id bigserial` PK, `project_id`→projects(CASCADE), `seq int`, `kind`∈{auto,manual,restore}, `note`, `doc jsonb`, `created_at`, UNIQUE(project_id,seq) |
| `sessions`(可选) | 默认仍走文件;`LVD_SESSIONS_DB=1` 时会话读写落库 |

索引:`projects(owner_id, updated_at DESC)`、`project_versions(project_id, seq DESC)`。

### 账号系统落库

`auth.mjs` 抽象出 user store 层,按 `isDbEnabled()` 二选一(文件 / DB)。**所有 `/api/auth/*`、`/api/admin/*`
端点契约(状态码 + 字段)与旧版逐字不变**,前端零改动。首启若库里无用户但 `users.json` 有 →
一次性迁移导入,导入后 `users.json` 改名 `.bak`;bootstrap 管理员同样落当前 store。

### 工程 + 版本 API(全部需登录;owner 校验,越权/不存在一律 404 不泄露存在性)

| 端点 | 说明 |
|---|---|
| `GET /api/projects` | `{projects:[{id,name,version,updated_at}]}`(我的,`updated_at` desc) |
| `POST /api/projects` `{name,doc}` | `201 {id,name,version:1}`;`name`/`doc` 缺失 `400` |
| `GET /api/projects/:id` | `{id,name,doc,version,updated_at}`;非 owner `404` |
| `PUT /api/projects/:id` `{doc,name?,baseVersion?}` | 保存;乐观锁:`baseVersion` 与库中 `version` 不符 → `409 {error:'version conflict',current}`;成功 `{version}`(version+1) |
| `DELETE /api/projects/:id` | `200 {ok:true}`(级联删 versions) |
| `POST /api/projects/:id/rename` `{name}` | `200 {ok:true}` |
| `GET /api/projects/:id/versions` | `{versions:[{seq,kind,note,created_at}]}`(seq desc) |
| `GET /api/projects/:id/versions/:seq` | `{doc}` |
| `POST /api/projects/:id/versions` `{note}` | 手动标当前为版本(kind=manual)→ `201 {seq}` |
| `POST /api/projects/:id/restore/:seq` | 回滚:先存回滚前 doc 为 kind=restore 快照,再把目标 doc 设为当前、version+1 → `200 {version}` |
| `DELETE /api/projects/:id/versions/:seq` | 删手动版本(仅 kind=manual;auto/restore → `400`)→ `200` |

**快照策略(PUT 保存)**:每次 PUT 追加一条 `kind=auto`;做**去抖 + 滚动**:
- 去抖:距上一条 auto 版本 <60s → **覆盖**它(不新建、seq 不推进);≥60s → 新建 `seq=max(seq)+1`。
- 滚动:同工程 auto 版本只保留最近 **30** 条,超出删最旧 auto;`manual`/`restore` 永不自动删。

取舍说明:去抖窗口用"最后一条 auto 的 `created_at`"判定,实现从简;连续快速保存只留最后状态,避免版本爆炸。

### 相关环境变量(数据层)

| 变量 | 作用 |
|---|---|
| `DATABASE_URL` | pg 连接串(容器内 `postgres://lvgld:***@postgres:5432/lvgldesigner`);不设=文件回退 |
| `PGPOOL_MAX` | 连接池上限(默认 10) |
| `LVD_SESSIONS_DB=1` | 会话也落库(默认走文件 sessions.json) |

### 自测

- 本机(无 DATABASE_URL):`npm test` —— `snapshot-policy.test.mjs`(快照滚动/去抖纯逻辑 + DB 降级 + 503 分支)
  与 `handlers-logic.test.mjs`(内存假库驱动真实 handler,验乐观锁 409 / owner 越权 404 / restore 备份 / 级联删)。
  共 16 项全绿(handlers 通过显式测试数据库适配器注入，兼容项目要求的 Node 20+)。
- 真库:`test-db-integration.mjs` 需真实 `DATABASE_URL`,在服务器容器网络内跑
  (如 `docker run --rm --network exam-notebook_app-net -e DATABASE_URL=... node ... node test-db-integration.mjs`)。
  已在服务器 `en-postgres`(postgres:16-alpine)上用 psql 跑通 `migrate` 的 SQL:两次连跑均成功、第二次仅
  "already exists" NOTICE,幂等验证通过;4 表 3 索引 + kind CHECK 约束均已建。node 全链路集成待部署阶段(服务器需先装 pg)补跑。
