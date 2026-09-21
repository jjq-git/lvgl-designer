/** @file lvd_xml_canvas.h — <lv_canvas> parser (overrides the official one:
 *  auto-allocates a draw buffer from width/height and fills fill_color) */
#ifndef LVD_XML_CANVAS_H
#define LVD_XML_CANVAS_H
#include "lvd_xml_extra.h"
#if LV_USE_XML && LV_USE_CANVAS
void * lvd_xml_canvas_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_canvas_apply(lv_xml_parser_state_t * state, const char ** attrs);
#endif
#endif /* LVD_XML_CANVAS_H */
