/** @file lvd_xml_led.h — <lv_led> parser */
#ifndef LVD_XML_LED_H
#define LVD_XML_LED_H
#include "lvd_xml_extra.h"
#if LV_USE_XML && LV_USE_LED
void * lvd_xml_led_create(lv_xml_parser_state_t * state, const char ** attrs);
void   lvd_xml_led_apply(lv_xml_parser_state_t * state, const char ** attrs);
#endif
#endif /* LVD_XML_LED_H */
