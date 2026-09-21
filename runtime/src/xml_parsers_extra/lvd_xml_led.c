/**
 * @file lvd_xml_led.c
 * <lv_led color="0xff0000" brightness="255"/>
 */
#include "lvd_xml_led.h"
#if LV_USE_XML && LV_USE_LED

void * lvd_xml_led_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    LV_UNUSED(attrs);
    return lv_led_create(lv_xml_state_get_parent(state));
}

void lvd_xml_led_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    void * item = lv_xml_state_get_item(state);
    lv_xml_obj_apply(state, attrs);

    for(int i = 0; attrs[i]; i += 2) {
        const char * name  = attrs[i];
        const char * value = attrs[i + 1];

        if(lv_streq("color", name)) lv_led_set_color(item, lv_xml_to_color(value));
        else if(lv_streq("brightness", name)) lv_led_set_brightness(item, (uint8_t)lv_xml_atoi(value));
    }
}

#endif /* LV_USE_XML && LV_USE_LED */
