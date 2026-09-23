# LVGL Designer 独立项目

这是从 `38_index` 拆出的完整独立版本，固定面向 LVGL 9.5.0。项目包含：

- React/Vite 可视化编辑器和 35 个 LVGL 控件；
- 真实 LVGL WASM 预览、设备外壳和交互模拟；
- C95、ESP-IDF、CMake 和裸 C 导出；
- 本地 IndexedDB 与服务端工程版本管理；
- 图片、字体和 Lottie 素材管理及转换；
- Display/Controller/Input/Firmware Profile、Theme 和 BuildTarget；
- 固定输入的构建、产物、审批、发布、回滚及 IoT v1 API；
- 独立的 `ui.podsc.com` 准备、缩略图、Git 发布和补偿回滚流程；
- DeepSeek AI 生成和修改 UI；
- 独立账号、权限和用户管理。

运行数据分别保存在 `auth_data/` 和 `lvgl_data/`，不再依赖 `38_index`。

## 克隆仓库

项目使用固定在 v9.5.0 的 LVGL 子模块。首次克隆时请同时拉取子模块：

```powershell
git clone --recurse-submodules http://192.168.1.88:3000/learn_data_github/lvgl_json_lvgl.git
```

若已经完成普通克隆，请在项目目录运行：

```powershell
git submodule update --init --recursive
```

## Windows 快速启动

要求：Node.js 20+、Corepack、Python 3.11+。

```powershell
cd F:\dengtec\lvgl-designer
.\scripts\standalone\setup.ps1
.\scripts\standalone\start.ps1
```

安装脚本首次运行时会从 `.env.example` 生成 `.env`。浏览器访问 `http://127.0.0.1:8001/`。
默认管理员账号为 `admin`，密码为 `admin123`；登录页底部可点击账号自动填入。

前端开发服务器：

```powershell
# 终端 1
.\scripts\standalone\start.ps1

# 终端 2；/api 自动代理到 127.0.0.1:8001
corepack pnpm dev
```

## 手工安装

```powershell
Copy-Item .env.example .env
# 编辑 .env，至少修改 AUTH_BOOTSTRAP_PASSWORD
corepack pnpm install --frozen-lockfile
corepack pnpm build
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8001
```

## Docker Compose

先从 `.env.example` 创建 `.env` 并设置管理员密码，然后运行：

```powershell
docker compose up --build
```

API 文档位于 `http://127.0.0.1:8001/docs`。

## 测试

```powershell
corepack pnpm test
corepack pnpm typecheck
.\.venv\Scripts\python.exe -m pytest backend\tests -q
# deploy 是独立包，首次单独安装依赖
corepack pnpm --dir deploy install --frozen-lockfile --ignore-workspace
corepack pnpm run test:deploy
```

若要启用正式构建的主机编译门禁，将 `.env` 的 `LVGL_BUILD_COMPILE_GATE` 改为 `host`，并确保已安装 CMake、Ninja 和 C 编译器。仓库内带有固定版本的 `vendor/lvgl/` 源码。

## 发布到 ui.podsc.com

具备 `tool.lvgl.publish` 权限的用户，可在工具栏打开“发布到 ui.podsc.com”。发布服务从云端工程创建不可变快照，以目标分支里的 frame 清单、`renderer.js`、`styles.css` 和 `scripts/build_seo.py` 完成准备检查；浏览器不能传入仓库地址或 Git 凭据。

服务端配置 `LVGL_PODSC_REPOSITORY`、`LVGL_PODSC_BRANCH` 和 `LVGL_PODSC_PUBLIC_URL`。Windows 可用 `LVGL_PODSC_CHROMIUM_PATH` 指向 Chrome；Docker 镜像已经安装 Chromium 和 Git。发布只允许修改版本化的 `site/uis/*`、`site/ui_list.json` 及 SEO 生成输出，`site/frames/` 始终只读。界面显示“Git 已提交”时不代表 OSS/CDN 已完成部署。

每次准备请求带稳定 `requestId`，网络超时重试会恢复同一 publication 和 Demo UUID；发布窗口也可恢复准备中、待提交或已提交的历史任务。准备阶段保存锁定消费者版本的交互 renderer，并在沙箱 iframe 中展示实际预览、缩略图、清单前后差异和写入文件。空白首页、近似纯色 mock、外部资源以及首期不支持的 image/imagebutton/animimage/lottie 素材组件会阻断发布。交付回执分别显示 Git、静态上传、旧页删除和 CDN 刷新状态；首期仅 Git 会进入 `submitted`，其余保持 `not_started`。

原设计器的详细架构、Schema、Preview、Generator 和验收文档位于 `docs/`。
