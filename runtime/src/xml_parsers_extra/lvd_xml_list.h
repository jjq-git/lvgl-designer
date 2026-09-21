/** @file lvd_xml_list.h — <lv_list> + <lv_list-text> + <lv_list-button> parsers */
#ifndef LVD_XML_LIST_H
#define LVD_XML_LIST_H
#include "lvd_xml_extra.h"
#if LV_USE_XML && LV_USE_LIST
void * lvd_xml_list_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_list_apply(lv_xml_parser_state_t * state, const char ** attrs);
void * lvd_xml_list_text_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_list_text_apply(lv_xml_parser_state_t * state, const char ** attrs);
void * lvd_xml_list_button_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_list_button_apply(lv_xml_parser_state_t * state, const char ** attrs);
#endif
#endif /* LVD_XML_LIST_H */
