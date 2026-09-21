# 方案 C「duotone」— 设计要点与风险

产物:`styles.css`(可直接整文件替换 `src/styles.css`,零 TSX 改动)。
已实测:vite preview + Playwright 真渲染(WASM 运行时就绪),浏览器引擎解析 124/124 条规则无丢弃;
原 87 个选择器全部逐一覆盖(脚本比对通过)。截图:`preview-full.png` / `preview-states.png`。

## 设计要点(5)

1. **双色分区**:操作区(工具条/左右面板)走苹果亮灰系 —— `#f5f5f7` 面板、白卡片、
   `rgba(255,255,255,.78) + backdrop-filter saturate(180%) blur(20px)` 磨砂工具条、全站 hairline
   (`rgba(0,0,0,.10)`);舞台 `#1a1a1c` 素色 + 内凹 hairline + 轻内阴影,LVGL 画布加 1px 白
   hairline + 48px 环境辉光 —— 暗场里"点亮的真机屏"。
2. **苹果控件语言**:胶囊按钮(白底 hairline + `0 1px 3px` 阴影,primary `#0071e3`)、选中行
   Finder 式 accent 填充白字、右键菜单/拖拽幽灵为玻璃浮层(blur + 大圆角 + 弹层阴影)、
   圆角 6/8/12 三档、过渡 0.15–0.2s ease、细滚动条(10px 轨 + 4px 视觉厚度胶囊拇指)。
3. **暗舞台编辑辅助重调(纯 CSS 覆写 SVG 呈现属性)**:选择框/手柄描边 `#2997ff`、
   参考线 `#ff375f`、hover 虚线亮蓝;只覆写颜色,**不碰**按 1/zoom 反补偿的 stroke-width。
4. **圆屏遮罩同色合成**:`.overlay path { fill: rgba(26,26,28,.88) }` 与 `--stage-bg` 同色 ——
   遮罩 path 在 DOM 里向画布外扩 1×w/h,同色高透明度合成后外溢区与舞台无缝;
   非同色会在暗场上留一块硬边方块(初版实测踩到,已修)。
5. **可用性红线全守住**:小字号全部 ≥4.5:1(`--fg-dim #6e6e73` on `#f5f5f7` = 4.66:1;
   属性标签 set/unset 用 `#3d3d40`/`#6e6e73` 两级、放弃原 opacity 降透明做法)、按钮/行命中区
   只增不减、`:focus-visible` 全局 2px 焦点环 + 输入框 accent 光晕、disabled 0.45 + 去阴影、
   补了原版缺失的 `.icon-btn:disabled`(屏幕删除钮单屏时禁用态原先不可辨)。

信息密度:行高/内边距基本保持原值(prop-row 2px、tree-row 3px 不变),仅工具条与分组标题
加 2px 呼吸;工具条预设下拉从 flex:1 收成 `max-width:280px`,不再吃掉 spacer。

## 最不确定的 2 个风险点

1. **CSS 深入内联 SVG 的耦合**:overlay 颜色覆写靠属性选择器
   (`rect[data-handle]`、`> rect[stroke-dasharray]`、`g > rect:not(...)`),遮罩消隐靠
   "fill == --stage-bg" 的同色约定。Overlay.tsx 结构/属性一变,或有人只改 `--stage-bg`
   不改 `.overlay path` 的 fill,覆写会静默失效(降级回内联属性色,暗底仍可见,但圆屏
   遮罩外溢方块会回来)。已在 CSS 内注释标明,但这是隐性契约。
2. **Windows 真机字体与窄窗观感未验**:实测环境是 WSL Chromium,SF Pro / PingFang 不在场,
   走的是 fallback;用户 Windows 上会落到微软雅黑,11px 大写字距标题和 12.5px 按钮字在雅黑
   下可能偏挤/偏重。另外两处 flex 行为有意改动(预设下拉不再撑满、`ed-size-mode` 固定 76px
   ——原文件该规则实际被 `select.ed-select` 的 flex:1 压掉,我按原意图恢复),窄窗口 +
   自定义分辨率输入组同时展开时的换行形态与旧版不同,未逐档宽度验证。
