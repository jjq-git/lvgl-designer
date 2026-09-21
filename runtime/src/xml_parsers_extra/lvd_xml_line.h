/** @file lvd_xml_line.h — <lv_line> parser */
#ifndef LVD_XML_LINE_H
#define LVD_XML_LINE_H
#include "lvd_xml_extra.h"
#if LV_USE_XML && LV_USE_LINE
void * lvd_xml_line_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_line_apply(lv_xml_parser_state_t * state, const char ** attrs);
#endif
#endif /* LVD_XML_LINE_H */
