/**
 * @file lvd_xml_menu.c
 * <lv_menu mode_header="top_fixed" mode_root_back_button="disabled">
 *     <lv_menu-page title="Page 1"> ...children... </lv_menu-page>
 * </lv_menu>
 *
 * Simplified model per design contract: menu + pages only (no explicit
 * sidebar/section/cont elements). The FIRST page created under a menu is
 * loaded as the main page so the preview shows content immediately.
 * lv_menu_page_create() strdups the title.
 */
#include "lvd_xml_menu.h"
#if LV_USE_XML && LV_USE_MENU

static lv_menu_mode_header_t mode_header_text_to_enum_value(const char * txt)
{
    if(lv_streq("top_fixed", txt)) return LV_MENU_HEADER_TOP_FIXED;
    if(lv_streq("top_unfixed", txt)) return LV_MENU_HEADER_TOP_UNFIXED;
    if(lv_streq("bottom_fixed", txt)) return LV_MENU_HEADER_BOTTOM_FIXED;

    LV_LOG_WARN("%s is an unknown value for menu mode_header", txt);
    return LV_MENU_HEADER_TOP_FIXED;
}

static lv_menu_mode_root_back_button_t mode_root_back_button_text_to_enum_value(const char * txt)
{
    if(lv_streq("disabled", txt)) return LV_MENU_ROOT_BACK_BUTTON_DISABLED;
    if(lv_streq("enabled", txt)) return LV_MENU_ROOT_BACK_BUTTON_ENABLED;

    LV_LOG_WARN("%s is an unknown value for menu mode_root_back_button", txt);
    return LV_MENU_ROOT_BACK_BUTTON_DISABLED;
}

void * lvd_xml_menu_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    LV_UNUSED(attrs);
    return lv_menu_create(lv_xml_state_get_parent(state));
}

void lvd_xml_menu_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    void * item = lv_xml_state_get_item(state);
    lv_xml_obj_apply(state, attrs);

    for(int i = 0; attrs[i]; i += 2) {
        const char * name  = attrs[i];
        const char * value = attrs[i + 1];

        if(lv_streq("mode_header", name))
            lv_menu_set_mode_header(item, mode_header_text_to_enum_value(value));
        else if(lv_streq("mode_root_back_button", name))
            lv_menu_set_mode_root_back_button(item, mode_root_back_button_text_to_enum_value(value));
    }
}

void * lvd_xml_menu_page_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    lv_obj_t * menu = lv_xml_state_get_parent(state);
    const char * title = lv_xml_get_value_of(attrs, "title");
    lv_obj_t * page = lv_menu_page_create(menu, title);   /* title==NULL -> no header title */
    if(page && lv_menu_get_cur_main_page(menu) == NULL) lv_menu_set_page(menu, page);
    return page;
}

void lvd_xml_menu_page_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    lv_xml_obj_apply(state, attrs);
}

#endif /* LV_USE_XML && LV_USE_MENU */
