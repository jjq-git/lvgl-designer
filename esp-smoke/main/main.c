/* esp-smoke: link-level smoke test for lvgl-web-designer exported C (R milestone).
 * lv_init + headless dummy display (no real panel), then ui_init(). */
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lvgl.h"
#include "ui.h"

#define HOR_RES 240
#define VER_RES 240
#define BUF_LINES 20

static void dummy_flush_cb(lv_display_t *disp, const lv_area_t *area, uint8_t *px_map)
{
    (void)area;
    (void)px_map;
    lv_display_flush_ready(disp); /* headless: discard pixels */
}

void app_main(void)
{
    printf("FW_FINGERPRINT: id=" __DATE__ "_" __TIME__ "\n");

    lv_init();

    static uint8_t buf[HOR_RES * BUF_LINES * 2]; /* RGB565 partial buffer */
    lv_display_t *disp = lv_display_create(HOR_RES, VER_RES);
    lv_display_set_color_format(disp, LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(disp, buf, NULL, sizeof(buf), LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_flush_cb(disp, dummy_flush_cb);

    ui_init();
    printf("ui_init done, active screen=%p\n", (void *)lv_screen_active());

    for (;;) {
        uint32_t wait_ms = lv_timer_handler();
        if (wait_ms == LV_NO_TIMER_READY) wait_ms = 100;
        vTaskDelay(pdMS_TO_TICKS(wait_ms ? wait_ms : 1));
    }
}
