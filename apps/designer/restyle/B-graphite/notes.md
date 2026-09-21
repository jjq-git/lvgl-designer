# 方案 B「Apple Pro 石墨暗色」— 设计笔记

产物:`restyle/B-graphite/styles.css`(可直接整文件替换 `src/styles.css`,未动本体)。
截图验证:`restyle/B-graphite/shots/1~7*.png`(vite preview + Playwright 拦截 CSS 请求注入本方案实拍,
未改任何源码;覆盖默认视图/圆屏选中/样式页/flags/右键菜单/运行态/自定义分辨率+focus 环)。

## 设计要点(5 条)

1. **三级石墨灰台阶 + 更深的舞台**:页面 #161617 → 面板 #1d1d1f → 控件 #2c2c2e,
   `.stage` 降到 #0e0e0f 素色加极淡径向提亮;LVGL 画布用「hairline 描边 + 双层黑影 +
   140px 蓝晕」当发光主角,取代原棋盘格。
2. **胶囊按钮 + 磨砂浮层**:全部 `.btn` 圆角 999px,primary 用 #0071e3 实心白字;
   工具条 rgba(29,29,31,.72)+`saturate(180%) blur(20px)`;右键菜单/拖拽幽灵同套磨砂
   (macOS 菜单质感,hover 行填 accent 蓝)。
3. **hairline 体系**:所有边框统一 rgba(255,255,255,.08)(强调 .14),阴影只留
   0 1px 3px 级别;检查器 tabs 从下划线改成 iOS 分段控件(active = 抬升灰块 + 内描边)。
4. **SVG overlay 精修只靠 CSS 覆盖 presentation attribute**:选择框/手柄/hover 虚线/落点
   高亮统一 #2997ff 系,圆屏遮罩 fill 加深到 rgba(9,9,10,.88) 使裁掉的角沉进舞台;
   **stroke-width 一律不碰**(JSX 里按 1/zoom 反补偿,CSS 覆盖会破坏缩放补偿)。
5. **可用性不倒退**:字号保持 13px 信息密度、prop-row label 仍 84px;次级文字 #a1a1a6
   (#1d1d1f 上 ≈6.5:1,超 4.5:1 红线);`:focus-visible` 全局 2px 蓝环、输入框 focus
   有 3px 光晕;`color-scheme: dark` + `accent-color` 让原生 select/checkbox/滚动条入调;
   按钮 padding 只增不减,disabled 保持 opacity .4 可辨。

## 最不确定的 2 个风险点

1. **overlay 结构选择器偏脆**:`.overlay g > rect:first-of-type`(选择框)、
   `.overlay > rect:not([stroke-dasharray])`(落点高亮)依赖 Overlay.tsx 当前的
   DOM 顺序和属性写法——将来 Overlay 加一种新图元或调整 rect 顺序,这些精修会
   错着色(功能不坏,JSX 属性色仍兜底,但可能出现旧蓝 #4aa8ff 混色)。
2. **磨砂玻璃的实际收益与代价**:工具条在布局流内、背后无滚动内容,blur 视觉上
   近似实色,真正吃 backdrop-filter 的是右键菜单/拖拽幽灵;低端核显 + 大画布 WASM
   逐帧渲染时,fixed 浮层的 backdrop-filter 可能引入合成开销(拖拽幽灵是跟手元素,
   最敏感)。若拖拽掉帧,把 `.dnd-ghost` 的 backdrop-filter 去掉即可,不影响观感大局。

## 自查记录

- 选择器覆盖:脚本比对原 `styles.css.bak-dark` 87 个选择器,**全部存在**(新文件 132 个)。
- 语法:esbuild CSS parse OK,0 warnings。
- 兼容:保留旧变量名 `--bg/--bg2/--bg3/--border/--fg/--fg-dim/--accent/--danger`,
  并补定义 `--text-dim`(`.custom-size` 原本引用了这个未定义变量)。
