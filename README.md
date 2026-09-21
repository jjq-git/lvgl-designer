# LVGL Designer 独立项目

这是从 `38_index` 拆出的完整独立版本，固定面向 LVGL 9.5.0。项目包含：

- React/Vite 可视化编辑器和 35 个 LVGL 控件；
- 真实 LVGL WASM 预览、设备外壳和交互模拟；
- C95、ESP-IDF、CMake 和裸 C 导出；
- 本地 IndexedDB 与服务端工程版本管理；
- 图片、字体和 Lottie 素材管理及转换；
- Display/Controller/Input/Firmware Profile、Theme 和 BuildTarget；
- 固定输入的构建、产物、审批、发布、回滚及 IoT v1 API；
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

安装脚本首次运行时会生成 `.env` 和随机管理员密码。浏览器访问 `http://127.0.0.1:8001/`。

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
```

若要启用正式构建的主机编译门禁，将 `.env` 的 `LVGL_BUILD_COMPILE_GATE` 改为 `host`，并确保已安装 CMake、Ninja 和 C 编译器。仓库内带有固定版本的 `vendor/lvgl/` 源码。

原设计器的详细架构、Schema、Preview、Generator 和验收文档位于 `docs/`。
