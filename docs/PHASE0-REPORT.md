# 阶段 0 报告:评审与最小技术验证

> 对应 `LVGL-UI-需求与实施方案.md` §9「阶段 0」的 8 项交付与退出条件
> 执行日期:2026-09-03；技术补验:2026-09-04
> 状态:**8 项技术交付完成**；负责人和正式评审记录仍待组织补齐

## 摘要

阶段 0 的核心产出是一项推翻方案前提的发现:

> **LVGL 9.5.0 已把 XML UI 引擎整体移出开源仓库,并将其并入商业产品 LVGL Pro。**
> `LV_USE_XML`、`src/others/xml/`、22 个官方 parser、全部 `lv_xml_*` API 在 9.5.0 中不存在。
> 官方 CHANGELOG Breaking Changes:「XML Engine Removed. XML UI engine development continues outside the main repository.」(PR [lvgl/lvgl#9565](https://github.com/lvgl/lvgl/pull/9565))

这不改变产品目标版本(仍是 9.5.0),但改变了到达路径:**「预览通道去 XML、改自有 IR 直驱 LVGL C API」从方案 §7.2 的可选规避方案,变成唯一可行路径。**

好消息是影响面比预期小得多:runtime 使用的 200 个 `lv_*` 符号里,9.5 缺失的正好 30 个,**全部是 XML 宿主符号**;13 个自研 parser 的 widget API 侧**零破坏**;35 个已登记 Widget 的 C API 在 9.5 只移除了 1 个函数。真正要重写的是宿主层,不是业务逻辑。

详细分析见:
- `lvgl-version-baseline.md` — D1/D2/D3/D4
- `xml-license-boundary.md` — D5
- `preview-architecture.md` — D6

---

## D1 目标版本与首个闭环目标板 ✅

- **产品目标版本:LVGL 9.5.0**(维持方案 §2.4 判断)。
- **首个闭环目标板:lingshi86 `主机_S3_ydp395`** — YDP395B003-V4 + ST7701S,480×480 方屏。
- 依据本仓库 `docs/screen-inventory.md`,非凭印象填写。
- 选它是因为:方屏、`visibleRect` 全屏、无 `touch_map` 原始触摸校准,把 Profile 三件套跑通的变量最少;且它是 D7 选定迁移页面所在的工程。

**未决**:该板的真实 `colorFormat`。其 `simulator/lv_conf.h:26` 是 `LV_COLOR_DEPTH 32`,但那是 Web 仿真器的值,不是面板的值。写入 `DisplayProfile` 前须核对固件侧面板驱动初始化。

详见 `lvgl-version-baseline.md` §1。

## D2 9.4 → 9.5 差异清单(含 13 个自研 parser 逐个判定)✅

| 面 | 结论 |
| --- | --- |
| XML 引擎 | **整体移除**。目录、配置项、22 个官方 parser、全部 API 均不存在 |
| runtime 符号 | 使用 200 个,9.5 缺失 30 个,**100% 是 `lv_xml_*`** |
| 13 个自研 parser | 逐个判定完成:**每个的 widget API 缺失数均为 0**;耦合全在 XML 宿主层的 6 类 API |
| 35 个已登记 Widget | 9.4→9.5 公开符号 548→600,**仅移除 `lv_tabview_rename_tab`** |
| `lv_conf.h` | 我方显式开启项中,9.5 消失的**只有 `LV_USE_XML`** |
| 9.5 新能力 | Property Interface 铺开(12→26 个 widget)、`LV_STATE_ALT`、`lv_obj_bind_style_prop`、原生 blur/shadow、WebP 解码 |

**工作量重估**:方案 §2.6 担心「13 个自研 parser 是 9.5 迁移的最大工作面」。实测不成立——parser 里真正的知识不在 parser 里。

补一条比上表更强的交叉验证:拿 **Widget Registry** 声明要调用的每个 C 符号去 9.5.0 符号表里逐个查——

| 检查 | 结果 |
| --- | --- |
| registry 引用的去重 C 符号 | **197** |
| 9.5.0 中缺失的 | **0** |

`PropSpec.c.setter` 是 registry 的**必填**字段,所以这 197 个符号覆盖的是「我们声称支持的全部 35 个 widget 的全部 173 个属性」,而不只是现有 runtime 碰过的那些。**这是「IR 直驱路径在 9.5 上走得通」的充分证据。**

由此,bridge 侧要写的分发器面向一个**已知的 197 符号集合**,不是开放集合;需要特殊形态的只有三类共 19 项(15 个构造实参、3 个 virtual 子元素、1 个 `lottie.src`),均已有测试守着。

审计方法可复现,见 `lvgl-version-baseline.md` §2.1;registry 侧验证见 `packages/schema/src/__tests__/registry-lvgl95-parity.test.ts`。

## D3 9.5 runtime 最小构建验证 ✅ **已补验**

已在 WSL 使用 Emscripten 6.0.9、CMake 4.4.3 与 LVGL v9.5.0 commit `85aa60d18b3d` 完成真实构建。9.5 产物只编译无 XML 的 `preview_host.c` + `preview_driver.c`，WASM 为 1,477,417 B；manifest 记录精确版本、配置哈希、`runtimeMode=preview-program`、`displayHost=canvas-flush` 与 `inputHost=pointer-events`。

Designer 生产构建与 Chrome 冒烟通过：Button、Label、Slider 均由真实 LVGL 9.5 创建，浏览器 PointerEvent 经自建 indev 后触发 LVGL `clicked` 回调。见 `lvgl-version-baseline.md` §3.1。

## D4 单 runtime 切换 RGB565 / 32-bit ✅（实现与浏览器实测）

**结论:可行,但前提是替换 SDL 呈现路径。**

- LVGL 核心**支持**:`lv_display_set_color_format()` 存在,`LV_DRAW_SW_SUPPORT_RGB565/RGB888/XRGB8888` 默认全开且独立于 `LV_COLOR_DEPTH`。
- SDL 呈现路径**不支持**:`lv_sdl_sw.c:166-172` 的纹理像素格式在编译期由 `LV_COLOR_DEPTH` 固定,flush 只特判 `RGB565_SWAPPED` 与 `I1`,没有 RGB565 → 纹理格式的转换分支。
- 已实现:**自建 `lv_display` + 64 行 partial draw buffer + 自写 `flush_cb`（五种 cf → RGBA8888）+ 自建 pointer/encoder indev**。9.5 构建已移除 SDL 依赖。

**判定:不需要维护 16bpp/32bpp 双 runtime。**方案 §2.3、§6.2 的「双 runtime」分支可以关闭。

附带收益:去 SDL 顺带消除 `runtime/CMakeLists.txt:44-46` 记录的 SDL2 port 硬编码 `#canvas` 选择器陷阱,并让我方完全掌握指针坐标注入——这是方案 §6.1「外壳、Canvas、Overlay 和指针使用同一变换矩阵」的前提。

Chrome 像素回归结果：`#123456` 在 RGB565/RGB565_SWAPPED 下均为 `[16,53,82,255]`，在 RGB888/XRGB8888/ARGB8888 下均为 `[18,52,86,255]`。浏览器侧结论已证实；固件 simulator/真机截图对拍仍属于阶段 2。见 `lvgl-version-baseline.md` §4。

## D5 XML 三类场景的工程/许可边界 ✅

书面记录见 `xml-license-boundary.md`。要点:

1. XML 规范许可文本(v1.0, June 2025)在 9.4→9.5 **逐字节未变**,但**实现方变了**:XML 工具链现为 `github.com/lvgl/lvgl_editor` = LVGL Pro 商业产品,Product 层 $20,000/产品/5 年起,该仓库根目录无 `LICENSE` 文件。
2. 许可 §2 的「Use the LVGL XML loader freely in accordance with its MIT license」在 9.5 **失去指向对象**——MIT 仓库里已无 loader。
3. 方案 §7.2 的场景表需重写:「内部 XML 通道」不再是零成本选项;「发布产物不含 XML 解析」在 9.5 变为结构性事实。
4. **我方 JSON Schema 不受该许可约束**——它约束的是 LVGL XML 规范,不是「用 JSON 描述 UI」。但须保留硬性规则:不得把 LVGL XML 的标签名/属性名/嵌套结构照搬为我方公开格式。
5. **确认发布产物走 JSON → C → WASM 路径**(方案要求的第 5 项)。该路径在 9.5 上是唯一路径;`lv_xml_*` 链接期检查保留为回归护栏,而非主要证据。

## D6 Schema v2 草案与模块依赖图评审 ✅

评审意见见 `preview-architecture.md`。要点:

**现状核对**:方案 §2.3 的六条技术债**全部属实且未改善**,已逐条附代码位置。

**依赖图评审**:方案 §3.2 的目标图成立,但达成路径变了——XML 是 Renderer → Codegen 依赖的**唯一成因**,去 XML 会自动完成解耦。因此建议**把 runtime 去 XML 重写并入阶段 1**,与色彩格式改造合并为一次重写(同一文件、同一初始化路径),避免同一批文件改三遍。

**Schema v2 草案**:结构成立,可进入实现。修订意见:

- v1→v2 迁移器中 `colorDepth: 16 → RGB565` 是**有损猜测**(也可能是 `RGB565_SWAPPED`),必须标记「待人工确认」而非静默取默认值。
- `colorFormat` 枚举限定为软件渲染器实际支持且我方 flush_cb 会实现的子集;`BuildTarget` 补 colorFormat 兼容校验。
- registry 中 16 条以 XML 限制为由收窄能力的 `notes` 须逐条重评——那是 XML 通道的限制,不是 LVGL 的限制。
- Components 仍放阶段 3,但阶段 2 迁移时须把固件侧的 `make_set_row()` 类 helper **记录为 Components 需求输入**,不要展开成重复节点。

**`cPatch` 结论强化**:阶段 0 发现 `cPatch` 的现存用途几乎全是为绕开 XML 表达限制(calendar 高亮日期、chart scatter X、arc `change_rate`/`knob_offset`)。目前 arc 两项已建模,calendar/chart 待补 typed property;普通工程已在 Validator 与 9.5 emitter 双重阻断 `cPatch`。

## D7 阶段 2 迁移页面选定 ✅

### 候选量化对比

对三个候选工程的真实源文件实测(非文档转述):

| 工程 / 文件 | 行数 | widget create | 事件 cb | 静态全局 | 样式调用 | 非 LVGL include | 屏 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| **86 屏 `host_s3_86panel_ui.c`** | **3120** | 109 | 38 | 271 | 339 | **1**(`font_ui.h`) | 480×480 方 |
| 旋钮屏 `app_ui.c` | 887 | 0 | 0 | 66 | 0 | — | 240×240 圆 |
| 旋钮屏 `app_ui_scenes.c` | 4220 | 52 | 0 | 328 | 266 | 5 | 240×240 圆 |
| P4 `sim_ui.c` | 744 | 16 | 4 | 35 | 80 | 3 | 720×1280/1440 |
| P4 `page_dev_settings.c` | 1089 | 49 | 18 | 59 | 149 | — | 同上 |
| P4 `page_service_settings.c` | 1775 | 122 | 41 | 77 | 346 | 2 | 同上 |

> 方案 §6.4 记 86 屏「当前约 2768 行」,实测已增至 3120 行;旋钮屏两文件合计 5107 行,与「约 5100 行」吻合。

widget 类型分布:

| 工程 | 使用的 widget |
| --- | --- |
| 86 屏 | label×56, obj×30, image×9, slider×3, textarea, qrcode, keyboard, button |
| 旋钮屏 scenes | label×30, obj×9, **arc×7**, image, **bar** |
| P4 service settings | label×66, obj×23, **btn×18**, textarea×7, switch×2, slider×2, keyboard×2 |

### 选定结论

**优先候选:86 屏 `host_s3_86panel_ui.c` 中的「控制页」(`s_page_ctrl`,第 2740–2832 行)+「设置页」(`s_page_set`,第 2889–2959 行)。**

选定理由(逐条对照方案 §6.4 要求的比较维度):

| 维度 | 86 屏表现 |
| --- | --- |
| 硬件回调 | **最优**。整个 3120 行文件只有 1 个非 LVGL include(`font_ui.h`),近乎纯 LVGL |
| 屏型 | 480×480 方屏,无 `visibleRect`、无 `InputProfile` 特例 |
| 页面结构 | 15 个页面均为**单 screen + 容器 HIDDEN 切换**(`show_page()`,第 1026 行),不是多 screen——迁移时需明确映射到 Schema 的 Screen 还是容器 |
| 可信扩展需求 | 未发现必须 `cPatch` 的用法 |
| 已有对拍基线 | ✅ `simulator/` 齐备,`web_output/main.wasm` 已构建入库(2.75 MB) |
| Components 需求 | 大量 helper(`make_set_row` / `make_page` / `make_dev_card` / `make_vfill_slider`),天然对应 Components |
| i18n 需求 | `tr_label(l, name, name_zh)` 双语登记,天然对应 Translations |

**风险与补充**:

1. **P0 覆盖不全**。86 屏用到 obj/label/button/image/slider(5/8),**不含 switch、arc、bar**。方案 §9 阶段 2 要求「P0 八个 Widget 全链路」——单靠 86 屏无法验收。
   → **建议:阶段 2 补做旋钮屏 `app_ui_scenes.c` 的一个 arc/bar 页面作为第二迁移对象**,恰好补齐 arc + bar;switch 需另找或用 P4 `page_service_settings.c` 的 switch 用例。
2. **button 用法与 Schema 假设不符**。全文件 `lv_button_create` 只出现 1 次,绝大多数「按钮」是 `lv_obj` + `LV_OBJ_FLAG_CLICKABLE` + 事件。Schema/codegen 必须支持这种表达,不能强制 button 语义。
3. **P4 用 `lv_btn_create`**(v8 命名),说明该工程可能仍在 LVGL 8.x 或依赖 `lv_api_map_v8.h` 兼容层。作为迁移对象前需先确认其 LVGL 版本——**这是 P4 排在最后的原因**。
4. 旋钮屏虽有 `DEMO_UI_ZIP` 直接上板通道,但圆屏 + 场景层抽象引入额外变量,作为第二对象而非第一对象。

## D8 §2.5 既有资产复用方式逐条确认 ✅

| 既有资产 | 实测核对 | 复用结论 |
| --- | --- | --- |
| **跨项目共享图标生成链** | 生成物 `platforms/icons/generated/lvgl/wf2_icons.c` 存在,头部注明「由 `platforms/icons/registry.json` + `svg/` 自动生成」「由 `tools/generate_lvgl.py` 自动生成,禁止手改」。旋钮屏 `app_ui_scenes.c:18` 消费,`CMakeLists.txt:14` 用 **8 级相对路径** `../../../../../../../../platforms/icons/...` 引入 | ⚠️ **方案 §2.5 的描述需修正**:86 屏(D7 选定工程)**不消费**该链,它用自己的 `host_s3_86panel_icons.c`(`main/CMakeLists.txt:4`)。且 `registry.json`/`svg/`/`tools/` **不在可达目录内**,只有生成物。<br>**行动**:先定位图标源与生成脚本的真实仓库位置,再谈复用;8 级相对路径是脆弱耦合,正是方案要求避免的「Designer 直接依赖固件生成目录」 |
| **可复现 WASM 构建脚本模式** | ✅ 完全属实。旋钮屏与 86 屏 `simulator/build_web.sh` 均为:`LVGL_TAG="${LVGL_TAG:-v9.4.0}"`(:14)、`EMSDK_DIR="${EMSDK_DIR:-/opt/emsdk}"`(:17)、缺失即显式失败(:19)、多源回退含内网 Gitea(:33-40) | ✅ **直接复用该模式重写 `runtime/build.sh`**,`LVGL_TAG` 默认改 `v9.5.0`。阶段 1 交付项 |
| **生成 C 已在真机跑通一次** | ✅ 旋钮屏 `firmware/main/CMakeLists.txt:21-24` 编入 `ui_zip/`:`ui.c` `styles.c` `subjects.c` `actions.c` `actions_default.c` `screens/main.c` `screens/screen_1.c`,注释「lvgl-web-designer 导出; main.c 的 DEMO_UI_ZIP 开关加载」;`:51` 另记生成代码用 `#include "lvgl.h"` 简单形式 | ✅ 闭环属实,阶段 2 风险可下调。**但注意**:`ui_zip/` 的实际文件不在当前可达目录,只有 CMakeLists 引用。上板验证前需取回产物或重新导出 |
| **固件 Web 仿真器** | ✅ 86 屏 `simulator/` 齐备:`build_web.sh`、`lv_conf.h`(`LV_COLOR_DEPTH 32`)、`src/main_sim.c`、`web_output/{index.html,main.js,main.wasm}`(2.75 MB,已入库) | ✅ 作为截图对拍基线。**注意**:仿真器也是 32bpp,与我方 Designer 同为 32bpp——今天的对拍是同色深比较,**都不代表 16bpp 面板**。方案 §10.3 的阈值定义须区分这两层 |
| **CJK 字体子集化与覆盖率门禁** | ⚠️ 部分属实。86 屏 `gen_ui_fonts.sh` 存在,五档字号(14/16/20/24/48),字符集以 `CJK` 变量硬编码累加。但:(a) 方案提到的 `tests/scripts/check_ui_font_coverage.py` **在可达目录中未找到**;(b) 脚本自身有与 `runtime/build.sh` 同类的可复现性问题——硬编码 `/home/rie/.nvm/versions/node/*/bin/lv_font_conv` 与 `/mnt/c/Windows/Fonts/simhei.ttf` | ⚠️ **复用契约,不复用实现**。字符收集 + 子集生成 + 覆盖率检查的**契约**可复用;但现有脚本不满足可复现要求,提取公共 CLI 时须一并修掉硬编码 |
| **舱级设置内核与 CANopen 组件** | ❌ **阻断**。旋钮屏 `firmware/main/CMakeLists.txt:44` 确实依赖 `host_settings_core`(注释「P4 / 0050 / 86 屏共用的舱级设置内核」),但 `simulator/sim_kernel/include/host_settings.h:5` 明确写着:「⚠️ 这不是原厂 host_settings_core 组件。**原件从未提交到任何可达仓库**」;`simulator/README.md:29,75` 记录 sim_kernel 是**反推重建**的 | ❌ **方案 §2.5 的复用要求当前不可执行**。Binding Adapter 无法「向下调用 `host_settings_core`」——我方拿不到该组件。<br>**行动(阻塞阶段 2)**:向固件团队索取 `host_settings_core` 源码或稳定接口定义;在此之前,第一批业务 Action 白名单**不能**从「`host_settings_core` 已有业务能力」中选取(方案 §9 阶段 2 交付项),只能基于反推的 `sim_kernel` 接口,并标注为待校准 |

---

## 退出条件核对

方案 §9 阶段 0 退出条件:「上述结论有仓库证据、负责人和评审记录;不以『待进一步讨论』作为完成。」

| 要素 | 状态 |
| --- | --- |
| 仓库证据 | ✅ 全部结论附文件:行号或官方 tag 源码引用,审计方法可复现(`lvgl-version-baseline.md` §2.1) |
| 负责人 | ❌ **未指派**。各行动项的负责人栏位待填 |
| 评审记录 | ❌ **未进行**。本报告是评审输入,不是评审结论 |
| 无「待讨论」占位 | ⚠️ 技术阻断已解除；目标板真实 `colorFormat`、负责人和正式评审记录仍有明确解除条件 |

**阶段 0 尚未真正退出。** 需要:

1. 指派各行动项负责人。
2. 召开 Schema v2 + 模块依赖图评审会,对本报告的路线修正建议作出决议。
3. 在阶段 2 把已通过的浏览器 D3/D4 验证延伸到固件 simulator 与真机截图对拍。

---

## 决策与执行状态(2026-09-04 更新)

产品方已授权由实施侧按最合理方案拍板。以下为**已定决策**与落地状态。

| # | 事项 | 决策 | 落地状态 |
| --- | --- | --- | --- |
| 1 | 预览通道去 XML,改自有 IR 直驱 LVGL C API | ✅ **确认** | `@lvd/preview-compiler` POD 协议与 9.5 `preview_driver.c` 受控 ABI 已落地，Designer 已优先走 PreviewProgram |
| 2 | 去 XML + 自建 display/indev + colorFormat 合并为一次 bridge 重写 | ✅ **确认** | 已实现并由 Emscripten/Chrome 真构建、五格式像素与 pointer 点击验证 |
| 3 | 阶段 2 迁移对象 | ✅ 86 屏控制页(2740-2832)+ 设置页(2889-2959)为第一;旋钮屏 arc/bar 页为第二 | 见 §D7 |
| 4 | `host_settings_core` 不可达 | ✅ **基于反推的 `sim_kernel` 建临时白名单,显式标注待校准** | **已交付** `packages/schema/src/v2/actions/podSettings.ts`,19 字段逐条抄自 `k_catalog[]`,15 个测试守着;`POD_ACTIONS_PROVISIONAL = true` 供流水线打标 |
| 5 | 图标共享链的真实源位置 | ⚠️ **全盘搜索未找到**,只有生成物 | **已交付** `asset-pipeline.md`:从生成物反推出完整契约,并发现一处实测优化(见下) |
| 6 | 是否保留 9.4 capability pack | ✅ 只保留到能读旧工程,不做 9.4 完整生成链 | 维持方案 §3.3 |
| 7 | Schema v2 是否接入 `MIGRATIONS` | ⛔ **暂不接入** | 一旦接入,旧工程读入即自动变 v2 —— 该动作需产品/架构评审后再做。代码已就绪,翻转只需一行 |
| 8 | 法务备案:9.4 时期内部 XML 使用 | 并行进行,不阻塞工程 | 见 `xml-license-boundary.md` §4.2 |

### 决策 4 的落地形态

内核是**字段式**的(按 field id 读/调),不是命令式的。因此 Action 契约照抄内核形态,而不是发明 `light.toggle` / `fan.setSpeed` 这类看着漂亮、与下层对不上的动作名:

```
pod.setField(field, value)      → host_settings_pod_set
pod.adjustField(field, delta)   → host_settings_ui_adjust   (delta 以 step 为单位,限 ±1)
pod.setActiveMode(slot)         → 四个稳定槽位
```

Widget 只引用**语义字段 ID**(`mode.light.brightness`),C 枚举名(`HOST_SETTINGS_FIELD_*`)只用于 Binding Adapter 生成映射,不进 UI Schema —— 符合 §4.6 的标识符分离与 §5.3「Widget 不直接保存 CANopen index/subIndex」。

拿到原厂组件后,应逐条比对 19 个字段的范围/步进/能力位并更新,而不是就地加字段。

### 决策 5 的额外发现

`asset-pipeline.md` 记录了三条对方案 §2.5 的修正,其中一条是可量化的优化:

> 19 个共享图标全部是**纯 alpha 遮罩**(逐字节解析 47,792 个像素,RGB 非纯白的有 **0** 个),却存成 ARGB8888。
> LVGL 原生的 `LV_COLOR_FORMAT_A8` 正是为此设计(`lv_draw_sw_img.c:348-351` 用 `recolor` 上色、图像数据当遮罩)。
> 改用 A8 可省 **≈140 KB** flash,`.c` 源码从 697 KB 降到约 180 KB。
> 前置检查:须确认全部 `ic_*` 调用点都显式设了 `image_recolor`(未设的现状渲染为白,换 A8 后会变黑)。

另两条修正:**86 屏(D7 选定的迁移工程)并不消费这条共享图标链**,它用自有的 `host_s3_86panel_icons.c`;字体档位是 **5 档**不是方案写的六档。

---

## 附:阶段 0 产出的文档

| 文件 | 内容 |
| --- | --- |
| `docs/lvgl-version-baseline.md` | D1/D2/D3/D4:版本基线、9.4→9.5 完整差异清单、13 个 parser 逐个判定、色彩格式可行性 |
| `docs/xml-license-boundary.md` | D5:XML 引擎移除的事实认定、许可条款原文、场景重判、行动项 |
| `docs/preview-architecture.md` | D6:现状核对、模块依赖评审、去 XML 预览通道设计、Schema v2 修订意见、阶段 1 交付清单修订 |
| `docs/PHASE0-REPORT.md` | 本文件:8 项交付汇总、D7 候选量化、D8 资产逐条核对、退出条件、决策与执行状态 |
| `docs/ui-schema.md` | Schema v2 模型、v1→v2 迁移规则、JSON Schema 生成方式 |
| `docs/asset-pipeline.md` | 图标链复用规格(从生成物反推)、A8 优化实测、字体子集化核对 |

> 本批文档不替代 `docs/ARCHITECTURE.md`。评审通过后,应把 Schema 与模块决策回写该权威架构文档(方案 §11 末句)。
> 同时,`LVGL-UI-需求与实施方案.md` 的 §2.1、§2.6、§3.4、§7 需按本报告修订——其 XML 相关判断基于 9.4 事实,已被 9.5 推翻。
