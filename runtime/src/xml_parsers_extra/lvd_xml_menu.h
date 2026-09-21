/** @file lvd_xml_menu.h — <lv_menu> + <lv_menu-page> parsers (simplified) */
#ifndef LVD_XML_MENU_H
#define LVD_XML_MENU_H
#include "lvd_xml_extra.h"
#if LV_USE_XML && LV_USE_MENU
void * lvd_xml_menu_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_menu_apply(lv_xml_parser_state_t * state, const char ** attrs);
void * lvd_xml_menu_page_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_menu_page_apply(lv_xml_parser_state_t * state, const char ** attrs);
#endif
#endif /* LVD_XML_MENU_H */
