/**
 * @file bridge_internal.h
 * Shared state/helpers between the bridge compilation units.
 */
#ifndef LVD_BRIDGE_INTERNAL_H
#define LVD_BRIDGE_INTERNAL_H

#include "lvgl.h"

/* The single SDL display, created by the selected host's lvd_init(). */
extern lv_display_t * lvd_disp;

/* Register the LVGL log -> JS sink (bridge_log.c); called from lvd_init() */
void lvd_log_init(void);

/* name -> obj lookup: active-screen root itself, then recursive descendant
 * search, then screens of the display by name. */
lv_obj_t * lvd_find_obj(const char * name);

/* Resolve a PreviewProgram imageRef to the host-owned MEMFS source path. */
const char * lvd_find_image_src(const char * name);

/* Resolve PreviewProgram text_font: built-in/default or registered tiny_ttf. */
const lv_font_t * lvd_find_font(const char * name);

/* Recreate the partial draw buffer and select the requested display format. */
int lvd_configure_display(int32_t width, int32_t height, const char * color_format);

#endif /* LVD_BRIDGE_INTERNAL_H */
