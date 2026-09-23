# 预览架构:模块依赖评审与去 XML 方案

> 阶段 0 交付物 D6(对应 `LVGL-UI-需求与实施方案.md` §3.2、§6.1、§9 阶段 0 第 6 项)
> 产出日期:2026-09-03
> 前置结论:`lvgl-version-baseline.md`(9.5 移除 XML 引擎)、`xml-license-boundary.md`

## 1. 现状核对

方案 §2.3 与 §3.2 描述的技术债,阶段 0 逐条复核后持续跟踪;2026-09-04 已有部分项目落地:

| 方案断言 | 代码事实/当前状态 | 状态 |
| --- | --- | --- |
| 目标版本仍是 9.4 | `packages/schema/src/project.ts:38` `lvglVersion: '9.4'`;`validate.ts:63` `z.literal('9.4')`;`factory.ts:62` 写死 `'9.4'` | ✓ |
| Preview 依赖 Codegen | 9.5 主通道已由 `apps/designer` 直接调用 `@lvd/preview-compiler`；`@lvd/codegen.emitXml()` 仅保留给旧 9.4 WASM 的迁移回退 | ◐ 主通道已解耦 |
| Components 未闭环 | v2 已按 `component:<id>` 打通 Editor/Preview/C/Web 发布投影；定义变化同步所有实例，v1 Validator 的阻断仅保留给旧文件兼容入口 | ✅ 已修复 |
| `cPatch` 可进工程 | v1 类型仅为存量迁移保留;Validator 已报 `cpatch-forbidden`,9.5 emitter 已报 `E_CPATCH_FORBIDDEN`;9.4 emitter 仅保留历史兼容 | ◐ 已阻断普通入口 |
| 色彩预览固定 32bpp | `runtime/lv_conf.h:18` `LV_COLOR_DEPTH 32` | ✓ |
| runtime 构建不可复现 | `runtime/build.sh` 已参数化 emsdk/LVGL 路径,增加 v9.5.0 版本断言、显式失败与构建 manifest | ✅ 已修复 |

当前实际依赖图（2026-09-04 实施后）:

```
@lvd/schema → @lvd/compiler-core → @lvd/preview-compiler
                                      ↑
apps/designer ─────────────────────────┘
      ↓ PreviewProgram
@lvd/lvgl-runtime → LVGL 9.5 WASM (preview_host + preview_driver，无 XML)

旧 9.4 WASM 被显式加载时：apps/designer → @lvd/codegen.emitXml() → legacy bridge
```

方案 §3.2 的目标图:

```
@lvd/schema
    ↑             ↑                 ↑
validator   preview-compiler   codegen-lvgl95
                   ↑                 ↑
              lvgl-runtime       build worker
```

## 2. 评审结论:目标依赖图成立,但达成路径变了

方案把「抽出 `preview-compiler`,消除 Renderer → Codegen 依赖」当成一次**重构**(阶段 1),把 runtime 迁 9.5 当成另一次**移植**(阶段 2)。

阶段 0 的实测结论是:**这两件事在 9.5 上是同一件事**。

XML 是当前 Renderer → Codegen 依赖的**唯一成因**——Designer 需要 XML 字符串,而 XML emitter 住在 codegen 包里。9.5 没有 XML 通道,这条依赖没有对象可依赖了。因此:

> 去 XML 会自动完成 §3.2 要求的解耦。反过来,先做解耦再迁 9.5,等于把同一批文件改两遍。

**建议:把 runtime 去 XML 重写并入阶段 1,与 Schema v2 同期交付。**

## 3. 去 XML 后的预览通道设计

### 3.1 总体形态

```
LvProject (JSON, 业务事实源)
     │
     ├─ validator            (纯函数,不依赖 React/WASM/codegen)
     │
     └─ preview-compiler     JSON → PreviewIR (纯函数,可测)
              │
              │  结构化指令流(非字符串)
              ↓
        @lvd/lvgl-runtime    JS 侧:IR → 扁平化指令缓冲 → WASM
              ↓
        runtime bridge.c     指令 → LVGL C API
              ↓
        自建 lv_display + flush_cb → RGBA8888 → canvas
```

与 C Codegen 的关系:

```
              @lvd/schema  +  widget registry  +  compiler-core (纯 IR/lowering)
                    ↑                                    ↑
          preview-compiler                        codegen-lvgl95
```

二者共享 Schema、Registry 和 lowering 核心,**互不依赖**——满足 §3.2 全部约束。

### 3.2 指令集:lowering 表已经存在,就是 Widget Registry

> **修正**:阶段 0 报告最初写的是「`manifest.json` 可升格为 IR lowering 表」。复核 registry 类型后发现这个说法**说小了**——真正完整的映射在 registry 里,`manifest.json` 只是它在 XML 侧的镜像(且 `manifest-parity.test.ts` 已经在对账两者)。

`packages/schema/src/registryTypes.ts` 的 `PropSpec` 中,`c: { setter: string }` 是**必填**字段;`WidgetSpec.cCreate` 与 `ChildSpec.cCreate` 同理。也就是说 registry 对**全部 35 个 widget**(不只自研 13 个)都声明了完整的「属性 → C API」映射:

```ts
{ key: 'text', type: 'string', default: 'Text', channel: 'both',
  c: { setter: 'lv_label_set_text($obj, $v)' }, ... }
```

实测规模(`registry-lvgl95-parity.test.ts`):

| 项 | 数量 |
| --- | ---: |
| Widget | 35 |
| 属性(含 obj 基类 11 项与子元素) | 173 |
| 子元素规格(其中 virtual 3 个) | 18 |
| **去重后引用的 LVGL C 符号** | **197** |
| `channel: 'c-only'` 的属性 | 4 |

**这 197 个符号已全部实测存在于 LVGL 9.5.0**,且 9.4→9.5 之间一个都没消失(测试:`registry 声明的每一个 C 符号在 9.5.0 中都存在`)。这是「IR 直驱路径在 9.5 上走得通」的直接证据——不是从 runtime 侧统计反推的,而是拿 registry 声明要调用的每个符号去 9.5 头文件里逐个查。

于是 bridge 侧要分发的 API 面是明确的 **197 个符号**,不是一个开放集合。

三处需要特殊处理的形态(数量少且已定位):

| 形态 | 数量 | 说明 |
| --- | ---: | --- |
| `createProps`(构造实参) | 15 | setter 为空,由父级 `cCreate` 以 `$key` 消费,如 `lv_chart_add_series($parent, $color, $axis)` |
| `kind: 'virtual'` 子元素 | 3 | `chart-axis` / `table-column` / `table-cell`,不产生对象,createProps 是**寻址参数**,由兄弟属性的 setter 消费 |
| 需 emitter 特殊形态 | 1 | `lottie.src`:C 侧 `lv_lottie_set_src_data`(extern 数组),预览侧 `lv_lottie_set_src_file` |

这三类在 `registry-lvgl95-parity.test.ts` 里都有断言守着,IR 驱动器实现时不会漏。

**结论**:去 XML 的工作量估算可以进一步下调。parser 里真正的知识本就不在 parser 里,而在 registry;而 registry 也已验证与 9.5 兼容。要写的是 bridge 侧的分发器,面向一个已知的 197 符号集合。

### 3.3 分发器需求清单:模板 DSL 是封闭的

动手写「IR → LVGL C API」分发器之前必须先回答一个问题:**registry 的 C 模板 DSL 是封闭的吗?**开放集合意味着分发器永远写不完;封闭则实现是机械的。

实测结论:**封闭。407 个占位符,10 个语义类别,零未知**(测试:`c-template-dsl.test.ts`)。

语法层面只有两种形态:

```
$NAME                          402 处
$NAME:LV_ANIM_ON:LV_ANIM_OFF     5 处（三元，全部作用在 companion 上）
```

复杂度在 `NAME` 的语义上,分发器要实现的就是这张表:

| 类别 | 数量 | 分发器要做什么 |
| --- | ---: | --- |
| `obj` | 147 | 从节点 id 查对象句柄 |
| `value` | 138 | 按 `PropSpec.type` 做值编组 |
| `parent` | 61 | **IR 必须同时下发父句柄**,不能只带自身 |
| `sibling` | 23 | 从父元素的 `createProps` 上下文取寻址参数 |
| `peerProp` | 22 | **多个属性塌缩成一次调用**,须先聚合再发 |
| `companion` | 7 | 与主值一起下发;三元开关在此生效 |
| `listArray` | 3 | 分配数组并负责释放 |
| `loop` | 3 | 值是列表,按元素重复调用 |
| `listCount` | 2 | 与数组成对 |
| `objRef` | 1 | 值是另一节点的 id,解析为句柄 |

#### 四条非平凡形态(最容易漏的)

**① 多属性 → 一次 C 调用。**分发器不能「一个属性发一次调用」。全仓只有 3 组,已穷举:

```
spinner:     anim_duration + angle        → lv_spinner_set_anim_params($obj, $anim_duration, $angle)
imagebutton: src_released_{left,mid,right} → lv_imagebutton_set_src($obj, ..._RELEASED, ...)
imagebutton: src_pressed_{left,mid,right}  → lv_imagebutton_set_src($obj, ..._PRESSED, ...)
```

**② 值驱动循环。**只有 2 处:`buttonmatrix.ctrl_map`(`$idx` + `$ored` 逐项)、`chart-series.values`(`$each` 逐点 `lv_chart_set_next_value`)。

**③ 数组不一定带长度。**两种形态:

- 指针 + 长度:`animimage.srcs`、`line.points`
- **哨兵结尾**:`buttonmatrix.map` 用 `""` 结尾,C API 自己数长度

分发器**不能假设「数组必配 `$n`」**。

**④ `$v` 可在一个模板里重复出现。**当前只有 `qrcode.data`:

```c
lv_qrcode_update($obj, $v, lv_strlen($v))
```

按名字全量替换即可,但不能只替换首个。

#### 这份清单是怎么来的

写断言时我先按直觉分类,结果被数据否掉四次——`peerProp`(多属性共用调用)整类被我漏了,而「数组必带长度」「`$v` 只出现一次」两条则是我的臆断,registry 是对的。测试现在把这些形态**逐条钉住**,谁往 registry 写了新形态会立刻失败,而不是等到 runtime 静默少调一个 setter。

### 3.4 是否新建 `compiler-core`:先检查,再决定

方案 §11 末句要求:「是否新建 `compiler-core` 应先检查现有 `packages/codegen/src/ir` 可否无生成器依赖地搬出;不要为了目录整齐先拆包。」

**检查结论:可以搬,且没有任何生成器依赖。**

| 文件 | 行数 | 依赖 |
| --- | ---: | --- |
| `codegen/src/ir/types.ts` | 75 | 仅 `@lvd/schema`(类型) |
| `codegen/src/ir/normalize.ts` | 397 | 仅 `@lvd/schema` + 同包 `diagnostics.ts` |
| `codegen/src/diagnostics.ts` | 25 | **零依赖**(4 个字段的 interface) |

依赖方向已经是单向的:`emitters/* → ir/*`,`ir/*` 不 import 任何 emitter。

**实施状态（2026-09-04）**：该边界已落地。`ir/types.ts` 、`ir/normalize.ts` 和 `diagnostics.ts` 已搬入 `packages/compiler-core`，`@lvd/codegen` 只作向后兼容转发并依赖 `@lvd/compiler-core`。这次搬迁由 9.5 emitter 与后续 `preview-compiler` 共享 lowering 的实际需求触发，不是为了目录整齐。

所以:

- **已完成**：`@lvd/compiler-core` 只依赖 `@lvd/schema`；C94/C95 emitter 反向依赖 core。
- **已完成（2026-09-04）**：`@lvd/preview-compiler` 已直接依赖 core，生成不含 `xmlTag`/`cCreate`/setter 模板/`cPatch` 的 `PreviewProgram` POD 协议。
- **已完成（2026-09-04）**：runtime bridge 已消费 `PreviewProgram`，并以全量 preflight + 受控 ABI 覆盖首批 P0 控件、标量属性、flag/state 与常用 inline style。
- **已完成（2026-09-04）**：命名 style 已使用独立 `lv_style_t` 注册、属性设置、selector 挂载与安全 reset 生命周期；全局/屏幕重名和悬空引用会在 `begin` 前失败。
- **已完成（2026-09-04）**：Preview const 已支持 `int/px/color/string/percent`，按全局/屏幕作用域解析并在调用 C ABI 前转成标量；非法值、同作用域重名、悬空和目标类型不匹配均由 preflight 阻断。
- **已完成（2026-09-04）**：四类 subject 已建立独立生命周期；P0 已支持 `slider/bar/arc.value`、`obj/button/switch.checked`、`label.text` 和 int subject 的 flag/state 条件 binding。对象销毁后才 deinit subject，label format 在 TS/C 双层校验。
- **已完成（2026-09-04）**：callback、subject_set/toggle/increment、screen_load/create 五类 event action 已走受控 ABI；66 个 trigger、16 个 screen animation、subject/screen 引用及数值范围均由 preflight 校验，callback 向 JS 透传 event code/userData，清场时禁止自定义回调重入。
- **已完成（2026-09-04）**：结构子元素三种机制已有首个闭环切片：table-column/table-cell 走 virtual 专用 ABI，tabview-tab/tab_bar/tab_button 分别覆盖 add/getter，并允许现有 P0 Widget 放入 tab 容器；父子形态、构造参数、getter 顺序和 virtual 附加能力均由 preflight 校验。
- **已完成（2026-09-04）**：新增无 XML `preview_host.c`，CMake 按 9.5 PreviewProgram / 9.4 legacy XML 二选一构建；使用 LVGL v9.5.0 commit `85aa60d18b3d` 与 Emscripten 6.0.9 生成真实 WASM，30 个 Preview ABI 导出完整且旧 XML 热重载导出不存在。
- **已完成（2026-09-04）**：Designer 优先编译并加载 PreviewProgram，旧 WASM 自动走 XML 回退；生产构建与浏览器冒烟验证了 v1 colorDepth=16 工程空屏创建及 Palette 拖入 Button 后的事务重建。
- **下一步**：Chart、Menu、List 等其余结构随阶段 3 Widget 能力扩展；随后增加 typed 增量 patch，避免每次属性编辑全量重建。

`PreviewProgram` 协议包含 display/colorFormat、globals、screen/node 树、已补齐默认值的构造参数、typed props、style/binding/event 与 `runtimeName → nodeId` 映射。v1 `colorDepth=16` 不会被静默猜成 RGB565：未显式给出 `RGB565`/`RGB565_SWAPPED` 时，目标格式编译仍失败。Designer 可另传 `runtimeColorFormat=XRGB8888` 描述当前 SDL 预览 framebuffer；它不代表目标格式确认，也不进入发布 BuildTarget。

搬迁时有一处必须一并处理:`IRProject` 现在携带 v1 的 `DisplayConfig` 和 `CPatch`。v2 下前者变成 `DisplayProfile` 引用、后者被移除(见 `ui-schema.md` §1、§6),因此 IR 需要一个 v2 变体,不能原样复制。

顺带一个已存在的信号:`normalize.ts` 里给匿名节点起名的函数叫 `anonPreviewName`,导出注释写着「跨包契约」——这套 IR 从一开始就是双用途的,不是纯 C 生成的产物。

### 3.5 bridge.c 的改造边界

| 文件 | 行数 | 动作 |
| --- | ---: | --- |
| `bridge.c` | 584(其中 XML 相关 42 行) | 保留为显式 9.4 migration-only 构建，不进入 9.5 产物 |
| `preview_host.c` | 9.5 新增 | 生命周期、自建 display/Canvas flush/indev、快照、节点查找、素材注册和手动时钟，不含 XML/SDL |
| `bridge_hit.c` | 218 | **不动**(无 XML 依赖) |
| `bridge_log.c` | 27 | **不动** |
| `xml_parsers_extra/*.c` | 13 个,共 842 行 | 仅随 9.4 migration-only 模式编译；9.5 能力逐项进入 typed driver |
| `preview_driver.c` | 9.5 新增 | PreviewProgram 全量 preflight 后通过受控 ABI 直调 LVGL C API |

保留能力的关键 API 已确认在 9.5 存在(见 `lvgl-version-baseline.md` §2.6):`lv_obj_set_name` / `lv_obj_find_by_name` / `lv_display_get_screen_by_name` 支撑节点 ID ↔ 对象映射,`lv_snapshot_take` 支撑截图对拍。**因此去 XML 不损失热更新、命中测试和截图能力。**

### 3.6 与色彩格式改造合并

`lvgl-version-baseline.md` §4 要求的自建 display 已落地。`preview_host.c` 直接创建 `lv_display`，使用 64 行 partial draw buffer，并在 `flush_cb` 中按 stride 将 `RGB565`、`RGB565_SWAPPED`、`RGB888`、`XRGB8888`、`ARGB8888` 转换到 `Module.canvas`；Pointer/Wheel 事件直接投喂 LVGL pointer/encoder indev，PreviewProgram ABI 无需变化。实际形态为：

```c
int lvd_init(int32_t hor, int32_t ver, lv_color_format_t cf)
{
    lv_init();
    lvd_register_widget_drivers();          /* 原 lvd_register_extra_widgets */
    lvd_log_init();
    lvd_disp = lv_display_create(hor, ver);
    lv_display_set_color_format(lvd_disp, cf);
    lv_display_set_buffers(lvd_disp, buf, NULL, sz, LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_flush_cb(lvd_disp, lvd_flush_to_rgba);
    lvd_indev_init();                       /* 自建指针设备,取代 lv_sdl_mouse */
    return lvd_disp ? 0 : -1;
}
```

9.5 构建已删除 `--use-port=sdl2` 编译/链接标志和 `specialHTMLTargets` 导出；相关兼容代码仅在显式 `LVD_LEGACY_XML_BRIDGE=ON` 的 9.4 迁移构建中保留。

自建 `lv_indev` 还是方案 §6.1 的前提——「外壳、Canvas、Overlay 和指针使用同一变换矩阵」需要我方完全掌握指针坐标注入,SDL 的 DOM 监听器做不到。

### 3.7 `lv_obj_set_property` 的取舍

9.5 把 Property Interface 铺开到 26 个 widget(9.4 仅 12 个),提供 `lv_obj_property_get_id(obj, name)` + `lv_obj_set_property(obj, &prop)` 的按名驱动能力。

**建议:不作为主通道,仅作为兜底。**理由:

- 覆盖仍不全(我方 35 个 widget 中,arclabel、canvas、imagebutton、list、lottie、msgbox、tileview、win 无 property 文件)。
- 开启 `LV_USE_OBJ_PROPERTY` + `LV_USE_OBJ_PROPERTY_NAME` 会带入名字表,增加 WASM 体积;而我方 IR 已经是结构化的,不需要运行时按字符串查找。
- 直接调 setter 的类型安全和错误定位都更好,且与 C emitter 走同一张映射表。

保留它的价值在于:**为 registry 未登记的属性提供受控扩展点**,这比 `cPatch` 安全得多(见 §5)。

## 4. Schema v2 草案评审意见

对方案 §4 草案逐条评审。总体判断:**结构成立,可进入实现**,以下为修订意见。

### 4.1 同意并建议冻结的部分

- 四对象分层(`UiProject` / `DisplayProfile` / `ControllerProfile` / `BuildTarget`)。
- 单一事实源规则:不持久化 Controller 推导的 display 副本;`UiProject` 不重复保存目标 LVGL 版本。
- `id` / `displayName` / `codeName` 三职责分离,Theme Token 用语义 ID。
- `$token` 显式包装对象,类型必须匹配,不做静默回退。
- `visibleRect` 表达 TXW620002B0 类插黑屏;`InputProfile` 承载原始触摸校准。
- Validator 四层(结构 / 语义 / 目标能力 / 信任)。

### 4.2 需要修订的部分

**(a) `UiProject.schemaVersion` 与迁移链**

现状 `SCHEMA_VERSION = 1`,`MIGRATIONS` 为空数组(`packages/schema/src/migrations.ts:39`),框架已就位。v1 → v2 迁移器需处理:

| v1 字段 | v2 去向 |
| --- | --- |
| `meta.lvglVersion: '9.4'` | **删除**,移入 `BuildTarget.lvglVersion` |
| `display: { width, height, shape, colorDepth, dpi }` | 生成一个锁定的 `DisplayProfile`,`UiProject` 只留 `designDisplayRef` |
| `display.colorDepth: 16\|24\|32` | 映射到 `colorFormat` 语义枚举。**16 → `RGB565` 是有损猜测**(可能是 `RGB565_SWAPPED`),迁移器必须标记为「待人工确认」而非静默取默认值 |
| `WidgetNode.cPatch` | 见 §5 |

**(b) `colorFormat` 枚举必须与 LVGL 对齐**

方案 §4.3 只举了 `RGB565`。应限定为 LVGL 软件渲染器实际支持且我方 flush_cb 会实现的子集:

```
RGB565 | RGB565_SWAPPED | RGB888 | XRGB8888 | ARGB8888 | I1 | L8
```

Validator 需校验:所选格式在目标 `BuildTarget.lvglVersion` 的 capability pack 中被声明支持。

**(c) 移除 Schema 中的 XML 痕迹**

`xml-license-boundary.md` §3 要求「不得把 LVGL XML 的标签名/属性名/嵌套结构照搬为我方公开格式」。当前 registry 里 16 条 `notes` 直接引用 XML 语义,例如:

- `'9.4 XML parser 未实现,仅进 C 产物,画布不生效(角标提示)'`
- `'scatter X/Y 需新增 typed point-series property，普通工程不得用 cPatch 绕过'`
- `'9.4 XML 预览不生效；9.5 IR Preview/C 可直接调 setter'`
- `'高亮日期需新增 typed date-list property，普通工程不得用 cPatch 绕过'`
- `'无 accepted_chars/password_bullet(XML 未暴露)'`
- `'无 dir/max_height/selected_highlight(XML 未暴露)'`

这些约束是 **XML 通道的限制,不是 LVGL 的限制**。去 XML 后应逐条重新评估——多数属性可以直接暴露为 typed property。这既扩大能力,又消灭 `cPatch` 的存在理由(§5)。

**(d) `BuildTarget` 需要补 `colorFormat` 兼容校验规则**

方案 §4.4 要求 Validator 验证「UI 与 Controller 指向同一 `DisplayProfile`」。补充:还需验证 `DisplayProfile.colorFormat` ∈ `capabilityPack(BuildTarget.lvglVersion).supportedColorFormats`,否则发布构建会产出无法渲染的产物。

**(e) Components 闭环的前置条件**

`validate.ts:353-355` 目前非空即拒。方案把 Components 放在阶段 3。建议**不变**——但 D7 选定的迁移页面大量使用 `make_set_row()` 这类 helper(见 `PHASE0-REPORT.md` §D7),它们天然对应 Components。阶段 2 迁移时应把这些 helper **记录为 Components 需求输入**,而不是展开成重复节点后在阶段 3 再回收。

## 5. `cPatch` 信任隔离:结论强化

方案 §8 要求「Schema v2 普通工程不再允许 `WidgetNode.cPatch`,现有合法用途优先扩展 Widget Registry 的 typed property」。

阶段 0 发现了支持该结论的新证据:**`cPatch` 的现存用途,几乎全部是为绕开 XML 的表达限制**(§4.2c 引用的 registry notes)。去 XML 之后:

- calendar 高亮日期 → 直接调 `lv_calendar_set_highlighted_dates`,可建模为 typed property。
- chart scatter X 坐标 → 直接调 `lv_chart_set_value_by_id2`,可建模。
- arc `change_rate` / `knob_offset` → 已补为 `channel: 'c-only'` typed property,并通过 9.5 符号对账。

即:**去 XML 使「禁止 cPatch」从「削减能力」变成「不削减能力」**,阻力大幅降低。

进度:Validator 已拒绝普通 v1 工程/导入中的 `cPatch`;9.5 emitter 也会终止并返回 `E_CPATCH_FORBIDDEN`。v1 类型与 9.4 emitter 暂仅供存量迁移/受信兼容。arc 两项已补,calendar 日期列表与 chart X/Y 点集仍待建模。

## 6. 风险与未决项

| # | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| 1 | 去 XML 重写规模被低估 | 阶段 1 延期 | 边界已精确到文件与行(§3.3);`bridge_hit.c`/`bridge_log.c` 不动,parser 业务逻辑复用 `manifest.json` |
| 2 | 自写 flush_cb 的性能 | 预览帧率下降 | RGBA8888 直出时可零拷贝;仅 RGB565/RGB888 需转换,按脏区转换而非整屏 |
| 3 | 去 SDL 后键盘输入缺失 | keyboard widget 预览受影响 | 自建 `lv_indev` 时一并接 keypad;D7 选定页面含 `lv_keyboard`,阶段 2 必须验证 |
| 4 | 9.5 runtime 与浏览器链路 | 已由 Emscripten 6.0.9 真编译，并通过 P0、五格式与 pointer 点击冒烟；固件侧仍可能有差异 | 阶段 2 继续做发布 WASM、固件 simulator 与真机截图对拍 |
| 5 | v1→v2 `colorDepth 16` 的格式歧义 | 迁移后预览色彩错误 | 迁移器标记待确认,不静默取默认 |

## 7. 建议的阶段 1 交付清单(修订版)

在方案 §9 阶段 1 基础上调整:

1. ✅ **已交付** `DisplayProfile` / `ControllerProfile` / `BuildTarget` / Theme Token / Action Registry 类型 —— `packages/schema/src/v2/`,详见 `ui-schema.md`。
2. ✅ **已交付** 由单一 zod 模型生成 JSON Schema 与 fixtures —— `packages/schema/schema/`,生成与漂移检查合一(`pnpm --filter @lvd/schema test`)。
3. ✅ **已交付** schemaVersion 1 → 2 迁移器,含 §4.2a 的字段映射与 `colorDepth` 歧义标记(`color-format-ambiguous` 标为 must-confirm)。
   ⚠️ 尚未接入 `MIGRATIONS` 链 —— `SCHEMA_VERSION` 仍为 1,等评审通过。
4. 🟡 **部分交付** runtime 已增加 `preview_driver.c` 受控 ABI 和 PreviewProgram 全量 preflight 执行器，首批覆盖 P0 八控件创建、标量属性、flag/state、检查器 25 项常用 inline style+selector、同一属性集的独立 `lv_style_t` 命名样式、五种全局/屏幕 const、四类 subject、P0 prop/flag/state binding、callback/subject/screen 事件，以及 table/tabview 的 virtual/add/getter 结构切片；自建 display/flush/indev 与五种 colorFormat 已完成，剩余 Widget 结构随阶段 3 扩展。
5. 🟡 **部分交付** `@lvd/preview-compiler` 已生成 POD 协议并成为 Designer 9.5 主通道；旧 `@lvd/codegen.emitXml()` 与 `localEmitXml.ts` 仅作 9.4 runtime 迁移回退，待明确退场条件后删除。
6. 🟡 **部分交付** 普通工程 Validator 和 9.5 emitter 已禁止 `cPatch`;arc 两项已类型化,calendar/chart 待补。
7. ✅ **已交付** `runtime/build.sh` 已按固件 `build_web.sh` 模式重写(`LVGL_TAG` 默认 `v9.5.0`、`EMSDK_DIR` 可覆盖、缺失即失败、多源回退)。

**退出条件(修订)**:在方案原条件基础上增加——`apps/designer` 的 `package.json` 不含 `@lvd/codegen`;runtime 产物中不存在 `lv_xml_*` 符号;同一 JSON 在 `RGB565` 与 `XRGB8888` 两种 colorFormat 下均能渲染并截图。
