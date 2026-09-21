# LVGL Web Designer

浏览器里的 LVGL 可视化拖拽 UI 设计器（对标 Qt Designer / SquareLine）。当前产品主链固定为 LVGL 9.5.0：UiProject 经 PreviewProgram 驱动真实 LVGL WASM 画布，并由 C95 Generator 生成设备端 C/H；9.4 XML 仅保留为存量迁移兼容路径。

> 本源码已于 2026-09-10 迁入 `38_index/lvgl-designer/`，这里是后续开发、
> 测试和构建的唯一位置。`frontend/pages/tools/lvgl/` 仅保存自动生成的部署产物，
> 不要直接修改其中的压缩 JS、CSS 或 WASM。

**平台入口**：`http://localhost:8001/pages/tools/lvgl/`

## 已有能力基线（迁入前记录）

**核心设计器**
- **35 个控件全量**(LVGL 9.4 除 3dtexture 外全部):23 个官方 XML parser + 13 个自研 parser(led/line/spinner/imagebutton/animimage/msgbox/list/menu/win/tileview/arclabel/canvas/lottie);chart 系列、tabview 页签、table 单元格等子元素可视化编辑
- **画布交互**:拖拽新建、多选/框选、多选拖动联动、方向键微移(1px/Shift 10px)、复制粘贴复刻(Ctrl+C/V/D)、撤销重做、适应窗口、Ctrl+滚轮缩放/空格平移、圆屏遮罩、快捷键帮助(?/F1)
- **导出 C 代码**:三目标(ESP-IDF 组件 / 通用 CMake / 裸文件),附 REQUIREMENTS.txt(lv_conf 对照清单)+ INTEGRATION.md(CubeIDE/Makefile/PlatformIO);回调 weak 兜底(`UI_WEAK`,GCC/Clang/IAR),`actions.c` 永不覆盖用户代码
- **双平台编译验证**:ESP-IDF v5.5(esp32s3)真编译 0 警;arm-none-eabi(Cortex-M4F)326/326 零告警
- 屏幕预设 11 种(按全仓真实屏盘点)+ 自定义分辨率;苹果官网风亮色主题;热重载 L1~L4(属性级 0.2ms,拖动零重建)

**AI / 云 / 账号**
- **AI 画 UI**(DeepSeek):聊天描述界面 → 结构化操作校验落画布 → 一条 Ctrl+Z 撤销;支持"改选中控件"
- **账号系统**:登录 + 管理员/普通角色 + 用户管理面板(公网启用;本机 AUTH_DISABLED)
- **云端工程存储**(PostgreSQL):我的工程列表、云为主+本地离线兜底、跨设备同步
- **版本历史/回滚**:自动快照(滚动留 30)+ 手动标版本(永久),预览/回滚,回滚前自动备份
- **素材面板**:图片/lottie 上传(IndexedDB 内容寻址),刷新自动重灌

## 开发

```bash
pnpm install
pnpm dev                        # Vite 开发服务器；/api 代理到 38_index FastAPI :8001
pnpm -r test && pnpm -r typecheck
pnpm run build:platform         # 构建并发布到 ../frontend/pages/tools/lvgl/
node apps/designer/e2e/run-e2e.mjs           # E1~E7
node apps/designer/e2e/all-widgets-e2e.mjs   # 35 控件全量
scripts/compile-smoke.sh && scripts/compile-smoke-arm.sh  # 双工具链编译冒烟
LVGL_TAG=v9.5.0 runtime/build.sh # 重编 WASM(emsdk)
```

## 文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — **总架构(唯一权威)**:核心契约、热重载协议、AI 子系统、部署拓扑、里程碑状态
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — 迭代日志(每次交付的功能/修复)
- [docs/DEPLOY.md](docs/DEPLOY.md) — 部署运维手册(本机+腾讯云、PostgreSQL、更新流程、运维坑)
- [docs/PLAN.md](docs/PLAN.md) · [docs/PLAN-accounts-storage.md](docs/PLAN-accounts-storage.md)(账号/云存储/版本历史三阶段规划)
- [docs/调研-2026-07-02.md](docs/调研-2026-07-02.md) · [docs/screen-inventory.md](docs/screen-inventory.md)
- 交付报告:[m0/REPORT.md](m0/REPORT.md) · [docs/M1-REPORT.md](docs/M1-REPORT.md) · [docs/ALL-WIDGETS-REPORT.md](docs/ALL-WIDGETS-REPORT.md)
- [docs/design/](docs/design/) — 子系统深度设计 ×4 + 交叉评审

## 本地资源

- `vendor/lvgl/` — 本地 LVGL 源码缓存（`.gitignore` 排除）；当前 Runtime 构建必须使用 `v9.5.0`，9.4 只供存量对账
- `~/toolchains/xpack-arm-none-eabi-gcc-14.2.1-1.1` — ARM 交叉工具链(compile-smoke-arm 用)
