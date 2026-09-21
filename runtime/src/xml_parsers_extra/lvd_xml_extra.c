/**
 * @file lvd_xml_extra.c
 * Registration entry point for the 13 self-written widget parsers.
 * Called once from lvd_init() (bridge.c) right after lv_init().
 *
 * lv_xml_register_widget() PREPENDS to the processor list and lookups scan
 * from the head, so re-registering "lv_canvas" here overrides the official
 * buffer-less canvas parser registered by lv_xml_init().
 */
#include "lvd_xml_extra.h"

#if LV_USE_XML

#include "lvd_xml_led.h"
#include "lvd_xml_line.h"
#include "lvd_xml_spinner.h"
#include "lvd_xml_imagebutton.h"
#include "lvd_xml_animimage.h"
#include "lvd_xml_msgbox.h"
#include "lvd_xml_list.h"
#include "lvd_xml_menu.h"
#include "lvd_xml_win.h"
#include "lvd_xml_tileview.h"
#include "lvd_xml_arclabel.h"
#include "lvd_xml_canvas.h"
#include "lvd_xml_lottie.h"

void lvd_register_extra_widgets(void)
{
#if LV_USE_LED
    lv_xml_register_widget("lv_led", lvd_xml_led_create, lvd_xml_led_apply);
#endif
#if LV_USE_LINE
    lv_xml_register_widget("lv_line", lvd_xml_line_create, lvd_xml_line_apply);
#endif
#if LV_USE_SPINNER
    lv_xml_register_widget("lv_spinner", lvd_xml_spinner_create, lvd_xml_spinner_apply);
#endif
#if LV_USE_IMAGEBUTTON
    lv_xml_register_widget("lv_imagebutton", lvd_xml_imagebutton_create, lvd_xml_imagebutton_apply);
#endif
#if LV_USE_ANIMIMG
    lv_xml_register_widget("lv_animimage", lvd_xml_animimage_create, lvd_xml_animimage_apply);
#endif
#if LV_USE_MSGBOX
    lv_xml_register_widget("lv_msgbox", lvd_xml_msgbox_create, lvd_xml_msgbox_apply);
    lv_xml_register_widget("lv_msgbox-button", lvd_xml_msgbox_button_create, lvd_xml_msgbox_button_apply);
#endif
#if LV_USE_LIST
    lv_xml_register_widget("lv_list", lvd_xml_list_create, lvd_xml_list_apply);
    lv_xml_register_widget("lv_list-text", lvd_xml_list_text_create, lvd_xml_list_text_apply);
    lv_xml_register_widget("lv_list-button", lvd_xml_list_button_create, lvd_xml_list_button_apply);
#endif
#if LV_USE_MENU
    lv_xml_register_widget("lv_menu", lvd_xml_menu_create, lvd_xml_menu_apply);
    lv_xml_register_widget("lv_menu-page", lvd_xml_menu_page_create, lvd_xml_menu_page_apply);
#endif
#if LV_USE_WIN
    lv_xml_register_widget("lv_win", lvd_xml_win_create, lvd_xml_win_apply);
    lv_xml_register_widget("lv_win-button", lvd_xml_win_button_create, lvd_xml_win_button_apply);
#endif
#if LV_USE_TILEVIEW
    lv_xml_register_widget("lv_tileview", lvd_xml_tileview_create, lvd_xml_tileview_apply);
    lv_xml_register_widget("lv_tileview-tile", lvd_xml_tileview_tile_create, lvd_xml_tileview_tile_apply);
#endif
#if LV_USE_ARCLABEL
    lv_xml_register_widget("lv_arclabel", lvd_xml_arclabel_create, lvd_xml_arclabel_apply);
#endif
#if LV_USE_CANVAS
    lv_xml_register_widget("lv_canvas", lvd_xml_canvas_create, lvd_xml_canvas_apply);  /* override */
#endif
#if LV_USE_LOTTIE
    lv_xml_register_widget("lv_lottie", lvd_xml_lottie_create, lvd_xml_lottie_apply);
#endif
}

#endif /* LV_USE_XML */
