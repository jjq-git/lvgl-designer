/** @file lvd_xml_lottie.h — <lv_lottie> parser */
#ifndef LVD_XML_LOTTIE_H
#define LVD_XML_LOTTIE_H
#include "lvd_xml_extra.h"
#if LV_USE_XML && LV_USE_LOTTIE
void * lvd_xml_lottie_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_lottie_apply(lv_xml_parser_state_t * state, const char ** attrs);
#endif
#endif /* LVD_XML_LOTTIE_H */
