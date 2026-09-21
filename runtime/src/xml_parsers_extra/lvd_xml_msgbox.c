/**
 * @file lvd_xml_msgbox.c
 * <lv_msgbox title="Title" text="Body" close_button="true">
 *     <lv_msgbox-button text="OK"/>
 * </lv_msgbox>
 *
 * title/text are idempotent on re-apply (L1 updates): if the label already
 * exists its text is updated instead of adding a second one.
 * lv_msgbox-button = lv_msgbox_add_footer_button(text).
 */
#include "lvd_xml_msgbox.h"
#if LV_USE_XML && LV_USE_MSGBOX

/* first lv_label child of `parent` or NULL */
static lv_obj_t * first_label_child(lv_obj_t * parent)
{
    if(parent == NULL) return NULL;
    uint32_t cnt = lv_obj_get_child_count(parent);
    for(uint32_t i = 0; i < cnt; i++) {
        lv_obj_t * child = lv_obj_get_child(parent, (int32_t)i);
        if(lv_obj_check_type(child, &lv_label_class)) return child;
    }
    return NULL;
}

static bool header_has_button(lv_obj_t * mbox)
{
    lv_obj_t * header = lv_msgbox_get_header(mbox);
    if(header == NULL) return false;
    uint32_t cnt = lv_obj_get_child_count(header);
    for(uint32_t i = 0; i < cnt; i++) {
        lv_obj_t * child = lv_obj_get_child(header, (int32_t)i);
        if(lv_obj_check_type(child, &lv_button_class)) return true;
    }
    return false;
}

void * lvd_xml_msgbox_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    LV_UNUSED(attrs);
    return lv_msgbox_create(lv_xml_state_get_parent(state));
}

void lvd_xml_msgbox_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    lv_obj_t * item = lv_xml_state_get_item(state);
    lv_xml_obj_apply(state, attrs);

    for(int i = 0; attrs[i]; i += 2) {
        const char * name  = attrs[i];
        const char * value = attrs[i + 1];

        if(lv_streq("title", name)) {
            lv_obj_t * title = lv_msgbox_get_title(item);
            if(title) lv_label_set_text(title, value);
            else lv_msgbox_add_title(item, value);
        }
        else if(lv_streq("text", name)) {
            lv_obj_t * label = first_label_child(lv_msgbox_get_content(item));
            if(label) lv_label_set_text(label, value);
            else lv_msgbox_add_text(item, value);
        }
        else if(lv_streq("close_button", name)) {
            if(lv_xml_to_bool(value) && !header_has_button(item)) lv_msgbox_add_close_button(item);
        }
    }
}

void * lvd_xml_msgbox_button_create(lv_xml_parser_state_t * state, const char ** attrs)
{
    const char * text = lv_xml_get_value_of(attrs, "text");
    return lv_msgbox_add_footer_button(lv_xml_state_get_parent(state), text ? text : "");
}

void lvd_xml_msgbox_button_apply(lv_xml_parser_state_t * state, const char ** attrs)
{
    lv_xml_obj_apply(state, attrs);
}

#endif /* LV_USE_XML && LV_USE_MSGBOX */
