/**
 * @file lvd_xml_tileview.c
 * <lv_tileview>
 *     <lv_tileview-tile col="0" row="0" dir="all"> ...children... </lv_tileview-tile>
 * </lv_tileview>
 *
 * The tile is a plain container: nested XML children are created inside it.
 * dir accepts '|'-combined tokens (e.g. "left|bottom"); default "all".
 */
#include "lvd_xml_tileview.h"
#if LV_USE_XML && LV_USE_TILEVIEW

/* lv_xml_dir_to_enum() handles single tokens only; allow OR-combos */
static lv_dir_t dir_text_to_enum_value(const char * txt)
{
    char buf[64];
    lv_strlcpy(buf, txt, sizeof(buf));
    lv_dir_t dir = LV_DIR_NONE;
    char * src = buf;
    char * tok;
    while((tok = lv_xml_split_str(&src, '|')) != NULL) {
        dir |= lv_xml_dir_to_enum(tok);
    }
    return dir;
}

void * lvd_xml_tileview_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    LV_UNUSED(attrs);
    return lv_tileview_create(lv_xml_state_get_parent(state));
}

void lvd_xml_tileview_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    lv_xml_obj_apply(state, attrs);
}

void * lvd_xml_tileview_tile_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    const char * col = lv_xml_get_value_of(attrs, "col");
    const char * row = lv_xml_get_value_of(attrs, "row");
    const char * dir = lv_xml_get_value_of(attrs, "dir");
    return lv_tileview_add_tile(lv_xml_state_get_parent(state),
                                col ? (uint8_t)lv_xml_atoi(col) : 0,
                                row ? (uint8_t)lv_xml_atoi(row) : 0,
                                dir ? dir_text_to_enum_value(dir) : LV_DIR_ALL);
}

void lvd_xml_tileview_tile_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    lv_xml_obj_apply(state, attrs);
}

#endif /* LV_USE_XML && LV_USE_TILEVIEW */
