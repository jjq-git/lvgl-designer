/**
 * @file bridge_log.c
 * LVGL log hook -> JS error channel (design/02 §2.10).
 *
 * XML parse failures have no error struct in LVGL 9.4; the only channel is
 * lv_log_register_print_cb(). Every WARN/ERROR line is forwarded verbatim to
 * Module.__lvLogSink(level, msg); the JS wrapper collects lines around each
 * bridge call and aggregates them into LvglError on failure (expat line
 * numbers are inside the message text).
 */
#include <emscripten.h>
#include "lvgl.h"
#include "bridge_internal.h"

EM_JS(void, lvd_js_on_lv_log, (int level, const char * msg), {
    if(Module.__lvLogSink) Module.__lvLogSink(level, UTF8ToString(msg));
});

static void lvd_log_cb(lv_log_level_t level, const char * buf)
{
    lvd_js_on_lv_log((int)level, buf);
}

void lvd_log_init(void)
{
    lv_log_register_print_cb(lvd_log_cb);
}
