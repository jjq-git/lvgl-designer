/** @file lvd_xml_spinner.h — <lv_spinner> parser */
#ifndef LVD_XML_SPINNER_H
#define LVD_XML_SPINNER_H
#include "lvd_xml_extra.h"
#if LV_USE_XML && LV_USE_SPINNER
void * lvd_xml_spinner_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_spinner_apply(lv_xml_parser_state_t * state, const char ** attrs);
#endif
#endif /* LVD_XML_SPINNER_H */
