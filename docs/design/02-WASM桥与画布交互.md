以下为可直接并入架构文档的设计。所有源码事实均已在本机 vendor/lvgl(9.4.0)中核实并标注路径。

---

# 子系统设计:WASM 运行时 + C 桥 + 画布交互层

## 0. 总览

```
┌─────────────────────────────── React 应用 (Vite) ───────────────────────────────┐
│  编辑器 UI          CanvasStage(画布交互层, §4)                                   │
│                     ├── <canvas id="lvgl-canvas">   ← SDL2/emscripten 渲染目标    │
│                     └── <div class="overlay">       ← 选择框/手柄/参考线/圆屏遮罩  │
│                              ↑ 坐标换算 (§4.1)                                    │
│  LvglRuntime (TS 包装层, §3) ── ccall/cwrap ──→ bridge.c (§2)                     │
│                                                    ↓                             │
│  lvgl_runtime.mjs + .wasm (runtime/ 构建产物, §1) ── LVGL 9.4 + lv_xml + SDL2     │
└──────────────────────────────────────────────────────────────────────────────────┘
数据流:JSON 工程模型(单一事实源) → XML 生成器(另一子系统) → 本子系统的热重载入口(§5)
```

---

## 1. WASM 运行时工程 `runtime/`

### 1.1 构建形态决策:MODULARIZE=1 + EXPORT_ES6=1 + 非 SINGLE_FILE

对比 lv_web_emscripten 的 `SINGLE_FILE` 方案,**结论:嵌入 React 应用必须改用模块化双文件产物**。理由:

| 维度 | SINGLE_FILE=1(官方示例) | MODULARIZE+ES6 双文件(本设计) |
|---|---|---|
| wasm 加载 | base64 内嵌 js,体积 +33%,无法流式编译 | `WebAssembly.instantiateStreaming`,首屏快 |
| 生命周期 | 全局 `Module`,污染全局、只能单实例单次初始化 | 工厂函数 `createLvglRuntime(opts)`,React 组件卸载/重建可控 |
| Vite 集成 | 大 js 进 bundle,阻塞主 chunk | `.mjs` 动态 import + `.wasm?url` 资源化,天然 code-split |
| canvas 绑定 | 依赖全局 `Module.canvas` | 工厂参数注入 `canvas`,可指向任意 React ref |

保留官方示例的其余思路:`emcmake cmake` + `-s USE_SDL=2`(emscripten SDL2 port 把 SDL_Renderer 落到 canvas)+ 初始堆 32MB。LVGL 侧入口用 `lv_sdl_window_create()`(`vendor/lvgl/src/drivers/sdl/lv_sdl_window.c:95`),它内部完成 `SDL_Init`、`lv_display_create`、`lv_tick_set_cb(SDL_GetTicks)`(:101)、创建 5ms 周期的 `sdl_event_handler` lv_timer 泵 SDL 事件(:100)——即 **SDL 事件泵挂在 lv_timer 体系里,只要 JS 驱动 `lv_timer_handler()` 一切都转**,不需要 `emscripten_set_main_loop`(取舍见 §3.4)。

### 1.2 目录与构建脚本

```
runtime/
├── CMakeLists.txt          # emcmake 工程
├── lv_conf.h               # LVGL 配置(§1.3)
├── build.sh                # emcmake cmake -B build && cmake --build build -j
├── src/
│   ├── bridge.c            # 全部 EMSCRIPTEN_KEEPALIVE 导出(§2)
│   ├── bridge_hit.c        # 命中测试/包围盒(§2.4/2.5)
│   └── bridge_log.c        # 日志钩子→JS 错误通道(§2.10)
└── dist/                   # 产物,提交进仓库(见下)
    ├── lvgl_runtime.mjs
    └── lvgl_runtime.wasm
```

`CMakeLists.txt` 要点:

```cmake
cmake_minimum_required(VERSION 3.16)
project(lvgl_runtime C)
set(LV_CONF_PATH ${CMAKE_CURRENT_SOURCE_DIR}/lv_conf.h CACHE STRING "" FORCE)
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../vendor/lvgl lvgl_build)
add_executable(lvgl_runtime src/bridge.c src/bridge_hit.c src/bridge_log.c)
target_link_libraries(lvgl_runtime lvgl)

set(EM_FLAGS
  "-sUSE_SDL=2"
  "-sMODULARIZE=1" "-sEXPORT_ES6=1" "-sEXPORT_NAME=createLvglRuntime"
  "-sENVIRONMENT=web"
  "-sINITIAL_MEMORY=33554432" "-sALLOW_MEMORY_GROWTH=1"   # 32MB 起,466x466 双 fb 仅 ~1.7MB,增长留给大字体/多屏
  "-sEXPORTED_RUNTIME_METHODS=cwrap,ccall,UTF8ToString,stringToNewUTF8,lengthBytesUTF8,stringToUTF8,HEAPU8,HEAP32,FS"
  "-sEXPORTED_FUNCTIONS=_malloc,_free"     # KEEPALIVE 函数自动并入
  "-sFILESYSTEM=1"                          # MEMFS 承载用户上传的图片/字体资产
  "-sSINGLE_FILE=0" "--no-entry"
)
target_link_options(lvgl_runtime PRIVATE ${EM_FLAGS})
target_compile_options(lvgl PRIVATE -Os)   # LVGL 本体尺寸优先
```

USE_SDL 需同时加到 compile 与 link;`--no-entry`:没有 `main()`,一切由 JS 显式调 `lvd_init` 启动。

### 1.3 `runtime/lv_conf.h` 关键项(相对 `vendor/lvgl/lv_conf_template.h` 的改动)

| 配置 | 值 | 理由 |
|---|---|---|
| `LV_COLOR_DEPTH` | `32` | SDL texture ARGB,截图直接得 ARGB8888,浏览器端零转换 |
| `LV_USE_STDLIB_MALLOC/STRING/SPRINTF` | `LV_STDLIB_CLIB` | 用 emscripten dlmalloc,随 ALLOW_MEMORY_GROWTH 弹性,不用调 `LV_MEM_SIZE` 固定池(template :43,默认 BUILTIN 64KB 必爆) |
| `LV_USE_XML` | `1` | 核心;`lv_init()` 会自动调 `lv_xml_init()`(`src/lv_init.c:413`) |
| `LV_USE_OBJ_NAME` | `1` | **name 反查与 `lv_xml_update` 的硬前提**(`lv_xml_update.c:10` 整个文件被 `#if LV_USE_XML && LV_USE_OBJ_NAME` 包住;template :525 默认 0,必须显式开) |
| `LV_USE_SNAPSHOT` | `1` | 截图导出(template :1041 默认 0) |
| `LV_USE_SDL` | `1`,`LV_SDL_RENDER_MODE = LV_DISPLAY_RENDER_MODE_DIRECT`,`LV_SDL_ACCELERATED 1`,`LV_SDL_DIRECT_EXIT 0` | DIRECT 模式整屏 fb,`flush_cb` 直接 memcpy 进 texture;DIRECT_EXIT 关掉防止关窗销毁 runtime |
| `LV_USE_LOG` | `1`,`LV_LOG_LEVEL = LV_LOG_LEVEL_WARN`,`LV_LOG_PRINTF = 0` | XML 解析错误只从日志出(§2.10),必须开;PRINTF=0 走注册回调 |
| `LV_USE_FS_STDIO` | `1`,letter `'A'` | emscripten 把 stdio 落到 MEMFS,用户上传的 PNG/字体写进 MEMFS 后 LVGL 以 `A:assets/xx.png` 访问 |
| `LV_USE_LODEPNG / LV_USE_TJPGD` | `1` | 用户图片资产解码 |
| `LV_FONT_MONTSERRAT_{8..48}` | 按需全开(WASM 不差这点体积) | 设计器要即点即换字号 |
| `LV_USE_OBSERVER` | `1`(默认) | `lv_xml.h` 依赖 subject 注册 |
| `LV_DEF_REFR_PERIOD` | `16` | 桌面浏览器 60fps |

### 1.4 产物进 Vite

产物提交到 `runtime/dist/`(设计者不需要装 emsdk 也能跑前端)。应用侧:

```ts
// src/wasm/loadRuntime.ts
import wasmUrl from '../../runtime/dist/lvgl_runtime.wasm?url';

export async function loadRuntimeModule(canvas: HTMLCanvasElement): Promise<EmscriptenModule> {
  const { default: createLvglRuntime } = await import('../../runtime/dist/lvgl_runtime.mjs');
  return createLvglRuntime({
    canvas,
    locateFile: (p: string) => (p.endsWith('.wasm') ? wasmUrl : p),
  });
}
```

`vite.config.ts` 需 `assetsInclude: ['**/*.wasm']`(`?url` 已足够,此项兜底)与 `optimizeDeps.exclude: []` 中排除该 mjs 避免预打包破坏 `import.meta.url`。纯静态部署无额外要求;若日后开 pthread 才需要 COOP/COEP 头,一期不用。

---

## 2. C 桥 `bridge.c` 完整导出清单

### 2.1 约定

- 前缀 `lvd_`(LVGL Designer);返回 `int`:`0=OK`,负数错误码(`-1` 通用失败、`-2` 未找到、`-3` 参数非法)。
- 对象引用一律用 **name 字符串**(JSON 模型的节点 id 即 XML `name` 属性,生成器保证全屏唯一),不向 JS 暴露 `lv_obj_t*` 指针——热重载会整批销毁重建对象,裸指针必然悬垂。name→obj 每次现查:`lv_obj_find_by_name()` 全树递归(`src/core/lv_obj_tree.c`),240x240 场景百级节点,微秒量级,无需缓存。
- 复杂返回值走"JS 传入 out 缓冲区"或"C 返回静态缓冲区指针 + JS 立即拷走"。

### 2.2 生命周期 / 主循环 / 画布

```c
#include <emscripten.h>
#include "lvgl.h"
#include "src/others/xml/lv_xml.h"
#include "src/others/xml/lv_xml_widget.h"   /* lv_widget_processor_t, 公开头 */

static lv_display_t * g_disp;
static lv_indev_t   * g_mouse;

EMSCRIPTEN_KEEPALIVE int lvd_init(int32_t hor, int32_t ver) {
    lv_init();                              /* 内部已调 lv_xml_init() (lv_init.c:413) */
    g_disp  = lv_sdl_window_create(hor, ver);
    g_mouse = lv_sdl_mouse_create();        /* 预览模式用;设计模式禁用,见 2.8 */
    lv_sdl_mousewheel_create();
    return g_disp ? 0 : -1;
}

/* JS rAF 每帧调;返回距下次 timer 到期的 ms 数,JS 可据此节流 */
EMSCRIPTEN_KEEPALIVE uint32_t lvd_tick(void) { return lv_timer_handler(); }

/* 改画布分辨率(切换目标屏型号)。SDL 驱动已挂 LV_EVENT_RESOLUTION_CHANGED
 * 回调做 texture_resize(lv_sdl_window.c:148,512),直接调即可 */
EMSCRIPTEN_KEEPALIVE void lvd_set_resolution(int32_t hor, int32_t ver) {
    lv_display_set_resolution(g_disp, hor, ver);
}
```

**缩放不走 `lv_sdl_window_set_zoom`**(`lv_sdl_window.h:50`):它改的是 SDL 窗口/texture 尺寸,在浏览器里意味着 canvas 像素尺寸变化、截图和命中坐标全要跟着换算。设计器缩放统一在 DOM 层做 CSS transform(§4.1),LVGL 侧永远 1:1 逻辑分辨率,坐标世界干净。

### 2.3 XML 注册 / 建屏 / 热重载序列

对应 API 事实:`lv_xml_register_component_from_data(name, xml)`、`lv_xml_component_unregister(name)`(`lv_xml_component.h:42,64`);`lv_xml_create_screen(name)` 只是 `lv_xml_create(NULL, name, NULL)`(`lv_xml.c:388-392`);screen 组件用 `<screen><view>...</view></screen>` 语法(`tests/src/test_cases/xml/test_xml_screen_event.c`),解析时置 `scope.is_screen`(`lv_xml_component.c:875`),建成后对象名自动设为组件名(`lv_xml.c:297-302`)。

**两个必须绕开的源码级陷阱**(热重载顺序由此决定):

1. `lv_xml_register_component_from_data` **不查重**,同名重注册是 `lv_ll_ins_head` 插头部(`lv_xml_component.c:174`)——旧 scope 泄漏且被遮蔽。必须先 `unregister` 再 `register`。
2. 共享样式 `lv_style_t` **内嵌在 scope 的链表节点里**(`lv_xml_style.h:26-30`),实例对象持有 `&xml_style->style` 指针;`unregister` 会 `lv_style_reset` 并 `lv_free(scope)`(`lv_xml_component.c:250+`)。**必须先删光实例、再 unregister,否则悬垂指针**。

```c
EMSCRIPTEN_KEEPALIVE int lvd_register_component(const char * name, const char * xml) {
    lv_xml_component_unregister(name);      /* 不存在时返回 INVALID,忽略即可 */
    return lv_xml_register_component_from_data(name, xml) == LV_RESULT_OK ? 0 : -1;
}
EMSCRIPTEN_KEEPALIVE int lvd_unregister_component(const char * name) {
    return lv_xml_component_unregister(name) == LV_RESULT_OK ? 0 : -2;
}

/* 屏级热重载:严格顺序 = 删旧实例 → unregister → register → create → load */
EMSCRIPTEN_KEEPALIVE int lvd_reload_screen(const char * name, const char * xml) {
    lv_obj_t * old_scr = lv_display_get_screen_by_name(g_disp, name); /* lv_display.h:451 */
    lv_obj_t * fallback = NULL;
    if(old_scr && old_scr == lv_screen_active()) {
        fallback = lv_obj_create(NULL);     /* 空白垫屏,防止删除活动屏 */
        lv_screen_load(fallback);
    }
    if(old_scr) lv_obj_delete(old_scr);     /* ① 实例先死 */
    lv_xml_component_unregister(name);      /* ② 再拆 scope(样式此刻无人引用) */
    if(lv_xml_register_component_from_data(name, xml) != LV_RESULT_OK) return -1;
    lv_obj_t * scr = lv_xml_create_screen(name);
    if(scr == NULL) { return -1; }          /* 解析失败:错误文本已经由日志钩子送到 JS */
    lv_screen_load(scr);
    if(fallback) lv_obj_delete(fallback);
    lv_obj_update_layout(scr);              /* 让 JS 下一步立刻能读 bbox,见 2.5 */
    return 0;
}

/* 追加子控件(拖拽新建时的控件级更新,§5 L2):
 * parent_name=NULL/"" 表示活动屏根。attrs 为扁平 k,v 交替数组,JSON 侧组好 */
EMSCRIPTEN_KEEPALIVE int lvd_create_child(const char * parent_name,
                                          const char * widget_or_comp,
                                          const char ** attrs) {
    lv_obj_t * parent = (parent_name && parent_name[0])
        ? lv_obj_find_by_name(lv_screen_active(), parent_name)
        : lv_screen_active();
    if(!parent) return -2;
    return lv_xml_create(parent, widget_or_comp, attrs) ? 0 : -1;  /* lv_xml.h:61 */
}

EMSCRIPTEN_KEEPALIVE int lvd_delete_obj(const char * name) {
    lv_obj_t * o = lv_obj_find_by_name(lv_screen_active(), name);
    if(!o) return -2;
    lv_obj_delete(o);
    return 0;
}
```

### 2.4 命中测试 `lvd_obj_at_point`

研究结论:**不能直接用 `lv_indev_search_obj`**。它对每个对象调 `lv_obj_hit_test`,而后者第一行 `if(!lv_obj_has_flag(obj, LV_OBJ_FLAG_CLICKABLE)) return false;`(`src/core/lv_obj_pos.c:961-963`)——设计器里 label、image 默认不可点击,会全部选不中。但它的**遍历骨架值得照抄**(`src/indev/lv_indev.c:590-624`):跳过 `HIDDEN`、用 `lv_obj_transform_point(obj,&p,LV_OBJ_POINT_TRANSFORM_FLAG_INVERSE)` 处理 transform、`OVERFLOW_VISIBLE` 时扩大判定区、子对象逆序(顶层优先)递归。

自写版本 = 同骨架,把 `lv_obj_hit_test` 换成纯几何判定 `lv_area_is_point_on(&obj->coords_click_area, p, 0)` 且不看 CLICKABLE:

```c
static lv_obj_t * search_obj_design(lv_obj_t * obj, lv_point_t * point) {
    if(lv_obj_has_flag(obj, LV_OBJ_FLAG_HIDDEN)) return NULL;
    lv_point_t p = *point;
    lv_obj_transform_point(obj, &p, LV_OBJ_POINT_TRANSFORM_FLAG_INVERSE);

    lv_area_t coords = obj->coords;               /* 私有字段:bridge 编译单元内可 include private 头 */
    bool self_hit = lv_area_is_point_on(&coords, &p, 0);

    lv_area_t search_area = coords;
    if(lv_obj_has_flag(obj, LV_OBJ_FLAG_OVERFLOW_VISIBLE))
        lv_area_increase(&search_area, lv_obj_get_ext_draw_size(obj), lv_obj_get_ext_draw_size(obj));

    if(lv_area_is_point_on(&search_area, &p, 0)) {
        for(int32_t i = (int32_t)lv_obj_get_child_count(obj) - 1; i >= 0; i--) {
            lv_obj_t * hit = search_obj_design(lv_obj_get_child(obj, i), &p);
            if(hit) return hit;
        }
    }
    return self_hit ? obj : NULL;
}

/* 返回命中对象的 name(静态缓冲,JS 立即拷走);未命中返回 NULL */
EMSCRIPTEN_KEEPALIVE const char * lvd_obj_at_point(int32_t x, int32_t y) {
    lv_obj_update_layout(lv_screen_active());     /* 保证 coords 新鲜,见 2.5 */
    lv_point_t p = { x, y };
    lv_obj_t * hit = search_obj_design(lv_screen_active(), &p);
    if(!hit) return NULL;
    static char buf[256];
    lv_obj_get_name_resolved(hit, buf, sizeof(buf));  /* lv_obj_tree.h:249,解析 "_#" 索引名 */
    return buf;
}
```

name 存储机制事实:`name` 属性经 obj parser 落到 `lv_obj_set_name`(`parsers/lv_xml_obj_parser.c:88-89`,strdup 存进 `obj->spec_attr->name`,`lv_obj_tree.c`);screen 自动命名为组件名(`lv_xml.c:301`);无名组件实例得到 `"<comp>_#"` 模板名,`_#` 由 `lv_obj_get_name_resolved` 解析成索引(`lv_obj_tree.h:208`)。**设计器策略:生成器给每个节点都显式写 `name`(= JSON 节点 id),让 obj↔JSON 双向映射零歧义**,`_#` 机制只是兜底。

### 2.5 包围盒查询与"坐标何时有效"

事实链:`lv_obj_get_coords` 只是拷贝 `obj->coords`(`lv_obj_pos.c:490-495`);布局脏时 coords 是旧值;但**不需要等下一次 `lv_refr`**——`lv_obj_update_layout()` 会同步循环 `while(scr->scr_layout_inv){ layout_update_core(scr); }` 直到布局收敛(`lv_obj_pos.c:308-327`),官方头文件也明示"若要在改尺寸后立刻读坐标,先调它"(`lv_obj_pos.h:227` 等多处)。**解决办法 = 所有几何查询入口前置一次 `lv_obj_update_layout(lv_screen_active())`**,该函数有防重入锁,空脏标记时近似免费。

```c
/* out: int32[4] = {x1, y1, w, h},屏坐标系;含 transform 时给视觉包络 */
EMSCRIPTEN_KEEPALIVE int lvd_get_obj_rect(const char * name, int32_t * out, int include_transform) {
    lv_obj_t * o = lv_obj_find_by_name(lv_screen_active(), name);
    if(!o) return -2;
    lv_obj_update_layout(o);
    lv_area_t a;
    lv_obj_get_coords(o, &a);
    if(include_transform)                          /* 旋转/缩放控件的外接矩形 */
        lv_obj_get_transformed_area(o, &a, LV_OBJ_POINT_TRANSFORM_FLAG_RECURSIVE); /* lv_obj_pos.h:391 */
    out[0]=a.x1; out[1]=a.y1; out[2]=lv_area_get_width(&a); out[3]=lv_area_get_height(&a);
    return 0;
}

/* 批量版:overlay 每帧要刷全部选中框+悬停框,一次跨界调用拿完。
 * names 为 '\n' 分隔;out 每对象 4 个 int32;返回成功个数 */
EMSCRIPTEN_KEEPALIVE int lvd_get_obj_rects(const char * names_joined, int32_t * out);
```

### 2.6 对象 → JSON id 反查 / 树同步校验

JSON id 即 name(§2.4 策略),`lvd_obj_at_point` 返回值直接就是 JSON id。补一个调试/一致性接口:

```c
/* 导出当前活动屏对象树 (name + class_name + rect) 的 JSON,写入 out(容量 cap),
 * 用于开发期断言 "WASM 树 == JSON 模型树"。返回写入长度,溢出返回 -3 */
EMSCRIPTEN_KEEPALIVE int lvd_dump_tree(char * out, int cap);
```

### 2.7 截图

`lv_snapshot_take(obj, cf)` 返回 `lv_draw_buf_t*`(`src/others/snapshot/lv_snapshot.h:41`),对 screen 对象整屏截图,`LV_COLOR_FORMAT_ARGB8888` 下 data 即预乘前 BGRA 字节流,JS 侧从 HEAPU8 切出转 `ImageData`(注意 R/B 通道序,JS 端交换一次)。

```c
static lv_draw_buf_t * g_snap;
/* 返回像素数据指针;宽高步长写入 meta_out[3]。JS 拷走后必须调 lvd_snapshot_free */
EMSCRIPTEN_KEEPALIVE uint8_t * lvd_snapshot(const char * screen_name, int32_t * meta_out) {
    lv_obj_t * scr = screen_name && screen_name[0]
        ? lv_display_get_screen_by_name(g_disp, screen_name) : lv_screen_active();
    if(!scr) return NULL;
    lv_obj_update_layout(scr);
    if(g_snap) { lv_draw_buf_destroy(g_snap); g_snap = NULL; }
    g_snap = lv_snapshot_take(scr, LV_COLOR_FORMAT_ARGB8888);
    if(!g_snap) return NULL;
    meta_out[0] = g_snap->header.w; meta_out[1] = g_snap->header.h; meta_out[2] = g_snap->header.stride;
    return g_snap->data;
}
EMSCRIPTEN_KEEPALIVE void lvd_snapshot_free(void) { if(g_snap){ lv_draw_buf_destroy(g_snap); g_snap=NULL; } }
```

选 `lv_snapshot` 而非直读 display framebuffer:snapshot 可截"未加载的屏"和任意子对象(将来做控件缩略图),且不依赖 SDL DIRECT 模式内部 fb 布局。

### 2.8 设计模式禁用真实交互

`lv_indev_enable(indev, bool)`(`src/indev/lv_indev.h:121`)即为此设计。设计态禁用后,SDL 鼠标事件仍被泵取但 indev 读缓存不再驱动 LVGL 状态机(不会触发 pressed/click/scroll),画布事件全部由 DOM 覆盖层接管:

```c
EMSCRIPTEN_KEEPALIVE void lvd_set_interactive(int enable) {
    for(lv_indev_t * i = lv_indev_get_next(NULL); i; i = lv_indev_get_next(i))
        lv_indev_enable(i, enable != 0);
}
```

补充预览态需要的运行控制:

```c
EMSCRIPTEN_KEEPALIVE void lvd_pause_anims(int pause);   /* lv_anim 全局暂停:设计态冻结动画 */
```

### 2.9 资产注入(图片/字体)

用户上传 PNG → JS 经 `Module.FS.writeFile('/assets/logo.png', bytes)` 写 MEMFS → 注册:

```c
EMSCRIPTEN_KEEPALIVE int lvd_register_image(const char * name, const char * memfs_path) {
    /* scope=NULL → 注册进 globals scope (lv_xml.c:402+ 同款逻辑) */
    return lv_xml_register_image(NULL, name, lv_strdup(memfs_path)) == LV_RESULT_OK ? 0 : -1;
}
EMSCRIPTEN_KEEPALIVE int lvd_register_font_tiny_ttf(const char * name, uint8_t * data, int len, int size_px);
/* 需 LV_USE_TINY_TTF=1;data 用 malloc 传入并由 C 侧持有 */
EMSCRIPTEN_KEEPALIVE void lvd_set_asset_prefix(const char * p) { lv_xml_set_default_asset_path(p); } /* lv_xml.h:84 */
```

### 2.10 错误回传:日志钩子

事实:XML 解析失败时 `lv_xml_create_in_scope` 只 `LV_LOG_WARN("XML parsing error: %s on line %lu", ...)` 后返回 NULL(`lv_xml.c:288-293`);`register_component_from_data` 同理 `LV_LOG_ERROR`(`lv_xml_component.c:156-163`)。**没有任何错误结构体,唯一通道是 `lv_log_register_print_cb`**(`src/misc/lv_log.h:60,72`,签名 `void cb(lv_log_level_t level, const char * buf)`)。方案:C 侧把日志经 `EM_JS` 直送 JS 回调,JS 侧在每次桥调用前清环形缓冲、失败时把窗口期内的 WARN/ERROR 聚合为错误消息(含 expat 报的行号,可映射回 XML 生成器的源节点):

```c
EM_JS(void, js_on_lv_log, (int level, const char * msg), {
    Module.__lvLogSink && Module.__lvLogSink(level, UTF8ToString(msg));
});
static void log_cb(lv_log_level_t level, const char * buf) { js_on_lv_log((int)level, buf); }
/* lvd_init 中: lv_log_register_print_cb(log_cb); */
```

### 2.11 属性级更新(热重载 L1,实现见 §5)

```c
/* 对已存在对象就地应用属性。widget_class 是底层 widget 名("lv_slider"等,
 * 组件实例传其 extends 链底部的 widget 名,由 JSON 模型侧提供)。 */
EMSCRIPTEN_KEEPALIVE int lvd_update_attrs(const char * name, const char * widget_class, const char ** attrs);
```

---

## 3. JS 包装层 `src/wasm/`

```
src/wasm/
├── loadRuntime.ts      # §1.4
├── LvglRuntime.ts      # 下述类
├── types.ts            # LvdRect / LvdError / ...
└── attrs.ts            # Record<string,string> ⇄ C char** 打包
```

### 3.1 接口定义

```ts
export interface LvdRect { x: number; y: number; w: number; h: number; }
export class LvglError extends Error { logLines: { level: number; msg: string }[]; }

export type RuntimeMode = 'design' | 'play';

export class LvglRuntime {
  static async create(canvas: HTMLCanvasElement, hor: number, ver: number): Promise<LvglRuntime>;

  /** 画布 */
  setResolution(hor: number, ver: number): void;
  setMode(mode: RuntimeMode): void;              // design: indev off + anim 暂停; play: 反之
  start(): void;                                  // 启动 rAF 循环
  stop(): void;                                   // 组件卸载/标签页隐藏时停
  destroy(): void;                                // stop + 释放 Module(丢引用,让 GC 收)

  /** XML / 热重载(§5 的执行端) */
  registerComponent(name: string, xml: string): void;        // throws LvglError
  reloadScreen(name: string, xml: string): void;             // throws LvglError
  updateAttrs(name: string, widgetClass: string, attrs: Record<string, string>): void;
  createChild(parentName: string | null, widget: string, attrs: Record<string, string>): void;
  deleteObj(name: string): void;
  registerImage(name: string, bytes: Uint8Array): void;      // FS.writeFile + lvd_register_image

  /** 几何 / 命中(§4 的数据源;全部 LVGL 逻辑坐标) */
  hitTest(x: number, y: number): string | null;              // 返回 JSON 节点 id
  getObjRect(name: string, transformed?: boolean): LvdRect | null;
  getObjRects(names: string[]): Map<string, LvdRect>;        // 单次跨界批量

  /** 输出 */
  snapshot(screenName?: string): ImageData;                  // BGRA→RGBA 通道交换后返回
  dumpTree(): unknown;                                       // 开发期一致性断言

  /** 错误/日志订阅 */
  onLog(cb: (level: number, msg: string) => void): () => void;
}
```

### 3.2 ccall/cwrap 与字符串/内存管理

- 初始化时一次性 `cwrap` 全部 `lvd_*`,存为私有字段;高频路径(`hitTest`/`getObjRects`,拖动中每帧调)**不用 `ccall` 的自动字符串封送**,而是复用预分配缓冲:构造时 `this.strBuf = Module._malloc(4096)`、`this.rectBuf = Module._malloc(4 * 4 * 64)`,`stringToUTF8` 写入后传指针,避免每帧 malloc/free 抖动。
- `attrs.ts` 打包 `char**`:对 N 对键值,malloc `(2N+2)*4` 的指针表 + 逐串 `stringToNewUTF8`,调用后统一 free。低频路径(属性面板提交),开销无所谓。
- C 返回的 `const char *`(如 `lvd_obj_at_point` 的静态缓冲)在下一次桥调用前有效,包装层内 `UTF8ToString` 立即拷成 JS string,不外泄指针。
- 错误回传:`registerComponent`/`reloadScreen` 调用前清空 log 环形数组(`Module.__lvLogSink` 落进来的),返回非 0 时把数组内 `level>=WARN` 的行塞进 `LvglError.logLines` 抛出。expat 行号在 msg 里(格式见 `lv_xml.c:289`),上层用"XML 生成器输出的行号→JSON 节点"映射表定位到具体控件。

### 3.3 主循环:rAF 驱动,弃 `emscripten_set_main_loop`

取舍理由:
- `emscripten_set_main_loop` 靠 unwind 异常劫持控制流、绑定全局单循环,与 MODULARIZE 多实例、React 严格模式的挂载/卸载语义冲突;暂停/恢复要经 C API 绕一圈。
- rAF 直接驱动 `lvd_tick()`(即 `lv_timer_handler`)语义完全等价:SDL 事件泵本身就是一个 5ms lv_timer(`lv_sdl_window.c:100`),tick 源是 `SDL_GetTicks`(:101,emscripten port 下即 performance.now),**LVGL 的时间观完全独立于调用频率**,rAF 被节流(后台标签页)也只是画面暂停、不会时序错乱。
- `lv_timer_handler` 返回下次到期 ms,包装层可做智能节流:设计态且无脏区时降到 rAF 每 3 帧一次,省电。

```ts
private loop = () => {
  if (!this.running) return;
  this.mod._lvd_tick();
  this.raf = requestAnimationFrame(this.loop);
};
```

### 3.4 React 生命周期契约

`LvglRuntime.create` 只在 CanvasStage 挂载后调用一次;严格模式双挂载用模块级单例 + 引用计数守护;`destroy()` 不尝试复用 wasm 实例(emscripten 运行时不支持干净重初始化),重建 = 重新 `create`。

---

## 4. 画布交互层 `src/canvas/`

### 4.1 坐标系对齐

三个坐标系:LVGL 逻辑坐标 L(240x240 等)、canvas CSS 坐标、页面指针坐标。约束:**canvas 的像素尺寸恒等于 LVGL 分辨率**(SDL 会设 `canvas.width/height = hor/ver`),缩放只用 CSS `transform: scale(zoom)`,于是:

```
L = (pointer.clientX - stageRect.left - panX) / zoom     // stageRect 来自 stage 容器 getBoundingClientRect
DOM_overlay_px = L * zoom + pan                          // overlay 与 canvas 同一个 transform 容器则直接用 L
```

**实现选择:overlay 与 canvas 放进同一个施加 `transform: translate(pan) scale(zoom)` 的容器**,overlay 内部全部用 LVGL 逻辑坐标画(选择框 x/y/w/h 直接取 `getObjRect` 结果),换算只发生在"指针事件→逻辑坐标"一处。手柄等不希望随缩放变粗的元素用 `transform: scale(calc(1/var(--zoom)))` 反向补偿。DPR 处理:容器再乘 `devicePixelRatio` 无必要——浏览器对 canvas CSS 缩放自带插值,zoom≥2 时给 canvas 加 `image-rendering: pixelated` 保持像素感(嵌入式设计者需要看真实像素)。

```html
<div class="stage" (wheel→zoom/pan, pointer events)>
  <div class="world" style="transform: translate(px,py) scale(zoom)">
    <canvas id="lvgl-canvas" width=240 height=240 />
    <svg class="overlay">          <!-- 同尺寸,viewBox="0 0 240 240" -->
      <g class="guides"/>          <!-- 对齐参考线 -->
      <g class="hover-outline"/>
      <g class="selection">        <!-- 每个选中对象:rect + 8 个 handle -->
      </g>
    </svg>
    <div class="round-mask"/>      <!-- 圆屏遮罩:同尺寸 div,径向渐变或 SVG evenodd path,
                                        pointer-events:none,仅设计辅助不影响 LVGL 渲染 -->
  </div>
</div>
```

overlay 选 SVG 而非 DOM div:参考线/多选框数量动态,SVG 一个 viewBox 天然继承逻辑坐标系。圆屏遮罩 = `<path fill-rule="evenodd" d="外矩形 + 内圆">` 半透明黑,240x240/466x466 切换只改 viewBox。

### 4.2 事件流状态机(设计态)

stage 容器捕获全部 pointer 事件(canvas 上层 overlay `pointer-events:none`,stage 统一监听),状态机:

```
Idle ── pointerdown ──→ 判定:
  ① 命中手柄(DOM elementFromPoint,手柄有 data-handle 属性) → Resizing
  ② hitTest(L) 命中对象:
        已选中且按 Alt → 向上一层选父(循环穿透)
        Shift → 加选/减选 → Idle
        否则 → 选中 + PressedOnObject
  ③ 未命中 → RubberBand(框选)
PressedOnObject ── 位移 > 3px/zoom ──→ Dragging(拖动所有选中对象)
Dragging  ── pointermove ──→ dispatch(model.move Δ) → §5 L1 更新 x/y → 读回 rect 刷 overlay
          └─ 同帧计算对齐参考线:候选 = 兄弟节点 rects(getObjRects 批量)+ 画布中线,
             吸附阈值 4/zoom px,命中则显示 guide 线并钳制 Δ
Resizing  ── 同上,按 handle 方位改 w/h(min 1),Shift 锁比例
RubberBand ── pointerup ──→ 用 getObjRects(全部节点) 做矩形相交 → 多选
任何状态 ── pointerup ──→ 提交一次 undo 快照 → Idle
右键 ── contextmenu ──→ hitTest → 菜单(删除/复制/置顶置底/包一层容器)
拖拽新建 ── 控件面板 HTML5 dragstart,stage drop ──→ hitTest(L) 找容器目标
             (仅接受 obj/tabview 等容器类,否则落屏根)→ model.insert → §5 L2
```

关键点:**拖动/缩放过程中不走 XML 重建**,直接 `updateAttrs(name,'lv_obj',{x,y})`(L1,微秒级),pointerup 才回写 JSON 模型并触发正常持久化;overlay 刷新永远"改完→`getObjRect` 读回",以 LVGL 布局结果为准(flex/align 下你设的 x/y 可能不生效,读回可立即在 UI 上如实呈现)。

### 4.3 设计态 vs 运行态

| | 设计态 | 运行态(预览试玩) |
|---|---|---|
| indev | `lvd_set_interactive(0)` | `(1)`,SDL 鼠标直接驱动 LVGL |
| 动画 | `lvd_pause_anims(1)` | 恢复 |
| DOM 事件 | stage 捕获,`preventDefault` | stage 透传:overlay 隐藏,stage 不拦截,让事件落到 canvas(SDL 自己监听 canvas) |
| overlay | 显示 | 隐藏(圆屏遮罩保留) |
| 切换 | 纯状态切换,无需重建屏;进运行态前可选 `reloadScreen` 复位控件状态 |

### 4.4 性能预算

拖动帧:1 次 `updateAttrs` + 1 次 `getObjRects(选中集+参考线候选)` ≈ 2 次跨界调用 + 一次 `lv_obj_update_layout`,240x240 百节点 << 1ms,60fps 无压力。

---

## 5. 热重载协议:三级策略

### 5.1 `lv_xml_update` 可行性评估(源码结论)

`lv_xml_update_from_data`(`lv_xml_update.c:44-116`)机制:元素名须为 `update-<widget>`,按 widget 名取 processor,`lv_obj_get_child_by_name(lv_screen_active(), name)` 找对象,把 `name` 属性抹掉后直接调 `proc->apply_cb(state, attrs)`。**能力边界**:

- 可用:所有 obj 基类属性(x/y/w/h/align/flags/states,`parsers/lv_xml_obj_parser.c:77-166`)、全部 `style_*` 内联样式(经 `apply_styles`→`lv_obj_set_style_*(obj,v,selector)` 落**对象本地样式**,与 scope 无关,安全)、各 widget 专有属性(value/min/max/text 等,走各自 apply_cb)。
- 不可用:①子元素(如 `<style name=...>` 挂共享样式)——handler 对非 `update-` 前缀元素直接 WARN 跳过;②它用的 `lv_obj_get_child_by_name` 按 `/` 分段**逐层直查**(`lv_obj_tree.c`),要求从屏根的全路径;③ dummy state 的 scope 为空(`lv_xml_update.c:47-48`),组件本地命名样式解析会落到 globals(`lv_xml_style.c:368-385`,限定名 `comp.style` 例外);④属性"删除"无语义——XML 里去掉一个属性,update 不会把它还原成默认值。

**决策:不用 `lv_xml_update_from_data` 本体,借它的思路在 bridge 里直调 processor**,消除路径限制(②)并省去拼 XML 字符串:

```c
/* bridge.c —— §2.11 的实现 */
int lvd_update_attrs(const char * name, const char * widget_class, const char ** attrs) {
    lv_widget_processor_t * proc = lv_xml_widget_get_processor(widget_class); /* lv_xml_widget.h:58 */
    if(!proc) return -3;
    lv_obj_t * obj = lv_obj_find_by_name(lv_screen_active(), name);   /* 递归查,不要求路径 */
    if(!obj) return -2;
    lv_xml_parser_state_t state;
    lv_xml_parser_state_init(&state);      /* lv_xml_parser.h:64;scope 空=global,与官方 update 一致 */
    state.item = obj;
    proc->apply_cb(&state, attrs);         /* attrs 不含 "name" 键,JS 侧保证 */
    lv_obj_update_layout(obj);
    return 0;
}
```

### 5.2 分级路由(编辑操作 → 通道)

| 级别 | 触发操作 | 执行 | 延迟量级 |
|---|---|---|---|
| **L1 属性级** `updateAttrs` | 白名单属性改动:x/y/w/h/align、全部 `style_*` 内联值、widget 值属性(text/value/min/max/checked…)、flags/states | §5.1 直调 apply_cb | ~µs,可跟拖动每帧 |
| **L2 控件级** `createChild`/`deleteObj` | 新增叶子/子树、删除节点、(移动=删+建) | `lv_xml_create(parent, tag, attrs)` 建子树 + 显式 name | ~10µs–ms |
| **L3 屏级** `reloadScreen` | 共享样式定义/consts/api 参数变更、组件 `<view>` 结构变更、subject 定义、z 序调整、跨容器 reparent、以及**任何属性删除/置默认** | §2.3 五步序列(删实例→unregister→register→create→load) | ~ms–10ms,仍无感 |

路由规则由 JSON 模型 diff 器判定(另一子系统),原则:**diff 落在单节点 attrs 且均在 L1 白名单 → L1;diff 是节点增删 → L2;其余一律 L3**。L3 是唯一的正确性兜底,L1/L2 只是体验优化——任何拿不准的编辑直接走 L3,240x240 全屏重建实测量级在毫秒档,肉眼无感。

### 5.3 不变式(必须写进代码断言)

1. L3 顺序不可乱:实例删除必须先于 `lv_xml_component_unregister`(§2.3 陷阱 2,样式悬垂)。
2. 同名重注册前必须 unregister(§2.3 陷阱 1,scope 泄漏+遮蔽)。
3. 每个 JSON 节点必有唯一 `name`,生成器负责;`lvd_update_attrs` 的 attrs 不得含 `name` 键。
4. 属性"从有到无"永不走 L1(update 无法还原默认值),强制 L3。
5. 所有几何读取(hitTest/getObjRect/snapshot)前置 `lv_obj_update_layout`。

---

## 6. 风险与二期扩展点

- **8.4 扩展点**:bridge API 全部以 name+字符串属性为界面,不暴露 9.4 结构体;二期做 8.4 时另编一个 `lvgl_runtime_v8.wasm`(8.4 无 lv_xml,由 IR 直接驱动 C 端建树的 bridge 变体),`LvglRuntime` 接口不变,`create()` 按工程目标版本选 wasm。
- **`lv_xml` 覆盖面**:仅 23 个 widget 有 parser(`vendor/lvgl/src/others/xml/parsers/`),led/spinner/line/imagebutton/msgbox 无。控件面板一期只放这 23+obj;若产品要 spinner,可在 bridge 里 `lv_xml_register_widget()` 自补 parser(接口公开,`lv_xml_widget.h:50`),不改 vendor。
- **XML 许可**:本子系统内 XML 仅存在于 wasm 内存中的热重载通道,符合"自有 JSON 为单一事实源"的约束;导出功能不经过本子系统。