/**
 * @file lvd_xml_extra.h
 * LVGL Web Designer — self-written XML parsers for the 13 widgets that have
 * no official parser in LVGL 9.4 (led, line, spinner, imagebutton, animimage,
 * msgbox, list, menu, win, tileview, arclabel, canvas*, lottie).
 * (*canvas: the official parser exists but allocates no draw buffer; ours
 *  overrides it — lv_xml_register_widget prepends, so the last registration
 *  for a given name wins.)
 *
 * Contract: attribute names = C setter minus the lv_<widget>_set_ prefix
 * (snake_case); enum tokens = C enum minus its prefix, lowercased; xml tags
 * are lv_<type>, children lv_<type>-<child>. The machine-readable single
 * source of truth for the schema/codegen side is manifest.json in this
 * directory — keep it in lockstep with the .c files.
 */
#ifndef LVD_XML_EXTRA_H
#define LVD_XML_EXTRA_H

#ifdef __cplusplus
extern "C" {
#endif

#include "lvgl.h"

#if LV_USE_XML

#include "src/others/xml/lv_xml.h"
#include "src/others/xml/lv_xml_parser.h"
#include "src/others/xml/lv_xml_utils.h"
#include "src/others/xml/lv_xml_base_types.h"
#include "src/others/xml/lv_xml_widget.h"
#include "src/others/xml/parsers/lv_xml_obj_parser.h"

/** Register every extra widget parser. Call once, after lv_init(). */
void lvd_register_extra_widgets(void);

#endif /* LV_USE_XML */

#ifdef __cplusplus
} /*extern "C"*/
#endif

#endif /* LVD_XML_EXTRA_H */
