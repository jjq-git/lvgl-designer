# LVGL JSON UI 可视化系统：需求与实施方案

> 最后更新：2026-09-04（第十一版，ControllerProfile 与 BuildTarget 跨引用发布闭环已落地）
> 状态：阶段 0 技术验证完成，阶段 1/2 主链路已贯通，阶段 3 Widget 与真实产品闭环进行中
> 主实现仓库：`38_index`；核心源码目录：`lvgl-designer/`
> 关联仓库：`38_index`、`iot_server_frontend`、`iot_server_backend`、目标固件工程

> ## ⚠️ 阶段 0 实测推翻了本文的一项核心前提
>
> **LVGL 9.5.0 已把 XML UI 引擎整体移出开源仓库，并将其并入商业产品 LVGL Pro。**
> `LV_USE_XML`、`src/others/xml/`、22 个官方 parser、全部 `lv_xml_*` API 在 9.5.0 中不存在。
> 依据：`lvgl-9.5.0/docs/src/CHANGELOG.rst` Breaking Changes「XML Engine Removed」+ PR [lvgl/lvgl#9565](https://github.com/lvgl/lvgl/pull/9565)。
>
> 受影响的章节：**§2.1、§2.3、§2.6、§3.4、§7、§9 阶段 0/1/2**。相关段落已就地标注修正。
>
> 完整分析与修订后的路线见阶段 0 交付物：
> - `PHASE0-REPORT.md` — 8 项交付汇总、待决策事项
> - `lvgl-version-baseline.md` — 9.4→9.5 完整差异清单（可用 `pnpm audit:lvgl-diff` 复现）
> - `xml-license-boundary.md` — 许可边界重判
> - `preview-architecture.md` — 去 XML 的预览通道设计与 Schema v2 评审意见

## 0. 结论先行

原始需求的方向正确：应以自有 JSON UI Project 作为业务事实源，由同一份工程驱动 Web 预览、校验、LVGL 代码生成和后续 AI 修改。

但上一版方案有几项不合理判断，本版已纠正：

| 问题 | 上一版判断 | 本版结论 |
| --- | --- | --- |
| LVGL 版本 | 因现有工程使用 9.3/9.4，默认放弃 9.5 | **目标版本采用产品需求指定的 LVGL 9.5.0**；现有 9.4 实现是迁移起点，不是推翻需求的理由 |
| 9.4 钉版注释 | 视为公司层面“主动拒绝 9.5”的决策 | 只能证明 `MultiTester` 当时需要 9.4 兼容，不能外推为所有产品的长期架构决策 |
| Renderer 与 Generator | 文档声称二者互不依赖 | **9.5 主通道已解耦**：Designer 通过 `@lvd/preview-compiler` 直驱受控 PreviewProgram；`@lvd/codegen.emitXml()` 只保留为 9.4 迁移回退，待明确退场条件后删除 |
| Theme Token | 强制 Token 名满足 C 标识符 | Schema 不应被 C/XML 命名规则反向绑定；使用语义 ID，输出端再确定性映射到 C 符号 |
| 屏幕尺寸权威 | Controller Profile 独占屏幕几何，Project 保存派生副本 | 抽出独立 `DisplayProfile`；UI 和 Controller 都引用同一个不可变 Profile，不持久化派生副本 |
| 触摸映射 | `touchMap` 作为 UI/Controller 必备字段 | 原始触摸坐标校准属于硬件输入配置；只在需要仿真原始触摸时通过 `InputProfile` 引用，不进入通用 UI Schema |
| 客户分享与许可 | 客户只读分享自动等于对外分发 XML 编辑器，必须先重写 bridge | 不能自动等同。内部 XML 工具、只读预览、对外编辑器是三种不同场景；客户预览优先发布预编译 WASM 产物，涉及在客户浏览器处理 XML 时再做许可确认 |
| 16bpp 预览 | 必须维护独立 16bpp runtime | **【已实装验证】不需要双 runtime。**9.5 host 已改为自建 `lv_display`、64 行 partial buffer 与 Canvas `flush_cb`，同一产物已在 Chrome 实测 `RGB565`、`RGB565_SWAPPED`、`RGB888`、`XRGB8888`、`ARGB8888` 五种格式；SDL 只留在显式 9.4 legacy 构建 |
| **XML 通道**（阶段 0 新增） | 编辑态可继续使用 LVGL XML | **9.5 无 XML 引擎**。预览必须改为自有 IR 直驱 LVGL C API。影响面已量化：runtime 170 个可解析符号中 9.5 缺失 30 个，全部是 `lv_xml_*`；13 个自研 parser 的 widget API 零破坏 |
| 像素一致性 | 同版本 + 同色深即可“所见即真机” | 仍受字体、`lv_conf.h`、绘制后端、图片转换和驱动影响；必须通过截图对拍量化，不能仅靠配置声明 |
| RAG 阈值 | 以 200 个模板、300 个项目等固定数字触发 | 删除无依据的固定数字，改为由上下文占用、检索失败率和真实用户需求触发 |

推荐路线：

1. 基于已有 `lvgl-web-designer` 增量演进，不另建 Schema、Renderer 或 Generator。
2. 新系统目标基线定为 **LVGL 9.5.0**；9.4 作为迁移兼容入口，是否长期保留由真实产品决定。
3. 先完成 Schema v2 与模块边界评审，再实现 9.5 runtime/emitter 和产品外壳预览。
4. 编辑态预览继续使用真 LVGL WASM；客户分享使用发布时生成的不可变、预编译 WASM 产物。
5. MVP 只闭环一个真实控制器、一个 Theme、八个 P0 Widget 和一个真实固件页面。

### 0.1 代码实施核查（2026-09-04）

| 项目 | 当前状态 | 下一步 |
| --- | --- | --- |
| Schema v2 类型/校验/迁移/JSON Schema | ✅ `ProjectSnapshotV2` 已接管编辑、文件、IndexedDB、云工程和版本历史；Canvas/Inspector 等写操作使用 v2 patch，Token/icons 可无损编辑与撤销；v1 仅为只读运行时投影和旧文件入口 | 接入真实 Controller/Profile 设备数据并完成首个产品闭环 |
| 中立 IR/lowering | ✅ 已抽到 `@lvd/compiler-core` | 与 Schema v2 的 Profile/Token/Action 结构对齐 |
| Preview Compiler | 🟡 `@lvd/preview-compiler` 已产出无 XML/无 C 模板的 POD 协议、节点映射与 colorFormat 门禁；`@lvd/lvgl-runtime` 已增加全量 preflight、命名 style、五种作用域 const、P0 binding、受控 event 分发，以及 table/tabview 的 virtual/add/getter 结构切片；Designer 已优先使用该协议 | Chart、Menu、List 等其余结构随阶段 3 Widget 扩展；再设计 typed 增量 patch |
| LVGL 9.5 C emitter | 🟡 `emitC95` 初版、精确版本和 manifest 已落地；16bpp 发布必须确认 RGB565 字节序，manifest 已写 `colorFormat` 及 BuildTarget/UI/Controller/Display/Theme revision 锁；正式 C 导出已切换并阻断 `cPatch` | 补 host/ARM/ESP-IDF 9.5 真编译与上板 |
| Designer 与 Codegen 解耦 | 🟡 9.5 预览主通道已改为直接依赖 `@lvd/preview-compiler`，不生成 XML；`@lvd/codegen.emitXml()` 只在旧 9.4 runtime 缺少 Preview ABI 时作为迁移回退 | 明确 9.4 兼容退场条件后删除 XML adapter、`localEmitXml.ts` 和 Designer 的 codegen 预览依赖 |
| LVGL 9.5 WASM runtime | ✅ 无 XML 的 `preview_host.c` + `preview_driver.c` 已由 LVGL v9.5.0 commit `85aa60d18b3d`、Emscripten 6.0.9 真编译；manifest 标记 `runtimeMode=preview-program`、`displayHost=canvas-flush`、`inputHost=pointer-events`。Designer 生产构建及浏览器 P0/交互/五格式冒烟通过，WASM 为 1,477,417 B | 扩展阶段 3 Widget；补发布 WASM、固件 simulator 与真机截图对拍 |
| colorFormat/display/indev | ✅ 9.5 使用自建 display、64 行 partial draw buffer、五格式 Canvas 转换，以及 Pointer/Wheel → pointer/encoder indev；Toolbar 已提供 Display 格式与 Controller 选择，未确认任一项都禁止发布 | 接入真实 Profile 仓库，并补外壳、旋转、裁切、滚轮与高 DPI 回归 |
| 版本感知 UI/AI | 🟡 正式 C 导出、AI 目标和 Toolbar 已切 9.5.0；v2 快照保存完整 BuildTarget 并由其约束 emitter | 按 Capability 包选择 runtime，并完成平台级 Profile/BuildTarget API |
| Components/真实页面/产品对拍 | ❌ 尚未闭环 | 先完成 86 屏控制页+设置页，再补 arc/bar/switch 用例 |

## 1. 需求边界

### 1.1 业务目标

静音舱控制器存在多客户、多控制器型号和多套 UI。不同组合可能具有不同的：

- 外壳、边框、屏幕开孔和物理控件。
- 屏幕分辨率、形状、色彩格式和安装旋转。
- 页面结构、布局、Theme、字体、图标和图片。
- Widget 配置、交互和设备数据绑定。

系统需要让设计师、工程师和 AI 操作受约束的 UI Project，而不是把手写 LVGL C 当作唯一源文件。

### 1.2 核心能力

```text
用户 / 设计师 / AI
        ↓
版本化 JSON UI Project
        ├──→ Validator
        ├──→ Preview Adapter → LVGL WASM
        ├──→ LVGL 9.5 C Generator
        └──→ 保存 / 评审 / 发布 / 分享
```

JSON 至少描述：

- 工程元数据与 Schema 版本。
- Display/Controller/Theme/Build Target 的引用。
- Screens、Components 和 Widget Tree。
- Position、Size、Align、Flex、Grid。
- LVGL Style、Part、State 和局部覆盖。
- Assets、Fonts、Icons 和 Translations。
- Events、Actions、Subjects 和 Data Binding。

### 1.3 第一阶段不做

- 不支持 LVGL 全部 Widget 和私有 API。
- 不承诺任意手写 C 可自动、无损还原为 JSON。
- 不在 Vue 管理平台中重做 React 设计器。
- 不让 AI 直接修改 C、JavaScript 或任意表达式。
- 不先建设完整多租户、审批、计费或 RAG 系统。
- 不同时承诺 8.4、9.4、9.5 三条完整生成链。
- 不在 Schema 未评审前大规模重构既有 Designer。

## 2. 调研依据与现状

### 2.1 LVGL 官方事实

截至 2026-09-03：

- LVGL 官方发布页将 `v9.5.0` 标记为 Latest，发布日期为 2026-02-18。
- LVGL 9.5 官方文档说明 Display Color Format 可选择 RGB565、RGB888、XRGB8888 等，默认值由 `LV_COLOR_DEPTH` 决定，也可对 Display 设置具体格式。
- LVGL Style 不只是简单的“Theme → Named Style → Local Style”三层覆盖；还包含 Part、State 匹配、状态优先级、样式添加顺序和继承。生成器必须保留 LVGL 原生语义。
- ~~LVGL 9.5 的官方 Editor 本身采用 XML，并支持真 LVGL 预览、C 导出、Subjects/Data Binding、动画和翻译等能力。~~
  **【阶段 0 修正】** 官方 Editor 确实采用 XML，但它已成为**商业产品 LVGL Pro**（`github.com/lvgl/lvgl_editor`，Product 层 $20,000/产品/5 年起），且 **XML 引擎已从 MIT 开源库中删除**。9.5.0 里没有 `LV_USE_XML`、没有 `src/others/xml/`、没有任何 `lv_xml_*` API。因此「9.5 上保留 XML 预览通道」不是低成本选项，而是需要采购授权或自维护上游已放弃的代码。详见 `xml-license-boundary.md`。
- 自有 Schema 应避免重复发明已有的 LVGL 概念，但**不得**直接复制 LVGL XML 的标签名/属性名/嵌套结构作为我方公开格式（这是许可与产品定位的双重要求）。

官方参考：

- [LVGL Releases](https://github.com/lvgl/lvgl/releases)
- [LVGL 9.5 Change Log](https://github.com/lvgl/lvgl/blob/master/docs/src/changelog/CHANGELOG.mdx)
- [LVGL 9.5 Color Format](https://docs.lvgl.io/9.5/main-modules/display/color_format.html)
- [LVGL 9.5 Learn the Basics](https://docs.lvgl.io/9.5/getting_started/learn_the_basics.html)
- [LVGL 9.5 Editor Overview](https://docs.lvgl.io/9.5/xml/editor/overview.html)
- [LVGL XML Format License](https://docs.lvgl.io/master/details/auxiliary-modules/xml/license.html)

### 2.2 `lvgl-web-designer` 已有能力

当前 `38_index/lvgl-designer/` 已经具备：

- React 18 + TypeScript + Vite 三栏编辑器。
- `.lvproj.json` 工程模型、TypeScript 类型和 Zod/语义校验。
- LVGL 9.5 PreviewProgram WASM 画布；9.4 XML runtime 仅作迁移兼容构建。
- Widget Tree、Screens、Named/Inline Styles、Events、Subjects/Bindings。
- 35 个已登记 Widget（包含原始需求列出的 15 个）。
- 无 XML 的 9.5 PreviewProgram 主通道、9.5 C emitter，以及 9.4 XML/C 迁移回退。
- 素材处理、撤销重做、IndexedDB、本地/云端工程和版本历史。
- DeepSeek 结构化操作，经 `applyAiOps` 校验后修改工程。

因此本项目是“升级与扩展”，不是从零开发。

### 2.3 已确认的现状缺口

| 缺口 | 代码事实 | 处理方向 |
| --- | --- | --- |
| v1 工程仍携带 9.4 历史字段 | v1 `project.ts`/`c94` emitter 仍保留 9.4 兼容；Schema v2、PreviewProgram runtime 与 `c95` emitter 已具备 9.5 路径 | 由 `BuildTarget.lvglVersion` 接管 Designer 主流程，再确定 v1/9.4 退场条件 |
| **13 个自研 XML parser 需要自行维护** | `runtime/src/xml_parsers_extra/` 共 14 个 `.c`：13 个控件 parser（`animimage` `arclabel` `canvas` `imagebutton` `led` `line` `list` `lottie` `menu` `msgbox` `spinner` `tileview` `win`）+ 1 个聚合器 `lvd_xml_extra.c` | **【阶段 0 修正】** 静态审计已完成：13 个 parser 的 **widget API 侧零破坏**，耦合 100% 集中在 9.5 已删除的 XML 宿主层。因此不是「适配 parser」问题，而是「宿主消失」问题；其业务知识沉淀在 `manifest.json`（属性名→C setter 映射），该映射可原样升格为 IR lowering 表。见修订后的 §2.6 |
| ~~Preview 依赖 Codegen~~ **主通道已修复** | Designer 通过 `@lvd/preview-compiler` 生成 POD PreviewProgram；仅在加载旧 9.4 runtime、缺失 Preview ABI 时调用 XML adapter | 接入 Schema v2 后删除 9.4 XML adapter、`localEmitXml.ts` 与 Designer 的 codegen 预览依赖 |
| ~~runtime 构建不可复现~~ **已修复** | 旧脚本硬编码单机 emsdk 路径且失败被 `2>/dev/null` 吞掉；vendored LVGL 未声明可核验版本 | **【已交付】** `runtime/build.sh` 按固件 `build_web.sh` 模式重写：`LVGL_TAG` 默认 `v9.5.0` 可覆盖、`EMSDK_DIR` 参数化、缺失即显式失败、多源回退；另加固件脚本没有的**版本断言**（源码版本与 tag 不符即失败）与**构建 manifest**（LVGL commit / `lv_conf.h` 哈希 / emcc 版本）。`CMakeLists.txt` 的 LVGL 路径改为 `-DLVD_LVGL_DIR` 参数。失败路径由 `packages/lvgl-runtime/src/buildScript.test.ts` 覆盖（不需 emsdk） |
| ~~Components 未闭环~~ **已修复** | Schema v2 使用 `component:<id>` 保存关联实例；编辑器支持从子树创建、重复拖放、更新定义、解除关联与安全删除 | Preview、LVGL 9.5 C 和 Web UI JSON 在发布投影阶段确定性展开；v1 的非空 `components` 阻断仅作为旧格式兼容边界保留 |
| `cPatch` 信任边界 | 普通 Project/JSON 导入已由 Validator 拒绝；9.5 emitter 也报 `E_CPATCH_FORBIDDEN` 且不落盘片段；9.4 仅保留存量兼容 | 完成 calendar/chart typed property，再设计带权限、签名/哈希与人工审批的独立 trusted extension |
| ~~色彩预览固定 32bpp~~ **已修复** | 9.5 host 运行时调用 `lv_display_set_color_format` 并重建 partial buffer；Canvas flush 显式转换五种格式 | 由 `BuildTarget` 传入目标格式；用固件 simulator/真机截图继续校准像素阈值 |

补充说明：AI 的结构化 `NodeSpec` 未暴露 `cPatch`；现有普通导入和 9.5 生成器也已双重阻断。v1 类型与 9.4 emitter 中的字段/行为仅用于显式的存量迁移兼容，不是普通发布通道。

### 2.4 固件版本现状

当前仓库事实是：部分真机为 9.3，多个 simulator 与 Designer 为 9.4，`MultiTester` 明确钉到 `~9.4.0`。这些事实说明迁移需要兼容验证，但不能推出“产品需求中的 9.5 是错误前提”。

本方案采用以下表达：

- **产品目标版本：LVGL 9.5.0。**
- **现有工具基线：LVGL 9.4.0。**
- **遗留固件：按产品逐个盘点，允许在迁移期保留 9.3/9.4。**
- 任何发布构建都必须记录精确版本或 commit，不能只写模糊的“9.5”。

不再把 `MultiTester` 的一次钉版注释解释成公司范围的长期版本决策。

### 2.5 跨仓库既有资产与复用护栏

本方案的多个「新建」项在固件仓库中已有成熟实现。以下资产**禁止另起炉灶**，实施时必须先接既有链路，确有不足再扩展。

| 既有资产 | 事实源 | 复用要求 |
| --- | --- | --- |
| **跨项目共享图标生成链** | 旋钮屏 `main/CMakeLists.txt` 消费 `platforms/icons/generated/lvgl/wf2_icons.c` | **【阶段 0 修正】** ⚠️ 三处与本行描述不符：① 86 屏（D7 选定的迁移工程）**不消费**该链，它用自有 `host_s3_86panel_icons.c`；② 生成链的**源不在可达目录内**（`registry.json`/`svg/`/`tools/` 均缺失），只有生成物；③ 现有生成物用 ARGB8888 存**纯 alpha 遮罩**，改 `LV_COLOR_FORMAT_A8` 可省约 140 KB。完整规格与待办见 `asset-pipeline.md` |
| **可复现 WASM 构建脚本模式** | 三个固件的 `simulator/build_web.sh`：`LVGL_TAG` 变量固定 tag + 多源回退（含内网 Gitea）+ `EMSDK_DIR` 可覆盖 | 修 `runtime/build.sh`（当前 `:11` 硬编码 `/home/rie/emsdk`、无任何版本约束）时复用这些原则；优先提取共享脚本或参数约定，避免复制后形成两份漂移实现 |
| **生成 C 已在真机跑通一次** | 旋钮屏固件 `main/CMakeLists.txt` 编入 `ui_zip/`，由 `DEMO_UI_ZIP` 开关加载设计器导出产物 | JSON→C→ESP32 链路**已闭合过一次**，阶段 2 的风险应据此下调；同时该通道可直接复用为上板验证入口。注意它只证明「能渲染」，阶段 2 要证明的是「能替代」 |
| **固件 Web 仿真器** | 三个固件各有 `simulator/`：真实固件 C 整体编成 WASM，`web_output/main.wasm` 已入库 | 作为高保真回归与截图对拍基线（§3.4、§10.3），**不新建仿真链路**，也不要求它下线 |
| **CJK 字体子集化与覆盖率门禁** | 旋钮屏 `ui_font_cn_16.c`（「Web/真机共用中文子集字体」）+ 编译前跑 `tests/scripts/check_ui_font_coverage.py`；86 屏 `gen_ui_fonts.sh` 六档字号 | 复用字符收集、子集生成和覆盖率检查的契约与核心实现；如需跨仓库调用，提取稳定 CLI/库，不在 Designer 中复制脚本逻辑 |
| **舱级设置内核与 CANopen 组件** | 旋钮屏 `CMakeLists.txt` 依赖 `host_settings_core`（注释「P4 / 0050 / 86 屏共用的舱级设置内核」）、`host_canopen` / `canopen` | Binding Adapter 放在固件 UI 集成层，向下调用 `host_settings_core` / CANopen；核心设置层不反向依赖 UI Schema，也不新造平行设备模型 |

### 2.6 LVGL 9.5 迁移的高风险面【阶段 0 已完成评估，本节已重写】

原判断是「自研 XML parser 是候选高风险面，待阶段 0 Spike 后估算」。阶段 0 的静态审计给出了不同的答案。

**真正的高风险面是 XML 宿主整体消失，而不是 13 个 parser 需要适配。**

审计结果（`scripts/audit-lvgl-version-diff.mjs`，可复现）：

| 面 | 结论 |
| --- | --- |
| runtime 引用的可解析 LVGL 符号 | 170 个 |
| 9.5 中缺失的 | **30 个，100% 是 `lv_xml_*` 宿主符号** |
| 13 个 parser 各自缺失的 widget API | **全部为 0** |
| 35 个已登记 Widget 的 C API | 9.4→9.5 公开符号 548→600，**仅移除 `lv_tabview_rename_tab`** |
| `bridge_hit.c`（218 行）/ `bridge_log.c`（27 行） | 无 XML 依赖，**不动** |
| `bridge.c`（584 行） | 42 行涉及 XML，需重写 |

由此修正三点判断：

1. **官方 22 个控件 parser 不存在了**，不是「维护风险相对较低」——9.5 里一个都没有。控件本身的 C API 无恙。
2. **自研 13 个控件的工作量被高估。** 它们的知识是 `manifest.json` 里的「属性名 → C setter」映射，该映射无需改动。工作量在换宿主：从「XML 属性字符串 → parser → LVGL API」换成「我方 IR → 驱动器 → LVGL API」。
3. **`audit-parsers.mjs` / `audit-extra.mjs` 需要改造。** 它们目前对账的是 `lv_xml_register_widget("<xmlTag>")` 注册与 XML 属性分支；去 XML 后对账目标变成驱动器注册表与 IR 属性分发。

**行动**：预览通道改为自有 IR 直驱 LVGL C API（原 §7.2 的可选方案之二，现为唯一路径），并入阶段 1。详见 `preview-architecture.md`。

## 3. 架构原则

### 3.1 JSON 是业务事实源

JSON UI Project 是用户、编辑器、AI、版本管理和生成流程共同操作的唯一业务源文件。

- LVGL XML 只是当前内部 Preview Adapter 可使用的中间表示。
- LVGL C/H、WASM、图片和字体 C 文件都是生成物。
- 生成文件不得成为继续编辑 UI 的事实源。
- 固件业务逻辑保留在用户文件或 Adapter 中，不回写到生成文件。

### 3.2 核心模块依赖方向

目标依赖关系：

```text
@lvd/schema
    ↑             ↑                 ↑
validator   preview-compiler   codegen-lvgl95
                   ↑                 ↑
              lvgl-runtime       build worker
```

约束：

- Validator 不依赖 React、WASM 或 Codegen。
- Preview Compiler 不依赖 C Codegen。
- C Codegen 不依赖浏览器、React 或管理平台。
- Preview 与 Codegen 可共同依赖 Schema、Widget Registry 和纯函数式 IR/Lowering Core。
- Widget 能力、属性类型和版本差异只能有一份注册事实源。

当前 `apps/designer` 直接使用 `@lvd/codegen.emitXml()` 是待拆分的技术债，不能在文档中写成“已经满足”。

### 3.3 版本能力包

不要在大量 `if (version === ...)` 中散落版本差异。每个版本提供显式 Capability Pack：

```ts
interface LvglCapabilityPack {
  version: '9.4.0' | '9.5.0';
  widgets: WidgetRegistry;
  styleProperties: StylePropertyRegistry;
  events: EventRegistry;
  previewAdapter: PreviewAdapter;
  cEmitter: CEmitter;
  requiredConfig: LvglConfigRequirements;
}
```

MVP 只要求 `9.5.0` 完整通过；`9.4.0` 只用于读取旧工程和迁移，除非有明确产品仍需长期维护。

### 3.4 Web 预览策略

- 编辑态：使用 LVGL WASM 真渲染，支持快速热更新。**【阶段 0 修正】** 驱动方式由「JSON → XML → `lv_xml_*`」改为「JSON → 自有 IR → LVGL C API」；9.5 无 XML 通道可用。节点寻址（`lv_obj_set_name` / `lv_obj_find_by_name`）与截图（`lv_snapshot_take`）不属于 XML 模块，在 9.5 保留，故热更新与对拍能力不受损失。
- 产品外壳：使用受清洗的 SVG/HTML Overlay 合成，不进入 LVGL 坐标系和生成 C。
- 客户分享：绑定不可变发布版本，运行发布时预编译的固件 UI WASM，不在客户浏览器暴露编辑器、Generator 或工程写接口。**该产物必须由 JSON → C → 编译为 WASM 得到，运行期不含 XML 解析路径**（理由见 §7.2）。
- 固件 simulator：继续作为包含真实业务代码的高保真回归基线，不被 Designer 取代。

“真 LVGL WASM”只能说明绘制引擎接近真机，不能自动保证像素一致。必须把 LVGL commit、`lv_conf.h`、字体、资源转换参数、色彩格式和渲染后端写入构建清单并做截图对拍。

## 4. Schema v2 草案

### 4.1 分层模型

为避免 UI、屏幕和外壳互相绑死，使用四种核心对象：

1. `UiProject`：页面、Widget、Theme 引用、状态和动作。
2. `DisplayProfile`：逻辑分辨率、可视区域、形状和色彩格式。
3. `ControllerProfile`：外壳 SVG、屏幕在外壳中的位置、物理控件。
4. `BuildTarget`：将 UI、Controller、Theme、固件配置和 LVGL 版本绑定为一次可构建目标；Display 通过前两者的引用做兼容校验。

`FirmwareProfile` 和可选的 `InputProfile` 是目标侧支持对象，不属于 UI Project 本体。

关系：

```text
BuildTarget.uiProjectRef ───────→ UiProject.designDisplayRef ───┐
                                                               ├── 同一个不可变 DisplayProfile
BuildTarget.controllerRef ─────→ ControllerProfile.displayRef ─┘

BuildTarget.lvglVersion 是发布构建所用 LVGL 版本的唯一权威
```

同一个 UI 可直接套用到共享同一 Display Profile 的不同外壳。不同分辨率之间复用 UI，必须明确采用响应式布局或独立 Screen Variant，不能假设固定坐标会自动适配。

### 4.2 单一事实源规则

- Schema v2 不再持久化“由 Controller 推导出的 `display` 副本”。
- UI 只保存 `designDisplayRef`；Controller 也引用同一个 `DisplayProfile`。
- `BuildTarget` 校验两个引用是否一致或是否满足已声明的兼容规则。
- `UiProject` 不重复保存目标 LVGL 版本；编辑器当前使用哪个目标由会话状态或 `activeBuildTargetId` 决定，发布构建以 `BuildTarget.lvglVersion` 为准。
- 离线工程包必须包含 Profile lock/snapshot，避免外部 Profile 更新后历史构建漂移。
- `orientation` 可作为 UI 展示的派生值，但不持久化。派生时必须考虑逻辑宽高与安装旋转，而不是只判断 `width > height`。

### 4.3 `DisplayProfile` 示例

```json
{
  "schemaVersion": 1,
  "kind": "display-profile",
  "id": "display:800x480-rgb565",
  "revision": 1,
  "logicalSize": { "width": 800, "height": 480 },
  "shape": "rect",
  "colorFormat": "RGB565",
  "dpi": 130,
  "visibleRect": { "x": 0, "y": 0, "width": 800, "height": 480 }
}
```

`colorFormat` 使用 LVGL 语义枚举，而不是只保存 `16/24/32`。例如 RGB565 与 RGB565_SWAPPED 都是 16bpp，但驱动含义不同。

条屏可使用非全屏 `visibleRect`；它表示从逻辑 framebuffer 中显示哪一块区域。Validator 必须保证它位于 `logicalSize` 内。

发布设备型号与设计器一键预设以 `ui.podsc.com/site/frames/manifest.json` 为准；
`docs/screen-inventory.md` 仅保留固件硬件调研背景。两个已知需要特殊字段的例子：

- **TXW620002B0**：逻辑分辨率 480×960，但物理可视仅 360 列（左右各插黑 60）。只有 `logicalSize` 无法表达，产品预览会画错开孔——对应 `visibleRect: { x: 60, y: 0, width: 360, height: 960 }`。
- **MX039/ST7102 圆屏**：显示 480×480，而触摸坐标系为 480×854 经 `touch_map` 映射。这属于硬件输入校准，进 `InputProfile`（§4.4），不进 `DisplayProfile`。

### 4.4 `ControllerProfile` 示例

```json
{
  "schemaVersion": 1,
  "kind": "controller-profile",
  "id": "controller:ctrl-430-a",
  "revision": 3,
  "model": "CTRL-430-A",
  "displayRef": "display:800x480-rgb565@1",
  "frame": {
    "assetRef": "asset:controller-430-a.svg@sha256:...",
    "viewBox": { "x": 0, "y": 0, "width": 1040, "height": 720 },
    "screenViewport": {
      "x": 126,
      "y": 135,
      "width": 788,
      "height": 450,
      "rotation": 0,
      "clip": { "type": "roundedRect", "radius": 8 }
    }
  },
  "inputProfileRef": "input:ctrl-430-a-touch@2"
}
```

`screenViewport` 的单位是 SVG `viewBox` 单位，不是屏幕像素；二者只要求旋转后的宽高比兼容，不要求数值相等。

原始触摸面板坐标、校准矩阵和轴交换属于可选 `InputProfile`。普通鼠标/触摸客户预览应直接映射到 LVGL 逻辑坐标，不能无条件套用真实触摸 IC 的原始坐标变换。

`BuildTarget` 示例：

```json
{
  "schemaVersion": 1,
  "kind": "lvgl-build-target",
  "id": "target:ctrl-430-a-customer-a",
  "uiProjectRef": "ui:ctrl-430-lighting@12",
  "controllerProfileRef": "controller:ctrl-430-a@3",
  "themeRef": "ui:ctrl-430-lighting@12#theme:customer-a-dark",
  "firmwareProfileRef": "firmware:esp32s3-default@5",
  "lvglVersion": "9.5.0"
}
```

`BuildTarget` 是构建与发布的不可变输入快照。Validator 解析引用后，必须验证 UI 与 Controller 指向同一 `DisplayProfile`，并将所有 Profile revision、资源哈希和 LVGL commit 写入构建 lock/manifest。

### 4.5 `UiProject` 核心示例

以下示例用于评审结构，不是冻结 Schema：

```json
{
  "schemaVersion": 2,
  "kind": "lvgl-ui-project",
  "meta": {
    "id": "ui:ctrl-430-lighting",
    "name": "CTRL-430 Lighting"
  },
  "designDisplayRef": "display:800x480-rgb565@1",
  "themes": [
    {
      "id": "theme:customer-a-dark",
      "tokens": [
        { "id": "color.primary", "type": "color", "value": "#2563EB" },
        { "id": "color.background", "type": "color", "value": "#111827" },
        { "id": "color.text.primary", "type": "color", "value": "#FFFFFF" },
        { "id": "radius.control", "type": "px", "value": 8 }
      ]
    }
  ],
  "subjects": [
    { "id": "subject:light-level", "type": "int", "initial": 50, "min": 0, "max": 100 }
  ],
  "screens": [
    {
      "id": "screen:home",
      "codeName": "home",
      "isHome": true,
      "root": {
        "id": "widget:root-home",
        "type": "obj",
        "props": { "width": "100%", "height": "100%" },
        "styles": [
          {
            "selector": { "part": "main", "states": ["default"] },
            "props": { "bg_color": { "$token": "color.background" } }
          }
        ],
        "events": [],
        "bindings": [],
        "children": [
          {
            "id": "widget:light-button",
            "type": "button",
            "codeName": "light_button",
            "props": { "x": 50, "y": 100, "width": 160, "height": 60 },
            "styles": [],
            "events": [
              { "on": "clicked", "action": "light.toggle", "args": {} }
            ],
            "bindings": [],
            "children": [
              {
                "id": "widget:light-label",
                "type": "label",
                "props": { "text": "LIGHT", "align": "center" },
                "styles": [],
                "events": [],
                "bindings": [],
                "children": []
              }
            ]
          }
        ]
      }
    }
  ],
  "components": [],
  "assets": { "fonts": [], "images": [], "icons": [] },
  "translations": null
}
```

### 4.6 标识符规则

不要让一个字段同时承担业务 ID、显示名称、XML 名和 C 符号四种职责。

- `id`：稳定业务标识，可使用 URI 风格或 UUID，不直接输出到 C。
- `displayName`：面向用户，可为中文。
- `codeName`：仅需要导出符号的节点使用，满足 C 标识符约束。
- Theme Token 使用语义 ID，例如 `color.text.primary`。
- Lowering 阶段生成并锁定 C/XML 符号映射；发生碰撞时报错或使用稳定后缀，映射写入 manifest。

样式属性引用 token 使用显式包装对象，与字面值区分：

```json
{
  "tokenReference": { "bg_color": { "$token": "color.background" } },
  "literalValue": { "bg_color": "#111827" }
}
```

约束：`$token` 的值必须是当前 Build Target 所选 Theme 中已定义的 token id，且类型匹配（`color` token 不能赋给 `radius.*` 类属性）；引用不存在的 token 在语义校验阶段拒绝，不做静默回退。

现有 `ConstDef.name: CName` 可以继续作为 9.4/9.5 输出 IR，但不应成为 Theme Token 的公共命名规则。

### 4.7 Validator 分层

1. **结构校验**：由 TypeScript 单一模型生成 JSON Schema，校验类型、枚举和范围。
2. **语义校验**：引用完整、ID 唯一、父子关系、Selector、Action 参数和循环依赖。
3. **目标能力校验**：目标 LVGL 版本、`lv_conf.h`、Widget、字体、图片解码器、色彩格式和内存预算。
4. **信任校验**：普通工程不得包含 trusted extension；发布构建检查权限、签名/哈希和审计记录。

前端保存前、后端接收时、构建前都必须执行同版本校验。JSON Schema 不能替代语义和目标校验。

## 5. Theme、Widget 与交互

### 5.1 Theme

建议优先级：

```text
LVGL 默认 / 基础 Theme
  < Theme 生成的 Widget 默认样式
  < 显式 Named Style（按添加顺序）
  < Widget Local Style
```

但这只是产品层级。实际生成时还必须保留 LVGL 的 Part、State、状态优先级、样式添加顺序和继承规则，不能用简单对象覆盖模拟全部行为。

第一阶段仅支持设计时/构建时选择 Theme。运行时切换需要额外评估样式生命周期、内存、重绘和状态保持，不放入 MVP。

### 5.2 Widget 范围

已有 35 个 Widget 继续保持可读取，不删除能力。MVP 验收分层如下：

- P0：Container/Object、Label、Button、Image、Switch、Slider、Arc、Bar。
- P1：Dropdown、Checkbox、Textarea、Keyboard、Tabview、List、Roller。
- 其他已登记 Widget：保持兼容，按真实产品需求逐批验证。

P0 必须贯通 Schema、Preview、Codegen、交互、Binding、编译和真机；P1 至少贯通 Schema、Preview、Codegen 和 golden 测试。

### 5.3 Event、Action 与 Binding

Event 是 LVGL 事件；Action 是业务命令。两者必须分离：

```text
clicked → light.toggle
value_changed → fan.setSpeed(value)
clicked → screen.open(screen:settings)
```

- Event 只能选择当前 Widget/版本支持的事件。
- Action 只能引用 Action Registry 中的强类型契约。
- Widget 不直接保存 CANopen index/subIndex、MQTT topic 或数据库字段。
- 目标固件在 UI 集成层通过 Binding Adapter 将语义 Subject/Action 映射到 `host_settings_core`、CANopen 或本地状态；`host_settings_core` 本身不依赖 UI Schema。
- Preview 使用模拟 Adapter；默认不能调用真实设备。真实设备联调必须进入单独授权模式。

## 6. Renderer 与 Generator

### 6.1 Preview Renderer

产品预览由三层合成：

```text
Controller Frame SVG
  └─ Screen Viewport / Clip
       └─ LVGL WASM Canvas
```

要求：

- SVG 只负责外壳和遮罩；屏幕像素来自 LVGL。
- 外壳、Canvas、Overlay 和指针使用同一变换矩阵。
- `visibleRect` 负责 framebuffer 裁切。
- 安装旋转在 viewport 映射中处理。
- 只有“原始触摸仿真模式”才应用 `InputProfile` 校准。
- 上传 SVG 必须移除 script、事件属性、外部资源、危险 URL 和 `foreignObject`。

### 6.2 色彩与像素一致性

~~先做一个技术 Spike：在同一 LVGL 9.5 WASM runtime 中切换 Display Color Format，并验证 SDL/Canvas 输出、截图和交互是否正常。~~

**【阶段 0 已完成实现与浏览器验证】** 结论：**单 runtime，由 Build Target 选择 `RGB565`/`RGB565_SWAPPED`/`RGB888`/`XRGB8888`/`ARGB8888`；双 runtime 分支关闭。**

- LVGL 核心支持：`lv_display_set_color_format()` 存在；`LV_DRAW_SW_SUPPORT_RGB565/RGB888/XRGB8888` 默认全开且**独立于 `LV_COLOR_DEPTH`**。
- 原阻碍不在 LVGL，而在 SDL 呈现路径：`lv_sdl_sw.c:166-172` 的纹理像素格式由 `#if LV_COLOR_DEPTH` 编译期固定，flush（`:252+`）没有通用 RGB565 → Canvas 转换分支。
- 已落地：`preview_host.c` 自建 `lv_display`、64 行 partial draw buffer 和 `flush_cb`，按 draw-buffer stride 把五种格式转换到 Canvas RGBA；Pointer/Wheel 事件分别映射到 LVGL pointer/encoder indev。9.5 CMake 不再编译或链接 SDL port，9.4 legacy 模式仍显式保留。
- 已验证：Chrome 对 `#123456` 的中心像素，RGB565/交换版均为量化后的 `[16,53,82,255]`，RGB888/XRGB8888/ARGB8888 均为 `[18,52,86,255]`；Button/Label/Slider 创建成功，合成 pointer 点击收到 LVGL `clicked` 回调。

**仍需固件 simulator 与真机截图证伪**，当前浏览器结果只证明 runtime 内部格式切换与 Canvas 转换正确，不等于产品像素完全一致。详见 `lvgl-version-baseline.md` §4。

不论采用哪种方式，“像素一致”都以自动截图 diff 和人工抽检为准，而不是以“版本相同”推定。构建 manifest 至少记录：

- LVGL tag/commit。
- runtime/固件 `lv_conf.h` 哈希。
- Display Color Format。
- 字体文件与转换参数哈希。
- 图片/图标转换参数哈希。
- Renderer backend。

### 6.3 LVGL 9.5 Generator

```text
UiProject
  → migrate
  → validate
  → resolve target/profile/theme/assets
  → normalize
  → versioned IR
  → LVGL 9.5 C emitter
  → C/H + assets + requirements + manifest
```

要求：

- 生成文件可覆盖；Action/Adapter 用户实现文件不可覆盖。
- 所有字符串、资源名和符号经过类型化转义，不直接拼接客户输入。
- 生成包包含精确 LVGL 版本、所需 `lv_conf.h` 开关、资源哈希和未实现 Action 清单。
- 9.5 emitter 使用独立 golden 基线，并通过 host gcc、ARM 工具链和至少一个 ESP-IDF 真机目标。
- 生成代码成功编译不是最终验收；必须替换一个真实产品页面并上板运行。

### 6.4 历史手写 C 的迁移

§6.3 的验收要求「替换一个真实产品页面并上板」。这一条决定阶段 2 能否按期完成，因此候选页面必须在阶段 0 就选定，而不是到阶段 2 临时找。

采用**项目级一次性迁移**，不做通用 C Parser，也不承诺双向同步。候选源均为纯 LVGL 手写 C，且**每个都自带 `simulator/`，可直接作为对拍基线**：

| 工程 | UI 源文件 | 规模 | 屏 | 迁移难点 |
| --- | --- | --- | --- | --- |
| **86 屏 lingshi86（优先候选）** | `host_s3_86panel_ui.c` | 当前约 2768 行 | 480×480 方屏 | 单文件、方屏、无 `visibleRect` 与 `InputProfile` 特例；仍需盘点全局状态、回调和硬件依赖 |
| 旋钮屏 WF2P-0050 | `app_ui.c` + `app_ui_scenes.c`（「产品 UI 共享场景层，与网页模拟器同一份，纯 LVGL」） | 约 5100 行 | 240×240 圆屏 | 跨两文件、场景层抽象、圆屏 |
| P4 主机大屏 | `sim_ui.c` + `page_dev_settings.c` + `page_service_settings.c` | — | 720×1280 / 720×1440 | 多页面、多文件 |

**【阶段 0 已完成比较并选定】**（量化对比见 `PHASE0-REPORT.md` §D7）

- **第一迁移对象**：86 屏 `host_s3_86panel_ui.c` 的**控制页**（`s_page_ctrl`，第 2740–2832 行）+ **设置页**（`s_page_set`，第 2889–2959 行）。
  决定性优势：整个 3120 行文件只有 **1 个非 LVGL include**（`font_ui.h`），近乎纯 LVGL；方屏、无 `visibleRect`/`InputProfile` 特例；`simulator/` 齐备且 `web_output/main.wasm` 已入库可直接对拍；未发现必须 `cPatch` 的用法。
- **第二迁移对象**：旋钮屏 `app_ui_scenes.c` 的一个 arc/bar 页面——**因为 86 屏不含 switch/arc/bar，单靠它无法完成 P0 八件套验收**。
- 实测修正：本文原记 86 屏「约 2768 行」，现已增至 **3120 行**。
- 需注意的结构差异：86 屏 15 个页面是**单 screen + 容器 `LV_OBJ_FLAG_HIDDEN` 切换**（`show_page()`，第 1026 行），不是多 screen；且全文件 `lv_button_create` 只出现 1 次，绝大多数「按钮」是 `lv_obj` + `LV_OBJ_FLAG_CLICKABLE` + 事件。Schema/codegen 必须支持这两种表达。
- P4 工程使用 `lv_btn_create`（v8 命名），作为迁移对象前须先确认其 LVGL 版本——这是它排在最后的原因。

迁移步骤：

1. 选定一个代表性页面（不是整个工程）。
2. 提取 Widget Tree、Style、事件、资源和状态。
3. 建立 JSON 工程。
4. 人工校正无法自动推断的逻辑，并记录哪些属于必须保留的可信扩展。
5. 用该工程的 `simulator/` 输出与生成固件做截图和交互对比。
6. 迁移经验回填 Schema——但不为单一页面无限扩张格式。

## 7. 客户预览与 XML 许可边界

### 7.1 官方许可可直接得出的结论

根据 LVGL XML Format License：

- LVGL 库与 XML loader 代码按其开源许可证使用。
- 组织内部可以编写、加载、编辑和生成 XML UI，也可使用内部自动化工具。
- 未经书面许可，不应向组织外发布或提供处理该 XML 格式的 UI Editor、Visual Builder、Layout Designer、Code Generator、API、插件或 SDK。

### 7.2 本项目的场景必须拆开判断

| 场景 | 默认处理 |
| --- | --- |
| 内部员工使用 Designer，XML 只在内存中流转 | 保持内部使用，记录许可依据 |
| 向客户提供不可编辑的预编译 WASM UI，**且产物内不含 XML 解析路径** | 工程上风险较低。发布包不得包含编辑、生成接口或 `lv_xml_*` 运行时；正式对外前仍按公司流程完成许可确认 |
| 客户浏览器下载 XML，或运行含我方 XML 解析能力的产物 | 上线前做专项许可确认或取得书面授权 |
| 向客户开放完整 Designer/Generator | 先取得 LVGL LLC 书面许可，或移除对 LVGL XML 规范的依赖 |

“客户只读分享”本身不能直接推出“必须重写全部 bridge”。推荐的规避设计是：发布时把批准版本生成并编译为不可变 WASM，客户只运行产物；编辑态仍留在组织内部。

**但这个规避方案成立与否，取决于发布产物用哪条路径构建，必须写死：**

| 构建路径 | 产物是否含 XML 解析 | 许可判定 |
| --- | --- | --- |
| **JSON → C → 编译 WASM（工程推荐路径）** | 发布运行时不处理 XML，`lv_xml_*` 与 13 个自研 parser 均不编入 | 属于较低风险的技术隔离方案，但不单独构成法律结论 |
| JSON → XML → 运行时 `lv_xml_*` 加载 | 是。产物本身即「处理该格式的运行时」 | 落表格第 3 行，须专项确认 |

~~编辑态内部预览走哪条路径不受此约束（属表格第 1 行），因此 Designer 现有 XML 通道可以保留。~~

**【阶段 0 修正】** 该结论在 9.5 上不成立：9.5 没有 XML 通道可保留。许可条款 §2 的「Use the LVGL XML loader freely in accordance with its MIT license」在 9.5 已失去指向对象——MIT 仓库里不再有 loader。因此**编辑态也必须去 XML**，改为自有 IR 直驱 LVGL C API（即下文可选方案 2，现为唯一路径）。

附带结果：**发布构建必须与编辑态预览走不同路径**这一要求自动满足——两者都不产生也不解析 XML。「产物链接期若出现 `lv_xml_*` 符号即构建失败」的检查在 9.5 上恒真，应保留为**回归护栏**（防止有人把 9.4 的 loader 抄回来），而不再是主要许可证据。

该检查可以证明客户运行时没有 XML 解析能力，也解耦了客户发布与 §3.2 的内部 Preview bridge 重构；但官方许可并未把某个符号是否存在定义为许可判据，因此该检查是工程证据，不是许可“安全港”。

如未来确实需要向客户提供编辑器，可选方案不止一个：

1. 向 LVGL LLC 申请书面许可或采购合适授权。
2. Preview Adapter 改为自有 IR 直驱 LVGL API，不处理 LVGL XML。
3. 服务端编译预览产物，客户端不获得 XML 工具链。

本节是工程风险说明，不替代法律意见。许可确认不阻塞自有 JSON Schema 的评审，但会影响客户编辑器和客户侧动态 XML 预览的实现方式。

### 7.3 客户分享要求

- 分享绑定不可变发布版本，不读取正在自动保存的草稿。
- 使用高熵、可撤销、可过期的只读令牌。
- 只暴露指定 Controller、Theme 和 UI 产物。
- 不包含 Designer、Codegen、工程下载或真实设备控制权限。
- 访问记录与“确认/要求修改”反馈分开存储。
- 分享页使用严格 CSP；外壳 SVG 和资源均为清洗后的不可变资源。

完整账号、SSO、审批和多租户 API 属于平台集成阶段，不在 Schema MVP 中预先定死。具体部署方案继续参考 `F:\dengtec\38_index\docs\lvgl-web-designer-migration-plan.md`。

## 8. 安全边界

普通 UI Project 禁止包含：

- JavaScript、HTML 事件属性或动态 import。
- 任意 C/C++ 片段。
- SQL、Python、Shell 或模板表达式。
- 未登记 Widget、Action 或 Binding Adapter。
- 任意本地文件路径和任意编译参数。

`cPatch` 迁移策略：

- Schema v2 普通工程不再允许 `WidgetNode.cPatch`。
- 现有合法用途优先扩展 Widget Registry 的 typed property/capability，不继续堆 C 字符串。
- 确实无法建模的代码进入独立 trusted extension manifest。
- trusted extension 仅开发者可写，构建时要求权限、内容哈希和人工审查。
- AI Operations 永远不暴露 trusted extension。

## 9. 分阶段实施计划

### 阶段 0：评审与最小技术验证

> **执行状态（2026-09-04）**：第 3、4 项技术验证已补齐：LVGL 9.5.0 + Emscripten 6.0.9 真实构建成功，Button/Label/Slider 已在 Chrome 渲染，自建 indev 点击可触发 LVGL 事件，同一 runtime 的五种 Color Format 像素回归通过。
> 结果已同步到 `PHASE0-REPORT.md` 与 `lvgl-version-baseline.md`。**阶段 0 的技术阻断已解除，治理项尚未退出**：仍需指派负责人、形成评审记录，并把浏览器验证延伸到固件 simulator/真机对拍。

交付：

1. 确认产品目标为 LVGL `9.5.0`，并选定一个真实目标板作为首个闭环对象（发布屏型参数以 `ui.podsc.com/site/frames/manifest.json` 为准，勿凭印象填写）。
2. 产出 9.4 → 9.5 的 API、XML、Widget、Style 和 `lv_conf.h` 差异清单。**其中必须包含 13 个自研 parser 的逐个静态影响判定（§2.6）**；完成 Spike 后再按证据估算它与 emitter 的相对工作量。
3. 验证 9.5 runtime 能构建、启动并渲染 P0 中至少 Button/Label/Slider。
4. 验证单 runtime 切换 RGB565/32-bit 格式是否可行。
5. 对 XML 的三类使用场景完成书面工程/许可边界记录，**并确认发布产物走 JSON → C → WASM 路径**（§7.2）。
6. 评审 Schema v2 草案和模块依赖图。
7. 选定阶段 2 要迁移的真实产品页面（§6.4，建议 86 屏 `host_s3_86panel_ui.c`）。
8. 逐条确认 §2.5 的既有资产复用方式，不得出现平行新建。

退出条件：上述结论有仓库证据、负责人和评审记录；不以“待进一步讨论”作为完成。

### 阶段 1：Schema v2 与模块解耦【阶段 0 修正：并入 runtime 去 XML 重写】

> **修正理由**：XML 是 Renderer → Codegen 依赖的唯一成因；9.5 没有 XML 通道，去 XML 会自动完成 §3.2 要求的解耦。
> 且去 XML、自建 display（色彩格式可切换）、自建 indev 三项改的是同一批文件、同一条初始化路径——分三个阶段做等于同一批文件改三遍。
> 详见 `preview-architecture.md` §2、§7。

交付：

- `DisplayProfile`、`ControllerProfile`、`BuildTarget`、Theme Token、Action Registry 类型；如首个目标需要原始触摸仿真，再纳入 `InputProfile`，否则保留为后续扩展。
- 由 TypeScript 模型生成的 JSON Schema 和 fixtures。
- schemaVersion 1 → 2 迁移器；旧 `display` 转为锁定的 Display Profile。**`colorDepth: 16` → `colorFormat` 是有损猜测（可能是 `RGB565` 或 `RGB565_SWAPPED`），迁移器必须标记「待人工确认」，不得静默取默认值。**
- **runtime 去 XML 重写**（自阶段 2/4 提前）：`bridge.c` 的 42 行 XML 逻辑改为 IR 驱动；13 个 parser 剥掉 XML 宿主外壳、复用 `manifest.json` 映射转为 widget 驱动器；`bridge_hit.c` / `bridge_log.c` 不动。
- **自建 `lv_display` + `flush_cb`（任意 colorFormat → RGBA8888）+ 自建 `lv_indev`**，移除 SDL 依赖与 `#canvas` 硬编码选择器的绕行胶水。
- `preview-compiler`/`compiler-core` 边界，移除 Designer 对 C Codegen 的预览依赖；删除 XML emitter 与 `localEmitXml.ts` 兜底。
- `cPatch` 信任隔离。**普通导入和 9.5 emitter 已阻断；arc `change_rate`/`knob_offset` 已建模为 typed property，calendar 高亮日期与 chart scatter X/Y 点集待建模。**
- 可复现的 runtime 构建脚本：按固件 `simulator/build_web.sh` 既有模式重写（`LVGL_TAG` 默认 `v9.5.0`、`EMSDK_DIR` 可覆盖、缺失即显式失败、多源回退）。

退出条件：Renderer 与 C Generator 只共享 Schema/Registry/IR Core，不直接依赖彼此；v1 工程迁移前后语义一致。**补充**：`apps/designer/package.json` 不含 `@lvd/codegen`；runtime 产物中不存在 `lv_xml_*` 符号；同一 JSON 在 `RGB565` 与 `XRGB8888` 两种 colorFormat 下均能渲染并截图。

### 阶段 2：LVGL 9.5 垂直闭环

> **执行状态（2026-09-04）**：纯 IR/normalize 已从 codegen 搬入 `@lvd/compiler-core`；`@lvd/preview-compiler` 已产出无 XML/无 C 模板的 POD 协议；`@lvd/lvgl-runtime` 已增加全量 preflight 执行器与无 XML 的 P0 八控件 C driver ABI，并覆盖标量属性、flag/state、25 项常用 inline style+selector、独立 `lv_style_t` 命名样式生命周期、`int/px/color/string/percent` 的全局/屏幕 const、int/float/string/color subject、P0 prop/flag/state binding，以及 callback、subject_set/toggle/increment、screen_load/create 受控事件。事件 trigger/动画/引用/数值会在 `begin` 前校验，callback 向 JS 保留 event code 与 userData，清场期间禁止回调重入。结构能力已用 table-column/table-cell 的 virtual 和 tabview-tab/tab_bar/tab_button 的 add/getter 闭环三种机制；Chart、Menu、List 等其余结构随阶段 3 Widget 扩展。`emitC95`、可追溯 `build-manifest.json` 与 Designer 正式 9.5 导出已落地，并在 Validator/emitter 双重阻断普通 `cPatch`。LVGL v9.5.0 commit `85aa60d18b3d` 已用 Emscripten 6.0.9 真编译为无 XML/无 SDL 的 PreviewProgram WASM；自建 display/flush/indev、P0 Button/Label/Slider、pointer 点击和五种 Color Format 已通过 Chrome 冒烟。Designer 的迁移侧车已维护 `UiProject + DisplayProfile + ControllerProfile + BuildTarget` 四对象快照：16bpp 未确认时以 XRGB8888 编辑但阻断发布；选择内建“裸屏”Controller 后运行完整跨引用校验，C95 manifest 锁定 BuildTarget/UI/Controller/Display/Theme revision。主 E2E 已验证实际下载 zip 的引用链。当前剩余阻断是完整 v2 工程读写、真实 Controller 外壳/Profile 仓库、真实产品页面、ARM/ESP-IDF 编译与上板对拍，因此本阶段**尚未完成产品垂直闭环**。

交付：

- LVGL 9.5 runtime 与 C emitter。
- P0 与首个目标页面实际依赖的自研 widget 驱动器移植；改造并重跑 `audit-parsers.mjs` / `audit-extra.mjs`（对账目标从 XML 注册改为驱动器注册表，§2.6），其余延后到阶段 3 恢复能力对等。
- P0 八个 Widget 全链路。**注意：阶段 0 选定的 86 屏页面只覆盖 obj/label/button/image/slider 五项，不含 switch/arc/bar。须补旋钮屏 `app_ui_scenes.c` 的 arc/bar 页面作为第二迁移对象，switch 另找用例。**
- 一个 Display Profile、一个 Controller Profile、一个 Theme。
- 字体/图片/图标生成物和构建 manifest；复用既有 `platforms/icons` 与字体子集化的源数据、转换契约或公共 CLI，避免复制实现或直接耦合固件生成目录（§2.5）。**前置：`platforms/icons` 的 `registry.json`/`svg/`/`tools/` 当前不在可达目录内，只有生成物；且 86 屏并不消费该链（用自己的 `host_s3_86panel_icons.c`）。须先定位源与生成脚本所在仓库。**
- ~~第一批业务 Action 白名单从 `host_settings_core` 已有业务能力中选取~~；Binding Adapter 实现在固件 UI 集成层，不修改核心层以依赖 UI Schema。
  **【阶段 0 阻断】** `host_settings_core` **原件从未提交到任何可达仓库**（依据 `WF2P-0050_Knob_Display/simulator/sim_kernel/include/host_settings.h:5`、`simulator/README.md:29,75`；现有 `sim_kernel` 是反推重建）。须向固件团队索取源码或稳定接口定义；在此之前 Action 白名单只能基于反推接口并标注为待校准。
- 一个真实产品页面由 JSON 生成后上板（页面在阶段 0 已选定，§6.4）。

退出条件：同一 JSON 在 Designer、发布 WASM 和真机运行；截图/交互差异在已定义阈值内。

### 阶段 3：复用能力

交付：

- Components 与参数化模板。
- Theme Variant。
- 至少两个共享同一 Display Profile 的 Controller 外壳切换。
- `visibleRect` 条屏用例。
- CJK 字体子集化和缺字门禁。
- P1 七个 Widget。
- 完成剩余自研 parser 的 9.5 适配与回归，恢复声明的 35 Widget 能力对等；不再需要的控件应明确标记废弃，而不是静默缺失。

### 阶段 4：客户发布与平台集成

**前置条件（启动前必须确认，不能沿用历史状态推定）**：完成生产基础设施可用性、TLS、网络入口、数据隔离、备份恢复、容量和监控检查。具体服务器事件与临时运维状态记录在部署/运维文档中，不写入长期架构基线；对外服务的可用性要求与内部工具不同。

交付：

- 不可变发布构建和预编译客户预览。
- 分享令牌、撤销、过期和反馈。
- 与现有平台账号、权限、工程存储和审计的集成决策。
- 现有 UI Preview 与新构建产物的兼容迁移。

不要在阶段 0/1 为阶段 4 预先实现完整 API。资源路径、权限名和数据库归属应在平台仓库中单独评审。

### 阶段 5：AI 加固

现有 AI 能力保留并扩展到 v2 字段：

- Prompt 与选定版本的 Registry 自动同步。
- AI 只生成结构化 Operations，不生成 C 或整份任意 JSON。
- Target、Theme、Profile 修改经过字段级权限和 Validator。
- 一轮 AI 修改形成一个可撤销事务。
- 失败修复有严格次数限制和审计日志。

端到端验收用户故事：

> 把主页改成黑色背景，顶部放公司 Logo，下面放灯光、风扇、温度三个控制区域。

必须能观察到：自然语言 → 结构化 ops → 校验 → LVGL WASM 重渲染 → undo；全过程不得触及 trusted extension 或固件源码。

## 10. 测试与验收

### 10.1 Schema

- valid/invalid/migration fixtures 完整。
- 未知字段策略明确；普通字段默认拒绝，只有命名扩展区允许保留。
- 所有引用、ID、Action 参数、父子关系和 Profile 兼容规则可校验。
- JSON Schema 由单一模型生成，不手写维护第二份结构定义。

### 10.2 Preview 与 Codegen

- P0 Widget 的 Preview/C/golden/交互/Binding 全通。
- P1 Widget 的 Preview/C/golden 全通。
- 9.5 生成代码通过 host gcc、ARM 和首个真实固件工具链。
- Renderer 不导入 C Codegen 包。
- Preview 错误能定位到 Project 节点 ID。

### 10.3 产品一致性

- 同一 Build Target 的 LVGL 版本、config、字体、图片和颜色格式均可追踪。
- 编辑态 WASM、发布 WASM、固件 simulator 和真机截图有固定测试场景。
- 对字体栅格、抗锯齿、颜色量化等差异设定可解释阈值。
- Button、Slider、Switch、页面跳转和 Subject 双向绑定做交互对拍。
- 外壳 viewport、裁切、旋转和指针映射分别测试。

### 10.4 安全

- 普通工程、AI 和客户入口不能写 trusted extension。
- 恶意 SVG、超大资源、路径穿越和任意编译参数被拒绝。
- 分享令牌不能访问其他工程、草稿或真实设备。
- 构建日志不记录密钥、令牌或客户隐私数据。

## 11. 交付物

建议在 `lvgl-web-designer` 中维护：

```text
docs/
  PHASE0-REPORT.md          # ✅ 已交付：阶段 0 汇总、D7 候选量化、D8 资产核对、待决策事项
  lvgl-version-baseline.md  # ✅ 已交付：9.4→9.5 完整差异清单
  preview-architecture.md   # ✅ 已交付：模块依赖评审 + 去 XML 预览设计 + Schema v2 评审意见
  xml-license-boundary.md   # ✅ 已交付：XML 引擎移除的事实认定与许可重判
  ui-schema.md              # ✅ 已交付：Schema v2 模型、迁移规则、JSON Schema 生成方式
  asset-pipeline.md         # ✅ 已交付：图标链复用规格（从生成物反推）+ A8 优化实测
  widget-mapping.md         # 不单独产出：registry 即映射事实源，见 preview-architecture.md §3.2
  theme-system.md           # 不单独产出：Token 规则与继承见 ui-schema.md §4
  display-profile.md        # 不单独产出：模型与规则见 ui-schema.md §1-§3
  controller-profile.md     # 不单独产出：同上
  lvgl-generator.md         # 🟡 初版已交付：9.5 emitter/manifest/兼容边界；真编译与上板待验证

scripts/
  audit-lvgl-version-diff.mjs   # ✅ 已交付：版本差异审计，`pnpm audit:lvgl-diff` 复现

packages/schema/src/v2/             # ✅ 已交付：Schema v2 类型 / 校验 / 迁移 / 持久化快照
packages/schema/schema/             # ✅ 已交付：生成物，由 v2/schemas.ts 的 zod 模型生成
  ui.schema.json
  display-profile.schema.json
  controller-profile.schema.json
  input-profile.schema.json
  build-target.schema.json
  trusted-extension.schema.json
  fixtures/                         # v1 迁移输入 + v2 迁移产物

packages/compiler-core/             # ✅ 已交付：仅纯 IR/lowering，不依赖 Preview/XML/Codegen
packages/preview-compiler/           # 🟡 已接 runtime：IR → 无 XML/无 C 模板 PreviewProgram；受控 ABI 能力继续扩展
packages/codegen/src/emitters/c95/
```

是否新建 `compiler-core` 应先检查现有 `packages/codegen/src/ir` 可否无生成器依赖地搬出；不要为了目录整齐先拆包。

本文件是跨仓库实施总纲，不替代本仓库的 `docs/ARCHITECTURE.md`。Schema 和模块决策通过后，应回写该权威架构文档。

## 12. RAG 决策

第一阶段不接入 RAG。Registry、Schema、Action 契约和当前工程 JSON 都是强结构化数据，应优先使用确定性筛选和按需裁剪。

出现以下现象后再评估：

- 结构化裁剪后仍频繁超过模型上下文预算。
- 用户明确需要跨大量历史工程或客户模板查找相似设计。
- 离线评测显示 AI 因缺少历史知识而持续失败，且精确字段检索不能解决。
- 知识跨多个仓库并频繁变化，人工维护 Prompt 已不可控。

评估顺序：程序化裁剪 → 结构化检索 → 全文检索 → 向量 RAG。是否启用由评测数据决定，不由任意模板数量阈值决定。

## 13. 可直接交给工程师或 Codex 的第一批任务

> 我们要在现有 `38_index/lvgl-designer/` 上增量建设 LVGL JSON UI 系统。不要从零重建 Schema、Renderer、Generator 或三栏编辑器。
>
> 产品目标版本为 **LVGL 9.5.0**。当前 Designer/runtime/codegen 是 9.4，部分固件是 9.3/9.4；请把它们视为迁移起点，不要把单个工程的 9.4 钉版注释扩大成公司级“拒绝 9.5”的决策。
>
> 第一批任务只做架构、Schema 草案和最小技术验证：
>
> 1. 盘点现有 `@lvd/schema`、Widget Registry、XML Preview、C94 emitter 和固件目标，输出 9.4 → 9.5 差异表。差异表必须单列 `runtime/src/xml_parsers_extra/` 下 13 个自研 parser 的逐个静态影响判定；它们是自维护适配层，与 XML API、Widget 行为及少量数据结构存在版本耦合。不要预先断言它们一定是最大工作量，完成 Spike 后再估算。
> 2. 用 LVGL 9.5.0 构建最小 WASM runtime，验证 Button、Label、Slider；同时验证一个 runtime 切换 RGB565/32-bit Display Color Format 是否可行。
> 3. 提交 Schema v2 草案：`UiProject`、`DisplayProfile`、`ControllerProfile`、`BuildTarget`、Theme Token、Action Registry 和 Binding Adapter。`BuildTarget.lvglVersion` 是发布版本的唯一权威，`UiProject` 不重复保存目标 LVGL 版本；给出一份完整 BuildTarget 示例。
> 4. Schema 中不要持久化 Controller 推导出的 display 副本；UI 与 Controller 引用同一个不可变 Display Profile。
> 5. Theme Token 使用语义 ID（如 `color.text.primary`），Lowering 阶段再映射到 C/XML 符号；不要让公共 Schema 直接服从 CName。
> 6. 将原始触摸坐标校准放入可选 `InputProfile`，普通产品预览直接使用 LVGL 逻辑坐标。首个目标不需要原始触摸仿真时，不把 `InputProfile` 纳入 MVP 必交范围。
> 7. 给出 Preview 与 C Generator 解耦方案。当前 Designer 通过 `@lvd/codegen.emitXml()` 预览，这是待修复现状；目标是二者只共享 Schema/Registry/纯 IR Core。
> 8. 明确普通 Schema 与 trusted extension 的边界。现有 AI ops 没有暴露 `cPatch`，但导入工程和其他写入路径仍需在 Validator/构建端阻断任意 C。
> 9. 记录 XML 的内部编辑、客户只读预览、客户侧编辑器三类许可边界。客户预览采用发布时预编译的不可变 WASM，不把“客户查看链接”自动等同于“对外分发编辑器”。发布产物走 JSON → C → 编译 WASM 路径，运行期不含 `lv_xml_*`；这是一项技术隔离证据，不单独构成法律结论。编辑态内部预览可继续用 XML 通道。
> 10. 输出 TypeScript 类型、一份完整示例工程、valid/invalid/migration fixtures 和由类型模型生成 JSON Schema 的方案。
> 11. 选定阶段 2 要迁移的真实产品页面。86 屏 `host_s3_86panel_ui.c` 是优先候选，但必须先比较 Widget、事件/状态、资源、硬件回调和可信扩展数量；选择其中一个代表性页面，不默认迁移整个文件。各候选工程已有 `simulator/`，可作为截图对拍基线。
> 12. 逐条确认既有资产的复用方式（文档 §2.5）：`platforms/icons` 图标链、固件 `build_web.sh` 的版本锁定/镜像回退/环境参数模式、`host_settings_core` 舱级设置内核、CJK 字体子集化与覆盖率门禁、固件 `simulator/`。复用稳定契约、公共 CLI 或共享库，避免复制脚本，也避免 Designer 直接依赖某个固件生成目录；Binding Adapter 位于固件 UI 集成层。
>
> 本阶段不要实现完整客户分享、SSO、多租户 API、RAG 或大规模 UI 重构。
>
> 发布屏型参数一律以 `ui.podsc.com/site/frames/manifest.json` 为准；未登记分辨率时使用自定义逻辑尺寸，不要凭印象补值。
>
> 第一阶段完成后先提交 Schema 与架构评审。评审通过，再实现 LVGL 9.5 emitter、产品外壳预览、客户发布和平台集成。
