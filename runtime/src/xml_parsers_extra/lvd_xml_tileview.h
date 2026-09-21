/** @file lvd_xml_tileview.h — <lv_tileview> + <lv_tileview-tile> parsers */
#ifndef LVD_XML_TILEVIEW_H
#define LVD_XML_TILEVIEW_H
#include "lvd_xml_extra.h"
#if LV_USE_XML && LV_USE_TILEVIEW
void * lvd_xml_tileview_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_tileview_apply(lv_xml_parser_state_t * state, const char ** attrs);
void * lvd_xml_tileview_tile_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_tileview_tile_apply(lv_xml_parser_state_t * state, const char ** attrs);
#endif
#endif /* LVD_XML_TILEVIEW_H */
