# LVGL 版本基线与 9.4 → 9.5 差异清单

> 阶段 0 交付物 D1 / D2 / D3 / D4(对应 `LVGL-UI-需求与实施方案.md` §9 阶段 0)
> 产出日期:2026-09-03
> 证据基线:LVGL 官方 tag `v9.4.0` 与 `v9.5.0` 源码 tarball(codeload 直取,非文档转述)

## 0. 结论先行

**阶段 0 推翻了实施方案的一项核心前提:LVGL 9.5.0 已把 XML 引擎整体移出开源仓库。**

| 项 | 方案原假设 | 阶段 0 实测结论 |
| --- | --- | --- |
| 9.5 的 XML 通道 | 保留;编辑态预览可继续走 XML | **不存在**。`LV_USE_XML`、`src/others/xml/`、22 个官方 parser、全部 `lv_xml_*` API 在 9.5.0 中被删除 |
| 13 个自研 parser 的迁移工作量 | 候选最高风险面,需逐个适配 9.5 | **不是适配问题,是宿主消失问题**。13 个 parser 的 widget API 侧 0 破坏,破坏 100% 集中在 XML 宿主层 |
| 9.4→9.5 的 widget API 风险 | 需全面回归 | **极低**。35 个已登记 Widget 的 C API 仅移除 1 个函数 |
| 单 runtime 切换色深 | 待验证 | **可行,但必须先替换 SDL 呈现路径**;沿用 `lv_sdl_window_create` 时不成立 |
| XML 许可风险 | 内部使用低风险,对外需确认 | **风险性质变了**:XML 已成为商业产品 LVGL Pro 的接口,不再是开源库的一部分 |

由此得出的路线修正见 §6。

---

## 1. D1:目标版本与首个闭环目标板

### 1.1 目标版本

- **产品目标版本:LVGL `9.5.0`**(官方 Latest,发布日期 2026-02-18,见 `docs/src/CHANGELOG.rst` 首节标题)。
- **现有工具基线:LVGL `9.4.0`**(`runtime/CMakeLists.txt` 注释、`packages/schema/src/project.ts:38`)。
- 该结论**维持**实施方案 §2.4 的判断,不因 XML 引擎移除而改变:XML 是我方内部中间表示,不是产品需求。

### 1.2 首个闭环目标板

依据本仓库 `docs/screen-inventory.md`,选定:

| 项 | 值 | 证据 |
| --- | --- | --- |
| 屏型 | YDP395B003-V4 + ST7701S | `screen-inventory.md` 「其他」表 `~/lingshi86-firmware/主机_S3_ydp395` |
| 逻辑分辨率 | 480 × 480 | 同上 |
| 形状 | 方屏 | 同上 |
| `visibleRect` | 全屏(无插黑) | 非 TXW620002B0 类条屏 |
| `InputProfile` | **不需要** | 非 MX039/ST7102 圆屏,无 `touch_map` 原始触摸映射 |
| 色彩格式 | RGB565(待固件 `lv_conf.h` 核对后写入 DisplayProfile) | 见 §4.3 遗留项 |

选它的理由:方屏、无异形屏特例、无原始触摸校准,是把 `DisplayProfile` / `ControllerProfile` / `BuildTarget` 跑通的最小变量组合;且它正是 D7 选定迁移页面所在的工程(见 `PHASE0-REPORT.md` §D7)。

---

## 2. D2:9.4 → 9.5 差异清单

### 2.1 审计方法(可复现)

本节全部数字由 `scripts/audit-lvgl-version-diff.mjs` 生成,可随时重跑核对:

```bash
node scripts/audit-lvgl-version-diff.mjs            # 默认 v9.4.0 -> v9.5.0
node scripts/audit-lvgl-version-diff.mjs v9.4.0 v9.5.0
```

脚本流程:下载两个 tag 的源码 tarball(缓存到 `scripts/out/lvgl-cache/`)→ 抽取各自 `src/**/*.h` 中的 `lv_*` 函数与 `_t` 类型符号 → 抽取 `runtime/src/{bridge*.c, xml_parsers_extra/*.c}` 引用的 `lv_*` 符号 → 求差集并按编译单元拆分,区分「XML 宿主符号」与「widget/核心符号」。完整结果落 `scripts/out/lvgl-version-diff.json`。

**若出现任何非 XML 的缺失符号,脚本以非零码退出**——那才是需要人工处理的破坏性变更。

> 「符号数」的口径:仅统计能在源版本头文件中解析到的 `lv_*` 符号。runtime 源码里的 `lv_*` 原始 token 更多(约 200),但其中包含宏、枚举成员和局部命名,不构成 API 契约,故不计入。

### 2.2 头号差异:XML 引擎被移除

官方原文(`lvgl-9.5.0/docs/src/CHANGELOG.rst`):

```
Breaking Changes
~~~~~~~~~~~~~~~~
- **XML Engine Removed**. XML UI engine development continues outside the
  main repository. Separate announcement forthcoming.
```

对应 PR:`feat(xml): remove the XML parser and loader` [lvgl/lvgl#9565](https://github.com/lvgl/lvgl/pull/9565)

实测佐证:

| 检查项 | 9.4.0 | 9.5.0 |
| --- | --- | --- |
| `src/others/xml/` 目录 | 存在 | **不存在** |
| `src/others/` 子目录 | file_explorer, font_manager, fragment, gridnav, ime, imgfont, monkey, observer, snapshot, sysmon, test, translation, vg_lite_tvg, **xml** | file_explorer, fragment, translation |
| 官方 widget XML parser | 22 个(arc bar button buttonmatrix calendar canvas chart checkbox dropdown image keyboard label obj qrcode roller scale slider spangroup spinbox switch table tabview textarea) | **0 个** |
| `lv_conf_template.h` 中的 `LV_USE_XML` | 存在(第 1199 行,默认 0) | **不存在** |
| 全仓 `lv_xml_register_widget` 引用 | 有 | **0** |

> 注:9.5 开发周期内官方曾**继续给 XML 加功能**(spinner #9091、imagebutton #9381、slot #9193、局部样式 selector #9184),最终在发版前整体移除。这说明移除是产品决策,不是维护性删减,短期内不会回流开源仓。

其余 `src/others/` 子模块是**搬家**而非删除(不影响我方):`ime`→`src/widgets/ime`、`imgfont`/`font_manager`→`src/font/`、`monkey`/`sysmon`/`test`/`vg_lite_tvg`→`src/debugging/`、`snapshot`→`src/draw/snapshot`。

### 2.3 runtime 符号级影响面

两版头文件符号总数:9.4.0 = 3956,9.5.0 = 3999。

runtime(`bridge.c` + `bridge_hit.c` + `bridge_log.c` + 13 个 parser + 聚合器)共引用 **170 个**可解析的 LVGL 符号。其中在 9.4 存在、9.5 缺失的共 **30 个,全部是 XML 宿主符号**:

```
lv_xml_atof              lv_xml_atof_split        lv_xml_atoi
lv_xml_atoi_split        lv_xml_component_init    lv_xml_component_unregister
lv_xml_create            lv_xml_create_screen     lv_xml_dir_to_enum
lv_xml_get_const         lv_xml_get_image         lv_xml_get_value_of
lv_xml_init              lv_xml_obj_apply         lv_xml_parser_state_init
lv_xml_parser_state_t    lv_xml_register_component_from_data
lv_xml_register_event_cb lv_xml_register_font     lv_xml_register_image
lv_xml_register_widget   lv_xml_set_default_asset_path
lv_xml_split_str         lv_xml_state_get_item    lv_xml_state_get_parent
lv_xml_to_bool           lv_xml_to_color          lv_xml_to_size
lv_xml_widget_get_processor                       lv_widget_processor_t
```

**其余 170 个符号(widget / style / obj / draw / event / display / subject API)在 9.5 中全部保留。**

### 2.4 13 个自研 parser 的逐个静态影响判定

方案 §2.6 要求的逐个判定。结论:**每个 parser 的 widget API 侧零破坏,破坏集中在 XML 宿主层**。

数据源:`scripts/out/lvgl-version-diff.json`(由 §2.1 的脚本生成)。

| 编译单元 | 行数 | XML 宿主符号 | widget/核心符号 | 9.5 缺失(XML) | **9.5 缺失(其他)** | 判定 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| animimage | 104 | 6 | 14 | 6 | **0** | 宿主替换即可 |
| arclabel | 70 | 7 | 16 | 7 | **0** | 宿主替换即可 |
| canvas | 70 | 6 | 14 | 6 | **0** | 宿主替换即可 |
| imagebutton | 58 | 5 | 5 | 5 | **0** | 宿主替换即可 |
| led | 28 | 6 | 4 | 6 | **0** | 宿主替换即可 |
| line | 73 | 7 | 13 | 7 | **0** | 宿主替换即可 |
| list | 49 | 5 | 3 | 5 | **0** | 宿主替换即可 |
| lottie | 84 | 6 | 13 | 6 | **0** | 宿主替换即可 |
| menu | 70 | 5 | 10 | 5 | **0** | 宿主替换即可 |
| msgbox | 80 | 6 | 14 | 6 | **0** | 宿主替换即可 |
| spinner | 37 | 5 | 3 | 5 | **0** | 宿主替换即可 |
| tileview | 54 | 7 | 4 | 7 | **0** | 宿主替换即可 |
| win | 65 | 7 | 10 | 7 | **0** | 宿主替换即可 |
| `lvd_xml_extra.c`(聚合器) | — | 2 | 1 | 2 | **0** | 改为驱动器注册表 |
| `bridge.c` | 584 | 15 | 40 | 15 | **0** | 42 行需重写 |
| `bridge_hit.c` | 218 | **0** | 20 | 0 | **0** | **不动** |
| `bridge_log.c` | 27 | **0** | 2 | 0 | **0** | **不动** |

共享的宿主耦合面(全部 13 个 parser 都依赖,全部在 9.5 消失):

- `lv_xml_register_widget()` — 注册入口(`lvd_xml_extra.c`)
- `lv_xml_parser_state_t` + `state->scope` — 直接结构体成员访问
- `lv_xml_state_get_parent()` / `lv_xml_state_get_item()`
- `lv_xml_obj_apply()` — 基类属性套用
- `lv_xml_atoi/atof/to_bool/to_color/to_size/split_str/get_value_of/dir_to_enum` — 值转换工具
- `lv_xml_get_image()` — 资源解析

非 XML 的结构体耦合仅两处,9.5 均保留:`lv_draw_buf_t->header.w/h`(canvas、lottie)。

**工作量重估**:方案 §2.6 担心的「13 个 parser 是 9.5 迁移的最大工作量」不成立。它们的业务逻辑(属性名 → C setter 的映射)可**原样复用**。真正的工作量在于**替换宿主**,即把「XML 属性字符串 → parser → LVGL API」换成「我方 IR → 驱动器 → LVGL API」。

> **补充实测(晚于本节初稿)**:映射表不在 `manifest.json`,而在 **Widget Registry** ——
> `PropSpec.c.setter` 是必填字段,registry 对全部 35 个 widget 都声明了完整的属性→C API 映射
> (`manifest.json` 只是它在 XML 侧的镜像)。registry 引用的 **197 个去重 C 符号已实测全部存在于 9.5.0**,
> 9.4→9.5 一个未失。见 §2.6 与 `preview-architecture.md` §3.2。

### 2.5 35 个已登记 Widget 的 C API 差异

对 `packages/schema/src/widgets/` 登记的 35 个 Widget 逐个比对 `src/widgets/**/*.h` + `src/libs/qrcode`:

- 9.4.0 公开 widget 符号:548
- 9.5.0 公开 widget 符号:600(净增 52)
- **9.5 中被移除的:仅 `lv_tabview_rename_tab` 一个**

即 widget 层几乎完全向后兼容。C emitter(`c94` → `c95`)的移植成本主要来自 §2.6 的新能力,而非破坏性变更。

### 2.6 9.5 对本项目有正面价值的新增能力

| 新增 | 对本项目的意义 |
| --- | --- |
| **Property Interface 大幅铺开** | `src/widgets/property/` 从 9.4 的 12 个文件增至 9.5 的 26 个,新增 arc、bar、switch、checkbox、led、line、scale、spinbox、spinner、table、tabview、buttonmatrix、span、menu、chart。配合 `lv_obj_set_property()` / `lv_obj_property_get_id(obj, name)`,**这是 XML 宿主的直接替代品**:按名字驱动属性,正是 IR-driven 预览需要的机制,且是 MIT 核心库 |
| `LV_STATE_ALT` | 深/浅色切换无需维护两套 theme 树,直接服务 Theme Variant(阶段 3) |
| `lv_obj_bind_style_prop()`、`lv_obj_remove_theme()`、theme create/copy/delete API | 数据驱动样式绑定 + 多 Theme;9.4 无此 API |
| Blur / Drop Shadow 原生软件渲染 | 无需 GPU,可用于产品外壳与卡片视觉 |
| WebP 解码器 | 素材管线多一种输入格式 |
| `LV_CHART_TYPE_CURVE` | chart widget 能力对等 |

**registry 侧的独立验证**(与 §2.3 的 runtime 侧统计互为交叉验证):

拿 Widget Registry 声明要调用的每一个 C 符号,去 9.5.0 头文件符号表里逐个查:

| 检查 | 结果 |
| --- | --- |
| registry 引用的去重 C 符号数 | **197** |
| 其中在 9.5.0 缺失的 | **0** |
| 9.4 有、9.5 无的 | **0** |

测试:`packages/schema/src/__tests__/registry-lvgl95-parity.test.ts`
输入:`node scripts/audit-lvgl-version-diff.mjs` 生成的 `scripts/out/lvgl-symbols.json`(缺失时测试自动跳过,不让离线开发者变红)

这条比 §2.3 更强:§2.3 证明的是「现有 runtime 代码用到的符号还在」,本条证明的是「我们**声称支持的全部 35 个 widget 的全部属性**所需的符号都还在」——后者才是 9.5 能力对等的充分条件。

关键 API 存在性核对(用于确认「无 XML 也能做预览」):

| 符号 | 9.4 | 9.5 | 用途 |
| --- | :---: | :---: | --- |
| `lv_obj_set_name` / `lv_obj_get_name` | ✓ | ✓ | 节点 ID ↔ 对象映射(`bridge.c:104` `lvd_find_obj`) |
| `lv_obj_find_by_name` | ✓ | ✓ | 同上,递归查找 |
| `lv_display_get_screen_by_name` | ✓ | ✓ | 未加载屏的查找 |
| `lv_snapshot_take` | ✓ | ✓ | 截图对拍(`bridge.c:281`) |
| `lv_obj_set_property` / `lv_obj_property_get_id` | ✓ | ✓ | 通用属性驱动 |
| `lv_subject_init_int` | ✓ | ✓ | Subject / Binding |

**这些都不属于 XML 模块**,因此「去 XML」不会连带损失节点寻址、截图和数据绑定能力。

### 2.7 `lv_conf.h` 差异

对 `runtime/lv_conf.h` 中显式定义的全部 `LV_*` 项与两版 `lv_conf_template.h` 比对:

- 我方显式开启项中,**在 9.5 已不存在的只有 `LV_USE_XML`**(`runtime/lv_conf.h:59`)。
- 模板层面 9.5 移除:`LV_USE_XML`、`LV_USE_DEMO_SCROLL`、`LV_USE_DEMO_TRANSFORM`(后两个我方未用)。
- 模板层面 9.5 新增:`LV_USE_NANOVG`、`LV_USE_DRAW_NANOVG`、`LV_USE_EXT_DATA`、`LV_USE_LIBWEBP`、`LV_USE_NEMA_LIB`(均可保持默认关闭)。

即 `lv_conf.h` 的迁移动作只有一条:**删除 `LV_USE_XML`**,并按 §4 决定是否显式开启 `LV_USE_OBJ_PROPERTY`。

---

## 3. D3:9.5 runtime 最小构建验证

### 3.1 本机执行状态:**已完成**（2026-09-04 补验）

阶段 0 要求「验证 9.5 runtime 能构建、启动并渲染 Button/Label/Slider」。已在 WSL 使用 Emscripten 6.0.9、CMake 4.4.3 与 LVGL v9.5.0 commit `85aa60d18b3d` 完成真实构建：

- `runtime/build.sh` 成功生成无 XML、无 SDL 的 PreviewProgram runtime；manifest 记录精确 tag/commit、`lv_conf.h` 哈希、编译器、`displayHost=canvas-flush` 与 `inputHost=pointer-events`。
- 产物为 `lvgl_runtime.mjs` 70,604 B、`lvgl_runtime.wasm` 1,477,417 B。
- Designer 生产构建成功；Chrome 中 Button/Label/Slider 的真实 LVGL 树和尺寸正确，PointerEvent 经自建 indev 触发 `clicked` 回调。
- 同一 runtime 已实测五种 framebuffer 格式，详见 §4.2。

### 3.2 构建前改造（已完成）

若只把旧 runtime 的 `vendor/lvgl` 换成 v9.5.0 会在以下位置失败；现已通过 CMake 严格分流解决：9.5 编译 `preview_host.c` + `preview_driver.c`，9.4 legacy 才编译 `bridge.c` + XML parsers。

| 文件 | 位置 | 失败原因 |
| --- | --- | --- |
| `runtime/lv_conf.h` | `:59` | `LV_USE_XML` 在 9.5 不再被 `lv_conf_internal.h` 识别 |
| `runtime/src/xml_parsers_extra/lvd_xml_extra.h` | 6 个 `#include "src/others/xml/..."` | 头文件不存在 |
| `runtime/src/xml_parsers_extra/*.c`(13 个) | 全部 | `lv_xml_*` 未声明 |
| `runtime/src/bridge.c` | 42 行涉及 `lv_xml`,19 个不同符号 | 同上 |
| `runtime/CMakeLists.txt` | `:24` `EXTRA_PARSER_SOURCES` glob | 目标源文件将整体失效 |

`bridge.c` 共 584 行,其中 XML 相关 42 行;`bridge_hit.c`(218 行)与 `bridge_log.c`(27 行)**不含** XML 依赖,可原样保留。

### 3.3 `runtime/build.sh` 可复现性(方案 §2.5 复用要求)

现状缺陷已确认:

```bash
# runtime/build.sh:11
source /home/rie/emsdk/emsdk_env.sh >/dev/null 2>&1   # 硬编码单机路径,失败被静默吞掉
```

且全脚本无任何 LVGL 版本约束。对照固件仓库 `WF2P-0050_Knob_Display/simulator/build_web.sh` 的既有模式(方案 §2.5 要求复用):

```bash
LVGL_TAG="${LVGL_TAG:-v9.4.0}"          # :14  版本锁定 + 可覆盖
EMSDK_DIR="${EMSDK_DIR:-/opt/emsdk}"     # :17  环境参数化
[ -f "$EMSDK_DIR/emsdk_env.sh" ] || { echo "找不到 emsdk（设 EMSDK_DIR=）"; exit 1; }   # :19  显式失败
# :33-40  多源回退(GitHub + 内网 Gitea),git clone --depth 1 --branch "$LVGL_TAG"
```

**结论**:`runtime/build.sh` 应按此模式重写(`LVGL_TAG` 默认 `v9.5.0`、`EMSDK_DIR` 可覆盖、缺失即显式失败、多源回退),而不是自创一套。这是阶段 1 交付项,且是 D3 能在 CI 中复现的前提。

---

## 4. D4:单 runtime 切换 RGB565 / 32-bit 的可行性

### 4.1 结论:**可行,但前提是替换 SDL 呈现路径**

分三层判断:

**第一层 — LVGL 核心:支持。**
`lv_display_set_color_format(disp, cf)` 在 9.5 存在(`src/display/lv_display.h:337`)。软件渲染器对各格式的支持默认全开(`lv_conf_internal.h` 缺省值):

```
LV_DRAW_SW_SUPPORT_RGB565 1    LV_DRAW_SW_SUPPORT_RGB565_SWAPPED 1
LV_DRAW_SW_SUPPORT_RGB888 1    LV_DRAW_SW_SUPPORT_XRGB8888 1
LV_DRAW_SW_SUPPORT_ARGB8888 1  ...
```

这些开关**独立于 `LV_COLOR_DEPTH`**。因此一个以 `LV_COLOR_DEPTH 32` 构建的 runtime,可以让某个 display 以 RGB565 格式渲染与混色——这正是 16bpp 保真度问题的实质(抗锯齿与色带来自混色位深,不是来自最终呈现位深)。

**第二层 — SDL 呈现路径:不支持。**
9.5 把 SDL 驱动重构为 `lv_sdl_window.c` + `lv_sdl_sw.c` + `lv_sdl_texture.c` + `lv_sdl_egl.c`。软件路径中:

```c
/* lv_sdl_sw.c:166-172 —— 纹理像素格式在编译期由 LV_COLOR_DEPTH 决定 */
#if LV_COLOR_DEPTH == 32 || LV_COLOR_DEPTH == 1
    SDL_PixelFormatEnum px_format = SDL_PIXELFORMAT_RGB888;
#elif LV_COLOR_DEPTH == 24
    SDL_PixelFormatEnum px_format = SDL_PIXELFORMAT_BGR24;
#elif LV_COLOR_DEPTH == 16
    SDL_PixelFormatEnum px_format = SDL_PIXELFORMAT_RGB565;
#endif

/* lv_sdl_sw.c:252+ flush_cb —— 按 display 的 cf 逐字节拷进 fb,不做格式转换 */
lv_color_format_t cf = lv_display_get_color_format(display);
uint32_t px_size = lv_color_format_get_size(cf);
```

flush 只对 `RGB565_SWAPPED`(字节交换)和 `I1`(转 ARGB8888)做特判,**没有 RGB565 → 纹理格式的转换分支**。于是「display cf = RGB565 + `LV_COLOR_DEPTH` = 32(纹理 RGB888)」会把 16bpp 数据当 32bpp 上传,输出乱码。9.4 同理。

**第三层 — 解决方案:自建 display,不用 `lv_sdl_window_create`。**

```c
/* 目标形态 */
lv_display_t * d = lv_display_create(hor, ver);
lv_display_set_color_format(d, cf);          /* 由 BuildTarget 决定 */
lv_display_set_buffers(d, buf1, buf2, size, LV_DISPLAY_RENDER_MODE_DIRECT);
lv_display_set_flush_cb(d, lvd_flush_to_rgba);  /* 任意 cf → RGBA8888,写入 JS 可见缓冲 */
/* JS 侧: new ImageData(new Uint8ClampedArray(HEAPU8.buffer, ptr, len)) → putImageData */
```

`lvd_flush_to_rgba` 的格式转换约 20~30 行(RGB565 / RGB888 / XRGB8888 三个分支)。

这一步的**附带收益**同样重要——它消除了当前 `runtime/CMakeLists.txt:44-46` 记录的 SDL port 硬编码陷阱:

```
# specialHTMLTargets: SDL2 port registers DOM mouse listeners on the hardcoded
# selector "#canvas" (SDL_emscriptenvideo.c:217/963).
```

去掉 SDL 后,`--use-port=sdl2`、`specialHTMLTargets` 导出、以及为绕开该硬编码选择器写的 JS 胶水全部可以删除,指针事件改由我方直接投喂 `lv_indev`——这也是产品外壳 viewport 变换(方案 §6.1「外壳、Canvas、Overlay 和指针使用同一变换矩阵」)所需要的控制力。

### 4.2 判定

- **不需要维护 16bpp / 32bpp 双 runtime。**方案 §2.3、§6.2 里「若不可行则构建两个 runtime」的分支已关闭。
- 单 runtime 由 `lvd_preview_begin` 按 PreviewProgram 的 `colorFormat` 配置 display，并原子替换 64 行 partial draw buffer。
- 自建 Canvas `flush_cb` 已实测：`#123456` 在 RGB565/RGB565_SWAPPED 下输出 `[16,53,82,255]`，在 RGB888/XRGB8888/ARGB8888 下输出 `[18,52,86,255]`。
- 浏览器内部格式切换已证实；固件 simulator/真机的「像素一致」仍以截图 diff 为准，不以配置声明推定。

---

## 5. 阶段 0 后续项（2026-09-04 更新）

| 项 | 状态 | 阻断原因 | 解除条件 |
| --- | --- | --- | --- |
| D3 9.5 runtime 实际构建 + Button/Label/Slider 渲染 | **✅ 已完成** | — | Emscripten 6.0.9 真编译；Chrome P0 树与 pointer 点击通过 |
| D4 RGB565 实测截图 | **✅ 浏览器侧已完成** | 固件/真机仍待接入 | 五格式 Canvas 像素回归已通过；阶段 2 补 simulator/真机对拍 |
| 首个目标板 `colorFormat` 精确值 | 待定 | 需读 `主机_S3_ydp395` 固件的 `lv_conf.h` / 面板驱动初始化 | 阶段 1 写入 DisplayProfile 前核对 |

---

## 6. 路线修正建议

原方案的阶段划分基于「9.5 有 XML,迁移 = 适配 parser」。实测结论要求调整:

### 6.1 预览通道必须改为 IR 直驱

方案 §7.2 曾把「Preview Adapter 改为自有 IR 直驱 LVGL API,不处理 LVGL XML」列为**可选**规避方案之一。现在它是**唯一可行路径**:9.5 没有 XML 通道可继续用。

改造范围(已精确定位):

| 文件 | 动作 |
| --- | --- |
| `runtime/src/bridge.c` | 42 行 XML 逻辑替换为 IR 驱动;其余 542 行大部分可留 |
| `runtime/src/xml_parsers_extra/*.c`(13 个) | 去掉 XML 宿主外壳,widget 设值逻辑转为 IR lowering 的 widget 驱动器;`manifest.json` 升格为映射事实源 |
| `runtime/src/bridge_hit.c`、`bridge_log.c` | **不动**(无 XML 依赖) |
| `runtime/lv_conf.h` | 删 `LV_USE_XML`;评估开启 `LV_USE_OBJ_PROPERTY` |
| `apps/designer` → `@lvd/codegen.emitXml()` | 该依赖随 XML 通道一并消失,方案 §2.3「Preview 依赖 Codegen」的技术债被顺带解决 |

**这同时把三件原本分散在阶段 1/2/4 的事合并成一次改造**:去 XML、Preview/Codegen 解耦、色彩格式可切换。它们改的是同一批文件,分开做会重写三次。

### 6.2 建议的阶段调整

| 阶段 | 原内容 | 建议 |
| --- | --- | --- |
| 阶段 0 | 评审 + 最小验证 | 增补:在 emsdk 环境完成 D3/D4 实测(§5) |
| 阶段 1 | Schema v2 + 模块解耦 | **提前纳入 runtime 去 XML 重写**(原属阶段 2/4)。这是 9.5 的前置条件,不是优化项 |
| 阶段 2 | 9.5 垂直闭环 | 「13 个自研 parser 适配」改为「13 个 widget 驱动器移植」,工作量从「适配未知 API 变更」降为「换宿主」 |
| 阶段 3 | 复用能力 | 不变 |
| 阶段 4 | 客户发布 | §7 的 `lv_xml_*` 链接期检查变为**恒真**(9.5 里根本没有该符号),该检查项降级为回归护栏 |

### 6.3 需要产品/法务确认的新问题

XML 引擎已迁入 `lvgl/lvgl_editor` = **LVGL Pro 商业产品**。详见 `xml-license-boundary.md`。这不阻塞 Schema 评审,但改变了「保留 XML 通道」的成本结构:该选项现在意味着采购或自维护一份被上游放弃的引擎。

---

## 7. 证据索引

| 结论 | 证据 |
| --- | --- |
| 9.5 移除 XML 引擎 | `lvgl-9.5.0/docs/src/CHANGELOG.rst` Breaking Changes 段;PR lvgl/lvgl#9565 |
| `LV_USE_XML` 消失 | `lvgl-9.5.0/lv_conf_template.h` 无该项;9.4.0 在第 1199 行 |
| 22 个官方 parser 消失 | `lvgl-9.4.0/src/others/xml/parsers/` 有 22 个 `.c`;9.5.0 无该目录 |
| 30 个缺失符号全为 XML | 见 §2.1 复现步骤 |
| widget API 仅移除 1 个 | `find src/widgets src/libs/qrcode -name '*.h'` 符号差集 |
| SDL 纹理格式编译期固定 | `lvgl-9.5.0/src/drivers/sdl/lv_sdl_sw.c:166-172` |
| SDL flush 不转 RGB565 | `lvgl-9.5.0/src/drivers/sdl/lv_sdl_sw.c:252-300` |
| SDL `#canvas` 硬编码 | `runtime/CMakeLists.txt:44-46` 注释 |
| `build.sh` 硬编码路径 | `runtime/build.sh:11` |
| 固件 `build_web.sh` 版本锁定模式 | `WF2P-0050_Knob_Display/simulator/build_web.sh:14,17,19,33-40` |
