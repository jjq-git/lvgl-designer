/**
 * @file lvd_xml_arclabel.c
 * <lv_arclabel text="Curved" angle_start="0" angle_size="360" dir="clockwise"
 *              radius="80" offset="0" recolor="false"
 *              center_offset_x="0" center_offset_y="0"
 *              text_vertical_align="center" text_horizontal_align="center"/>
 *
 * Attribute set mirrors the real lv_arclabel_set_* API of LVGL 9.4.
 * angle_start/angle_size are lv_value_precise_t (float, LV_USE_FLOAT=1).
 */
#include "lvd_xml_arclabel.h"
#if LV_USE_XML && LV_USE_ARCLABEL

static lv_arclabel_dir_t dir_text_to_enum_value(const char * txt)
{
    if(lv_streq("clockwise", txt)) return LV_ARCLABEL_DIR_CLOCKWISE;
    if(lv_streq("counter_clockwise", txt)) return LV_ARCLABEL_DIR_COUNTER_CLOCKWISE;

    LV_LOG_WARN("%s is an unknown value for arclabel dir", txt);
    return LV_ARCLABEL_DIR_CLOCKWISE;
}

static lv_arclabel_text_align_t align_text_to_enum_value(const char * txt)
{
    if(lv_streq("default", txt)) return LV_ARCLABEL_TEXT_ALIGN_DEFAULT;
    if(lv_streq("leading", txt)) return LV_ARCLABEL_TEXT_ALIGN_LEADING;
    if(lv_streq("center", txt)) return LV_ARCLABEL_TEXT_ALIGN_CENTER;
    if(lv_streq("trailing", txt)) return LV_ARCLABEL_TEXT_ALIGN_TRAILING;

    LV_LOG_WARN("%s is an unknown value for arclabel text align", txt);
    return LV_ARCLABEL_TEXT_ALIGN_DEFAULT;
}

void * lvd_xml_arclabel_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    LV_UNUSED(attrs);
    return lv_arclabel_create(lv_xml_state_get_parent(state));
}

void lvd_xml_arclabel_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    void * item = lv_xml_state_get_item(state);
    lv_xml_obj_apply(state, attrs);

    for(int i = 0; attrs[i]; i += 2) {
        const char * name  = attrs[i];
        const char * value = attrs[i + 1];

        if(lv_streq("text", name)) lv_arclabel_set_text(item, value);
#if LV_USE_FLOAT
        else if(lv_streq("angle_start", name)) lv_arclabel_set_angle_start(item, lv_xml_atof(value));
        else if(lv_streq("angle_size", name)) lv_arclabel_set_angle_size(item, lv_xml_atof(value));
#else
        else if(lv_streq("angle_start", name)) lv_arclabel_set_angle_start(item, lv_xml_atoi(value));
        else if(lv_streq("angle_size", name)) lv_arclabel_set_angle_size(item, lv_xml_atoi(value));
#endif
        else if(lv_streq("offset", name)) lv_arclabel_set_offset(item, lv_xml_atoi(value));
        else if(lv_streq("dir", name)) lv_arclabel_set_dir(item, dir_text_to_enum_value(value));
        else if(lv_streq("recolor", name)) lv_arclabel_set_recolor(item, lv_xml_to_bool(value));
        else if(lv_streq("radius", name)) lv_arclabel_set_radius(item, (uint32_t)lv_xml_atoi(value));
        else if(lv_streq("center_offset_x", name)) lv_arclabel_set_center_offset_x(item, (uint32_t)lv_xml_atoi(value));
        else if(lv_streq("center_offset_y", name)) lv_arclabel_set_center_offset_y(item, (uint32_t)lv_xml_atoi(value));
        else if(lv_streq("text_vertical_align", name))
            lv_arclabel_set_text_vertical_align(item, align_text_to_enum_value(value));
        else if(lv_streq("text_horizontal_align", name))
            lv_arclabel_set_text_horizontal_align(item, align_text_to_enum_value(value));
    }
}

#endif /* LV_USE_XML && LV_USE_ARCLABEL */
