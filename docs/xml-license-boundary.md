# LVGL XML 的工程与许可边界

> 阶段 0 交付物 D5(对应 `LVGL-UI-需求与实施方案.md` §7、§9 阶段 0 第 5 项)
> 产出日期:2026-09-03
> **本文件是工程风险说明,不是法律意见。** 对外发布前仍须走公司法务流程。

## 0. 相较实施方案 §7 的变化

方案 §7 的分析建立在「XML loader 是 MIT 开源 LVGL 库的一部分,只有*规范*受限」这一前提上。阶段 0 实测发现该前提在 9.5 已不成立:

| | 方案 §7 假设(基于 9.4) | 2026-09-03 实测(9.5.0) |
| --- | --- | --- |
| XML loader 代码 | 在 `lvgl/lvgl` 仓库内,MIT | **已从开源仓库删除**(PR #9565) |
| XML 规范许可 | LVGL XML Format License 限制第三方编辑器 | **文本未变**(v1.0, June 2025),但实现方已变 |
| XML 工具的归属 | LVGL 官方 Editor | **LVGL Pro** 商业产品(`github.com/lvgl/lvgl_editor`) |
| 「保留内部 XML 通道」的成本 | ≈0(用 MIT 代码即可) | 采购授权,或自行维护一份上游已放弃的引擎 |

方案 §7.2 的三行场景表因此需要重写(见 §3)。

---

## 1. 事实认定

### 1.1 XML 引擎已移出开源仓库

`lvgl-9.5.0/docs/src/CHANGELOG.rst`,Breaking Changes:

> **XML Engine Removed**. XML UI engine development continues outside the main repository. Separate announcement forthcoming.

对应 PR:[lvgl/lvgl#9565](https://github.com/lvgl/lvgl/pull/9565) `feat(xml): remove the XML parser and loader`

代码层验证:9.5.0 中 `src/others/xml/` 目录、`LV_USE_XML` 配置项、22 个官方 widget parser、全部 `lv_xml_*` API 均不存在。详见 `lvgl-version-baseline.md` §2.2。

### 1.2 XML 规范许可文本未变

`docs/src/xml/xml/license.rst`(9.5.0)与 `docs/src/details/xml/xml/license.rst`(9.4.0)**逐字节一致**。要点(Version 1.0 – June 2025, Copyright (c) 2025 LVGL LLC):

许可的(§2 Permitted Usage):

- 在基于官方 MIT LVGL 库的**任何固件或嵌入式应用**中使用本规范。
- 「Use the LVGL XML loader freely in accordance with its MIT license.」
- **仅供组织内部使用**地编写、加载、编辑或生成本规范描述的 UI,包括组织内自动化或配置工具。
- 创建**内部脚本或插件**,前提是**不分享到组织外、不公开**。
- 在面向 LVGL 嵌入式系统的客户固件或工程中分享 XML UI 文件。

禁止的(§3 Restrictions):

- 未经 LVGL LLC 书面许可,**创建、发布或分发**任何读写或解释本规范 XML 的 **UI 编辑器、可视化构建器、布局设计器、代码生成器或工具**——「**whether commercial, open-source, or intended for public use, use by customers or partners, or any use outside your own organization**」。
- 在提供类似 LVGL UI Editor 的 UI 创建/编辑/设计能力的软件或平台中实现或扩展本规范。
- 基于本规范构建公开 API、插件、转换器或 SDK。
- 分享或发布围绕本规范构建的内部工具。

> **关键**:§2 允许项里的「Use the LVGL XML loader freely in accordance with its MIT license」在 9.5 已**失去指向对象**——9.5 的 MIT 仓库里没有 XML loader 了。要在 9.5 上有 loader,只能:(a) 从 9.4 抄一份自行维护;(b) 走 LVGL Pro。

### 1.3 XML 工具链已成为商业产品

`github.com/lvgl/lvgl_editor` 现为 **LVGL Pro**。仓库 `README.md` 记载:

- 定位:「The Complete Workflow for Professional LVGL UI Development」,含 Editor、Online Viewer、Figma Flow、CLI 四件套。
- 授权模型(README「Licensing」节,per product,非 per seat/per device):
  - **Community**:免费,面向 makers、个人使用与开源项目。
  - **Evaluation**:免费,用于评估。
  - **Growth**:定制价,单产品,最多 2 个活跃席位。
  - **Product**:**$20,000**,单产品,最多 5 席,最少 5 年。
  - **Platform**:定制,组织级跨产品。
- 运行时加载 XML 需单独洽谈:「It is also possible to load the XML files at runtime, without exporting C code and rebuilding the firmware. **Contact us at lvgl@lvgl.io to learn more.**」
- 该仓库根目录**未提供 `LICENSE` / `LICENSE.md` / `LICENSE.txt`**(均 404)。

静音舱控制器是商业产品,不属于 Community 层的「makers, personal use, and open-source projects」。

---

## 2. 我方受影响的具体位置

| 位置 | 现状 | 9.5 下的处境 |
| --- | --- | --- |
| `runtime/lv_conf.h:59` | `LV_USE_XML 1` | 配置项不存在 |
| `runtime/src/bridge.c` | 42 行、19 个 `lv_xml_*` 符号 | 全部无定义 |
| `runtime/src/xml_parsers_extra/`(13 个 parser + 聚合器) | 依赖 `lv_xml_register_widget` 等 6 类宿主 API | 宿主消失 |
| `apps/designer` → `@lvd/codegen.emitXml()` | `reloadPipeline.ts:24` 导入,`:313`/`:327` 调用 | 产物无消费者 |
| `packages/codegen/src/emitters/`(XML emitter) | 生成 LVGL XML | 同上 |

即:**我方对 LVGL XML 的全部依赖都在「编辑态内部预览」这一条通道上**,发布产物与生成的固件 C 代码不含 XML。

---

## 3. 场景重判(替代方案 §7.2 的表格)

| # | 场景 | 9.4 下的判定 | 9.5 下的判定 | 建议 |
| --- | --- | --- | --- | --- |
| 1 | 内部员工使用 Designer,XML 仅在内存中流转 | 落 §2「internal use only」,风险低 | **技术上不再可行**(无 loader)。若自行 vendor 9.4 的 loader,仍落 §2 内部使用,但需自维护被上游放弃的代码 | **取消该通道**(见 §4) |
| 2 | 向客户提供不可编辑的预编译 WASM,产物内不含 XML 解析 | 风险较低 | **风险更低**:9.5 里根本不存在 `lv_xml_*` 符号,「产物不含 XML 解析」变为结构性事实 | 保持;链接期检查降级为回归护栏 |
| 3 | 客户浏览器下载 XML,或运行含我方 XML 解析能力的产物 | 须专项许可确认 | 同前,且需自维护 loader | **不做** |
| 4 | 向客户开放完整 Designer/Generator(处理 LVGL XML) | 须 LVGL LLC 书面许可 | 同前,且对应 LVGL Pro 的直接竞争位 | **不做** |
| 5 | 采购 LVGL Pro 并在其上构建 | 不适用 | 可行但改变产品定位:UI 事实源变成 LVGL Pro 工程,我方 Designer 降级为外壳 | 与方案 §3.1「JSON 是业务事实源」冲突,不推荐 |

### 我方 JSON Schema 不受本许可约束

需要明确写下:**LVGL XML Format License 约束的是「LVGL XML 规范」,不是「用 JSON 描述 UI」这件事本身。**我方 `.lvproj.json` 的字段来自 LVGL 的 **C API 概念**(widget 类型、style property、part、state、event),这些是 MIT 库的公开接口,不是 XML 规范的表达形式。

因此:

- 继续演进自有 JSON Schema v2 **不受影响**,不需要等许可结论。
- 但**不得**把 LVGL XML 的标签名/属性名/嵌套结构直接照搬成我方 Schema 的公开格式,否则难以主张二者不同。方案 §4.6「不要让一个字段同时承担业务 ID、显示名、XML 名和 C 符号」的分离原则,恰好在这一点上提供了保护——应作为硬性规则保留。

---

## 4. 结论与行动

### 4.1 结论

1. **去 XML 从「可选规避方案」变成「唯一可行路径」。** 方案 §7.2 曾列出三个规避选项,其中「Preview Adapter 改为自有 IR 直驱 LVGL API」现在是唯一不需要采购、也不需要自维护弃用代码的路径。
2. **这同时消除了长期许可风险。** 一旦预览通道不产生也不解析 LVGL XML,§3 表格中场景 3/4/5 的整类风险归零,客户分享与未来客户编辑器都不再受 XML 规范许可约束。
3. **发布产物侧的许可判定改善。** 方案 §7.2 要求的「产物链接期不得出现 `lv_xml_*` 符号,否则构建失败」在 9.5 上恒真。该检查应保留为回归护栏(防止有人把 9.4 loader 抄回来),但不再是主要证据。
4. **仍需法务确认的只剩一项**:过渡期内(9.4 runtime 尚在服役时)内部 Designer 使用 XML 的历史与现状,是否需要书面备案。这不阻塞任何工程动作。

### 4.2 行动项

| # | 动作 | 阶段 | 负责人 |
| --- | --- | --- | --- |
| 1 | runtime bridge 去 XML,改 IR 直驱 LVGL C API(与色彩格式改造合并) | 阶段 1 | 待指派 |
| 2 | 移除 `@lvd/codegen` 的 XML emitter 与 Designer 的 `emitXml()` 调用 | 阶段 1 | 待指派 |
| 3 | 在发布流水线保留 `lv_xml_*` 符号检查作为回归护栏 | 阶段 4 | 待指派 |
| 4 | Schema 评审时确认「不照搬 LVGL XML 命名/结构」作为硬性规则 | 阶段 1 | 待指派 |
| 5 | 向法务备案:9.4 时期内部 XML 使用的性质与终止时间 | 阶段 1 并行 | 待指派 |

### 4.3 不做的事

- 不采购 LVGL Pro(与「JSON 是业务事实源」冲突)。
- 不 vendor 9.4 的 XML loader 到 9.5 runtime(自维护弃用代码 + 保留许可风险,换不到任何能力)。
- 不因本节结论推迟 Schema v2 评审(维持方案 §7 末句原则)。

---

## 5. 证据索引

| 结论 | 证据 |
| --- | --- |
| XML 引擎移除 | `lvgl-9.5.0/docs/src/CHANGELOG.rst` Breaking Changes;PR lvgl/lvgl#9565 |
| XML 规范许可文本未变 | `diff lvgl-9.4.0/docs/src/details/xml/xml/license.rst lvgl-9.5.0/docs/src/xml/xml/license.rst` → 无差异 |
| 许可条款原文 | `lvgl-9.5.0/docs/src/xml/xml/license.rst` §2 Permitted Usage / §3 Restrictions |
| LVGL Pro 定价与层级 | `github.com/lvgl/lvgl_editor` `README.md`「Licensing」节 |
| lvgl_editor 无根 LICENSE 文件 | `LICENSE` / `LICENSE.md` / `LICENSE.txt` 三个路径均 404 |
| 运行时 XML 加载需洽谈 | 同 README:「Contact us at lvgl@lvgl.io to learn more.」 |
| 我方 XML 依赖位置 | `runtime/lv_conf.h:59`、`runtime/src/bridge.c`、`runtime/src/xml_parsers_extra/`、`apps/designer/.../reloadPipeline.ts:24,313,327` |
