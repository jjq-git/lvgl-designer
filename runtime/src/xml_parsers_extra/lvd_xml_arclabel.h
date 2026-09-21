/** @file lvd_xml_arclabel.h — <lv_arclabel> parser */
#ifndef LVD_XML_ARCLABEL_H
#define LVD_XML_ARCLABEL_H
#include "lvd_xml_extra.h"
#if LV_USE_XML && LV_USE_ARCLABEL
void * lvd_xml_arclabel_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_arclabel_apply(lv_xml_parser_state_t * state, const char ** attrs);
#endif
#endif /* LVD_XML_ARCLABEL_H */
