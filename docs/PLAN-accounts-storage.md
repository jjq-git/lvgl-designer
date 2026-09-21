# 规划:账号系统 + 云端工程存储 + 版本历史

> 2026-07-02 立案,2026-07-03 三阶段全部交付。用户已定案:**云端为主+本地离线缓存**、**自动快照+手动标版本**、管理员建号不开放注册。
>
> **状态:阶段一/二/三均已 ✅ 交付并真库验证**(见各阶段小节 + CHANGELOG)。本文余下为设计存档。

## 术语澄清(两种"撤销",别混)

- **编辑撤销(Ctrl+Z/Y)**:已有。immer patches 内存栈,当前编辑会话内,连续拖动合并成一步。不动。
- **版本历史/回滚**:本规划新增。每个工程的历史存档进数据库,跨会话/设备可回退。这才是用户要的"画图记录"。

---

## 阶段一:账号系统 ✅ 已交付(2026-07-03)

- 服务端会话式鉴权替换旧的单口令门(`server-ai.mjs` + `deploy/auth.mjs`)。
- 角色:admin(管账号+用设计器)/ normal(只用设计器)。
- 登录页服务端直出(未登录不下发任何 SPA 资源);管理面板做进 React。
- 存储:`users.json`/`sessions.json`(0600,git 外)。密码 scrypt+盐,会话 HttpOnly cookie 存盘。
- 详见 deploy/auth 契约与 apps/designer/src/panels/auth。

---

## 阶段二:PostgreSQL + 云端工程存储 ✅ 已交付(2026-07-03)

### 技术选型(2026-07-03 定案:用户要"大"的,选 PG,复用现有实例)
- **数据库 = PostgreSQL 16**,复用腾讯云已有的 `en-postgres` 容器(考研笔记本的,PG16.14),**新建独立库+用户隔离**:
  - 库 `lvgldesigner`、用户 `lvgld`(随机强密码),`OWNER lvgld` + `GRANT ALL ON SCHEMA public`。
  - **已 `REVOKE CONNECT ON DATABASE ennote FROM lvgld/PUBLIC`** → lvgld 连考研笔记本库直接 FATAL,数据面完全隔离。
  - 连接串在 `/opt/lvgl-designer/env` 的 `DATABASE_URL`(容器内 `host=postgres`,同 `exam-notebook_app-net` 网络);本机开发用 `AUTH_DISABLED` + 本地 pg 或直接连云(SSH 隧道)。
  - 建库脚本:scratchpad/pg-setup.sh(幂等,密码不打印)。
- **node pg 驱动**:用 `pg`(node-postgres,纯 JS 无原生编译,最稳);连接池 `pg.Pool`。这是本项目第一个 npm 运行时依赖(此前 deploy 零依赖)——装在 deploy/ 下独立 package.json,不污染前端。
- 阶段一的 users 迁进 DB 的 `users` 表(auth.mjs 改为读 DB;现有 data/users.json 作一次性迁移源,迁移后保留备份)。

### 数据模型
```
users            (id PK, username UNIQUE, role, salt, hash, created_at)
projects         (id PK, owner_id FK→users, name, doc_json, updated_at, created_at)
project_versions (id PK, project_id FK→projects, seq, doc_json, note, kind, created_at)
                 -- kind: 'auto'(自动快照) | 'manual'(手动标的版本)
sessions         (可留文件或进 DB;进 DB 更统一)
```
- `projects.doc_json` = 当前最新工程(= .lvproj.json 的内容)。
- 索引:projects(owner_id, updated_at)、project_versions(project_id, seq)。

### API(全部登录后,普通用户只能操作自己的工程;越权 403)
```
GET    api/projects                    → 我的工程列表 [{id,name,updated_at}]
POST   api/projects {name,doc}         → 新建 → {id}
GET    api/projects/:id                → {id,name,doc,updated_at}(owner 校验)
PUT    api/projects/:id {doc,name?}    → 保存当前工程(触发自动快照,见阶段三)
DELETE api/projects/:id                → 删除(级联删 versions)
POST   api/projects/:id/rename {name}
（管理员可选:GET api/admin/projects 看全部,阶段二末做或推迟）
```

### 前端(依赖阶段一的 authStore)
- **工程列表页/抽屉**:登录后先看"我的工程"(新建/打开/重命名/删除),而非直接进空画布。
- **StorageProvider 抽象**(design/04 §6.2 早留的缝):新增 `CloudProvider` 实现现有 StorageProvider 接口;`IndexedDbProvider` 降级为离线缓存层。
- **云端为主+离线缓存策略**:
  - 打开工程:优先云端拉取 → 写入 IndexedDB 缓存 → 渲染。
  - 编辑自动保存:debounce 写云端(PUT);同时写 IndexedDB。
  - 断网:检测到云端不可达 → 落 IndexedDB + 标记 dirty + UI 提示"离线,联网后同步";恢复后自动 PUT 补同步。
  - 冲突(同工程多端编辑):以 updated_at 版本号做乐观锁(PUT 带 base version,服务器版本更新则 409 + 提示,用户选覆盖/放弃)。M 阶段可先简化为"最后写入胜 + 每次 PUT 存快照兜底"。

---

## 阶段三:版本历史面板 + 回滚 ✅ 已交付(2026-07-03)

### 快照策略(用户选:自动+手动)
- **自动快照**:PUT 保存工程时,若距上一条快照 >N 分钟或累计 M 次编辑,则追加一条 `kind='auto'` version;每工程自动快照**滚动保留最近 K 条**(如 30),超出删最旧的 auto(manual 永不自动删)。
- **手动标版本**:用户点"保存版本"→ 追加 `kind='manual'` + 用户填 note;永久保留。
- 参数(K/N/M)先给保守默认,后续可调。

### API
```
GET  api/projects/:id/versions              → [{seq,kind,note,created_at}]
GET  api/projects/:id/versions/:seq         → {doc}(预览/回滚取)
POST api/projects/:id/versions {note}       → 手动标当前为版本
POST api/projects/:id/restore/:seq          → 回滚:把该版本 doc 设为当前(并再存一条快照记录"回滚自 vN",可逆)
DELETE api/projects/:id/versions/:seq       → 删手动版本(auto 由滚动策略管)
```

### 前端
- **版本历史面板**(工具条入口):时间线列出该工程的 auto/manual 版本(manual 高亮+备注),点某条 → 预览(只读加载进画布)/ 回滚(确认后设为当前,当前状态先自动存一版防误操作)。
- 回滚本身产生一条新版本 → 可再回滚回来,永不丢数据。

---

## 里程碑与顺序

1. **阶段一** 账号系统(进行中)→ 集成 e2e 部署。
2. **阶段二** SQLite + 工程 CRUD API + 工程列表 UI + 云/离线同步 → e2e(建工程/换"设备"打开/断网编辑恢复)部署。
3. **阶段三** versions 表 + 快照策略 + 历史面板 + 回滚 → e2e(编辑→自动快照→手动标→回滚→再回滚)部署。

每阶段:本机验证 → 腾讯云更新(docker restart)→ git commit。数据库文件与 users/sessions 一律 0600、git 外、备份进 deploy 说明。

## 风险/注意
- SQLite 单文件 + docker 容器:DB 文件挂宿主机卷(`-v /opt/lvgl-designer:/app`),容器重建不丢数据。**部署更新时勿覆盖 data.db**(tar 只解 dist+server,不碰 *.db/*.json)。
- doc_json 可能较大(内嵌 base64 素材)→ 版本表体积。对策:素材内容寻址单独存(assets 表,按 sha256 去重),doc 只存引用;或先接受、后优化。阶段二先按"doc 内嵌"最简做,阶段二末评估是否拆素材表。
- 迁移:阶段二上线时把现有本地 IndexedDB 工程一次性导入云端(前端提供"上传本地工程到云"入口)。
