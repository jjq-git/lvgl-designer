# M1 集成验收报告

日期:2026-07-02
范围:schema / codegen / lvgl-runtime / designer 全链路集成(真 WASM,vite preview dist 产物 + playwright)
验收脚本:`apps/designer/e2e/run-e2e.mjs`(运行:先 `pnpm --filter @lvd/designer build`,再 `node e2e/run-e2e.mjs`)

## 0. 前置门槛

| 项 | 结果 |
|---|---|
| `pnpm -r typecheck` | 5 包全绿 |
| `pnpm -r test` | schema 82 / codegen 9(golden)/ lvgl-runtime 13,全绿 |
| `pnpm --filter @lvd/designer build` | 绿(dist 含 wasm 资产 1.26MB) |

## 1. E1~E7 判定表

| # | 用例 | 判定 | 关键数据 |
|---|---|---|---|
| E1 | 新建工程(240 圆屏) | **PASS** | 工具条「新建」(confirm 自动接受)→ display=240×240 round、1 屏 0 子节点;画布出现圆屏 evenodd 遮罩(`svg path[fill-rule=evenodd]` ×1) |
| E2 | palette 拖 button+label+slider | **PASS** | 模型 3 节点 `button:button_1, label:label_1, slider:slider_1`;对象树 4 行(屏根+3);像素采样(runtime.snapshot):3 个 widget 中心 2 个 ≠ 底色 rgba(245,245,245)(label 中心恰落字间空隙,属预期) |
| E3 | Inspector 改 width=200/value=60 + 拖动 | **PASS** | width=200 → `getObjRect` w=200;value=60 → 画布像素变化 + 模型 props 正确;画布拖动 rect (60,150)→(35,110),松手后模型 x/y 与 rect 一致(位置持久) |
| E4 | 样式 bg_color + undo×2/redo | **PASS** | bg_color=#ff3300 写入模型 inlineStyles + 画布变化;track 右端像素 rgba(247,206,196) 红通道占优(默认主题 track bg_opa 非满,红按 opa 混入,符合 LVGL 语义);undo#1 → inlineStyles 清空,undo#2 → 位置回退 (60,150);redo×2 → 位置+颜色全恢复 |
| E5 | 刷新 → IndexedDB 恢复 | **PASS** | autosave(debounce 2s)后 reload:3 节点 + slider(width=200, value=60, bg_color=#ff3300)+ display 240 round 全部恢复 |
| E6 | 导出 zip | **PASS** | 真下载事件捕获 → fflate 解包 14 文件;ui.h/ui.c/CMakeLists/actions.h/actions.c/actions_default.c/screens/main.h/.c 均在;main.c 含 `lv_slider_create`/`lv_button_create`/`lv_label_create`/`lv_slider_set_value(obj,60,…)`/`lv_obj_set_style_bg_color(…0xff3300…)`,set_name 带 `#if LV_USE_OBJ_NAME` 守卫;内容已落 `apps/designer/e2e/out-ui/` |
| E7 | 运行模式 | **PASS** | 切运行 → overlay 手柄 0;画布内合成点击 button → 0 JS error;切回设计态 → mode=design,点选 button 出 8 手柄,模型无损(仍 3 节点) |

全程 **0 条 pageerror / console.error**。

### 加测:导出 C 真编译(超出 E6 要求)
`out-ui/` 全部 6 个 .c 用 gcc(-std=c11 -Wall -Wextra -Werror,`packages/codegen/ci/lv_conf_ci.h`,vendor/lvgl 头)在 LV_USE_OBJ_NAME=1/0 双配置下编译:**12/12 OK,0 警告**。

## 2. 截图 / 产物清单(apps/designer/e2e/)

- `artifacts/e1-new-project-round.png`、`e1-page-full.png` — 新工程 + 圆屏遮罩
- `artifacts/e2-three-widgets.png`、`e2-page-full.png` — 三 widget + 对象树(已目检:三栏布局、圆屏、选中框正常)
- `artifacts/e3-width200-value60.png`、`e3-after-drag.png`
- `artifacts/e4-bgcolor.png`(已目检:track 右段红色可见)、`e4-after-undo2.png`、`e4-after-redo.png`
- `artifacts/e5-restored.png`、`e5-page-full.png`
- `artifacts/e6-after-export.png`、`artifacts/ui.zip`
- `artifacts/e7-play-mode.png`(已目检:停止按钮态、无手柄、检查器"未选中对象")、`e7-back-design.png`
- `out-ui/` — E6 导出 zip 全量解包(14 文件),供 EspIdf 阶段直接取用

## 3. 修复记录

产品代码(schema/codegen/runtime/app)**零改动** —— 集成一次跑通。验收脚本本身迭代 2 处:

1. 像素采样最初用 `drawImage(lvgl-canvas)` 抓帧,拿到的全是空白(canvas 上下文非 2d,帧外读不可靠)→ 改走 `pipeline.runtime.snapshot()`(桥函数,ImageData RGBA),稳定。
2. E4 红色断言最初要求饱和红(r>180,g<130,b<120)→ 实测 track 像素 rgba(247,206,196):LVGL 默认主题 slider 主部件 bg_opa 非满,bg_color 按 opa 混入底色,这是 LVGL 正确语义而非 bug → 断言改为红通道占优(r−g>25 且 r−b>25)。

## 4. 已知限制(结转,均非 M1 阻塞)

来自 app:
- 跨容器 reparent、画布框选/Alt 穿透选父、多选编辑、画布右键菜单未做(树右键删除/Delete 已覆盖)
- 图片/字体资产上传 UI 未做(runtime registerImage 通道已就绪);events/bindings 编辑 UI 未做(emitter/管线已支持)
- exportZip 未消费 `GeneratedFile.overwrite`(zip 恒全量;actions.c write-if-absent 语义靠文件头注释声明)

来自 codegen:
- gradRef C 侧 `&grad_<name>` 占位(渐变二期);bind_style / float subject XML 一期跳过并出 warning;链接级冒烟(main_stub+liblvgl.a)属 CI 二阶段未做

验收脚本约束:
- E2 像素断言依赖默认主题底色 rgba(245,245,245),换主题需调整
- e2e 串行跑一个 chromium 实例,端口固定 4185

## 5. ESP-IDF 真编译(R 里程碑收尾,2026-07-02)

工程:`esp-smoke/`(仅新增,产品包零改动)。结构:main(lv_init + headless dummy display,flush_cb 直接 flush_ready)+ `components/lvgl` → 软链 `vendor/lvgl`(v9.4.0,ESP 组件走 Kconfig/LV_CONF_SKIP)+ `components/ui` → 软链 `apps/designer/e2e/out-ui`(E6 导出的 14 文件,原样未改)。全程离线——组件管理器缓存里只有 lvgl 9.3,不满足 ^9.4,改用本仓 vendor/lvgl 作本地组件,一次网络都没拉。

| 项 | 结果 |
|---|---|
| IDF / target | **v5.5.2**(`~/idf552`)/ esp32s3 |
| `idf.py build` | **0 error / 0 warning**(含 touch 全部 ui .c 重编复核,grep warning 零命中) |
| sdkconfig | `CONFIG_LV_USE_OBJ_NAME=y`(专门打开以走生成代码的 set_name 分支) |
| 符号 | nm 确认 `ui_init`(42008d20 T)、`ui_main_create`、`lv_obj_set_name` 均入 elf |
| ui 目标文件 | libui.a 34,566 B;screens/main.c.obj 16,408 B、ui.c.obj 5,376 B、styles 3,844 B、subjects 3,856 B、actions 2,212+2,236 B |
| 镜像 | esp_smoke.bin 454,224 B(0x6ee50,1MB app 分区余 57%) |

坑:无实质性坑。唯一取舍是 LVGL 组件来源——managed_components 缓存是 9.3(WF2P-0050 工程的),不能凑合;vendor/lvgl 自带 `env_support/cmake/esp.cmake` + Kconfig + idf_component.yml,软链进 `components/` 即被 IDF 当本地组件识别,零配置。生成代码的 `#if LV_USE_OBJ_NAME` 守卫在 Kconfig 体系下同样生效(该选项 default n,须 sdkconfig.defaults 显式开)。未上真板(链接级冒烟即 R 门槛);flash+指纹验证留待有屏工程接入时做。

## 6. STM32 开箱即用 + ARM 交叉编译收口(2026-07-02 附记)

codegen 多目标导出落地:`emitC94(project, {target: 'esp-idf'|'cmake'|'bare'})`(缺省 esp-idf,designer 现有调用零改动)。三 target 除 CMakeLists 外输出逐字节一致(diff -rq 实证);每包新增 `REQUIREMENTS.txt`(lv_conf 宏清单:widget 依赖闭包 + 字体 + FLEX/GRID/OBSERVER 特征检测 + LV_USE_OBJ_NAME/LV_COLOR_DEPTH 说明)与 `INTEGRATION.md`(CubeIDE / Makefile / PlatformIO / ESP-IDF);回调 weak 兜底改 `UI_WEAK` 三分支(GCC/Clang → attribute、IAR → __weak、其余 → UI_NO_WEAK 停用 default 文件)。

ARM 交叉编译验证(`scripts/compile-smoke-arm.sh`,Cortex-M4F hard-float,-Os -Wall -Wextra -Werror,LV_USE_OBJ_NAME=1/0 双配置,golden 全部 27 case × 三 target 新例):

| 工具链 | OBJ_NAME=1 | OBJ_NAME=0 |
|---|---|---|
| host gcc(基线) | 163/163 | 163/163 |
| arm-none-eabi-gcc 13.2.1(Debian) | 163/163 | 163/163 |
| xpack arm-none-eabi-gcc 14.2.1 | 见下方补充 | 见下方补充 |

cmake target 的 CMakeLists 经真实 `cmake -S -B` configure 通过;bare 无构建文件、INTEGRATION.md 齐全。遗留:导出对话框的 target 下拉属 apps/designer,待 D 工作流完成后由编排器安排。
