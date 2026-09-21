/**
 * @file preview_host.c
 * LVGL 9.5 browser host for the no-XML PreviewProgram driver.
 *
 * This unit deliberately contains only display/input lifecycle, design-time
 * inspection, assets and deterministic ticking. Project construction lives in
 * preview_driver.c and crosses the WASM boundary through a typed ABI.
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

#include "lvgl.h"
#include "src/misc/cache/instance/lv_image_cache.h"
#include "bridge_internal.h"

lv_display_t * lvd_disp = NULL;

typedef struct lvd_img_rec {
    char * name;
    char * path;
    struct lvd_img_rec * next;
} lvd_img_rec_t;

typedef struct lvd_font_rec {
    char * name;
    lv_font_t * font;
    uint8_t * data;
    struct lvd_font_rec * next;
} lvd_font_rec_t;

static lvd_img_rec_t * g_imgs = NULL;
static lvd_font_rec_t * g_fonts = NULL;
static lv_draw_buf_t * g_snap = NULL;
static uint32_t g_manual_ms = 0;
static void * g_draw_buf = NULL;
static lv_color_format_t g_color_format = LV_COLOR_FORMAT_XRGB8888;

EM_JS(uint32_t, lvd_wall_ms, (), {
    return Math.floor(performance.now()) >>> 0;
});

EM_JS(int, lvd_canvas_resize, (int32_t width, int32_t height), {
    const canvas = Module.canvas;
    if(!canvas) return -1;
    if(canvas.width !== width) canvas.width = width;
    if(canvas.height !== height) canvas.height = height;
    return 0;
});

EM_JS(void, lvd_canvas_flush, (int32_t x, int32_t y, int32_t width, int32_t height,
                               const uint8_t * pixels, uint32_t stride, int color_format), {
    const canvas = Module.canvas;
    if(!canvas || width <= 0 || height <= 0) return;
    const ctx = canvas.getContext('2d');
    const rgba = new Uint8ClampedArray(width * height * 4);
    let dst = 0;
    for(let row = 0; row < height; row++) {
        let src = pixels + row * stride;
        for(let col = 0; col < width; col++) {
            let r, g, b, a = 255;
            if(color_format === 0x12 || color_format === 0x1b) {
                const byte0 = HEAPU8[src];
                const byte1 = HEAPU8[src + 1];
                const value = color_format === 0x12
                    ? byte0 | (byte1 << 8)
                    : byte1 | (byte0 << 8);
                r = ((value >> 11) & 0x1f) * 255 / 31;
                g = ((value >> 5) & 0x3f) * 255 / 63;
                b = (value & 0x1f) * 255 / 31;
                src += 2;
            }
            else if(color_format === 0x0f) {
                b = HEAPU8[src];
                g = HEAPU8[src + 1];
                r = HEAPU8[src + 2];
                src += 3;
            }
            else {
                b = HEAPU8[src];
                g = HEAPU8[src + 1];
                r = HEAPU8[src + 2];
                if(color_format === 0x10) a = HEAPU8[src + 3];
                src += 4;
            }
            rgba[dst++] = r;
            rgba[dst++] = g;
            rgba[dst++] = b;
            rgba[dst++] = a;
        }
    }
    ctx.putImageData(new ImageData(rgba, width, height), x, y);
});

EM_JS(void, lvd_canvas_input_init, (), {
    const canvas = Module.canvas;
    if(!canvas) return;
    if(canvas.__lvdInputCleanup) canvas.__lvdInputCleanup();
    const state = { x: 0, y: 0, down: 0, wheel: 0, middle: 0 };
    Module.__lvdInputState = state;
    const updatePoint = (event) => {
        const rect = canvas.getBoundingClientRect();
        if(rect.width <= 0 || rect.height <= 0) return;
        state.x = Math.max(0, Math.min(canvas.width - 1,
            Math.round((event.clientX - rect.left) * canvas.width / rect.width)));
        state.y = Math.max(0, Math.min(canvas.height - 1,
            Math.round((event.clientY - rect.top) * canvas.height / rect.height)));
    };
    const onPointerDown = (event) => {
        updatePoint(event);
        if(event.button === 0) state.down = 1;
        if(event.button === 1) state.middle = 1;
        if(canvas.setPointerCapture) {
            try { canvas.setPointerCapture(event.pointerId); }
            catch(_) { /* Synthetic tests and older browsers may not own this pointer. */ }
        }
    };
    const onPointerMove = (event) => updatePoint(event);
    const onPointerUp = (event) => {
        updatePoint(event);
        if(event.button === 0) state.down = 0;
        if(event.button === 1) state.middle = 0;
    };
    const onPointerCancel = () => { state.down = 0; state.middle = 0; };
    const onWheel = (event) => {
        state.wheel += event.deltaY < 0 ? -1 : event.deltaY > 0 ? 1 : 0;
        event.preventDefault();
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('lostpointercapture', onPointerCancel);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.__lvdInputCleanup = () => {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerCancel);
        canvas.removeEventListener('lostpointercapture', onPointerCancel);
        canvas.removeEventListener('wheel', onWheel);
        delete canvas.__lvdInputCleanup;
        delete Module.__lvdInputState;
    };
});

EM_JS(void, lvd_canvas_input_deinit, (), {
    const canvas = Module.canvas;
    if(canvas && canvas.__lvdInputCleanup) canvas.__lvdInputCleanup();
});

EM_JS(void, lvd_canvas_pointer_read, (int32_t * x, int32_t * y, int32_t * down), {
    const state = Module.__lvdInputState || { x: 0, y: 0, down: 0 };
    HEAP32[x >> 2] = state.x;
    HEAP32[y >> 2] = state.y;
    HEAP32[down >> 2] = state.down;
});

EM_JS(void, lvd_canvas_encoder_read, (int32_t * diff, int32_t * down), {
    const state = Module.__lvdInputState || { wheel: 0, middle: 0 };
    HEAP32[diff >> 2] = state.wheel;
    HEAP32[down >> 2] = state.middle;
    state.wheel = 0;
});

static void display_flush(lv_display_t * display, const lv_area_t * area, uint8_t * pixels)
{
    lv_draw_buf_t * active = lv_display_get_buf_active(display);
    uint32_t stride = active ? active->header.stride
                      : lv_draw_buf_width_to_stride((uint32_t)lv_area_get_width(area), g_color_format);
    lvd_canvas_flush(area->x1, area->y1, lv_area_get_width(area), lv_area_get_height(area),
                     pixels, stride, (int)g_color_format);
    lv_display_flush_ready(display);
}

static void pointer_read(lv_indev_t * indev, lv_indev_data_t * data)
{
    (void)indev;
    int32_t x, y, down;
    lvd_canvas_pointer_read(&x, &y, &down);
    data->point.x = x;
    data->point.y = y;
    data->state = down ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}

static void encoder_read(lv_indev_t * indev, lv_indev_data_t * data)
{
    (void)indev;
    int32_t diff, down;
    lvd_canvas_encoder_read(&diff, &down);
    data->enc_diff = diff;
    data->state = down ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}

static int color_format_from_name(const char * name, lv_color_format_t * format)
{
    if(!name || !format) return -3;
    if(strcmp(name, "RGB565") == 0) *format = LV_COLOR_FORMAT_RGB565;
    else if(strcmp(name, "RGB565_SWAPPED") == 0) *format = LV_COLOR_FORMAT_RGB565_SWAPPED;
    else if(strcmp(name, "RGB888") == 0) *format = LV_COLOR_FORMAT_RGB888;
    else if(strcmp(name, "XRGB8888") == 0) *format = LV_COLOR_FORMAT_XRGB8888;
    else if(strcmp(name, "ARGB8888") == 0) *format = LV_COLOR_FORMAT_ARGB8888;
    else return -4;
    return 0;
}

static int configure_display(int32_t width, int32_t height, lv_color_format_t format)
{
    if(!lvd_disp || width <= 0 || height <= 0) return -3;
    uint32_t stride = lv_draw_buf_width_to_stride((uint32_t)width, format);
    uint32_t rows = height < 64 ? (uint32_t)height : 64u;
    if(stride == 0 || rows == 0 || stride > UINT32_MAX / rows) return -3;
    uint32_t size = stride * rows;
    void * next = malloc(size);
    if(!next) return -1;
    /* Allocate first: on OOM the previous display/buffer pairing stays valid. */
    void * previous = g_draw_buf;
    lv_display_set_color_format(lvd_disp, format);
    lv_display_set_resolution(lvd_disp, width, height);
    g_draw_buf = next;
    g_color_format = format;
    lv_display_set_buffers(lvd_disp, g_draw_buf, NULL, size, LV_DISPLAY_RENDER_MODE_PARTIAL);
    free(previous);
    return lvd_canvas_resize(width, height) == 0 ? 0 : -1;
}

int lvd_configure_display(int32_t width, int32_t height, const char * color_format)
{
    lv_color_format_t format;
    int rc = color_format_from_name(color_format, &format);
    return rc == 0 ? configure_display(width, height, format) : rc;
}

const char * lvd_find_image_src(const char * name)
{
    if(!name || !name[0]) return NULL;
    for(lvd_img_rec_t * r = g_imgs; r; r = r->next) {
        if(strcmp(r->name, name) == 0) return r->path;
    }
    return NULL;
}

const lv_font_t * lvd_find_font(const char * name)
{
    if(!name || !name[0]) return NULL;
    if(strcmp(name, "lv_font_default") == 0 || strcmp(name, "default") == 0)
        return lv_font_get_default();
#if LV_FONT_MONTSERRAT_8
    if(strcmp(name, "montserrat_8") == 0) return &lv_font_montserrat_8;
#endif
#if LV_FONT_MONTSERRAT_10
    if(strcmp(name, "montserrat_10") == 0) return &lv_font_montserrat_10;
#endif
#if LV_FONT_MONTSERRAT_12
    if(strcmp(name, "montserrat_12") == 0) return &lv_font_montserrat_12;
#endif
#if LV_FONT_MONTSERRAT_14
    if(strcmp(name, "montserrat_14") == 0) return &lv_font_montserrat_14;
#endif
#if LV_FONT_MONTSERRAT_16
    if(strcmp(name, "montserrat_16") == 0) return &lv_font_montserrat_16;
#endif
#if LV_FONT_MONTSERRAT_18
    if(strcmp(name, "montserrat_18") == 0) return &lv_font_montserrat_18;
#endif
#if LV_FONT_MONTSERRAT_20
    if(strcmp(name, "montserrat_20") == 0) return &lv_font_montserrat_20;
#endif
#if LV_FONT_MONTSERRAT_22
    if(strcmp(name, "montserrat_22") == 0) return &lv_font_montserrat_22;
#endif
#if LV_FONT_MONTSERRAT_24
    if(strcmp(name, "montserrat_24") == 0) return &lv_font_montserrat_24;
#endif
#if LV_FONT_MONTSERRAT_26
    if(strcmp(name, "montserrat_26") == 0) return &lv_font_montserrat_26;
#endif
#if LV_FONT_MONTSERRAT_28
    if(strcmp(name, "montserrat_28") == 0) return &lv_font_montserrat_28;
#endif
#if LV_FONT_MONTSERRAT_30
    if(strcmp(name, "montserrat_30") == 0) return &lv_font_montserrat_30;
#endif
#if LV_FONT_MONTSERRAT_32
    if(strcmp(name, "montserrat_32") == 0) return &lv_font_montserrat_32;
#endif
#if LV_FONT_MONTSERRAT_34
    if(strcmp(name, "montserrat_34") == 0) return &lv_font_montserrat_34;
#endif
#if LV_FONT_MONTSERRAT_36
    if(strcmp(name, "montserrat_36") == 0) return &lv_font_montserrat_36;
#endif
#if LV_FONT_MONTSERRAT_38
    if(strcmp(name, "montserrat_38") == 0) return &lv_font_montserrat_38;
#endif
#if LV_FONT_MONTSERRAT_40
    if(strcmp(name, "montserrat_40") == 0) return &lv_font_montserrat_40;
#endif
#if LV_FONT_MONTSERRAT_42
    if(strcmp(name, "montserrat_42") == 0) return &lv_font_montserrat_42;
#endif
#if LV_FONT_MONTSERRAT_44
    if(strcmp(name, "montserrat_44") == 0) return &lv_font_montserrat_44;
#endif
#if LV_FONT_MONTSERRAT_46
    if(strcmp(name, "montserrat_46") == 0) return &lv_font_montserrat_46;
#endif
#if LV_FONT_MONTSERRAT_48
    if(strcmp(name, "montserrat_48") == 0) return &lv_font_montserrat_48;
#endif
    for(lvd_font_rec_t * r = g_fonts; r; r = r->next) {
        if(strcmp(r->name, name) == 0) return r->font;
    }
    return NULL;
}

lv_obj_t * lvd_find_obj(const char * name)
{
    if(!name || !name[0]) return NULL;
    lv_obj_t * active = lv_screen_active();
    if(active) {
        const char * active_name = lv_obj_get_name(active);
        if(active_name && strcmp(active_name, name) == 0) return active;
        lv_obj_t * found = lv_obj_find_by_name(active, name);
        if(found) return found;
    }
    return lvd_disp ? lv_display_get_screen_by_name(lvd_disp, name) : NULL;
}

EMSCRIPTEN_KEEPALIVE
int lvd_init(int32_t hor, int32_t ver)
{
    if(hor <= 0 || ver <= 0) return -3;
    lv_init();
    lvd_log_init();
    lv_tick_set_cb(lvd_wall_ms);
    lvd_disp = lv_display_create(hor, ver);
    if(!lvd_disp) {
        lv_deinit();
        return -1;
    }
    lv_display_set_flush_cb(lvd_disp, display_flush);
    if(configure_display(hor, ver, LV_COLOR_FORMAT_XRGB8888) != 0) {
        lv_deinit();
        lvd_disp = NULL;
        free(g_draw_buf);
        g_draw_buf = NULL;
        return -1;
    }
    lvd_canvas_input_init();
    lv_indev_t * pointer = lv_indev_create();
    lv_indev_t * encoder = lv_indev_create();
    if(!pointer || !encoder) {
        lvd_canvas_input_deinit();
        lv_deinit();
        lvd_disp = NULL;
        free(g_draw_buf);
        g_draw_buf = NULL;
        return -1;
    }
    lv_indev_set_type(pointer, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(pointer, pointer_read);
    lv_indev_set_display(pointer, lvd_disp);
    lv_indev_set_type(encoder, LV_INDEV_TYPE_ENCODER);
    lv_indev_set_read_cb(encoder, encoder_read);
    lv_indev_set_display(encoder, lvd_disp);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
void lvd_deinit(void)
{
    if(g_snap) {
        lv_draw_buf_destroy(g_snap);
        g_snap = NULL;
    }
    lvd_canvas_input_deinit();
    if(lvd_disp) lv_deinit();
    lvd_disp = NULL;
    free(g_draw_buf);
    g_draw_buf = NULL;
}

EMSCRIPTEN_KEEPALIVE
uint32_t lvd_tick(void)
{
    return lv_timer_handler();
}

EMSCRIPTEN_KEEPALIVE
void lvd_set_resolution(int32_t hor, int32_t ver)
{
    if(lvd_disp && hor > 0 && ver > 0) (void)configure_display(hor, ver, g_color_format);
}

EMSCRIPTEN_KEEPALIVE
uint8_t * lvd_snapshot(const char * screen_name, int32_t * meta_out)
{
    lv_obj_t * screen = (screen_name && screen_name[0])
                        ? lv_display_get_screen_by_name(lvd_disp, screen_name)
                        : lv_screen_active();
    if(!screen || !meta_out) return NULL;
    lv_obj_update_layout(screen);
    if(g_snap) {
        lv_draw_buf_destroy(g_snap);
        g_snap = NULL;
    }
    g_snap = lv_snapshot_take(screen, LV_COLOR_FORMAT_ARGB8888);
    if(!g_snap) return NULL;
    meta_out[0] = (int32_t)g_snap->header.w;
    meta_out[1] = (int32_t)g_snap->header.h;
    meta_out[2] = (int32_t)g_snap->header.stride;
    return g_snap->data;
}

EMSCRIPTEN_KEEPALIVE
void lvd_snapshot_free(void)
{
    if(g_snap) {
        lv_draw_buf_destroy(g_snap);
        g_snap = NULL;
    }
}

EMSCRIPTEN_KEEPALIVE
void lvd_set_interactive(int enable)
{
    for(lv_indev_t * indev = lv_indev_get_next(NULL); indev; indev = lv_indev_get_next(indev))
        lv_indev_enable(indev, enable != 0);
}

EMSCRIPTEN_KEEPALIVE
void lvd_pause_anims(int pause)
{
    lv_timer_t * timer = lv_anim_get_timer();
    if(!timer) return;
    if(pause) lv_timer_pause(timer);
    else lv_timer_resume(timer);
}

EMSCRIPTEN_KEEPALIVE
int lvd_register_image(const char * name, const char * memfs_path)
{
    if(!name || !name[0] || !memfs_path || !memfs_path[0]) return -3;
    lvd_img_rec_t * rec = g_imgs;
    for(; rec; rec = rec->next) {
        if(strcmp(rec->name, name) == 0) break;
    }
    if(rec) {
        char * path = strdup(memfs_path);
        if(!path) return -1;
        free(rec->path);
        rec->path = path;
    }
    else {
        rec = malloc(sizeof(*rec));
        if(!rec) return -1;
        rec->name = strdup(name);
        rec->path = strdup(memfs_path);
        if(!rec->name || !rec->path) {
            free(rec->name);
            free(rec->path);
            free(rec);
            return -1;
        }
        rec->next = g_imgs;
        g_imgs = rec;
    }
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int lvd_register_font_tiny_ttf(const char * name, uint8_t * data, int len, int size_px)
{
    if(!name || !name[0] || !data || len <= 0 || size_px <= 0) return -3;
    lv_font_t * font = lv_tiny_ttf_create_data(data, (size_t)len, size_px);
    if(!font) return -1;
    lvd_font_rec_t * rec = g_fonts;
    for(; rec; rec = rec->next) {
        if(strcmp(rec->name, name) == 0) break;
    }
    if(rec) {
        rec->font = font;
        rec->data = data;
    }
    else {
        rec = malloc(sizeof(*rec));
        if(!rec) return -1;
        rec->name = strdup(name);
        if(!rec->name) {
            free(rec);
            return -1;
        }
        rec->font = font;
        rec->data = data;
        rec->next = g_fonts;
        g_fonts = rec;
    }
    return 0;
}

EMSCRIPTEN_KEEPALIVE
void lvd_set_asset_prefix(const char * prefix)
{
    (void)prefix;
}

EMSCRIPTEN_KEEPALIVE
void lvd_drop_image_cache(const char * src)
{
    lv_image_cache_drop((src && src[0]) ? (const void *)src : NULL);
}

EMSCRIPTEN_KEEPALIVE
int lvd_load_screen(const char * name)
{
    if(!name || !name[0]) return -3;
    lv_obj_t * screen = lv_display_get_screen_by_name(lvd_disp, name);
    if(!screen) return -2;
    lv_screen_load(screen);
    lv_obj_update_layout(screen);
    return 0;
}

static uint32_t manual_tick_cb(void)
{
    return g_manual_ms;
}

EMSCRIPTEN_KEEPALIVE
void lvd_set_manual_tick(int enable)
{
    if(enable) {
        g_manual_ms = lvd_wall_ms();
        lv_tick_set_cb(manual_tick_cb);
    }
    else {
        lv_tick_set_cb(lvd_wall_ms);
    }
}

EMSCRIPTEN_KEEPALIVE
uint32_t lvd_advance_tick(uint32_t ms)
{
    g_manual_ms += ms;
    return lv_timer_handler();
}
