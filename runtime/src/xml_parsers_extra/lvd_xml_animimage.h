/** @file lvd_xml_animimage.h — <lv_animimage> parser (C prefix is lv_animimg_) */
#ifndef LVD_XML_ANIMIMAGE_H
#define LVD_XML_ANIMIMAGE_H
#include "lvd_xml_extra.h"
#if LV_USE_XML && LV_USE_ANIMIMG
void * lvd_xml_animimage_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_animimage_apply(lv_xml_parser_state_t * state, const char ** attrs);
#endif
#endif /* LVD_XML_ANIMIMAGE_H */
