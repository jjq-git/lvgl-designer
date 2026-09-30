# 本机仓库屏幕盘点(2026-07-02)

> 这是固件仓库的历史硬件盘点，不再直接生成设计器设备预设。设计器及发布流程的
> 权威清单是 `ui.podsc.com/site/frames/manifest.json`；只有该清单已登记的型号与
> 分辨率才可作为一键预设，未登记分辨率的 frame 必须使用自定义逻辑尺寸。
> **重要更正:MX039(ST7102)圆屏是 480×480,不是曾经记忆中的 466×466**(依据 `wf2p_00d0_s3_mx039_st7102/main/board_st7102.h:78-79`、esp_lcd_st7102/README)。

## 去重后的「分辨率 + 形状」清单(进预设的)

| # | 分辨率 | 形状 | 屏型号 / 驱动IC | 代表项目 |
|---|---|---|---|---|
| 1 | 240×240 | 圆 | 微雪1.28″ / GC9A01 | WF2P-0050主板 |
| 2 | 480×480 | 圆 | 闽鑫 MX039505R40 (BOE INCELL) / ST7102 | wf2p_00d0_s3_mx039_st7102 |
| 3 | 480×480 | 方 | D395C930UV0(GC9503CV) / YDP395(ST7701S) / HD40010C40(ST7701S) | 多个 host + lingshi86 |
| 4 | 128×64 | 方 | 0.96″ OLED / SSD1306 | node_c3/c6、chip_tests 等 |
| 5 | 128×160 | 方 | 1.77″ TFT / ST7735S | s3_tft177_touch |
| 6 | 480×960 | 条 | TXW620002B0 6.2″ / ST7701SN(物理可视 360 列,左右各插黑 60) | txw_screen_bringup |
| 7 | 480×1920 | 条 | TXW880003S0 8.8″ / OTA7290B | host_p4_lcd_8x8 |
| 8 | 1024×600 | 方 | EK79007 7″ MIPI-DSI | p4_dic_cleaner |
| 9 | 720×1280 | 方 | ILI9881C MIPI-DSI(P4 6B) | host_p4_lcd |
| 10 | 720×1440 | 方 | HX8394 MIPI-DSI(P4 6A) | host_p4_lcd |

## 未进预设(存疑/未定型)

- txw700139_nv3052c_4b:目标 600×1424(H_RES=600 含单边插黑 320),工程暂停、未定型 → 用"自定义分辨率"即可
- wx_c6_epaper_3in7:UC8253 三色墨水屏,代码里没读到分辨率常量(典型 240×416,查手册确认)→ 非 LVGL 主战场
- host_s3_lcd:480×480 占位,屏 IC 待屏厂送样锁定

## 完整事实表

### WF2 静音舱 host(CHEN/products/wf2_quiet_pod/firmware/main/hosts/)

| 项目 | 面板+IC | 分辨率 | 形状 |
|---|---|---|---|
| wf2p_00d0_s3_mx039_st7102 | MX039505R40 + ST7102(触摸坐标系 480×854 经 touch_map 映射) | 480×480 | 圆 |
| wf2p_00d0_s3_ydp395_st7701 | YDP395BT003-V4 + ST7701S(FT6336U) | 480×480 | 方 |
| wf2p_00d0_s3_d395 | D395C930UV0 + GC9503CV(FT5436) | 480×480 | 方 |
| wf2p_00d0_s3_hd40010c40 | HSD040BPN1-A00 + ST7701S(GT911) | 480×480 | 方 |
| wx_esp32_s3_lcd_driver_board_dxwy / touch_lcd_4b_dxwy / lexin_host_s3_lcd_dxwy_ui | D395 + GC9503CV | 480×480 | 方 |
| host_p4_lcd | 6A: HX8394 720×1440 竖 / 6B: ILI9881C 720×1280 横(GT911) | 见左 | 方 |
| host_p4_lcd_8x8 | TXW880003S0 + OTA7290B | 480×1920 | 条 |
| host_s3_no_lcd | 可选 SSD1306 调试屏 | 128×64 | 方 |

### 其他

| 项目 | 面板+IC | 分辨率 | 形状 |
|---|---|---|---|
| ~/WF2P-0050主板/firmware | 微雪1.28″ GC9A01(可切 320×240) | 240×240 | 圆 |
| ~/lingshi86-firmware/主机_S3_ydp395 | YDP395B003-V4 + ST7701S | 480×480 | 方 |
| experiments/s3_lcd_driver_board_d395 | D395 + GC9503CV | 480×480 | 方 |
| experiments/txw_screen_bringup | TXW620002B0 + ST7701SN | 480×960(可视360列) | 条 |
| products/p4_dic_cleaner | EK79007(ILI2511 触摸) | 1024×600 | 方 |
| products/simple_boards/s3_tft177_touch | ST7735S(XPT2046) | 128×160 | 方 |
| chip_tests c3/c6 + node_c3/c6 + s3_pt100 | SSD1306 | 128×64 | 方 |
