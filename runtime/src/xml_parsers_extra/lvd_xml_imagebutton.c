/**
 * @file lvd_xml_imagebutton.c
 * <lv_imagebutton src_released_mid="img1" src_pressed_mid="img2" state="released"/>
 *
 * Pragmatic subset: only the RELEASED and PRESSED states are exposed
 * (left/mid/right each); lv_imagebutton_set_src() takes all three parts at
 * once, so the loop gathers them per state and calls the setter once per
 * state. Missing parts stay NULL (mid-only is the common case).
 */
#include "lvd_xml_imagebutton.h"
#if LV_USE_XML && LV_USE_IMAGEBUTTON

static lv_imagebutton_state_t state_text_to_enum_value(const char * txt)
{
    if(lv_streq("released", txt)) return LV_IMAGEBUTTON_STATE_RELEASED;
    if(lv_streq("pressed", txt)) return LV_IMAGEBUTTON_STATE_PRESSED;
    if(lv_streq("disabled", txt)) return LV_IMAGEBUTTON_STATE_DISABLED;
    if(lv_streq("checked_released", txt)) return LV_IMAGEBUTTON_STATE_CHECKED_RELEASED;
    if(lv_streq("checked_pressed", txt)) return LV_IMAGEBUTTON_STATE_CHECKED_PRESSED;
    if(lv_streq("checked_disabled", txt)) return LV_IMAGEBUTTON_STATE_CHECKED_DISABLED;

    LV_LOG_WARN("%s is an unknown value for imagebutton state", txt);
    return LV_IMAGEBUTTON_STATE_RELEASED;
}

void * lvd_xml_imagebutton_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    LV_UNUSED(attrs);
    return lv_imagebutton_create(lv_xml_state_get_parent(state));
}

void lvd_xml_imagebutton_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    void * item = lv_xml_state_get_item(state);
    lv_xml_obj_apply(state, attrs);

    const void * rel[3] = {NULL, NULL, NULL};   /* left, mid, right */
    const void * prs[3] = {NULL, NULL, NULL};
    bool has_rel = false, has_prs = false;

    for(int i = 0; attrs[i]; i += 2) {
        const char * name  = attrs[i];
        const char * value = attrs[i + 1];

        if(lv_streq("src_released_left", name))       { rel[0] = lv_xml_get_image(&state->scope, value); has_rel = true; }
        else if(lv_streq("src_released_mid", name))   { rel[1] = lv_xml_get_image(&state->scope, value); has_rel = true; }
        else if(lv_streq("src_released_right", name)) { rel[2] = lv_xml_get_image(&state->scope, value); has_rel = true; }
        else if(lv_streq("src_pressed_left", name))   { prs[0] = lv_xml_get_image(&state->scope, value); has_prs = true; }
        else if(lv_streq("src_pressed_mid", name))    { prs[1] = lv_xml_get_image(&state->scope, value); has_prs = true; }
        else if(lv_streq("src_pressed_right", name))  { prs[2] = lv_xml_get_image(&state->scope, value); has_prs = true; }
        else if(lv_streq("state", name)) lv_imagebutton_set_state(item, state_text_to_enum_value(value));
    }

    if(has_rel) lv_imagebutton_set_src(item, LV_IMAGEBUTTON_STATE_RELEASED, rel[0], rel[1], rel[2]);
    if(has_prs) lv_imagebutton_set_src(item, LV_IMAGEBUTTON_STATE_PRESSED,  prs[0], prs[1], prs[2]);
}

#endif /* LV_USE_XML && LV_USE_IMAGEBUTTON */
