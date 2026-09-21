/**
 * @file lvd_xml_lottie.c
 * <lv_lottie width="64" height="64" src="anim_json_ref"/>
 *
 * src is an imageRef whose registered value must be a MEMFS file path to a
 * lottie .json (e.g. "A:assets/anim.json"); if the ref is unknown, the raw
 * attribute value is used as the path. ThorVG loads the file with plain
 * fopen(), so an "X:" LVGL drive prefix is stripped (FS_STDIO letter 'A'
 * maps to the MEMFS cwd anyway).
 *
 * A lottie widget renders into a canvas draw buffer that the user must
 * provide: this parser allocates an ARGB8888 buffer from width/height
 * (plain px only; default 100x100) BEFORE setting src (thorvg needs the
 * target size). Buffer is parser-owned: recreated when the size changes,
 * destroyed on LV_EVENT_DELETE.
 */
#include "lvd_xml_lottie.h"
#if LV_USE_XML && LV_USE_LOTTIE

#define LVD_LOTTIE_DEF_SIZE 100

static void lottie_free_buf_cb(lv_event_t * e)
{
    lv_obj_t * obj = lv_event_get_target_obj(e);
    lv_draw_buf_t * buf = lv_canvas_get_draw_buf(obj);   /* lottie extends canvas */
    if(buf) lv_draw_buf_destroy(buf);
}

static const char * strip_drive_letter(const char * path)
{
    if(path && path[0] != '\0' && path[1] == ':') return path + 2;
    return path;
}

void * lvd_xml_lottie_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    LV_UNUSED(attrs);
    lv_obj_t * item = lv_lottie_create(lv_xml_state_get_parent(state));
    if(item) lv_obj_add_event_cb(item, lottie_free_buf_cb, LV_EVENT_DELETE, NULL);
    return item;
}

void lvd_xml_lottie_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    lv_obj_t * item = lv_xml_state_get_item(state);
    lv_xml_obj_apply(state, attrs);

    int32_t w = 0, h = 0;
    const char * src = NULL;

    for(int i = 0; attrs[i]; i += 2) {
        const char * name  = attrs[i];
        const char * value = attrs[i + 1];

        if(lv_streq("width", name)) w = lv_xml_atoi(value);        /* plain px only */
        else if(lv_streq("height", name)) h = lv_xml_atoi(value);
        else if(lv_streq("src", name)) src = value;
    }

    /* 1) make sure a correctly sized draw buffer exists (before src) */
    lv_draw_buf_t * old = lv_canvas_get_draw_buf(item);
    if(w <= 0) w = old ? (int32_t)old->header.w : LVD_LOTTIE_DEF_SIZE;
    if(h <= 0) h = old ? (int32_t)old->header.h : LVD_LOTTIE_DEF_SIZE;

    if(old == NULL || (int32_t)old->header.w != w || (int32_t)old->header.h != h) {
        lv_draw_buf_t * nb = lv_draw_buf_create(w, h, LV_COLOR_FORMAT_ARGB8888, 0);
        if(nb == NULL) {
            LV_LOG_WARN("lottie: lv_draw_buf_create(%d,%d) failed", (int)w, (int)h);
            return;
        }
        lv_draw_buf_clear(nb, NULL);
        lv_lottie_set_draw_buf(item, nb);
        if(old) lv_draw_buf_destroy(old);
    }

    /* 2) resolve + load the animation */
    if(src) {
        const void * resolved = lv_xml_get_image(&state->scope, src);
        const char * path = resolved ? (const char *)resolved : src;
        lv_lottie_set_src_file(item, strip_drive_letter(path));
    }
}

#endif /* LV_USE_XML && LV_USE_LOTTIE */
