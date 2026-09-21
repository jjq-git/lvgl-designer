# CHANGELOG

> LVGL Web Designer 迭代日志。倒序,最新在上。权威架构见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 2026-07-03

### 本地体验优化一批(体检驱动)· commit c8bbe30
先跑两路质量体检(交互 playwright 实测 + 代码逐 package 审查,结论:底子好——零 any/TODO、SQL 参数化、scrypt),据此挑性价比最高的一批做:
- **新功能**:复制/粘贴/复刻(Ctrl+C/V/D)、多选拖动联动、框选(marquee)、方向键微移(1px/Shift 10px)、画布"适应窗口"、快捷键帮助浮层(?/F1)
- **修 bug**:
  - `getObjRects` 用命中计数当循环上界 → 某控件缺失会截断丢掉后续 rect(选中框错位)。改为遍历全部、跳过 w/h<0
  - 复制粘贴粘到了选中控件**自身内部**(button 可作容器)→ 画布上看不见。改为粘到父容器同层(集成时真浏览器实测才现形,单测/agent 自测均漏)
  - 历史/我的工程弹层不支持 Esc(遮罩劫持工具条)、对象树右键菜单点外部不消失、rAF tick 无 try/catch(一次异常永久黑屏)
- **本机免登录**:设 `AUTH_DISABLED=1`(账号系统只对公网有意义)
- **推迟**(记录原因):云同步竞态(当前无云)、影子 codegen 清理(零收益+混着热重载活代码)、跨容器 reparent/对齐工具/中文预览字体(改动大或需字体包)

### 账号系统 + 云端工程存储 + 版本历史(阶段一二三)· commit 454bb8a→2354603
规划见 [PLAN-accounts-storage.md](PLAN-accounts-storage.md)。
- **阶段一 账号系统**:服务端会话式鉴权替换单口令门;管理员/普通角色;登录页服务端直出;scrypt+HttpOnly cookie;用户管理面板(建号/删号/重置密码/切角色,防删最后管理员)
- **阶段二 云端工程存储**:PostgreSQL 16(复用腾讯云 en-postgres,独立库 lvgldesigner+用户 lvgld,REVOKE 隔离考研笔记本 ennote);工程 CRUD API + 乐观锁;"我的工程"列表;云为主+本地 IndexedDB 离线兜底
- **阶段三 版本历史/回滚**:自动快照(去抖 60s + 滚动留 30)+ 手动标版本(永久)+ 回滚(回滚前自动备份,永不丢);版本历史抽屉(预览/回滚/标版本)
- **真库跨设备同步 e2e 通过**:设备A 建工程编辑 → 设备B 全新会话读回一致
- **修白屏 bug**:云端 doc 是外部输入,必须经 `loadProjectJson` 校验补全再 loadProject(原直用裸 doc → 下游 undefined.length 崩)
- **部署踩坑**:容器代码卷 `:ro` 写账号库 EROFS → 单独挂可写 `/data` 卷;`docker restart` 不重读新增 env → 改 env 须 `rm -f && run`

### ⚠️ 腾讯云失联
124.221.248.195 的 22/80 全不通(本机外网正常,对照公网可达)——服务器宕/防火墙被改/欠费,需去腾讯云轻量控制台救(实例状态/防火墙/OrcaTerm 网页终端)。数据在 /data 卷 + pg 库不丢。本机 http://localhost:8318 正常。

## 2026-07-02

- **组件面板改版**(commit a537fdf):紧凑双列行(C 版)+ 搜索(拼音/英文)+ 最近使用 + 分类折叠记忆
- **初始 git 基线**(commit 39c962a):全量交付版
- **35 控件全量**:23 官方 XML parser + 13 自研 parser(led/line/spinner/…/lottie via ThorVG);素材面板;chart 系列/tabview 页签/table 单元格等子元素编辑器;全量 e2e 过
- **STM32 支持**:C 导出三目标(esp-idf/cmake/bare)+ REQUIREMENTS.txt + INTEGRATION.md + UI_WEAK;arm-none-eabi(cortex-m4)326/326 零告警
- **DeepSeek AI 画 UI**:聊天 → 结构化 ops → 校验(自动修复≤2轮)→ 热重载,一条 undo;本地代理 server-ai.mjs
- **苹果亮色主题**:三方案评审选定 A-light
- **屏幕预设按全仓盘点更新**(11 个 + 自定义分辨率;更正 MX039/ST7102=480×480 圆)
- **部署**:本机 systemd :8318 + 腾讯云 docker+caddy /lvgl/
- **M1 MVP**:15 核心控件、检查器、flex、C 导出、ESP-IDF v5.5 esp32s3 真编译 0 警(E1~E7 全过)
- **M0 技术验证**:8/8(WASM+XML 热重载 + 命中测试 + lv_font_conv 浏览器可跑)
- **架构定稿**:四子系统设计 + 交叉评审(design/01~05)
