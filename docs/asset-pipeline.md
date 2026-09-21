# 素材管线:图标链复用规格

> 阶段 0 交付物 D8 的展开(对应 `LVGL-UI-需求与实施方案.md` §2.5「跨项目共享图标生成链」)
> 产出日期:2026-09-04

## 0. 结论

方案 §2.5 要求「Designer 与固件共享素材源、命名规范和转换契约;优先抽取可复用 CLI/库,不让浏览器端直接依赖某个固件仓库的生成目录」。

阶段 0 核对后有三条修正:

| # | 方案的描述 | 实测 |
| --- | --- | --- |
| 1 | 「两个带屏项目统一消费 `platforms/icons` 生成物」 | **86 屏(D7 选定的迁移工程)不消费这条链**,它用自己的 `host_s3_86panel_icons.c` |
| 2 | 「复用既有生成链」 | **生成链的源不在可达目录内**,只有生成物 |
| 3 | —— | 现有生成物**用 ARGB8888 存纯 alpha 遮罩,浪费 4 倍空间**(约 140 KB) |

---

## 1. 可达的只有生成物

全盘搜索 `F:\dengtec` 的结果:

| 路径 | 状态 |
| --- | --- |
| `platforms/icons/generated/lvgl/wf2_icons.c` | ✅ 存在(697 KB) |
| `platforms/icons/generated/lvgl/wf2_icons.h` | ✅ 存在 |
| `platforms/icons/registry.json` | ❌ **不存在** |
| `platforms/icons/svg/` | ❌ **不存在** |
| `platforms/icons/tools/generate_lvgl.py` | ❌ **不存在** |

两个生成物的头部注释指明了来源:

```c
/* 由 platforms/icons/registry.json + svg/ 自动生成，禁止手改。 */   // wf2_icons.c:1
/* 由 platforms/icons/tools/generate_lvgl.py 自动生成，禁止手改。 */ // wf2_icons.h:2
```

**行动**:向固件团队索取 `platforms/` 目录所在的仓库。在拿到之前,阶段 2 的素材管线只能基于生成物反推契约(下面 §2 就是反推结果),无法复用生成脚本本身。

## 2. 从生成物反推出的契约

这些是不依赖源码也能确定的事实,可直接写进 Designer 侧的素材导入规格。

### 2.1 命名与符号

- C 符号:`ic_<name>`,类型 `const lv_image_dsc_t`
- 头文件用 `extern` 声明,`#include "lvgl.h"`
- 消费方式:固件 `CMakeLists.txt` 直接编入生成的 `.c`

### 2.2 图标清单(19 个)

```
ic_fan  ic_bulb  ic_desk  ic_phone  ic_work  ic_relax  ic_timer  ic_gear
ic_wifi ic_wifi_off ic_wifi_high ic_wifi_slash ic_bluetooth
ic_list ic_volume ic_globe ic_tune ic_theme ic_mic
```

### 2.3 格式

| 项 | 值 |
| --- | --- |
| 色彩格式 | `LV_COLOR_FORMAT_ARGB8888`(全部 19 个) |
| 尺寸 | 60×60 共 11 个,32×32 共 8 个 |
| stride | `w * 4` |
| 像素内容 | **全部为 `(255,255,255,A)`** —— 见 §3 |

### 2.4 第三方素材来源与授权

每个图标带独立署名注释,格式 `/* <name> | <来源> / <原名> | <许可> */`:

| 来源 | 数量 | 许可 |
| --- | ---: | --- |
| Lucide | 15 | ISC |
| Phosphor Icons | 4 | MIT |

两者都是宽松许可,可用于商业产品,但**要求保留版权声明**。当前是靠 `.c` 里的逐个注释满足的——一旦 Designer 侧重新生成或转格式,这些注释必须一并带过去,否则会丢失署名。这一点须写进素材管线的硬性要求。

---

## 3. 实测发现:ARGB8888 存 alpha 遮罩,浪费 4 倍

### 3.1 事实

逐字节解析 19 个像素数组(共 **47,792** 个像素):

```
RGB 非纯白的像素数: 0
alpha 取值范围:     0 - 255
```

**每一个像素的 RGB 都是 (255,255,255)**,信息全部承载在 alpha 通道里。也就是说这批图标是**纯 alpha 遮罩**,靠调用方设 `image_recolor` 上色。固件侧确实是这么用的:

```c
/* host_s3_86panel_ui.c，make_set_row() */
lv_obj_set_style_image_recolor_opa(im, LV_OPA_COVER, 0);
lv_obj_set_style_image_recolor(im, lv_color_hex(COL_TEXT), 0);
```

### 3.2 LVGL 原生支持这种用法

`LV_COLOR_FORMAT_A8` 就是为此设计的。LVGL 9.5 软件渲染器(`src/draw/sw/lv_draw_sw_img.c:348-351`):

```c
if(cf == LV_COLOR_FORMAT_A8) {
    blend_dsc.src_buf = NULL;
    blend_dsc.color = draw_dsc->recolor;   /* 颜色取自 recolor,图像数据当 alpha 遮罩 */
}
```

另有一条快路径(`:240`):未做变换、无圆角时,A8 图直接作为 mask 参与混合,连中间缓冲都省了。

### 3.3 可节省的空间

| | 每像素 | 总字节 |
| --- | ---: | ---: |
| 现状 ARGB8888 | 4 B | **191,168** |
| 改用 A8 | 1 B | **47,792** |
| 节省 | | **≈ 140 KB** |

(8 个 32×32 + 11 个 60×60 = 47,792 像素;现状 8×4096 + 11×14400 = 191,168 字节。)

在 ESP32 上 140 KB flash 不是小数目,且 `.c` 源码体积会从 697 KB 降到约 180 KB,编译时间同步下降。

### 3.4 改动的行为影响(必须评估,不能直接换)

ARGB8888 白底 + `recolor_opa = COVER` 与 A8 + `recolor` 视觉等价,**前提是调用方设了 recolor**。

- ✅ 设了 recolor 的调用点:视觉完全一致。
- ⚠️ **没设 recolor 的调用点**:现状渲染为白色图标;换 A8 后会用 `recolor` 的默认值(黑)。

因此换格式前必须扫一遍全部 `lv_image_set_src(.., &ic_*)` 调用点,确认每处都显式设了 `image_recolor`。这是一次可穷举的检查,不是不可控的风险。

**建议**:这项优化归入阶段 2 的素材管线工作,与「取回生成链源码」一并做——因为改格式最干净的方式是改 `generate_lvgl.py` 的输出,而不是在 Designer 侧二次转换。

---

## 4. Designer 侧的复用方案

方案 §2.5 明确要求「不让浏览器端直接依赖某个固件仓库的生成目录」。现状恰恰相反——固件用 **8 级相对路径**引入:

```cmake
# WF2P-0050_Knob_Display/firmware/main/CMakeLists.txt:14
"../../../../../../../../platforms/icons/generated/lvgl/wf2_icons.c"
```

这种耦合脆弱且不可能被 Designer 复用。建议的边界:

```
platforms/icons/            ← 素材事实源(仓库位置待确认)
  registry.json  svg/  tools/generate_lvgl.py
        │
        ├──→ generated/lvgl/wf2_icons.{c,h}    固件编译期消费
        └──→ generated/manifest.json           ← 新增:Designer 消费
```

新增一份 `manifest.json`(名称、尺寸、色彩格式、sha256、来源与许可),Designer 通过它导入图标为 `UiProject.assets.icons`,不碰 `.c`。这样:

- Designer 不依赖 C 产物,也不依赖固件目录结构;
- 署名信息随 manifest 流转,不会在格式转换中丢失;
- 资源哈希天然进构建 manifest,满足方案 §6.2 的溯源要求。

`packages/schema/src/v2/uiProject.ts` 的 `AssetEntry` 已经预留了这个形状(`id` / `codeName` / `file.sha256` / `conv`),不需要改 Schema。

---

## 5. 字体子集化(§2.5 的另一条)

同样核对了 86 屏的 `gen_ui_fonts.sh`:

| 项 | 实测 |
| --- | --- |
| 字号档位 | 5 档(14/16/20/24/48),方案写的「六档」不准确 |
| 组成 | Montserrat 拉丁 `0x20-0x7F` + `0xB0` / FontAwesome 6 个码点 / 中文子集 |
| 中文字符集 | 脚本内 `CJK` 变量硬编码累加,分 5 段按功能注释 |
| 覆盖率门禁 | 方案提到的 `tests/scripts/check_ui_font_coverage.py` **在可达目录内未找到** |

**可复现性问题**(与旧版 `runtime/build.sh` 同类):

```bash
NODEBIN="$(dirname "$(ls /home/rie/.nvm/versions/node/*/bin/lv_font_conv 2>/dev/null | head -1)")"
ZH="/mnt/c/Windows/Fonts/simhei.ttf"
```

硬编码到单台开发机的 nvm 路径与 Windows 字体路径。

**结论**:字体链**复用契约,不复用实现**。可复用的是「字符收集 → 子集生成 → 覆盖率检查」这三段契约与字符集数据;脚本本身在提取为公共 CLI 时必须一并修掉硬编码(参照 `runtime/build.sh` 已完成的改造模式)。

---

## 6. 待办

| # | 事项 | 阻塞 |
| --- | --- | --- |
| 1 | 取回 `platforms/` 所在仓库(`registry.json` / `svg/` / `tools/`) | 阻塞阶段 2 素材管线 |
| 2 | 取回 `check_ui_font_coverage.py` | 阻塞字体覆盖率门禁复用 |
| 3 | 扫描 `ic_*` 全部调用点,确认都设了 `image_recolor`,再切 A8 | 阶段 2 优化项 |
| 4 | 在 `platforms/icons` 增产 `generated/manifest.json` 供 Designer 消费 | 需要 #1 |
| 5 | 确认 86 屏是否应并入共享图标链(现用自有 `host_s3_86panel_icons.c`) | 影响 D7 迁移页面的素材依赖 |
