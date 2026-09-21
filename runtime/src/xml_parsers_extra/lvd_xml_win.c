/**
 * @file lvd_xml_win.c
 * <lv_win title="My window">
 *     <lv_win-button icon="img_ref" width="40"/>
 * </lv_win>
 *
 * title is idempotent on re-apply: the first label already in the header is
 * updated instead of adding a second one (lv_win_add_title appends).
 * lv_win-button = lv_win_add_button(icon, width) into the header.
 * NOTE: generic children of <lv_win> land on the win object itself (below
 * header+content) — content-area children are out of scope for this subset.
 */
#include "lvd_xml_win.h"
#if LV_USE_XML && LV_USE_WIN

static lv_obj_t * header_first_label(lv_obj_t * win)
{
    lv_obj_t * header = lv_win_get_header(win);
    if(header == NULL) return NULL;
    uint32_t cnt = lv_obj_get_child_count(header);
    for(uint32_t i = 0; i < cnt; i++) {
        lv_obj_t * child = lv_obj_get_child(header, (int32_t)i);
        if(lv_obj_check_type(child, &lv_label_class)) return child;
    }
    return NULL;
}

void * lvd_xml_win_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    LV_UNUSED(attrs);
    return lv_win_create(lv_xml_state_get_parent(state));
}

void lvd_xml_win_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    lv_obj_t * item = lv_xml_state_get_item(state);
    lv_xml_obj_apply(state, attrs);

    for(int i = 0; attrs[i]; i += 2) {
        const char * name  = attrs[i];
        const char * value = attrs[i + 1];

        if(lv_streq("title", name)) {
            lv_obj_t * label = header_first_label(item);
            if(label) lv_label_set_text(label, value);
            else lv_win_add_title(item, value);
        }
    }
}

void * lvd_xml_win_button_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    const char * icon  = lv_xml_get_value_of(attrs, "icon");
    const char * width = lv_xml_get_value_of(attrs, "width");
    const void * icon_src = icon ? lv_xml_get_image(&state->scope, icon) : NULL;
    int32_t w = width ? lv_xml_to_size(width) : 40;
    return lv_win_add_button(lv_xml_state_get_parent(state), icon_src, w);
}

void lvd_xml_win_button_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    lv_xml_obj_apply(state, attrs);
}

#endif /* LV_USE_XML && LV_USE_WIN */
