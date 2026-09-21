/**
 * @file lvd_xml_spinner.c
 * <lv_spinner anim_duration="1000" angle="200"/>
 *
 * The only setter is lv_spinner_set_anim_params(t, angle) which takes both
 * values at once, so the loop gathers them and calls the setter once
 * (defaults: 1000 ms / 270 deg, same as lv_spinner's constructor).
 */
#include "lvd_xml_spinner.h"
#if LV_USE_XML && LV_USE_SPINNER

void * lvd_xml_spinner_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    LV_UNUSED(attrs);
    return lv_spinner_create(lv_xml_state_get_parent(state));
}

void lvd_xml_spinner_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    void * item = lv_xml_state_get_item(state);
    lv_xml_obj_apply(state, attrs);

    uint32_t t = 1000, angle = 270;
    bool has = false;

    for(int i = 0; attrs[i]; i += 2) {
        const char * name  = attrs[i];
        const char * value = attrs[i + 1];

        if(lv_streq("anim_duration", name)) { t = (uint32_t)lv_xml_atoi(value); has = true; }
        else if(lv_streq("angle", name)) { angle = (uint32_t)lv_xml_atoi(value); has = true; }
    }

    if(has) lv_spinner_set_anim_params(item, t, angle);
}

#endif /* LV_USE_XML && LV_USE_SPINNER */
