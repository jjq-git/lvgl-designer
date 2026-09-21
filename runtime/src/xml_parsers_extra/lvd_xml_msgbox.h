/** @file lvd_xml_msgbox.h — <lv_msgbox> + <lv_msgbox-button> parsers */
#ifndef LVD_XML_MSGBOX_H
#define LVD_XML_MSGBOX_H
#include "lvd_xml_extra.h"
#if LV_USE_XML && LV_USE_MSGBOX
void * lvd_xml_msgbox_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_msgbox_apply(lv_xml_parser_state_t * state, const char ** attrs);
void * lvd_xml_msgbox_button_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_msgbox_button_apply(lv_xml_parser_state_t * state, const char ** attrs);
#endif
#endif /* LVD_XML_MSGBOX_H */
