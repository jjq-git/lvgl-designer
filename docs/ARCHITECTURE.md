# ARCHITECTURE — LVGL Web Designer 总架构（9.4 基线；9.5 迁移中）

> 2026-07-02 的 9.4 架构基线；2026-09-04 回写 9.5 迁移决策。本文未逐段改写的 XML/9.4 细节仅用于解释历史实现；当它们与 `LVGL-UI-需求与实施方案.md`、`preview-architecture.md` 或 `lvgl-generator.md` 冲突时，以后三者的 9.5 决策为准。

> **9.5 迁移不变式**：产品目标是 LVGL 9.5.0；9.5 不含开源 XML 引擎，目标 Preview 不生成/解析 XML；纯 lowering 已抽到 `@lvd/compiler-core`，`@lvd/preview-compiler` 已产出 POD 协议；`@lvd/lvgl-runtime` 已落地全量 preflight 执行器、无 XML C driver、自建 display/flush/indev 和五格式 framebuffer；`emitC95` 与 Designer 正式 9.5 导出已落地；普通 `cPatch` 已在 Validator/emitter 阻断；`ProjectSnapshotV2` 已接管编辑、文件、本地、云端和版本历史，只持久化一份 UiProject v2 UI 树并并列锁定 Profile/BuildTarget/Action Registry。v1 仅为只读运行时投影和旧文件入口；Profile/Theme/BuildTarget revision API 已接入，9.4 XML 回退仍待明确退场条件。

## 0. 文档地图

| 文档 | 内容 | 状态 |
|---|---|---|
| [PLAN.md](PLAN.md) | 目标、选型、里程碑 | 有效 |
| [调研-2026-07-02.md](调研-2026-07-02.md) | 生态调研、许可红线、8.4/9.4 断裂点 | 有效 |
| [design/01](design/01-工程Schema与Widget描述表.md) | 工程 JSON schema、widget 描述表、样式模型、命名策略 | 历史 9.4 基线;当前以 Schema v2 和文内 2026-09-04 信任边界修订为准 |
| [design/02](design/02-WASM桥与画布交互.md) | WASM 构建、bridge.c 全集、画布交互、热重载 L1~L3 | **全盘有效**,另补 5 个桥函数(§3.3)与 L4(§3.4);lv_conf 补 LV_USE_TINY_TTF=1;命中测试改用公开 API lv_obj_get_coords |
| [design/03](design/03-代码生成器.md) | IR、XML/C emitter、golden 测试 | 有效,除:砍 pass4 样式自动提升、删 emitXmlUpdateFragment、删 LoweringRule、XmlEmitResult 补 lineMap、set_name 加宏守卫、输入类型直用 @lvd/schema、颜色/键名按 01 |
| [design/04](design/04-前端应用架构.md) | monorepo、store、undo、DnD、素材、持久化、测试 | 有效,除:LvglBridge 接口废弃(用 02 的 LvglRuntime)、WidgetNode 废弃(用 01 的 schema)、SINGLE_FILE 改双文件、Overlay 坐标按 02、mock 降级为打桩、快照环形备份简化 |
| [design/05](design/05-交叉评审.md) | 全部裁决的依据与源码引用 | 本文的裁决来源 |
| [M1-REPORT.md](M1-REPORT.md) | M1 验收(E1~E7)+ ESP-IDF 真编译 | 交付存档 |
| [ALL-WIDGETS-REPORT.md](ALL-WIDGETS-REPORT.md) | 35 控件全量扩容:来源/属性/子元素/已知限制 | 交付存档 |
| [screen-inventory.md](screen-inventory.md) | 全仓历史屏幕盘点（预设权威来源已迁移到 site frame manifest） | 参考 |
| [DEPLOY.md](DEPLOY.md) | 部署运维手册(本机 systemd + 腾讯云 docker/caddy) | 有效 |
| [m0/REPORT.md](../m0/REPORT.md) | M0 技术验证 8/8 | 交付存档 |

## 1. 总体架构与数据流

```
┌──────────────────────────── 浏览器(纯静态部署)────────────────────────────┐
│  apps/designer (React 18 + TS + Vite)                                      │
│  ┌──────────┬─────────────────────────────┬───────────────┐               │
│  │ 组件面板  │ CanvasStage                  │ 属性/样式/事件 │               │
│  │ 对象树    │  <canvas> ← LVGL9.4 WASM     │ 检查器         │               │
│  │ 屏幕列表  │  <svg overlay> 选择框/手柄/   │ (描述表驱动    │               │
│  │          │   参考线/圆屏遮罩(同一 transform│  自动生成表单) │               │
│  │          │   容器,逻辑坐标系)            │               │               │
│  └──────────┴─────────────────────────────┴───────────────┘               │
│        │ 全部编辑操作走 projectStore.mutate(immer patches)                  │
│        ▼                                                                    │
│  工程模型 .lvproj.json(@lvd/schema,单一事实源)                             │
│    ├─ reloadPipeline:diff 分级 → L1/L2/L3/L4 → LvglRuntime → bridge.c      │
│    │    L1 属性级直调 apply_cb;L3 屏级 XML 重注册;L4 全工程重载             │
│    ├─ @lvd/codegen:normalize → IR ─┬─ XML emitter(仅内存预览通道)          │
│    │                               └─ C94 emitter → src/ui/*.c/h(导出物)   │
│    └─ @lvd/asset-pipeline:字体(tiny_ttf 预览 / lv_font_conv 导出)、         │
│         图片(lodepng 预览 / 自写 v9 编码器导出),Web Worker 内跑             │
│  持久化:IndexedDB 自动保存(素材内容寻址分离);导出 = base64 内嵌单文件       │
└─────────────────────────────────────────────────────────────────────────────┘
```

核心原则:
1. **画布即真值**:预览必须是真 LVGL 9.4(WASM)渲染;不可预览的能力显式打角标(cPatch/c-only),绝不 DOM 仿制。
2. **工程 JSON 是单一事实源**;LVGL XML 只存在于内存里的预览通道 + 可选导出物(许可红线,见 §7)。
3. **一份 widget 描述表驱动一切**:组件面板、属性检查器、校验器、XML emitter、C emitter、(二期)8.4 映射,全部消费 `packages/schema/src/widgets/`,且有 CI 对账(从 parser 源码 grep 属性清单 diff 描述表)。

## 2. 仓库结构(pnpm workspace,评审 X4 归并)

```
lvgl-web-designer/
├── pnpm-workspace.yaml
├── vendor/lvgl/                 # LVGL 9.4.0 源码(不提交,.gitignore;build 时需要)
├── runtime/                     # WASM 构建工程(emcmake;非 npm 包)
│   ├── CMakeLists.txt           # MODULARIZE=1 + EXPORT_ES6 + 双文件(评审 X5,弃 SINGLE_FILE)
│   ├── lv_conf.h                # LV_USE_XML/OBJ_NAME/SNAPSHOT/TINY_TTF/LODEPNG/TJPGD/QRCODE/LOTTIE/THORVG=1,32bpp
│   ├── src/bridge.c|bridge_hit.c|bridge_log.c
│   ├── src/xml_parsers_extra/   # ★ 自研 13 控件 XML parser(led/line/…/lottie)+ manifest.json(schema 对账事实源)
│   └── build.sh                 # 产物 → packages/lvgl-runtime/dist/{lvgl_runtime.mjs,.wasm}(现 ~1.62MB)
├── deploy/                      # 部署件:serve.mjs(纯静态)/ server-ai.mjs(静态+DeepSeek代理+口令门)/ README-ai.md
├── packages/
│   ├── schema/                  # ★ 单一事实源:类型 + 35 控件描述表(officialWidgets/complexWidgets/extraWidgets)+ format.ts
│   ├── compiler-core/           # 纯 normalize + IR + diagnostics，仅依赖 schema
│   ├── preview-compiler/        # IR → 无 XML/无 C 模板 PreviewProgram；runtime 已接入首批受控 ABI
│   ├── codegen/                 # emitters/{xml(迁移期),c94(兼容),c95(产品目标)}
│   ├── lvgl-runtime/            # LvglRuntime 唯一桥契约 + PreviewProgram preflight/执行器 + 打桩 mock
│   └── asset-pipeline/          # design/04 §5:fontConv(worker,spike 已验)/ imageEncodeV9(待做)
├── scripts/                     # audit-parsers/audit-extra 对账;compile-smoke(host gcc)/compile-smoke-arm(cortex-m4)
└── apps/designer/               # React 应用:stores/ canvas/ panels(含 ai/ AI面板、AssetPanel 素材)/ services(ai/)
    └── e2e/                     # run-e2e(E1~E7)/ ai-e2e(mock AI)/ all-widgets-e2e(35控件)+ 截图 artifacts
```

## 3. 核心契约(裁决后的最终形态)

### 3.1 标识:id / name 双轨(评审 X1)

- `WidgetNode.id`(UUID):编辑器内部唯一引用,树操作/undo/事件绑定全走它,永不导出。
- `name`(CName,`/^[a-z][a-z0-9_]*$/`,screen 内唯一):用户可选填;中文放 `displayName`。
- **XML 预览通道**:emitter 给**每个**节点强制输出 `name` —— 有用户名用之,匿名节点发 `_x` + uuid 前 8 位 hex;emitter 随结果回传 `previewName ↔ uuid` 双向 Map(命中测试、错误定位靠它)。
- **XML 导出物与 C 代码**:匿名节点不发 name、不进 objects 结构体。
- 全局符号(screen/style/subject/const/asset 名)共用一个去重域;widget name 按 screen 作用域去重。

### 3.2 Widget 描述表:一份,不许复制(评审 X3)

位置 `packages/schema/src/widgets/`,结构以 design/01 §3 的 `WidgetSpec/PropSpec` 为基(含 `channel:'both'|'c-only'`、`companions`、`ChildSpec.kind:add|getter|virtual`),`c` 字段用 `PerVersion<CSetter>` 形态留 8.4 键位,`ui` 字段驱动检查器表单。**CI 对账脚本**:从 `vendor/lvgl/src/others/xml/parsers/*.c` grep `lv_streq("...")` 生成属性清单与描述表 diff,防手抄漂移。

### 3.3 桥契约:`LvglRuntime` 唯一(评审 X6),bridge.c 导出总表

TS 契约 = design/02 §3.1 的 `LvglRuntime` 类(错误统一 `LvglError` + 日志钩子聚合,不用 boolean)。C 侧导出(design/02 §2 全集 + 评审补项):

| 函数 | 来源 |
|---|---|
| `lvd_init / lvd_tick / lvd_set_resolution` | 02 §2.2 |
| `lvd_register_component / lvd_unregister_component / lvd_reload_screen / lvd_create_child / lvd_delete_obj` | 02 §2.3 |
| `lvd_update_attrs`(直调 processor 的 apply_cb,绕开 lv_xml_update 的路径限制) | 02 §5.1 |
| `lvd_obj_at_point`(自写遍历,不看 CLICKABLE;用公开 `lv_obj_get_coords`,评审 R9) | 02 §2.4 |
| `lvd_get_obj_rect / lvd_get_obj_rects`(批量)/ `lvd_dump_tree` | 02 §2.5/2.6 |
| `lvd_snapshot / lvd_snapshot_free` | 02 §2.7 |
| `lvd_set_interactive / lvd_pause_anims` | 02 §2.8 |
| `lvd_register_image / lvd_register_font_tiny_ttf / lvd_set_asset_prefix` | 02 §2.9 |
| **`lvd_reload_all(globals_xml, screens[], n)`** — L4 全工程重载 | 评审 G1 |
| **`lvd_register_event_stub(cb_name)`** — 预览态回调打桩(EM_JS 上报触发) | 评审 G3 |
| **`lvd_load_screen(name)`** — 纯切屏不重建 | 评审 G6 |
| **`lvd_drop_image_cache(src)`** — 图片替换后失效缓存 | 评审 G4 |
| **`lvd_set_manual_tick / lvd_advance_tick`** — e2e 确定性截图 | 评审 X6 |

### 3.4 热重载协议:四级(评审 X2 + G1)

**`lv_xml_update_from_data` 路线已被源码证伪弃用**(裸 name 只能命中活动屏直接子节点)。分级:

| 级 | 触发 | 执行 | 量级 |
|---|---|---|---|
| L1 属性级 | 白名单属性(x/y/w/h/align、`style_*` 内联值、widget 值属性、flags/states) | `lvd_update_attrs` 直调 apply_cb | µs,跟拖动每帧 |
| L2 控件级 | 增删叶子/子树 | `lvd_create_child` / `lvd_delete_obj` | 10µs–ms |
| L3 屏级 | 结构变更、共享样式、z 序、reparent、**任何属性删除/置默认** | `lvd_reload_screen` 五步序列(删实例→unregister→register→create→load,顺序不可乱) | ms 级 |
| **L4 全工程** | **subjects / 全局 styles / consts / 字体任何变更** | `lvd_reload_all`:销毁全部屏 → 重注册 globals → 逐屏重建 | 十 ms 级 |

不变式(写进断言):实例删除先于 unregister;同名注册前必 unregister;L1 attrs 不含 name 键;属性从有到无强制 ≥L3;几何读取前置 `lv_obj_update_layout`。
运行态(预览试玩)退出时强制一次 L3/L4 复位(评审 G8)。启动/刷新页面的初始化管线定死:`loadProject(IndexedDB) → LvglRuntime.create → 全量 writeAsset+lvd_register_* → lvd_reload_all`(评审 G5)。

### 3.5 资产通道(评审 X7)

- **统一走 bridge 直注册**进 globals scope;**globals.xml 只承载 consts/styles/subjects**。
- 字体:预览 = TTF 写 MEMFS + `lvd_register_font_tiny_ttf`(零转换);导出 = worker 里跑 `lv_font_conv` 生成 C 数组(库入口浏览器可运行性属 M0 验证 R5,兜底为"给出本地 npx 命令"降级)。字体任何变更 → L4。
- 图片:预览 = PNG 写 MEMFS + `lvd_register_image`(lodepng 解码);替换 = 写 MEMFS → `lvd_drop_image_cache` → L3/L4。导出 = `asset-pipeline` 自写 v9 `lv_image_dsc_t` 编码器(RGB565/RGB565A8/ARGB8888/I8)。
- 预览色深固定 32bpp,与 RGB565 真机有渐变观感偏差 —— UI 上显式声明(评审 G9),16bpp runtime 变体二期。

### 3.6 代码生成(design/03,砍 pass4)

- 管线:`LvProject(@lvd/schema)→ @lvd/compiler-core.normalizeProject(resolveRefs/eliminateDefaults/assignNames)→ IR → Preview/C emitters`。Core 不依赖 Preview、XML 或 Codegen。**样式自动去重提升(pass4)砍掉**(评审 O1):样式归属完全显式 —— 检查器改属性 = 写 inline,显式"提取为样式"命令才产生命名样式;二期降级为 lint 建议。
- `XmlEmitResult` 每屏带 `lineMap: {line, nodeId}[]`(评审 G2),解析错误行号可定位到画布节点。
- C 输出布局:`src/ui/`(CMakeLists/ui.h/ui.c/ui_conf.h/objects.h/styles.*/subjects.*/screens/*/fonts/images/actions.h + actions_default.c(weak)+ actions.c(只生成一次,用户所有))。`emitC94` 保留历史兼容；`emitC95` 是产品目标，对三种 target 生成精确钉死 9.5.0 的说明和 `build-manifest.json`（含资源哈希与未实现 Action）。详见 `lvgl-generator.md`。
- 事件回调保护 = **分文件 + weak 兜底**(纯写入结构上不可能吞用户代码)。
- 测试:golden 文本快照 + host gcc 编译冒烟(CI 必跑);XML↔C 像素对拍推迟 M3+/nightly(评审 O2)。
- 旧 v1 XML emitter 仍只输出 `<screen>` 文档并拒绝非空 `components`；当前 v2 编辑模型以 `component:<id>` 保存关联实例，在进入 Preview/C/Web emitter 前展开为普通 Widget Tree。

### 3.7 前端(design/04,按裁决修正)

- Zustand + immer 双 store:`projectStore`(文档态,`produceWithPatches` 即 undo/redo,coalesceKey 合并连续拖动)/ `editorStore`(选中/缩放等瞬态,不进历史不进文件)。
- reloadPipeline 是 **store 订阅**(不过 React),diff 分类路由到 L1~L4;L1 的属性字符串格式化复用 `@lvd/schema/format.ts`(与 emitter 同一份表)。
- 画布 DnD 自研 PointerDnd(落点在 canvas 内部必须问 `hitTest`);对象树用 dnd-kit sortable。
- Overlay:与 canvas 同置一个 `translate+scale` 容器,内部全用 LVGL 逻辑坐标;手柄 `scale(1/zoom)` 反补偿;`image-rendering: pixelated`;事件由 stage 统一 pointer 捕获 + `data-handle` 判定(评审 X8)。圆屏遮罩 = SVG evenodd path,GC9A01(240²)/ST7102(466²)预设。
- 持久化:IndexedDB(projects 表 + debounce 2s + beforeunload flush;素材 sha-256 内容寻址);导出 = **base64 内嵌单文件** `.lvproj.json`(评审 X9,>20MB 再升级 zip);StorageProvider 接口留 Gitea 二期缝。
- mock 桥 = 接口打桩(可调、返回固定值),**不做影子布局树**(评审 O4);WASM 加载失败回落打桩 + 黄条。

## 4. 控件范围(2026-07-02 全量扩容后)

- **当前 = 34 控件 + obj 基类,LVGL 9.4 全量(唯一排除 3dtexture,GL-only 软渲染无法预览)**:
  - 官方 XML parser 的 23 个:arc, bar, button, buttonmatrix, calendar, chart, checkbox, dropdown, image, keyboard, label, qrcode, roller, scale, slider, spangroup, spinbox, switch, table, tabview, textarea, canvas(经自研 parser 覆盖注册补上缓冲,已可用), obj
  - **自研 parser 的 13 个**(runtime/src/xml_parsers_extra/,`lvd_register_extra_widgets()` 注册,manifest.json 为 schema 对账事实源):led, line, spinner, imagebutton, animimage, msgbox, list, menu, win, tileview, arclabel, canvas(缓冲版), lottie(ThorVG 编入,WASM +350KB)
  - 子元素(children)双通道已实现:chart-series/cursor/axis、table-column/cell、tabview-tab、spangroup-span、msgbox/list/win/tileview/menu 子项等(kind: add/getter/virtual)
- <历史存档> M1 一期原白名单为 15 控件,扩容记录见 docs/ALL-WIDGETS-REPORT.md(生成中)。
- 属性缺口走 `channel:'c-only'`(检查器有、XML 跳过、C 照发、画布角标),一期只开刚需:keyboard→textarea 关联、textarea.max_length、chart scatter X 值。
- **砍掉/推迟**(评审 O 系):样式自动提升(砍)、像素对拍 CI(推迟)、timelines 成套(删,二期)、bind_style/color subject/翻译/consts 面板(schema 保留,UI+emitter 不实现)、mock 影子树(砍)、快照环形备份(简化)、智能节流(推迟)。
- 8.4:只留缝 —— `PerVersion` 描述表键位、`Emitter` 注册表、`meta.lvglVersion` 联合类型、bridge 以 name+字符串为界面(二期另编 v8 runtime 由 IR 直驱建树)。**无任何实现**。

## 5. M0 技术验证清单(先干这个,全项目风险都在这)

搭 `runtime/` 最小工程(评审 R1~R10 + G1/G4):

1. **R1** MODULARIZE+ES6 双文件产物:工厂注入 canvas、destroy→re-create 3 轮无残留。
2. **R2** 纯 rAF 驱动 `lv_timer_handler`(无 emscripten_set_main_loop)时 SDL 鼠标事件照常入队(预览态点按钮)。
3. XML 热重载全链路:register→create_screen→改 XML→L3 五步重载,毫秒级;解析错误经日志钩子拿到行号。
4. **R3** L4/globals 重载:注册 subject→绑定→`lvd_reload_all`→触发 subject,无野指针(unregister("globals") 行为核实;不可靠则兜底 runtime 整体 destroy+recreate 并量成本)。
5. **R4** `lvd_update_attrs` 空 scope 下 `text_font`/`#const` 值解析正确(L1 快路径正确性)。
6. 命中测试 + `lvd_get_obj_rect`:嵌套/flex 布局下选中框准确;`lv_obj_update_layout` 前置生效。
7. **R7** 图片同名替换:MEMFS 覆写 + `lvd_drop_image_cache` 后画布刷新为新图。
8. **R5/R6** `lv_font_conv` 浏览器 worker 可运行性;tiny_ttf vs 位图字体渲染差异肉眼评估(bpp 1/2 重点)。
9. **R8** 裁决 set_name 宏守卫 or 不输出;**R10** 466×466 + snapshot + 多字体下 HEAP 峰值观测(32MB 初始堆)。
10. 9.4 XML 属性覆盖率对账脚本首跑(parser grep ↔ 描述表 diff)。

## 6. 里程碑(2026-07-02 状态)

- ✅ **M0 技术验证**(8/8,m0/REPORT.md)
- ✅ **M1 MVP**(E1~E7 + ESP-IDF 真编译,M1-REPORT.md)
- ✅ **苹果亮色主题**(三方案评审,A-light 上线;B/C 留档 restyle/)
- ✅ **DeepSeek AI 画 UI**(§7)
- ✅ **35 控件全量 + 素材面板 + 子元素编辑器**(ALL-WIDGETS-REPORT.md;M2 的素材管线/undo 等多数项已随之落地)
- ✅ **STM32 支持**(三目标导出/UI_WEAK/REQUIREMENTS.txt;host gcc 326/326 + **arm-none-eabi cortex-m4 326/326** 双配置零告警)
- ✅ **账号系统 + PostgreSQL 云端工程存储 + 版本历史/回滚**(阶段一二三,PLAN-accounts-storage.md;真库跨设备同步已验)
- ✅ **本地体验优化一批**(2026-07-03,体检驱动):复制粘贴复刻、多选拖动、框选、方向键微移、适应窗口、Esc 关弹层、快捷键帮助;修 getObjRects 截断/粘贴目标/rAF 黑屏等
- ✅ **部署**(本机 §8;腾讯云公网 §8 —— ⚠️ 2026-07-03 起失联待恢复)
- ⏳ 余量:云同步竞态收口(待云端恢复)、跨容器 reparent、对齐/分布工具、图层锁定隐藏、中文预览字体、影子 codegen 清理;M2 尾巴(事件/subjects/命名样式 UI、图片 C 数组导出)→ **M3(二期)8.4 emitter** → **M4** 组件复用/模板/Gitea。

## 7. AI 子系统(DeepSeek「AI 画 UI」,2026-07-02 上线)

```
AiPanel(聊天面板)→ aiSession.runAiTurn → deepseekClient(同源 /api/deepseek/chat)
  → 代理(server-ai.mjs:x-ds-key 头 或 服务端 DS_KEY 回落 → Bearer 转发 api.deepseek.com)
  → 模型输出 {reply, ops[]}(json 模式)→ opsSchema 宽容解析 → applyAiOps 校验
  → 校验失败:错误喂回模型自动修复(≤2 轮)
  → 通过:单 recipe → projectStore.mutate('AI: …')= 一条 undo → 热重载即时可见
```

- system prompt 由 registry **程序化生成**(35 控件+属性值域,~2k tokens),控件扩容自动跟进。
- ops 协议:replace_screen / add / update / remove;NodeSpec 无 id(应用时生成),name 冲突自动改名。
- Key 双通道:浏览器 localStorage['lvd.ds.key'](设置面板)优先,否则服务端 `DS_KEY`(本机 `~/.config/lvgl-designer/env`,腾讯云 `/opt/lvgl-designer/env`);key 永不进仓库/日志。
- 模型:deepseek-chat(默认,快)/ deepseek-reasoner 面板可切;真模型闭环已实测(时钟界面三控件、公网 Hello 标签)。

## 8. 部署拓扑(2026-07-02)

| 环境 | 形态 | 入口 |
|---|---|---|
| 本机 | systemd --user `lvgl-designer.service` → `deploy/server-ai.mjs`(EnvironmentFile=~/.config/lvgl-designer/env) | http://localhost:8318 |
| 腾讯云 Lighthouse(考研笔记本同机,124.221.248.195) | docker `lvgl-designer`(node:22-alpine,挂 exam-notebook_app-net,不占公网端口)+ en-caddy `/lvgl/` 路由(handle_path)| http://124.221.248.195/lvgl/?token=…(口令门,cookie 记住) |

- 前端构建 `base:'./'` + 代理地址随 `document.baseURI` 解析 → 同一份 dist 根路径/子路径通吃。
- 口令门:`AUTH_TOKEN` 设置即启用(整站含 API;`?token=` 一次种 cookie);未设置(本机)行为不变。
- **运维坑**:en-caddy 的 Caddyfile 是单文件 bind mount,宿主机改完必须 `docker restart en-caddy`(reload 不换 inode);动 caddy 勿伤考研笔记本。细则见 [DEPLOY.md](DEPLOY.md)。

## 9. 许可红线(不变)

LVGL XML 格式规范版权归 LVGL LLC:公开分发处理该格式的编辑器/生成器需书面授权,内部私用豁免。本架构中 XML 仅作内存预览通道 + 默认关闭的可选导出(`CodegenOptions.exportXml=false`)→ **内部部署无虞**;若将来开源发布:改由 IR 直驱 bridge 建树绕开 XML,或向 lvgl@lvgl.io 申请授权。
