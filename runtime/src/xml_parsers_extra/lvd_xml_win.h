/** @file lvd_xml_win.h — <lv_win> + <lv_win-button> parsers */
#ifndef LVD_XML_WIN_H
#define LVD_XML_WIN_H
#include "lvd_xml_extra.h"
#if LV_USE_XML && LV_USE_WIN
void * lvd_xml_win_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_win_apply(lv_xml_parser_state_t * state, const char ** attrs);
void * lvd_xml_win_button_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_win_button_apply(lv_xml_parser_state_t * state, const char ** attrs);
#endif
#endif /* LVD_XML_WIN_H */
