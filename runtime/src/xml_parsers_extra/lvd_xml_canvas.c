/**
 * @file lvd_xml_canvas.c
 * <lv_canvas width="120" height="80" fill_color="0x00ff00"/>
 *
 * Replaces the official lv_canvas parser (which allocates no buffer, so the
 * widget stays invisible). Designer behavior: a draw buffer (ARGB8888) is
 * allocated automatically from width/height (plain px only; default 100x100)
 * and filled with fill_color (default white) so the canvas is visible in the
 * preview. The buffer is parser-owned: re-apply with a new size destroys and
 * recreates it, LV_EVENT_DELETE destroys it with the widget.
 */
#include "lvd_xml_canvas.h"
#if LV_USE_XML && LV_USE_CANVAS

#define LVD_CANVAS_DEF_SIZE 100

static void canvas_free_buf_cb(lv_event_t * e)
{
    lv_obj_t * obj = lv_event_get_target_obj(e);
    lv_draw_buf_t * buf = lv_canvas_get_draw_buf(obj);
    if(buf) lv_draw_buf_destroy(buf);
}

void * lvd_xml_canvas_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    LV_UNUSED(attrs);
    lv_obj_t * item = lv_canvas_create(lv_xml_state_get_parent(state));
    if(item) lv_obj_add_event_cb(item, canvas_free_buf_cb, LV_EVENT_DELETE, NULL);
    return item;
}

void lvd_xml_canvas_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    lv_obj_t * item = lv_xml_state_get_item(state);
    lv_xml_obj_apply(state, attrs);

    int32_t w = 0, h = 0;
    const char * fill = NULL;

    for(int i = 0; attrs[i]; i += 2) {
        const char * name  = attrs[i];
        const char * value = attrs[i + 1];

        if(lv_streq("width", name)) w = lv_xml_atoi(value);        /* plain px only */
        else if(lv_streq("height", name)) h = lv_xml_atoi(value);
        else if(lv_streq("fill_color", name)) fill = value;
    }

    lv_draw_buf_t * old = lv_canvas_get_draw_buf(item);
    if(w <= 0) w = old ? (int32_t)old->header.w : LVD_CANVAS_DEF_SIZE;
    if(h <= 0) h = old ? (int32_t)old->header.h : LVD_CANVAS_DEF_SIZE;

    lv_color_t fill_color = fill ? lv_xml_to_color(fill) : lv_color_white();

    if(old == NULL || (int32_t)old->header.w != w || (int32_t)old->header.h != h) {
        lv_draw_buf_t * nb = lv_draw_buf_create(w, h, LV_COLOR_FORMAT_ARGB8888, 0);
        if(nb == NULL) {
            LV_LOG_WARN("canvas: lv_draw_buf_create(%d,%d) failed", (int)w, (int)h);
            return;
        }
        lv_canvas_set_draw_buf(item, nb);
        if(old) lv_draw_buf_destroy(old);
        lv_canvas_fill_bg(item, fill_color, LV_OPA_COVER);
    }
    else if(fill) {
        lv_canvas_fill_bg(item, fill_color, LV_OPA_COVER);
    }
}

#endif /* LV_USE_XML && LV_USE_CANVAS */
