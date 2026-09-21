# M0 技术验证报告(2026-07-02)

真跑环境:playwright chromium(headless)+ node m0/run-e2e.mjs,静态服务 m0/server.mjs(:8317)。
产物:`m0/artifacts/{results.json, page.png, canvas.png, console.log}`。**T1~T8 全部 8/8 PASS**(results.json 为准)。

## ARCHITECTURE §5 十项清单逐项判定

| # | 项 | 判定 | 依据/数据 |
|---|----|------|-----------|
| 1 | **R1** MODULARIZE+ES6 双文件、destroy→re-create ×3 无残留 | ✅ | T1:3 轮 create/snapshot/destroy 正常,`window.Module` 无泄漏,missingExports=0 |
| 2 | **R2** 纯 rAF 驱动下 SDL 鼠标事件入队 | ✅(修后) | T2:play 模式合成 mouse 事件→`clicked`→stub 上报 t2_cb。**根因修复**:SDL2 port 把监听挂死在选择器 `#canvas`(SDL_emscriptenvideo.c:217/963,经 `document.querySelector`),canvas id 任意时全部挂空;已导出 `specialHTMLTargets` 并在 JS init 前映射 `'#canvas'→canvas 元素` |
| 3 | XML 热重载全链路 + 解析错误带行号 | ✅ | T3:L3 蓝→红重载 **0.20 ms**,hash 变化+像素校验;probe-parse-error.mjs:坏 XML → rc=-1 + 日志钩子 "XML parsing error; not well-formed on **line 1** (lv_xml_component.c:159)" |
| 4 | **R3** L4/globals 重载无野指针 | ✅ | T4:5 轮 `lvd_reload_all`(subject t4_val 30→70 + slider/label 双绑定)× 每轮 200 次 manual tick,零 WARN/ERROR,零崩溃;HEAP 恒 32.0MB(增长 0KB)。`lv_xml_component_init()` 私有调用重建 globals scope 方案成立,无需 destroy+recreate 兜底 |
| 5 | **R4** `lvd_update_attrs` 空 scope 值解析 | ✅(修后) | T5:字面量 0xff0000→红、`#accent`→(255,136,0) 均正确零警告。**根因修复**:apply_cb 直调绕过了 lv_xml.c 静态 `resolve_consts()`(:829),`#name` 原样进 color parser;bridge.c 里用公开 `lv_xml_get_const(NULL,…)`(NULL=globals)复刻该逻辑 |
| 6 | 命中测试 + `lvd_get_obj_rect`(嵌套 flex) | ✅ | T6:inner(10,10)/label(15,15)/slider(10,90,w180) 全部 ±2px 吻合;hitTest 中心点命中 t6_label/t6_slider |
| 7 | **R7** 图片同名替换 | ✅ | T7:MEMFS 覆写 + `lvd_drop_image_cache('A:assets/t7.png')` + L3 → (42,42) 红→绿。FS_STDIO letter 'A' ↔ `/assets/…` 映射确认 |
| 8a | **R5** lv_font_conv 浏览器可运行 | ✅ | chromium 实测 spike/test.html:`{"ok":true,"bin_bytes":7308,"c_bytes":48595,"has_lv_font_t":true}`,与 node 产物字节数一致(bundle 1.1MB,esbuild+buffer polyfill,Worker 化留待 M1) |
| 8b | **R6** tiny_ttf vs 位图字体渲染肉眼对比(bpp1/2) | ⚠️ 未做 | 素材已备(out/montserrat_16.bin + tiny_ttf 桥已导出),需人工肉眼评估,移交 M1 首日 |
| 9a | **R8** set_name 宏守卫裁决 | ⚠️ 未裁决 | 纯 emitter 侧决策,与 runtime 无耦合;建议:输出包 `#if LV_USE_OBJ_NAME` 守卫(零成本、真机可裁) |
| 9b | **R10** 466×466 + snapshot HEAP 观测 | ✅ | T8:setResolution(466,466)+10 控件屏+snapshot,画面正确(见 canvas.png);HEAP 全程 **32.00MB 恒定**(INITIAL_MEMORY=32MB 未触发 growth) |
| 10 | 9.4 属性覆盖率对账脚本首跑 | ✅(D 阶段) | scripts/audit-parsers.mjs + out/parser-attrs.{json,md};发现上游 `send_draw_task_evenTS` 拼写 bug 等 4 处差异(见 D 报告) |

## 关键数据

- wasm **1,262,175 B(1.20 MB)**,mjs 171,001 B(重建后 +108 B,加了 specialHTMLTargets 导出)
- L3 屏级重载 **0.20 ms**;L4 全工程重载 5 轮 + 1000 tick 共 33 ms(含 snapshot/hash)
- HEAP:init/setRes466/多控件屏/snapshot 后均 32.00MB,无增长;T4 5 轮 L4 增长 0KB → 无泄漏迹象(粗粒度,HEAPU8.length 只测 growth 触发)
- 8 项测试总耗时 ~0.7s(headless chromium)

## 集成期间修的东西(A/B 产出之外)

1. **runtime/CMakeLists.txt**:EXPORTED_RUNTIME_METHODS 增加 `specialHTMLTargets`(T2 根因)
2. **runtime/src/bridge.c** `lvd_update_attrs`:复刻 resolve_consts,`#const` 引用先经 `lv_xml_get_const(NULL,…)` 解析(T5 根因)
3. **m0/runtime-wrapper.mjs**:
   - `reloadAll` 对齐真实桥签名 4 参 `(globals, names**, xmls**, n)`(B 假设的 3 参交替表不符)
   - `dropImageCache` 去掉对 void 返回值的 rc 检查(T7 假失败)
   - create() 里 init 前做 `specialHTMLTargets['#canvas']=canvas` 映射
4. **m0/tests.mjs**:`tN.name = …` 改 `Object.defineProperty`(函数 name 只读,ES module 严格模式直接抛 TypeError,页面 main.mjs 挂不上)
5. 环境:项目根 npm init + playwright(chromium-1228 用本地缓存,未下载)

## 遗留问题

- **R6 肉眼评估未做**(素材齐,M1 首日补)、**R8 未裁决**(建议宏守卫)
- SDL '#canvas' 选择器映射是宿主页硬约束:任何嵌入 runtime 的页面都必须在 init 前做 `mod.specialHTMLTargets['#canvas']=canvas`,已写进 wrapper;正式 SDK 包装时要保留这行
- specialHTMLTargets 映射生效后 SDL 会真的改 canvas 元素的 width/height(setResolution 466 后 DOM canvas 变 466),设计器布局层要接受画布元素尺寸随分辨率变化(或改 CSS 约束)
- T4 的 HEAP 观测只对 growth 敏感(32MB 初始堆内的碎片/占用看不见);M1 若要精细泄漏检测需 mallinfo 类桥函数
- font-conv bundle 未 minify、未挪 Worker(转换同步 CPU 密集,M1 集成时处理)
- `lvd_set_manual_tick(0)` 虚拟时间回跳限制不变(仅一次性 e2e 会话用)
