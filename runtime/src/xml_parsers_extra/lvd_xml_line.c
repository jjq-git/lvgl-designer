/**
 * @file lvd_xml_line.c
 * <lv_line points="10,10 120,60 200,20" y_invert="false"/>
 *
 * lv_line does NOT copy the point array, so the parser owns it:
 *  - set via lv_line_set_points_mutable() (marks the array as ours),
 *  - on re-apply the previous mutable array is freed first,
 *  - a one-shot LV_EVENT_DELETE cb frees the last array with the widget.
 */
#include "lvd_xml_line.h"
#if LV_USE_XML && LV_USE_LINE

static void line_free_points_cb(lv_event_t * e)
{
    lv_obj_t * obj = lv_event_get_target_obj(e);
    if(lv_line_is_point_array_mutable(obj)) {
        lv_point_precise_t * pts = lv_line_get_points_mutable(obj);
        if(pts) lv_free(pts);
    }
}

static void line_set_points(lv_obj_t * obj, const char * value)
{
    /* one ',' per "x,y" pair */
    uint32_t n = 0;
    for(const char * p = value; *p; p++) if(*p == ',') n++;
    if(n == 0) return;

    lv_point_precise_t * pts = lv_malloc(sizeof(lv_point_precise_t) * n);
    LV_ASSERT_MALLOC(pts);
    if(pts == NULL) return;

    const char * s = value;
    for(uint32_t i = 0; i < n; i++) {
#if LV_USE_FLOAT
        pts[i].x = lv_xml_atof_split(&s, ',');
        pts[i].y = lv_xml_atof_split(&s, ' ');
#else
        pts[i].x = lv_xml_atoi_split(&s, ',');
        pts[i].y = lv_xml_atoi_split(&s, ' ');
#endif
    }

    if(lv_line_is_point_array_mutable(obj)) {
        lv_point_precise_t * old = lv_line_get_points_mutable(obj);
        if(old) lv_free(old);
    }
    lv_line_set_points_mutable(obj, pts, n);
}

void * lvd_xml_line_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    LV_UNUSED(attrs);
    lv_obj_t * item = lv_line_create(lv_xml_state_get_parent(state));
    if(item) lv_obj_add_event_cb(item, line_free_points_cb, LV_EVENT_DELETE, NULL);
    return item;
}

void lvd_xml_line_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    void * item = lv_xml_state_get_item(state);
    lv_xml_obj_apply(state, attrs);

    for(int i = 0; attrs[i]; i += 2) {
        const char * name  = attrs[i];
        const char * value = attrs[i + 1];

        if(lv_streq("points", name)) line_set_points(item, value);
        else if(lv_streq("y_invert", name)) lv_line_set_y_invert(item, lv_xml_to_bool(value));
    }
}

#endif /* LV_USE_XML && LV_USE_LINE */
