# LVGL Web Designer 项目规划

> 2026-07-02 定稿 v1;同日范围调整:**第一期只做 LVGL 9.4,8.4 只在架构上留扩展点、暂不实现**。调研依据见 [调研-2026-07-02.md](调研-2026-07-02.md),详细架构见 [ARCHITECTURE.md](ARCHITECTURE.md)。
>
> **状态(2026-07-02 晚)**:M0/M1 已交付,并超额完成——35 控件全量、DeepSeek AI 画 UI、素材面板、苹果亮色主题、STM32 三目标导出(host+ARM 双工具链验证)、本机+腾讯云双部署。当前状态一览以 [ARCHITECTURE.md §6](ARCHITECTURE.md) 为准,本文余下部分为立项时的原始规划存档。

## 1. 目标

浏览器里的 LVGL 可视化拖拽 UI 设计器(对标 Qt Designer / SquareLine):

- **LVGL 9.4 为主要目标版本**(8.4 兼容导出为二期,架构预留)
- 部署到网页(自家服务器,纯静态优先)
- 所见即所得:画布必须是**真 LVGL 渲染**,不做 HTML 仿制
- 导出可直接编译的 C 代码(`src/ui/` 形式,ESP-IDF 工程直接用)

## 2. 选型结论

**没有可以直接拿来用的开源项目**——开源阵营无一同时满足「网页版 + LVGL 9 + 真渲染 + 活着」。但拼图件全都现成:

| 路线 | 评估 | 决定 |
|---|---|---|
| A. 直接用 EEZ Studio(桌面) | 零开发,8.4+9.4 双导出齐全,WASM 真渲染 | ✅ **作为过渡工具立即用起来**;要浏览器访问可 Docker+KasmVNC 包一层 |
| B. 网页化改造 EEZ Studio | 功能最快齐,但 ~30 万行陌生 GPL 代码、Electron 解耦量未知、单人上游快速迭代,fork 维护成本高 | ❌ 不做主线 |
| C. **自研轻量 Web 设计器** | 真 LVGL 9.4 WASM 画布 + 自有 JSON 格式 + 双版本 C 导出;底座全部复用官方现成件;许可干净、可控、可集成进自家 workbench | ✅ **主线** |

复用清单(路线 C 的巨人肩膀):
- 渲染底座:`lvgl/lv_web_emscripten`(官方,活跃)
- 热重载:LVGL 9.4 内置 `lv_xml`(`register_component_from_data` / `unregister` / `create_screen`)
- 素材:`lv_font_conv`(npm)、`lv_img_conv`(JS)
- 8.4↔9.4 映射参考:EEZ Studio 的 `lvgl-versions.ts`(**只参考行为,不抄代码**——GPL)
- 交互参考:LVGL Pro Editor、SquareLine

## 3. 架构(路线 C)

```
浏览器(纯静态部署;后端可选)
┌──────────────────────────────────────────────────┐
│ React + TypeScript + Vite                         │
│ ┌─────────┬────────────────────┬───────────────┐ │
│ │ 组件面板 │ 画布                │ 属性/样式检查器 │ │
│ │ (拖拽源) │ = LVGL 9.4 WASM    │ widget 属性    │ │
│ │─────────│   真渲染 (canvas)   │ 样式(state/   │ │
│ │ 对象树   │ + HTML 覆盖层       │  part)        │ │
│ │ 多屏列表 │  (选中框/8个手柄/    │ 事件/绑定      │ │
│ │         │   对齐参考线)        │               │ │
│ └─────────┴────────────────────┴───────────────┘ │
│                  ↓↑ 全部编辑操作                    │
│   工程模型:自有 JSON schema(单一事实源,含 undo 栈) │
│     ├→ XML 生成 → lv_xml 热重载 → WASM 画布刷新     │
│     ├→ C 生成器 v9.4(直接映射)                     │
│     ├→ C 生成器 v8.4(重命名映射表 + 公共子集校验)    │
│     └→ 素材管线:字体/图片转换(v8/v9 格式各一份)     │
└──────────────────────────────────────────────────┘
```

关键设计:

- **WASM 桥(C 侧 export,JS 侧 ccall/cwrap)**:`load_component_xml(name, xml)`、`reload_screen(name)`、`obj_id_at_point(x, y)`、`get_obj_coords(id)`、`set_canvas_size(w, h)` 等。编辑操作改 JSON → 重新生成该屏 XML → unregister + register + create_screen,毫秒级热重载。
- **选中/拖拽**:HTML 覆盖层画选择框和手柄;命中测试与包围盒查询走桥函数;拖动/缩放写回 JSON 的 x/y/w/h。
- **8.4 兼容模式**:工程级开关。开启后组件面板只列两版共有 widget(meter/scale 这类单边货禁用或给替代提示)、样式属性限制公共子集、导出时同时产出 v9.4 与 v8.4 两套 `src/ui/`。
- **工程文件**:单个 `.lvproj.json`(内嵌素材引用),下载/上传即可;后续可选接 Gitea API 直接存仓库。
- **部署**:纯静态(Nginx / PLAY 服务器 / Gitea Pages),无后端硬依赖。

## 4. 里程碑

- **M0 技术验证(1–2 天)⚠️ 先干这个,全项目最大技术风险都在这**
  1. lv_web_emscripten + `LV_USE_XML=1` 编出 WASM,canvas 里跑起来
  2. JS 喂 XML 字符串 → 热重载成功(unregister→register→create_screen)
  3. 命中测试/包围盒桥函数打通,覆盖层能框住控件
  4. 顺手核一遍 9.4 内置 widget 的 XML 属性覆盖率清单
- **M1 MVP(约 1–2 周)**:15 个核心 widget(label/button/slider/switch/arc/bar/image/checkbox/roller/dropdown/textarea/spinner/led/panel(容器)/tabview);拖拽/缩放/对象树/属性面板;flex 布局;JSON 存取;C 导出(9.4、单屏)并在 ESP32 真机编译跑通。
- **M2 完整编辑(约 2–4 周)**:样式系统(states/parts)、多屏与跳转、字体/图片素材管线、事件绑定、subjects 数据绑定、undo/redo、**圆屏预览遮罩**(GC9A01/ST7102 这类圆屏是自家主力)。
- **M3 8.4 兼容(二期,暂缓)**:重命名映射表、兼容模式校验、双导出;两个版本各拿一块手上的 ESP32 板真机编译+烧录验证(按惯例走固件指纹验证)。一期只需保证代码生成器是「IR→emitter」结构,8.4 将来加一个 emitter 即可。
- **M4 锦上添花**:自定义可复用组件、模板库、多分辨率 responsive 预览、Gitea 集成、生成的 8.4 C 服务器端编 WASM 回传预览(参考 EEZ Full Simulator 思路)。

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| lv_xml 个别 widget 属性没暴露 | M0 就做覆盖率清单;缺口属性走"导出期 C 补丁段"(生成的 C 里直接调 API,预览近似) |
| **LVGL XML 规范许可**:公开分发处理该格式的编辑器/生成器需 LVGL LLC 书面授权(内部私用豁免) | 中间格式用自有 JSON;XML 只作内部预览通道 → **内部部署没问题**;将来若开源:改 JS→C 桥直接建控件绕开 XML,或发邮件申请授权 |
| 8.4 导出无真渲染预览(画布只跑 9.4) | 映射表 + 真机编译验证兜底;M4 可加服务器端编译预览 |
| 属性面板长尾是体力活 | 按自家项目实际用到的 widget 增量补,不追一次全覆盖 |
| EEZ Studio 过渡期依赖其代码质量 | 只用稳定版,升版后按其惯例重新构建验证 |

## 6. 过渡方案(今天就能画 UI)

**EEZ Studio 桌面版**(GPL 免费,8.4.0/9.4.0 都支持,41 widget,WASM 真渲染):Windows 直装或 WSL 装;真要浏览器访问,`docker + KasmVNC` 包一层即可。它同时是本项目 8.4/9.4 双导出行为的活参考。
