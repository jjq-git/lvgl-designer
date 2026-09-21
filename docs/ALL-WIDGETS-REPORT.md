# ALL-WIDGETS REPORT — 35 控件全量上线(2026-07-02)

> **版本边界（2026-09-15 复核）**：以下原始清单和体积/线上数据记录的是 LVGL 9.4 XML 链路。
> 当前 LVGL 9.5 `PreviewProgram` 受控 driver 已覆盖 35 个面板控件及其结构子项；
> 真实 LVGL 9.5 WASM 的 `all-widgets-e2e.mjs` P0–P6 已通过逐项拖放、属性与素材编辑、
> 一屏组合、IndexedDB 刷新恢复、C ZIP 双配置 `-Wall -Wextra -Werror` 编译。
> 该浏览器测试记录 11 条缺少后端接口的预览服务基线 404，未发现新增控件错误；
> 本地全 workspace 单测 398 passed / 88 skipped，typecheck 和 build 通过；
> chart values 已改为完整校验后写入，animimage 换帧后再释放旧数组，并重编真 WASM 复测。
> 产品交付、部署节点编译与真机闭环仍以 `../docs/LVGL-UI-需求与实施方案.md` 为准。

> 任务 D 交付物。34 个控件 + obj(面板基类)全部在线:组件面板可拖、检查器可编、
> 画布真 LVGL 9.4 WASM 渲染、C 代码可导出并经 host gcc 双配置编译。
> **唯一排除:`lv_3dtexture`(GL-only,SDL software render 无法预览,一期不做)。**

## 0. 总览

| 项 | 值 |
|---|---|
| registry 总数 | 35(`ALL_WIDGETS` = 官方 parser 22 + 自研 parser 13) |
| 组件面板 | 6 分类:基础 / 输入 / 显示 / 容器 / 图表 / 多媒体,共 35 项 |
| 预览运行时 | `packages/lvgl-runtime/dist/lvgl_runtime.wasm`(1,622,755 B;本次补 `LV_USE_QRCODE=1` 重编) |
| e2e（历史 9.4） | `apps/designer/e2e/all-widgets-e2e.mjs` P0~P6 全绿,全程 0 console error；9.5 复测另见顶部版本边界 |
| 线上 | http://localhost:8318 (server-ai.mjs 静态托管 dist,HTTP 200 实测) |

## 1. 控件清单(来源 / 属性 / 子元素覆盖)

属性列 = registry 专有属性(所有控件另继承 OBJ_BASE:x/y/width/height/align/flex/pad、
25 flags、8 states、style_* 内联样式、事件、bind_*)。`(仅C)` = channel:'c-only',
检查器带黄色「仅C」角标,XML 预览跳过、C 照发。

| type | 面板名 | parser 来源 | 分类 | 专有属性数 | 专有属性 | 结构子元素 |
|---|---|---|---|---|---|---|
| `obj` | 面板 | 官方 | 容器 | 0 | — | — |
| `label` | 标签 | 官方 | 基础 | 3 | text long_mode translation_tag | — |
| `button` | 按钮 | 官方 | 基础 | 0 | — | — |
| `slider` | 滑条 | 官方 | 输入 | 6 | min_value max_value value start_value orientation mode | — |
| `switch` | 开关 | 官方 | 输入 | 1 | orientation | — |
| `checkbox` | 复选框 | 官方 | 输入 | 1 | text | — |
| `bar` | 进度条 | 官方 | 显示 | 6 | value start_value min_value max_value orientation mode | — |
| `arc` | 弧形 | 官方 | 输入 | 9 | start_angle end_angle bg_start_angle bg_end_angle rotation value min_value max_value mode | — |
| `image` | 图片 | 官方 | 多媒体 | 7 | src inner_align rotation scale_x scale_y pivot_x pivot_y | — |
| `dropdown` | 下拉框 | 官方 | 输入 | 4 | options text selected symbol | dropdown-list[getter] |
| `roller` | 滚轮 | 官方 | 输入 | 3 | selected visible_row_count options | — |
| `textarea` | 文本框 | 官方 | 输入 | 8 | text placeholder_text one_line password_mode password_show_time text_selection cursor_pos max_length(仅C) | — |
| `spinbox` | 数字框 | 官方 | 输入 | 7 | value rollover digit_count dec_point_pos min_value max_value step | — |
| `qrcode` | 二维码 | 官方 | 显示 | 5 | size dark_color light_color data quiet_zone | — |
| `scale` | 刻度尺 | 官方 | 显示 | 10 | mode total_tick_count major_tick_every label_show post_draw draw_ticks_on_top min_value max_value angle_range rotation | — |
| `buttonmatrix` | 按钮矩阵 | 官方 | 输入 | 4 | map ctrl_map selected_button one_checked | — |
| `calendar` | 日历 | 官方 | 显示 | 5 | today_year today_month today_day shown_year shown_month | header_arrow[add] header_dropdown[add] |
| `chart` | 图表 | 官方 | 图表 | 5 | type point_count update_mode hor_div_line_count ver_div_line_count | series[add: color/axis + values] cursor[add: color/dir + pos_x/pos_y] axis[virtual: axis + min/max_value] |
| `keyboard` | 键盘 | 官方 | 输入 | 3 | mode popovers textarea(仅C) | — |
| `spangroup` | 富文本 | 官方 | 基础 | 3 | overflow max_lines indent | span[add: text/style/bind_text] |
| `table` | 表格 | 官方 | 显示 | 2 | column_count row_count | column[virtual: column + width] cell[virtual: row/column + value/ctrl] |
| `tabview` | 标签页 | 官方 | 容器 | 2 | active tab_bar_position | tab[add: text,容器] tab_bar[getter] tab_button[getter: index] |
| `led` | LED | 自研 | 显示 | 2 | color brightness | — |
| `line` | 折线 | 自研 | 基础 | 2 | points y_invert | — |
| `spinner` | 加载圈 | 自研 | 显示 | 2 | anim_duration angle | — |
| `imagebutton` | 图片按钮 | 自研 | 输入 | 7 | src_released_left/mid/right src_pressed_left/mid/right state | — |
| `animimage` | 动画图片 | 自研 | 多媒体 | 3 | srcs duration repeat_count | — |
| `msgbox` | 消息框 | 自研 | 容器 | 3 | title text close_button | button[add: text](footer) |
| `list` | 列表 | 自研 | 容器 | 0 | — | text[add: text] button[add: icon/text] |
| `menu` | 菜单 | 自研 | 容器 | 2 | mode_header mode_root_back_button | page[add: title,容器] |
| `win` | 窗口 | 自研 | 容器 | 1 | title | button[add: icon/width](header) |
| `tileview` | 平铺视图 | 自研 | 容器 | 0 | — | tile[add: col/row/dir,容器] |
| `arclabel` | 弧形文本 | 自研 | 基础 | 11 | text angle_start angle_size offset dir recolor radius center_offset_x/y text_vertical/horizontal_align | — |
| `canvas` | 画布 | 自研 | 多媒体 | 1 | fill_color | — |
| `lottie` | Lottie 动画 | 自研 | 多媒体 | 1 | src | — |

自研 13 个的唯一事实源 = `runtime/src/xml_parsers_extra/manifest.json`
(registry 由 `packages/schema/src/__tests__/manifest-parity.test.ts` 双向对账)。

## 2. 素材管理面板(新)

左栏顶部新增「组件 / 素材」tab(`apps/designer/src/panels/AssetPanel.tsx`):

- **上传**:png / jpg → `kind:'image'`;lottie `.json` → `kind:'lottie'`(`ImageAsset.kind` 为本次新增可选字段)。
- **存储**:字节按 **sha256 内容寻址**进 IndexedDB `lvgl-designer/assets` 表(DB v1→v2,`services/storage.ts`);
  工程 `.lvproj.json` 只存 `{name, file:{fileName,sha256,byteSize}, kind, conv}`。
- **runtime 注册**:`writeFile('/assets/<name>.<ext>')` + `registerImage(name, 'A:assets/<name>.<ext>')`;
  lottie 注册值即 MEMFS 路径,自研 `lv_lottie` parser 经 `lv_xml_get_image` 解析后 `set_src_file`。
- **刷新自动重灌**:启动管线(CanvasStage boot)在首次 `reloadAll` 前同步注册全部素材;
  恢复工程 / 打开 `.lvproj.json` 后走 `resyncAssets()`(等管线就绪 → 注册 → reloadAll)。
  e2e P6 实测:刷新后 image 中心像素仍为素材色。
- **检查器联动**:所有 `imageRef` 属性(image.src、imagebutton 六段、list/win 的 icon、lottie.src)
  变成带缩略图的素材下拉(`AssetPicker`,lottie 属性只列 lottie 素材);
  `animimage.srcs` 为素材多选(勾选顺序 = 帧序)。

## 3. 子元素编辑器(检查器「内容/子项」,ChildSpec 驱动)

通用机制(`Inspector.tsx` `ChildrenSection`):凡 `WidgetSpec.children` 非空即出现该分组,
按 ChildSpec 生成「+ 添加」按钮(`kind:'getter'` 不提供添加),每个实例可展开编辑
createProps + props(与普通属性同一套 ValueEditor)、可删除;容器型子元素
(tabview-tab / tileview-tile / menu-page)可继续从组件面板拖控件进画布落点
(`PointerDnd.ascendToContainer` 已支持结构子元素作 drop 目标)。

专用增强:

- **chart**:系列(颜色/轴/values 文本框,空格分隔整数)、游标、轴范围;
- **tabview**:页签增删改名、◉ 设为当前页(写 `active`)、tab 内拖入控件(e2e 实测 button 落入 tab);
- **table**:行列数(值属性)+ 单元格网格编辑(直接打字,空=删格;显示上限 16×8);
- **buttonmatrix**:map 多行文本框(每行一排,`|` 分隔同排按钮,换行=新排)↔ `['A','B','\n','C']`;
- **msgbox / list / win / menu / tileview**:子项列表增删 + 参数编辑;
- **line**:points 文本编辑(`x1,y1 x2,y2` ↔ 平铺 int 数组);
- **animimage**:帧序列素材多选。

选中树中的结构子元素节点时,检查器按 `findChildSpec` 渲染其 createProps/props;
非 obj 系子元素(chart-series 等)自动隐藏 name/flags/states。

## 4. e2e 判定(`apps/designer/e2e/all-widgets-e2e.mjs`,全绿)

| 阶段 | 判定 | 结果 |
|---|---|---|
| P0 | 组件面板 6 分类 / 35 项齐全 | PASS |
| P1 | 上传 2 png + 1 lottie json → 工程 assets 3 条 + 缩略图 2 张 | PASS |
| P2 | **35 项(34 控件 + obj)逐个鼠标拖上画布**:模型入树 + 零新增 console error + canvas snapshot 变化(每控件截图 `p2-<type>.png`) | PASS ×35 |
| P3.1 | chart UI 加 2 系列 + values=[10,40,30,80,60],snapshot 变化 | PASS |
| P3.2 | tabview UI 加页签改名 tab_a + 拖 button 落入 tab 容器 | PASS |
| P3.3 | table 2×2 + 单元格 (0,0)=A1 (1,1)=B2 | PASS |
| P3.4 | buttonmatrix map=`['OK','Cancel','\n','Yes']` | PASS |
| P3.5 | msgbox/list/win/menu/tileview 各加子项(list 加 text+button) | PASS |
| P3.6 | image 经素材选择器设 src、line points、animimage 双帧多选、lottie 设 json 且零 error | PASS |
| P4 | 导出 zip(main.c 含 add_series/add_tab/set_cell_value/set_map/… 15 个关键调用)→ 解包 `e2e/out-ui-all/` → **host gcc `-Wall -Wextra -Werror`,LV_USE_OBJ_NAME=1/0 双配置 12 个 .o 全 0 error** | PASS |
| P5 | 全家福:一屏 12 控件(`family-canvas.png` / `family-page-full.png`) | PASS |
| P6 | 刷新页面:工程 + 素材(IndexedDB sha256)自动重灌,image 中心像素仍为素材蓝色 | PASS |
| 回归 | 旧 `e2e/run-e2e.mjs`(E1~E7)、`e2e/ai-e2e.mjs`(A1~A5)全绿;schema 144 / codegen 34 / designer 56 / lvgl-runtime 13 单测全过;`scripts/compile-smoke.sh` 326/326 | PASS |

截图目录:`apps/designer/e2e/artifacts-all/`(含 `live-8318.png` 线上实拍)。

## 5. 已知限制

1. **`3dtexture` 排除**:`lv_3dtexture` 仅 OpenGL 驱动可用,WASM 预览走 SDL software
   render 无 GL 上下文,预览通道无法成像 → 一期整体排除(registry/面板均无)。
2. **imagebutton 仅两态**:只暴露 RELEASED / PRESSED 两态(各左/中/右三段);
   DISABLED / CHECKED_* 四态待补 typed state property，普通工程不得用 `cPatch` 绕过。
3. **keyboard.textarea 仅 C**:官方 parser 里该属性被注释,预览不生效(黄角标);
   C 侧要求目标 textarea 已命名、同 screen 且先于键盘创建。
4. **chart scatter 无 X 值**:series 仅 values → `set_next_value`,散点图 X/Y 待 typed point-series property。
5. **tabview 的 tab_bar / tab_button(getter 型)**:emitter/校验支持,检查器不提供添加 UI(样式化场景少,可手改 JSON)。
6. **table 网格编辑显示上限 16×8**,更大表格待批量单元格编辑/导入;buttonmatrix map 经官方 parser 解析缓冲 512 字节,超长截断。
7. **menu 简化模型**:menu + pages,无 sidebar/section;win 的普通子控件落在 win 对象上(不进 content 区)。
8. **arclabel 角度按 int**(底层 float);**canvas / lottie 的 width/height 只认纯 px**(决定绘制缓冲,默认 100×100)。
9. **lottie 依赖**:`LV_USE_LOTTIE + LV_USE_THORVG_INTERNAL + LV_USE_VECTOR_GRAPHIC + LV_USE_MATRIX`(已开);
   C 导出走 `lv_lottie_set_src_data` + `extern lottie_<name>[]` 符号约定(数组内容需用户 `xxd -i` 自备)。
10. **素材导出**:C 侧 `images.h` 只发 `extern const lv_image_dsc_t img_<name>;` 声明,
    像素 C 数组生成(asset-pipeline `imageEncodeV9`)是后续任务;编译(不链接)已验证通过。
11. **qrcode 曾缺席 WASM**:`LV_USE_QRCODE` 默认 0,此前 runtime 未开(画布上从未真渲染过)。
    本次在 `runtime/lv_conf.h` 补开并重编(wasm 1,611,718 → 1,622,755 B),e2e 实测渲染正常。

## 5.1 本次修掉的两个存量 bug

- **L1 热重载属性顺序**:`reloadPipeline.applyL1` 原按 patch 顺序发 attrs,而部分官方
  apply_cb 有属性间顺序依赖(qrcode 必须 `size` 先于 `data` 分配 canvas 缓冲,否则
  `set_data` 落空 + 后到的 `set_size` 清缓冲 → 白块)。已改为按 registry 描述表顺序发
  (与 XML emit 同序),e2e 像素级验证 QR 图案渲染(family-canvas.png)。
- **AI 单测过期数据**:`applyOps.test` 用 `spinner` 当"未知控件"(M3 后已合法)→ 改用
  确定不存在的类型;promptBuilder registry 文档快照随 35 控件更新。

## 6. 本次改动文件(要点)

- `packages/schema`:`registryTypes.ts`(PaletteCategory +chart/media)、`project.ts`(ImageAsset.kind)、
  `widgets/*`(chart→图表、image/animimage/canvas/lottie→多媒体)、`widgets/index.ts`(paletteEntries 6 类)
- `apps/designer`:`panels/AssetPanel.tsx`(新)、`panels/AssetPicker.tsx`(新)、`services/assets.ts`(新)、
  `services/storage.ts`(IndexedDB v2 assets 表)、`panels/Inspector.tsx`(子元素编辑器/素材选择器/列表类值编辑/仅C角标)、
  `canvas/PointerDnd.ts`(结构子元素 drop 目标)、`canvas/CanvasStage.tsx`(启动素材重灌)、
  `App.tsx`(左栏 tab)、`panels/WidgetPalette.tsx`(6 分类 + 20 新图标)、`panels/ObjectTree.tsx`(子元素类型名)、`styles.css`
- `runtime/lv_conf.h`:`LV_USE_QRCODE 1`(+ build.sh 重编 → `packages/lvgl-runtime/dist/`)
- e2e:`apps/designer/e2e/all-widgets-e2e.mjs`(新);AI 单测两处过期数据修正
  (`spinner` 已非未知类型 → 改 `holo_display`;registry 文档快照更新)
