/**
 * @file lvd_xml_animimage.c
 * <lv_animimage srcs="img_a img_b img_c" duration="1000" repeat_count="infinite"/>
 *
 * srcs: space separated imageRef list; each token resolves via
 * lv_xml_get_image(). lv_animimg does NOT copy the dsc array, so the parser
 * owns it: previous array (queried with the public lv_animimg_get_src())
 * is freed on re-apply and on LV_EVENT_DELETE. The animation is (re)started
 * at the end of apply when a source list is present.
 * Defaults: duration 1000 ms, repeat_count infinite.
 */
#include "lvd_xml_animimage.h"
#if LV_USE_XML && LV_USE_ANIMIMG

static void animimage_free_srcs_cb(lv_event_t * e)
{
    lv_obj_t * obj = lv_event_get_target_obj(e);
    const void ** dsc = lv_animimg_get_src(obj);
    if(dsc) lv_free(dsc);
}

static void animimage_set_srcs(lv_xml_parser_state_t * state, lv_obj_t * obj, const char * value)
{
    char * buf = lv_strdup(value);
    LV_ASSERT_MALLOC(buf);
    if(buf == NULL) return;

    /* count tokens */
    size_t n = 0;
    char * s = buf;
    while(*s) {
        while(*s == ' ') s++;
        if(*s == '\0') break;
        n++;
        while(*s && *s != ' ') s++;
    }
    if(n == 0) {
        lv_free(buf);
        return;
    }

    const void ** dsc = lv_malloc(sizeof(void *) * n);
    LV_ASSERT_MALLOC(dsc);
    if(dsc == NULL) {
        lv_free(buf);
        return;
    }

    s = buf;
    size_t i = 0;
    while(*s && i < n) {
        while(*s == ' ') s++;
        if(*s == '\0') break;
        char * tok = s;
        while(*s && *s != ' ') s++;
        if(*s) { *s = '\0'; s++; }
        dsc[i++] = lv_xml_get_image(&state->scope, tok);
    }

    const void ** old = lv_animimg_get_src(obj);
    lv_animimg_set_src(obj, dsc, n);
    if(old) lv_free(old);
    lv_free(buf);
}

void * lvd_xml_animimage_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    LV_UNUSED(attrs);
    lv_obj_t * item = lv_animimg_create(lv_xml_state_get_parent(state));
    if(item) lv_obj_add_event_cb(item, animimage_free_srcs_cb, LV_EVENT_DELETE, NULL);
    return item;
}

void lvd_xml_animimage_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    lv_obj_t * item = lv_xml_state_get_item(state);
    lv_xml_obj_apply(state, attrs);

    const char * srcs = NULL;
    uint32_t duration = 1000;
    uint32_t repeat   = LV_ANIM_REPEAT_INFINITE;
    bool touched = false;

    for(int i = 0; attrs[i]; i += 2) {
        const char * name  = attrs[i];
        const char * value = attrs[i + 1];

        if(lv_streq("srcs", name)) { srcs = value; touched = true; }
        else if(lv_streq("duration", name)) { duration = (uint32_t)lv_xml_atoi(value); touched = true; }
        else if(lv_streq("repeat_count", name)) {
            repeat = lv_streq("infinite", value) ? LV_ANIM_REPEAT_INFINITE : (uint32_t)lv_xml_atoi(value);
            touched = true;
        }
    }

    if(srcs) animimage_set_srcs(state, item, srcs);
    if(touched) {
        lv_animimg_set_duration(item, duration);
        lv_animimg_set_repeat_count(item, repeat);
        if(lv_animimg_get_src(item)) lv_animimg_start(item);
    }
}

#endif /* LV_USE_XML && LV_USE_ANIMIMG */
