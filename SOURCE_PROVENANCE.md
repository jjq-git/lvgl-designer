# 源码来源

- 原始历史仓库：`F:\dengtec\lvgl-web-designer`，基线提交 `d54f22a`
- 2026-09-10：完整源码迁入 `38_index/lvgl-designer`
- 2026-09-21：从 `38_index` 当前工作树拆出本独立项目

本副本包含拆分时尚未提交的 LVGL 9.5 Runtime 修改和当时已生成的 WASM，后端则包含账号、工程、素材、Catalog、Build/Release、IoT 集成与 AI 代理实现。

本目录可单独安装、构建和运行，不读取 `38_index` 的源码、静态目录或运行数据。常规构建命令：

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm build
```
