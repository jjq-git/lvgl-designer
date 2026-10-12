# 静音舱六规格差异化 UI

本目录包含六套可直接导入 LVGL Designer 的工程。每个规格采用独立首页功能、视觉主题与版式，同时保留对应设备规格和外壳信息。

| 屏幕规格 | 工程文件 | 首页重点 | 主题 |
|---|---|---|---|
| WF2D-8620 · 240×240 圆屏 | `WF2D-8620-quiet-focus.lvproj.json` | 25 分钟专注计时 | 午夜紫罗兰 |
| WF2D-8630 · 480×480 方屏 | `WF2D-8630-quiet-acoustics.lvproj.json` | 实时声压与主动降噪 | 冰川声场 |
| WF2D-1050 · 1024×600 横屏 | `WF2D-1050-quiet-lighting.lvproj.json` | 色温、亮度和灯光场景 | 琥珀光域 |
| WF2D-1040 · 1080×720 横屏 | `WF2D-1040-quiet-air.lvproj.json` | CO₂、温湿度与新风 | 生态薄荷 |
| WF2D-1030 · 1440×720 超宽屏 | `WF2D-1030-quiet-booking.lvproj.json` | 舱位预约与当日日程 | 珊瑚日程 |
| WF3 · 284×76 条形屏 | `WF3-284x76-quiet-dnd.lvproj.json` | 一键勿扰与静音计时 | 信号红黑 |

在设计器左上角点击“打开”，选择对应的 `.lvproj.json` 文件即可预览和继续编辑。

重新生成：

```powershell
node scripts/generate-six-quiet-pod-themes.mjs
```
