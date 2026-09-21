/**
 * @file lvd_xml_list.c
 * <lv_list width="200" height="200">
 *     <lv_list-text text="Section"/>
 *     <lv_list-button icon="img_ref" text="Item"/>
 * </lv_list>
 *
 * lv_list itself has no own setters (it's a styled lv_obj); the value lives
 * in the two child element types. icon is optional (NULL = text-only button).
 */
#include "lvd_xml_list.h"
#if LV_USE_XML && LV_USE_LIST

void * lvd_xml_list_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    LV_UNUSED(attrs);
    return lv_list_create(lv_xml_state_get_parent(state));
}

void lvd_xml_list_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    lv_xml_obj_apply(state, attrs);
}

void * lvd_xml_list_text_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    const char * text = lv_xml_get_value_of(attrs, "text");
    return lv_list_add_text(lv_xml_state_get_parent(state), text ? text : "");
}

void lvd_xml_list_text_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    lv_xml_obj_apply(state, attrs);
}

void * lvd_xml_list_button_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    const char * icon = lv_xml_get_value_of(attrs, "icon");
    const char * text = lv_xml_get_value_of(attrs, "text");
    const void * icon_src = icon ? lv_xml_get_image(&state->scope, icon) : NULL;
    return lv_list_add_button(lv_xml_state_get_parent(state), icon_src, text ? text : "");
}

void lvd_xml_list_button_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    lv_xml_obj_apply(state, attrs);
}

#endif /* LV_USE_XML && LV_USE_LIST */
