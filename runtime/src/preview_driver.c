/**
 * @file preview_driver.c
 * PreviewProgram protocol v1 的受控 LVGL driver。
 *
 * 本单元不包含 XML API、C 模板或通用函数名执行器。JS 仅能调用下面的
 * type+key 白名单。v1 先闭环 obj/label/button/image/slider/switch/arc/bar/line，
 * 并增加 table/tabview 作为 virtual/add/getter 结构切片的宿主。
 * 当前覆盖标量属性、flag/state、inline/named style、subject/binding 和事件。
 */
#include <stdint.h>
#include <errno.h>
#include <float.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

#include "lvgl.h"
#include "bridge_internal.h"

typedef struct lvd_preview_node_rec {
    char * name;
    char * type;
    lv_obj_t * obj;
    void * structural_handle;
    const void * imagebutton_src[2][3];
    lv_point_precise_t * line_points;
    char * roller_options;
    int32_t roller_selected;
    int roller_selected_set;
    int roller_selected_animated;
    int roller_mode;
    char ** buttonmatrix_map;
    uint32_t buttonmatrix_map_count;
    uint32_t spinner_duration;
    uint32_t spinner_angle;
    int spinner_duration_set;
    int spinner_angle_set;
    int menu_page_set;
    const void ** animimage_srcs;
    uint32_t animimage_src_count;
    lv_draw_buf_t * canvas_buf;
    int32_t canvas_width;
    int32_t canvas_height;
    lv_color_t canvas_fill_color;
    struct lvd_preview_node_rec * next;
} lvd_preview_node_rec_t;

typedef struct lvd_preview_style_rec {
    char * name;
    lv_style_t style;
    struct lvd_preview_style_rec * next;
} lvd_preview_style_rec_t;

typedef enum {
    LVD_SUBJECT_INT,
    LVD_SUBJECT_FLOAT,
    LVD_SUBJECT_STRING,
    LVD_SUBJECT_COLOR,
} lvd_preview_subject_type_t;

typedef struct lvd_preview_subject_rec {
    char * name;
    lvd_preview_subject_type_t type;
    lv_subject_t subject;
    char * string_buf;
    char * string_prev_buf;
    struct lvd_preview_subject_rec * next;
} lvd_preview_subject_rec_t;

typedef enum {
    LVD_PREVIEW_EVENT_CALLBACK,
    LVD_PREVIEW_EVENT_SCREEN,
} lvd_preview_event_kind_t;

typedef struct lvd_preview_event_rec {
    lvd_preview_event_kind_t kind;
    char * callback;
    char * user_data;
    int has_user_data;
    char * screen_name;
    lv_screen_load_anim_t anim;
    uint32_t duration;
    uint32_t delay;
    struct lvd_preview_event_rec * next;
} lvd_preview_event_rec_t;

static lvd_preview_node_rec_t * g_nodes = NULL;
static lvd_preview_style_rec_t * g_styles = NULL;
static lvd_preview_subject_rec_t * g_subjects = NULL;
static lvd_preview_event_rec_t * g_events = NULL;
static lv_obj_t * g_pad = NULL;
static int g_clearing = 0;

EM_JS(void, lvd_preview_js_event_stub,
      (const char * callback, int code, const char * user_data, int has_user_data), {
    if(Module.__lvEventStub) {
        Module.__lvEventStub(
            UTF8ToString(callback), code,
            has_user_data ? UTF8ToString(user_data) : undefined
        );
    }
});

static lvd_preview_node_rec_t * find_rec(const char * name)
{
    if(!name) return NULL;
    for(lvd_preview_node_rec_t * r = g_nodes; r; r = r->next)
        if(strcmp(r->name, name) == 0) return r;
    return NULL;
}

static lvd_preview_style_rec_t * find_style(const char * name)
{
    if(!name) return NULL;
    for(lvd_preview_style_rec_t * r = g_styles; r; r = r->next)
        if(strcmp(r->name, name) == 0) return r;
    return NULL;
}

static lvd_preview_subject_rec_t * find_subject(const char * name)
{
    if(!name) return NULL;
    for(lvd_preview_subject_rec_t * r = g_subjects; r; r = r->next)
        if(strcmp(r->name, name) == 0) return r;
    return NULL;
}

static int track(const char * name, const char * type, lv_obj_t * obj)
{
#if !LV_USE_OBJ_NAME
    (void)name; (void)type; (void)obj;
    return -4;
#else
    if(!name || !name[0] || !type || !obj || find_rec(name)) return -3;
    lvd_preview_node_rec_t * r = calloc(1, sizeof(*r));
    if(!r) return -1;
    r->name = strdup(name);
    r->type = strdup(type);
    if(!r->name || !r->type) {
        free(r->name);
        free(r->type);
        free(r);
        return -1;
    }
    r->obj = obj;
    r->next = g_nodes;
    g_nodes = r;
    lv_obj_set_name(obj, name);
    return 0;
#endif
}

static int track_structural_handle(const char * name, const char * type,
                                   lv_obj_t * parent_obj, void * handle)
{
    if(!name || !name[0] || !type || !parent_obj || !handle || find_rec(name)) return -3;
    lvd_preview_node_rec_t * r = calloc(1, sizeof(*r));
    if(!r) return -1;
    r->name = strdup(name);
    r->type = strdup(type);
    if(!r->name || !r->type) {
        free(r->name);
        free(r->type);
        free(r);
        return -1;
    }
    r->obj = parent_obj;
    r->structural_handle = handle;
    r->next = g_nodes;
    g_nodes = r;
    return 0;
}

static int color_from_hex(const char * text, lv_color_t * color);

#if LV_USE_CANVAS
static int canvas_refresh_buf(lvd_preview_node_rec_t * r)
{
    if(!r || !r->obj || r->canvas_width < 1 || r->canvas_height < 1) return -4;
    if(r->canvas_width > 2048 || r->canvas_height > 2048
       || (int64_t)r->canvas_width * r->canvas_height > 1048576) return -4;
    lv_draw_buf_t * old = r->canvas_buf;
    if(!old || old->header.w != (uint32_t)r->canvas_width
       || old->header.h != (uint32_t)r->canvas_height) {
        lv_draw_buf_t * next = lv_draw_buf_create(r->canvas_width, r->canvas_height,
                                                   LV_COLOR_FORMAT_ARGB8888, 0);
        if(!next) return -1;
#if LV_USE_LOTTIE
        if(strcmp(r->type, "lottie") == 0) {
            lv_draw_buf_clear(next, NULL);
            lv_lottie_set_draw_buf(r->obj, next);
        }
        else
#endif
        lv_canvas_set_draw_buf(r->obj, next);
        r->canvas_buf = next;
        if(old) lv_draw_buf_destroy(old);
    }
    if(strcmp(r->type, "canvas") == 0)
        lv_canvas_fill_bg(r->obj, r->canvas_fill_color, LV_OPA_COVER);
    return 0;
}
#endif

#if LV_USE_CHART
static int chart_axis_from_name(const char * text, lv_chart_axis_t * axis)
{
    if(strcmp(text, "primary_x") == 0) *axis = LV_CHART_AXIS_PRIMARY_X;
    else if(strcmp(text, "primary_y") == 0) *axis = LV_CHART_AXIS_PRIMARY_Y;
    else if(strcmp(text, "secondary_x") == 0) *axis = LV_CHART_AXIS_SECONDARY_X;
    else if(strcmp(text, "secondary_y") == 0) *axis = LV_CHART_AXIS_SECONDARY_Y;
    else return -4;
    return 0;
}

static int dir_from_name(const char * text, lv_dir_t * dir)
{
    if(strcmp(text, "none") == 0) *dir = LV_DIR_NONE;
    else if(strcmp(text, "left") == 0) *dir = LV_DIR_LEFT;
    else if(strcmp(text, "right") == 0) *dir = LV_DIR_RIGHT;
    else if(strcmp(text, "top") == 0) *dir = LV_DIR_TOP;
    else if(strcmp(text, "bottom") == 0) *dir = LV_DIR_BOTTOM;
    else if(strcmp(text, "hor") == 0) *dir = LV_DIR_HOR;
    else if(strcmp(text, "ver") == 0) *dir = LV_DIR_VER;
    else if(strcmp(text, "all") == 0) *dir = LV_DIR_ALL;
    else return -4;
    return 0;
}
#endif

static void free_buttonmatrix_map(lvd_preview_node_rec_t * r)
{
    if(!r || !r->buttonmatrix_map) return;
    for(uint32_t index = 0; index < r->buttonmatrix_map_count; index++) {
        free(r->buttonmatrix_map[index]);
    }
    free(r->buttonmatrix_map);
    r->buttonmatrix_map = NULL;
    r->buttonmatrix_map_count = 0;
}

static void clear_tracked(void)
{
    /* 只删根 screen；子节点由 LVGL 递归销毁。 */
    for(lvd_preview_node_rec_t * r = g_nodes; r; r = r->next) {
        if(strcmp(r->type, "screen") == 0 && r->obj) lv_obj_delete(r->obj);
    }
    while(g_nodes) {
        lvd_preview_node_rec_t * dead = g_nodes;
        g_nodes = dead->next;
        free(dead->name);
        free(dead->type);
        free(dead->line_points);
        free(dead->roller_options);
        free_buttonmatrix_map(dead);
        free(dead->animimage_srcs);
        if(dead->canvas_buf) lv_draw_buf_destroy(dead->canvas_buf);
        free(dead);
    }
}

static void clear_styles(void)
{
    while(g_styles) {
        lvd_preview_style_rec_t * dead = g_styles;
        g_styles = dead->next;
        lv_style_reset(&dead->style);
        free(dead->name);
        free(dead);
    }
}

static void clear_subjects(void)
{
    while(g_subjects) {
        lvd_preview_subject_rec_t * dead = g_subjects;
        g_subjects = dead->next;
        lv_subject_deinit(&dead->subject);
        free(dead->string_buf);
        free(dead->string_prev_buf);
        free(dead->name);
        free(dead);
    }
}

static void clear_events(void)
{
    while(g_events) {
        lvd_preview_event_rec_t * dead = g_events;
        g_events = dead->next;
        free(dead->callback);
        free(dead->user_data);
        free(dead->screen_name);
        free(dead);
    }
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_begin(int protocol_version, int32_t width, int32_t height,
                      const char * color_format)
{
    if(protocol_version != 1 || width <= 0 || height <= 0 || !color_format) return -3;
    /* Keep the accepted protocol formats explicit: the host selects the same
     * LVGL draw format and converts that partial buffer into Canvas RGBA. */
    if(strcmp(color_format, "RGB565") != 0
       && strcmp(color_format, "RGB565_SWAPPED") != 0
       && strcmp(color_format, "RGB888") != 0
       && strcmp(color_format, "XRGB8888") != 0
       && strcmp(color_format, "ARGB8888") != 0) return -4;
    if(!lvd_disp) return -1;
    int display_rc = lvd_configure_display(width, height, color_format);
    if(display_rc != 0) return display_rc;

    lv_obj_t * next_pad = lv_obj_create(NULL);
    if(!next_pad) return -1;
    lv_screen_load(next_pad);
    g_clearing = 1;
    clear_tracked();
    /* 自定义 event 的 user_data 由本 driver 持有，只能在旧对象删完后释放。 */
    clear_events();
    /* 对象删除会自动移除其 observer；之后才能 deinit subject。 */
    clear_subjects();
    /* style 只能在所有引用它的旧对象销毁后 reset。 */
    clear_styles();
    if(g_pad && g_pad != next_pad) lv_obj_delete(g_pad);
    g_clearing = 0;
    g_pad = next_pad;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_create_screen(const char * name)
{
    if(!name || !name[0] || find_rec(name)) return -3;
    lv_obj_t * screen = lv_obj_create(NULL);
    if(!screen) return -1;
    int rc = track(name, "screen", screen);
    if(rc != 0) lv_obj_delete(screen);
    return rc;
}

static lv_obj_t * create_widget(lv_obj_t * parent, const char * type)
{
    if(strcmp(type, "obj") == 0) return lv_obj_create(parent);
#if LV_USE_LABEL
    if(strcmp(type, "label") == 0) return lv_label_create(parent);
#endif
#if LV_USE_BUTTON
    if(strcmp(type, "button") == 0) return lv_button_create(parent);
#endif
#if LV_USE_IMAGE
    if(strcmp(type, "image") == 0) return lv_image_create(parent);
#endif
#if LV_USE_SLIDER
    if(strcmp(type, "slider") == 0) return lv_slider_create(parent);
#endif
#if LV_USE_SWITCH
    if(strcmp(type, "switch") == 0) return lv_switch_create(parent);
#endif
#if LV_USE_ARC
    if(strcmp(type, "arc") == 0) return lv_arc_create(parent);
#endif
#if LV_USE_BAR
    if(strcmp(type, "bar") == 0) return lv_bar_create(parent);
#endif
#if LV_USE_TABLE
    if(strcmp(type, "table") == 0) return lv_table_create(parent);
#endif
#if LV_USE_TABVIEW
    if(strcmp(type, "tabview") == 0) return lv_tabview_create(parent);
#endif
#if LV_USE_LIST
    if(strcmp(type, "list") == 0) return lv_list_create(parent);
#endif
#if LV_USE_IMAGEBUTTON
    if(strcmp(type, "imagebutton") == 0) return lv_imagebutton_create(parent);
#endif
#if LV_USE_LINE
    if(strcmp(type, "line") == 0) return lv_line_create(parent);
#endif
#if LV_USE_ARCLABEL
    if(strcmp(type, "arclabel") == 0) return lv_arclabel_create(parent);
#endif
#if LV_USE_SPAN
    if(strcmp(type, "spangroup") == 0) return lv_spangroup_create(parent);
#endif
#if LV_USE_CHECKBOX
    if(strcmp(type, "checkbox") == 0) return lv_checkbox_create(parent);
#endif
#if LV_USE_DROPDOWN
    if(strcmp(type, "dropdown") == 0) return lv_dropdown_create(parent);
#endif
#if LV_USE_ROLLER
    if(strcmp(type, "roller") == 0) return lv_roller_create(parent);
#endif
#if LV_USE_TEXTAREA
    if(strcmp(type, "textarea") == 0) return lv_textarea_create(parent);
#endif
#if LV_USE_SPINBOX
    if(strcmp(type, "spinbox") == 0) return lv_spinbox_create(parent);
#endif
#if LV_USE_BUTTONMATRIX
    if(strcmp(type, "buttonmatrix") == 0) return lv_buttonmatrix_create(parent);
#endif
#if LV_USE_KEYBOARD
    if(strcmp(type, "keyboard") == 0) return lv_keyboard_create(parent);
#endif
#if LV_USE_LED
    if(strcmp(type, "led") == 0) return lv_led_create(parent);
#endif
#if LV_USE_SPINNER
    if(strcmp(type, "spinner") == 0) return lv_spinner_create(parent);
#endif
#if LV_USE_QRCODE
    if(strcmp(type, "qrcode") == 0) return lv_qrcode_create(parent);
#endif
#if LV_USE_SCALE
    if(strcmp(type, "scale") == 0) return lv_scale_create(parent);
#endif
#if LV_USE_CALENDAR
    if(strcmp(type, "calendar") == 0) return lv_calendar_create(parent);
#endif
#if LV_USE_MSGBOX
    if(strcmp(type, "msgbox") == 0) return lv_msgbox_create(parent);
#endif
#if LV_USE_MENU
    if(strcmp(type, "menu") == 0) return lv_menu_create(parent);
#endif
#if LV_USE_WIN
    if(strcmp(type, "win") == 0) return lv_win_create(parent);
#endif
#if LV_USE_TILEVIEW
    if(strcmp(type, "tileview") == 0) return lv_tileview_create(parent);
#endif
#if LV_USE_CHART
    if(strcmp(type, "chart") == 0) return lv_chart_create(parent);
#endif
#if LV_USE_ANIMIMG
    if(strcmp(type, "animimage") == 0) return lv_animimg_create(parent);
#endif
#if LV_USE_CANVAS
    if(strcmp(type, "canvas") == 0) return lv_canvas_create(parent);
#endif
#if LV_USE_LOTTIE
    if(strcmp(type, "lottie") == 0) return lv_lottie_create(parent);
#endif
    return NULL;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_create_node(const char * parent_name, const char * name, const char * type)
{
    if(!parent_name || !name || !type || !name[0] || find_rec(name)) return -3;
    lvd_preview_node_rec_t * parent = find_rec(parent_name);
    if(!parent || !parent->obj) return -2;
    lv_obj_t * obj = create_widget(parent->obj, type);
    if(!obj) return -4;
    int rc = track(name, type, obj);
    if(rc != 0) lv_obj_delete(obj);
#if LV_USE_CANVAS
    if(rc == 0 && (strcmp(type, "canvas") == 0 || strcmp(type, "lottie") == 0)) {
        lvd_preview_node_rec_t * canvas = find_rec(name);
        canvas->canvas_width = 100;
        canvas->canvas_height = 100;
        canvas->canvas_fill_color = lv_color_white();
        rc = canvas_refresh_buf(canvas);
    }
#endif
    return rc;
}

static int parse_nonnegative_i32(const char * text, int32_t * value)
{
    if(!text || !value || !text[0]) return -3;
    char * end = NULL;
    errno = 0;
    long parsed = strtol(text, &end, 10);
    if(errno == ERANGE || end == text || *end != '\0' || parsed < 0 || parsed > INT32_MAX) return -4;
    *value = (int32_t)parsed;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_create_structural(const char * parent_name, const char * name,
                                  const char * type, const char * arg)
{
    if(!parent_name || !name || !name[0] || !type || !arg || find_rec(name)) return -3;
    lvd_preview_node_rec_t * parent = find_rec(parent_name);
    if(!parent || !parent->obj) return -2;
#if LV_USE_SPAN
    if(strcmp(parent->type, "spangroup") == 0 && strcmp(type, "spangroup-span") == 0) {
        if(arg[0]) return -4;
        lv_span_t * span = lv_spangroup_add_span(parent->obj);
        if(!span) return -1;
        return track_structural_handle(name, type, parent->obj, span);
    }
#endif
    lv_obj_t * obj = NULL;
#if LV_USE_CALENDAR && LV_USE_CALENDAR_HEADER_ARROW
    if(strcmp(parent->type, "calendar") == 0 && strcmp(type, "calendar-header_arrow") == 0) {
        if(arg[0]) return -4;
        obj = lv_calendar_add_header_arrow(parent->obj);
    }
    else
#endif
#if LV_USE_CALENDAR && LV_USE_CALENDAR_HEADER_DROPDOWN
    if(strcmp(parent->type, "calendar") == 0 && strcmp(type, "calendar-header_dropdown") == 0) {
        if(arg[0]) return -4;
        obj = lv_calendar_add_header_dropdown(parent->obj);
    }
    else
#endif
#if LV_USE_MSGBOX
    if(strcmp(parent->type, "msgbox") == 0 && strcmp(type, "msgbox-button") == 0) {
        obj = lv_msgbox_add_footer_button(parent->obj, arg);
    }
    else
#endif
#if LV_USE_MENU
    if(strcmp(parent->type, "menu") == 0 && strcmp(type, "menu-page") == 0) {
        obj = lv_menu_page_create(parent->obj, arg[0] ? arg : NULL);
        if(obj && !parent->menu_page_set) {
            lv_menu_set_page(parent->obj, obj);
            parent->menu_page_set = 1;
        }
    }
    else
#endif
#if LV_USE_WIN
    if(strcmp(parent->type, "win") == 0 && strcmp(type, "win-button") == 0) {
        const char * separator = strchr(arg, 0x1f);
        if(!separator || separator == arg + strlen(arg)) return -4;
        int32_t width;
        if(parse_nonnegative_i32(separator + 1, &width) != 0 || width < 1) return -4;
        const void * icon_src = NULL;
        if(separator != arg) {
            size_t icon_len = (size_t)(separator - arg);
            char * icon = malloc(icon_len + 1);
            if(!icon) return -1;
            memcpy(icon, arg, icon_len);
            icon[icon_len] = '\0';
            icon_src = lvd_find_image_src(icon);
            free(icon);
            if(!icon_src) return -2;
        }
        obj = lv_win_add_button(parent->obj, icon_src, width);
    }
    else
#endif
#if LV_USE_TILEVIEW
    if(strcmp(parent->type, "tileview") == 0 && strcmp(type, "tileview-tile") == 0) {
        char * end = NULL;
        errno = 0;
        long col = strtol(arg, &end, 10);
        if(errno == ERANGE || end == arg || *end != 0x1f || col < 0 || col > UINT8_MAX) return -4;
        const char * row_text = end + 1;
        errno = 0;
        long row = strtol(row_text, &end, 10);
        if(errno == ERANGE || end == row_text || *end != 0x1f || row < 0 || row > UINT8_MAX) return -4;
        const char * dir_text = end + 1;
        lv_dir_t dir;
        if(strcmp(dir_text, "none") == 0) dir = LV_DIR_NONE;
        else if(strcmp(dir_text, "left") == 0) dir = LV_DIR_LEFT;
        else if(strcmp(dir_text, "right") == 0) dir = LV_DIR_RIGHT;
        else if(strcmp(dir_text, "top") == 0) dir = LV_DIR_TOP;
        else if(strcmp(dir_text, "bottom") == 0) dir = LV_DIR_BOTTOM;
        else if(strcmp(dir_text, "hor") == 0) dir = LV_DIR_HOR;
        else if(strcmp(dir_text, "ver") == 0) dir = LV_DIR_VER;
        else if(strcmp(dir_text, "all") == 0) dir = LV_DIR_ALL;
        else return -4;
        obj = lv_tileview_add_tile(parent->obj, (uint8_t)col, (uint8_t)row, dir);
    }
    else
#endif
#if LV_USE_CHART
    if(strcmp(parent->type, "chart") == 0
       && (strcmp(type, "chart-series") == 0 || strcmp(type, "chart-cursor") == 0)) {
        const char * separator = strchr(arg, 0x1f);
        if(!separator) return -4;
        size_t color_len = (size_t)(separator - arg);
        if(color_len >= 8) return -4;
        char color_text[8];
        memcpy(color_text, arg, color_len);
        color_text[color_len] = '\0';
        lv_color_t color;
        if(color_from_hex(color_text, &color) != 0) return -4;
        if(strcmp(type, "chart-series") == 0) {
            lv_chart_axis_t axis;
            if(chart_axis_from_name(separator + 1, &axis) != 0) return -4;
            lv_chart_series_t * series = lv_chart_add_series(parent->obj, color, axis);
            if(!series) return -1;
            return track_structural_handle(name, type, parent->obj, series);
        }
        lv_dir_t dir;
        if(dir_from_name(separator + 1, &dir) != 0) return -4;
        lv_chart_cursor_t * cursor = lv_chart_add_cursor(parent->obj, color, dir);
        if(!cursor) return -1;
        return track_structural_handle(name, type, parent->obj, cursor);
    }
    else
#endif
#if LV_USE_DROPDOWN
    if(strcmp(parent->type, "dropdown") == 0 && strcmp(type, "dropdown-list") == 0) {
        if(arg[0]) return -4;
        obj = lv_dropdown_get_list(parent->obj);
    }
    else
#endif
#if LV_USE_TABVIEW
    if(strcmp(parent->type, "tabview") == 0 && strcmp(type, "tabview-tab") == 0) {
        obj = lv_tabview_add_tab(parent->obj, arg);
    }
    else if(strcmp(parent->type, "tabview") == 0 && strcmp(type, "tabview-tab_bar") == 0) {
        if(arg[0]) return -4;
        obj = lv_tabview_get_tab_bar(parent->obj);
    }
    else if(strcmp(parent->type, "tabview") == 0 && strcmp(type, "tabview-tab_button") == 0) {
        int32_t index;
        if(parse_nonnegative_i32(arg, &index) != 0) return -4;
        obj = lv_tabview_get_tab_button(parent->obj, index);
    }
    else
#endif
    {
        return -4;
    }
    if(!obj) return -2;
    /* getter 可能返回宿主内部对象；track 失败时统一留给根 screen 清场，不能局部 delete。 */
    return track(name, type, obj);
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_create_list_item(const char * parent_name, const char * name,
                                 const char * type, const char * icon,
                                 const char * text)
{
    if(!parent_name || !name || !name[0] || !type || !icon || !text || find_rec(name)) return -3;
    lvd_preview_node_rec_t * parent = find_rec(parent_name);
    if(!parent || !parent->obj || strcmp(parent->type, "list") != 0) return -2;
#if LV_USE_LIST
    lv_obj_t * obj = NULL;
    if(strcmp(type, "list-text") == 0) {
        if(icon[0]) return -4;
        obj = lv_list_add_text(parent->obj, text);
    }
    else if(strcmp(type, "list-button") == 0) {
        const void * icon_src = NULL;
        if(icon[0]) {
            icon_src = lvd_find_image_src(icon);
            if(!icon_src) return -2;
        }
        obj = lv_list_add_button(parent->obj, icon_src, text);
    }
    else {
        return -4;
    }
    if(!obj) return -1;
    int rc = track(name, type, obj);
    if(rc != 0) lv_obj_delete(obj);
    return rc;
#else
    (void)type; (void)icon; (void)text;
    return -4;
#endif
}

static int set_common_i32(lv_obj_t * obj, const char * key, int32_t value)
{
    if(strcmp(key, "x") == 0) lv_obj_set_x(obj, value);
    else if(strcmp(key, "y") == 0) lv_obj_set_y(obj, value);
    else if(strcmp(key, "width") == 0) lv_obj_set_width(obj, value);
    else if(strcmp(key, "height") == 0) lv_obj_set_height(obj, value);
    else if(strcmp(key, "flex_grow") == 0) lv_obj_set_flex_grow(obj, (uint8_t)value);
    else if(strcmp(key, "ext_click_area") == 0) lv_obj_set_ext_click_area(obj, value);
    else return -4;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_set_i32(const char * name, const char * key, int32_t value)
{
    if(!name || !key) return -3;
    lvd_preview_node_rec_t * r = find_rec(name);
    if(!r || !r->obj) return -2;
    if(r->structural_handle) {
#if LV_USE_CHART
        if(strcmp(r->type, "chart-cursor") == 0) {
            lv_chart_cursor_t * cursor = (lv_chart_cursor_t *)r->structural_handle;
            if(strcmp(key, "pos_x") == 0) lv_chart_set_cursor_pos_x(r->obj, cursor, value);
            else if(strcmp(key, "pos_y") == 0) lv_chart_set_cursor_pos_y(r->obj, cursor, value);
            else return -4;
            return 0;
        }
#endif
        return -4;
    }
#if LV_USE_CANVAS
    if((strcmp(r->type, "canvas") == 0 || strcmp(r->type, "lottie") == 0)
       && (strcmp(key, "width") == 0
       || strcmp(key, "height") == 0)) {
        if(value < 1 || value > 2048) return -4;
        int32_t old_width = r->canvas_width;
        int32_t old_height = r->canvas_height;
        if(strcmp(key, "width") == 0) r->canvas_width = value;
        else r->canvas_height = value;
        int rc = canvas_refresh_buf(r);
        if(rc != 0) {
            r->canvas_width = old_width;
            r->canvas_height = old_height;
            return rc;
        }
        if(strcmp(key, "width") == 0) lv_obj_set_width(r->obj, value);
        else lv_obj_set_height(r->obj, value);
        return 0;
    }
#endif
    if(set_common_i32(r->obj, key, value) == 0) return 0;

#if LV_USE_IMAGE
    if(strcmp(r->type, "image") == 0) {
        if(strcmp(key, "rotation") == 0) lv_image_set_rotation(r->obj, value);
        else if(strcmp(key, "scale_x") == 0) lv_image_set_scale_x(r->obj, value);
        else if(strcmp(key, "scale_y") == 0) lv_image_set_scale_y(r->obj, value);
        else if(strcmp(key, "pivot_x") == 0) lv_image_set_pivot_x(r->obj, value);
        else if(strcmp(key, "pivot_y") == 0) lv_image_set_pivot_y(r->obj, value);
        else return -4;
        return 0;
    }
#endif
#if LV_USE_SLIDER
    if(strcmp(r->type, "slider") == 0) {
        if(strcmp(key, "min_value") == 0) lv_slider_set_min_value(r->obj, value);
        else if(strcmp(key, "max_value") == 0) lv_slider_set_max_value(r->obj, value);
        else if(strcmp(key, "value") == 0) lv_slider_set_value(r->obj, value, LV_ANIM_OFF);
        else if(strcmp(key, "start_value") == 0) lv_slider_set_start_value(r->obj, value, LV_ANIM_OFF);
        else return -4;
        return 0;
    }
#endif
#if LV_USE_BAR
    if(strcmp(r->type, "bar") == 0) {
        if(strcmp(key, "min_value") == 0) lv_bar_set_min_value(r->obj, value);
        else if(strcmp(key, "max_value") == 0) lv_bar_set_max_value(r->obj, value);
        else if(strcmp(key, "value") == 0) lv_bar_set_value(r->obj, value, LV_ANIM_OFF);
        else if(strcmp(key, "start_value") == 0) lv_bar_set_start_value(r->obj, value, LV_ANIM_OFF);
        else return -4;
        return 0;
    }
#endif
#if LV_USE_ARC
    if(strcmp(r->type, "arc") == 0) {
        if(strcmp(key, "start_angle") == 0) lv_arc_set_start_angle(r->obj, value);
        else if(strcmp(key, "end_angle") == 0) lv_arc_set_end_angle(r->obj, value);
        else if(strcmp(key, "bg_start_angle") == 0) lv_arc_set_bg_start_angle(r->obj, value);
        else if(strcmp(key, "bg_end_angle") == 0) lv_arc_set_bg_end_angle(r->obj, value);
        else if(strcmp(key, "rotation") == 0) lv_arc_set_rotation(r->obj, value);
        else if(strcmp(key, "value") == 0) lv_arc_set_value(r->obj, value);
        else if(strcmp(key, "min_value") == 0) lv_arc_set_min_value(r->obj, value);
        else if(strcmp(key, "max_value") == 0) lv_arc_set_max_value(r->obj, value);
        else if(strcmp(key, "change_rate") == 0) lv_arc_set_change_rate(r->obj, value);
        else if(strcmp(key, "knob_offset") == 0) lv_arc_set_knob_offset(r->obj, value);
        else return -4;
        return 0;
    }
#endif
#if LV_USE_TABLE
    if(strcmp(r->type, "table") == 0) {
        if(value < 0) return -4;
        if(strcmp(key, "column_count") == 0) lv_table_set_column_count(r->obj, (uint32_t)value);
        else if(strcmp(key, "row_count") == 0) lv_table_set_row_count(r->obj, (uint32_t)value);
        else return -4;
        return 0;
    }
#endif
#if LV_USE_TABVIEW
    if(strcmp(r->type, "tabview") == 0 && strcmp(key, "active") == 0) {
        if(value < 0) return -4;
        lv_tabview_set_active(r->obj, (uint32_t)value, LV_ANIM_OFF);
        return 0;
    }
#endif
#if LV_USE_LINE
    if(strcmp(r->type, "line") == 0 && strcmp(key, "y_invert") == 0) {
        if(value != 0 && value != 1) return -4;
        lv_line_set_y_invert(r->obj, value != 0);
        return 0;
    }
#endif
#if LV_USE_DROPDOWN
    if(strcmp(r->type, "dropdown") == 0 && strcmp(key, "selected") == 0) {
        if(value < 0) return -4;
        lv_dropdown_set_selected(r->obj, (uint32_t)value);
        return 0;
    }
#endif
#if LV_USE_ROLLER
    if(strcmp(r->type, "roller") == 0) {
        if(strcmp(key, "selected") == 0) {
            if(value < 0) return -4;
            r->roller_selected = value;
            r->roller_selected_set = 1;
            lv_roller_set_selected(r->obj, (uint32_t)value,
                                   r->roller_selected_animated ? LV_ANIM_ON : LV_ANIM_OFF);
        }
        else if(strcmp(key, "selected_animated") == 0) {
            if(value != 0 && value != 1) return -4;
            r->roller_selected_animated = value;
            if(r->roller_selected_set) {
                lv_roller_set_selected(r->obj, (uint32_t)r->roller_selected,
                                       value ? LV_ANIM_ON : LV_ANIM_OFF);
            }
        }
        else if(strcmp(key, "visible_row_count") == 0) {
            if(value < 0) return -4;
            lv_roller_set_visible_row_count(r->obj, (uint32_t)value);
        }
        else return -4;
        return 0;
    }
#endif
#if LV_USE_TEXTAREA
    if(strcmp(r->type, "textarea") == 0) {
        if(strcmp(key, "one_line") == 0) {
            if(value != 0 && value != 1) return -4;
            lv_textarea_set_one_line(r->obj, value != 0);
        }
        else if(strcmp(key, "password_mode") == 0) {
            if(value != 0 && value != 1) return -4;
            lv_textarea_set_password_mode(r->obj, value != 0);
        }
        else if(strcmp(key, "text_selection") == 0) {
            if(value != 0 && value != 1) return -4;
            lv_textarea_set_text_selection(r->obj, value != 0);
        }
        else if(strcmp(key, "password_show_time") == 0) {
            if(value < 0) return -4;
            lv_textarea_set_password_show_time(r->obj, (uint32_t)value);
        }
        else if(strcmp(key, "cursor_pos") == 0) lv_textarea_set_cursor_pos(r->obj, value);
        else if(strcmp(key, "max_length") == 0) {
            if(value < 0) return -4;
            lv_textarea_set_max_length(r->obj, (uint32_t)value);
        }
        else return -4;
        return 0;
    }
#endif
#if LV_USE_SPINBOX
    if(strcmp(r->type, "spinbox") == 0) {
        if(strcmp(key, "value") == 0) lv_spinbox_set_value(r->obj, value);
        else if(strcmp(key, "rollover") == 0) {
            if(value != 0 && value != 1) return -4;
            lv_spinbox_set_rollover(r->obj, value != 0);
        }
        else if(strcmp(key, "digit_count") == 0) {
            if(value < 0) return -4;
            lv_spinbox_set_digit_count(r->obj, (uint32_t)value);
        }
        else if(strcmp(key, "dec_point_pos") == 0) {
            if(value < 0) return -4;
            lv_spinbox_set_dec_point_pos(r->obj, (uint32_t)value);
        }
        else if(strcmp(key, "min_value") == 0) lv_spinbox_set_min_value(r->obj, value);
        else if(strcmp(key, "max_value") == 0) lv_spinbox_set_max_value(r->obj, value);
        else if(strcmp(key, "step") == 0) {
            if(value < 0) return -4;
            lv_spinbox_set_step(r->obj, (uint32_t)value);
        }
        else return -4;
        return 0;
    }
#endif
#if LV_USE_BUTTONMATRIX
    if(strcmp(r->type, "buttonmatrix") == 0) {
        if(strcmp(key, "selected_button") == 0) {
            if(value < 0) return -4;
            lv_buttonmatrix_set_selected_button(r->obj, (uint32_t)value);
        }
        else if(strcmp(key, "one_checked") == 0) {
            if(value != 0 && value != 1) return -4;
            lv_buttonmatrix_set_one_checked(r->obj, value != 0);
        }
        else return -4;
        return 0;
    }
#endif
#if LV_USE_KEYBOARD
    if(strcmp(r->type, "keyboard") == 0 && strcmp(key, "popovers") == 0) {
        if(value != 0 && value != 1) return -4;
        lv_keyboard_set_popovers(r->obj, value != 0);
        return 0;
    }
#endif
#if LV_USE_LED
    if(strcmp(r->type, "led") == 0 && strcmp(key, "brightness") == 0) {
        if(value < 0 || value > 255) return -4;
        lv_led_set_brightness(r->obj, (uint8_t)value);
        return 0;
    }
#endif
#if LV_USE_SPINNER
    if(strcmp(r->type, "spinner") == 0) {
        if(strcmp(key, "anim_duration") == 0) {
            if(value < 1) return -4;
            r->spinner_duration = (uint32_t)value;
            r->spinner_duration_set = 1;
        }
        else if(strcmp(key, "angle") == 0) {
            if(value < 0 || value > 360) return -4;
            r->spinner_angle = (uint32_t)value;
            r->spinner_angle_set = 1;
        }
        else return -4;
        if(r->spinner_duration_set && r->spinner_angle_set) {
            lv_spinner_set_anim_params(r->obj, r->spinner_duration, r->spinner_angle);
        }
        return 0;
    }
#endif
#if LV_USE_QRCODE
    if(strcmp(r->type, "qrcode") == 0) {
        if(strcmp(key, "size") == 0) {
            if(value < 1) return -4;
            lv_qrcode_set_size(r->obj, value);
        }
        else if(strcmp(key, "quiet_zone") == 0) {
            if(value != 0 && value != 1) return -4;
            lv_qrcode_set_quiet_zone(r->obj, value != 0);
        }
        else return -4;
        return 0;
    }
#endif
#if LV_USE_SCALE
    if(strcmp(r->type, "scale") == 0) {
        if(strcmp(key, "total_tick_count") == 0) {
            if(value < 2) return -4;
            lv_scale_set_total_tick_count(r->obj, (uint32_t)value);
        }
        else if(strcmp(key, "major_tick_every") == 0) {
            if(value < 1) return -4;
            lv_scale_set_major_tick_every(r->obj, (uint32_t)value);
        }
        else if(strcmp(key, "label_show") == 0) {
            if(value != 0 && value != 1) return -4;
            lv_scale_set_label_show(r->obj, value != 0);
        }
        else if(strcmp(key, "post_draw") == 0) {
            if(value != 0 && value != 1) return -4;
            lv_scale_set_post_draw(r->obj, value != 0);
        }
        else if(strcmp(key, "draw_ticks_on_top") == 0) {
            if(value != 0 && value != 1) return -4;
            lv_scale_set_draw_ticks_on_top(r->obj, value != 0);
        }
        else if(strcmp(key, "min_value") == 0) lv_scale_set_min_value(r->obj, value);
        else if(strcmp(key, "max_value") == 0) lv_scale_set_max_value(r->obj, value);
        else if(strcmp(key, "angle_range") == 0) {
            if(value < 0) return -4;
            lv_scale_set_angle_range(r->obj, (uint32_t)value);
        }
        else if(strcmp(key, "rotation") == 0) lv_scale_set_rotation(r->obj, value);
        else return -4;
        return 0;
    }
#endif
#if LV_USE_CALENDAR
    if(strcmp(r->type, "calendar") == 0) {
        if(strcmp(key, "today_year") == 0) {
            if(value < 0) return -4;
            lv_calendar_set_today_year(r->obj, (uint32_t)value);
        }
        else if(strcmp(key, "today_month") == 0) {
            if(value < 1 || value > 12) return -4;
            lv_calendar_set_today_month(r->obj, (uint32_t)value);
        }
        else if(strcmp(key, "today_day") == 0) {
            if(value < 1 || value > 31) return -4;
            lv_calendar_set_today_day(r->obj, (uint32_t)value);
        }
        else if(strcmp(key, "shown_year") == 0) {
            if(value < 0) return -4;
            lv_calendar_set_shown_year(r->obj, (uint32_t)value);
        }
        else if(strcmp(key, "shown_month") == 0) {
            if(value < 1 || value > 12) return -4;
            lv_calendar_set_shown_month(r->obj, (uint32_t)value);
        }
        else return -4;
        return 0;
    }
#endif
#if LV_USE_CHART
    if(strcmp(r->type, "chart") == 0) {
        if(value < 0) return -4;
        if(strcmp(key, "point_count") == 0) lv_chart_set_point_count(r->obj, (uint32_t)value);
        else if(strcmp(key, "hor_div_line_count") == 0) lv_chart_set_hor_div_line_count(r->obj, (uint32_t)value);
        else if(strcmp(key, "ver_div_line_count") == 0) lv_chart_set_ver_div_line_count(r->obj, (uint32_t)value);
        else return -4;
        return 0;
    }
#endif
#if LV_USE_ANIMIMG
    if(strcmp(r->type, "animimage") == 0) {
        if(strcmp(key, "duration") == 0) {
            if(value < 1) return -4;
            lv_animimg_set_duration(r->obj, (uint32_t)value);
        }
        else if(strcmp(key, "repeat_count") == 0) {
            if(value < 0) return -4;
            lv_animimg_set_repeat_count(r->obj, (uint32_t)value);
        }
        else return -4;
        return 0;
    }
#endif
#if LV_USE_MSGBOX
    if(strcmp(r->type, "msgbox") == 0 && strcmp(key, "close_button") == 0) {
        if(value != 0 && value != 1) return -4;
        if(value) lv_msgbox_add_close_button(r->obj);
        return 0;
    }
#endif
#if LV_USE_ARCLABEL
    if(strcmp(r->type, "arclabel") == 0) {
        if(strcmp(key, "angle_start") == 0) lv_arclabel_set_angle_start(r->obj, value);
        else if(strcmp(key, "angle_size") == 0) lv_arclabel_set_angle_size(r->obj, value);
        else if(strcmp(key, "offset") == 0) lv_arclabel_set_offset(r->obj, value);
        else if(strcmp(key, "radius") == 0) {
            if(value < 0) return -4;
            lv_arclabel_set_radius(r->obj, (uint32_t)value);
        }
        else if(strcmp(key, "center_offset_x") == 0) {
            if(value < 0) return -4;
            lv_arclabel_set_center_offset_x(r->obj, (uint32_t)value);
        }
        else if(strcmp(key, "center_offset_y") == 0) {
            if(value < 0) return -4;
            lv_arclabel_set_center_offset_y(r->obj, (uint32_t)value);
        }
        else if(strcmp(key, "recolor") == 0) {
            if(value != 0 && value != 1) return -4;
            lv_arclabel_set_recolor(r->obj, value != 0);
        }
        else return -4;
        return 0;
    }
#endif
#if LV_USE_SPAN
    if(strcmp(r->type, "spangroup") == 0) {
        if(strcmp(key, "max_lines") == 0) lv_spangroup_set_max_lines(r->obj, value);
        else if(strcmp(key, "indent") == 0) lv_spangroup_set_indent(r->obj, value);
        else return -4;
        return 0;
    }
#endif
    return -4;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_set_point_list(const char * name, const char * key, const char * value)
{
    if(!name || !key || !value) return -3;
    lvd_preview_node_rec_t * r = find_rec(name);
    if(!r || !r->obj) return -2;
#if LV_USE_LINE
    if(strcmp(r->type, "line") != 0 || strcmp(key, "points") != 0) return -4;

    uint32_t point_count = 0;
    for(const char * p = value; *p; p++) {
        if(*p == ',') {
            if(point_count == 4096) return -4;
            point_count++;
        }
    }
    if(point_count == 0) return -4;

    lv_point_precise_t * points = malloc(sizeof(*points) * point_count);
    if(!points) return -1;
    const char * cursor = value;
    for(uint32_t index = 0; index < point_count; index++) {
        char * end = NULL;
        errno = 0;
        double x = strtod(cursor, &end);
        if(errno == ERANGE || end == cursor || *end != ',' || !isfinite(x)) goto invalid;
        cursor = end + 1;
        errno = 0;
        double y = strtod(cursor, &end);
        if(errno == ERANGE || end == cursor || !isfinite(y)) goto invalid;
#if LV_USE_FLOAT
        if(fabs(x) > FLT_MAX || fabs(y) > FLT_MAX) goto invalid;
#else
        if(x < INT32_MIN || x > INT32_MAX || y < INT32_MIN || y > INT32_MAX) goto invalid;
#endif
        if(index + 1 < point_count) {
            if(*end != ' ') goto invalid;
            cursor = end + 1;
            if(!*cursor) goto invalid;
        }
        else if(*end != '\0') goto invalid;
        points[index].x = (lv_value_precise_t)x;
        points[index].y = (lv_value_precise_t)y;
    }

    lv_line_set_points(r->obj, points, point_count);
    free(r->line_points);
    r->line_points = points;
    return 0;

invalid:
    free(points);
    return -4;
#else
    (void)key; (void)value;
    return -4;
#endif
}

#if LV_USE_CHART
EMSCRIPTEN_KEEPALIVE
int lvd_preview_set_i32_list(const char * name, const char * key, const char * value)
{
    if(!name || !key || !value) return -3;
    lvd_preview_node_rec_t * r = find_rec(name);
    if(!r || !r->obj || !r->structural_handle) return -2;
    if(strcmp(r->type, "chart-series") != 0 || strcmp(key, "values") != 0) return -4;
    if(!value[0]) return -4;
    const char * cursor = value;
    uint32_t count = 0;
    while(*cursor) {
        char * end = NULL;
        errno = 0;
        long parsed = strtol(cursor, &end, 10);
        if(errno == ERANGE || end == cursor || parsed < INT32_MIN || parsed > INT32_MAX) return -4;
        if(*end != '\0' && *end != ' ') return -4;
        if(++count > 4096) return -4;
        if(*end && (!end[1] || end[1] == ' ')) return -4;
        cursor = *end ? end + 1 : end;
    }
    cursor = value;
    while(*cursor) {
        char * end = NULL;
        long parsed = strtol(cursor, &end, 10);
        lv_chart_set_next_value(r->obj, (lv_chart_series_t *)r->structural_handle, (int32_t)parsed);
        cursor = *end ? end + 1 : end;
    }
    return 0;
}
#else
EMSCRIPTEN_KEEPALIVE
int lvd_preview_set_i32_list(const char * name, const char * key, const char * value)
{
    (void)name; (void)key; (void)value;
    return -4;
}
#endif

#if LV_USE_BUTTONMATRIX
static int buttonmatrix_ctrl_token(const char * token, size_t n, lv_buttonmatrix_ctrl_t * value)
{
#define LVD_BUTTONMATRIX_CTRL(text, symbol) \
    if(n == sizeof(text) - 1 && strncmp(token, text, n) == 0) { *value = symbol; return 0; }
    LVD_BUTTONMATRIX_CTRL("none", LV_BUTTONMATRIX_CTRL_NONE)
    LVD_BUTTONMATRIX_CTRL("hidden", LV_BUTTONMATRIX_CTRL_HIDDEN)
    LVD_BUTTONMATRIX_CTRL("no_repeat", LV_BUTTONMATRIX_CTRL_NO_REPEAT)
    LVD_BUTTONMATRIX_CTRL("disabled", LV_BUTTONMATRIX_CTRL_DISABLED)
    LVD_BUTTONMATRIX_CTRL("checkable", LV_BUTTONMATRIX_CTRL_CHECKABLE)
    LVD_BUTTONMATRIX_CTRL("checked", LV_BUTTONMATRIX_CTRL_CHECKED)
    LVD_BUTTONMATRIX_CTRL("click_trig", LV_BUTTONMATRIX_CTRL_CLICK_TRIG)
    LVD_BUTTONMATRIX_CTRL("popover", LV_BUTTONMATRIX_CTRL_POPOVER)
    LVD_BUTTONMATRIX_CTRL("recolor", LV_BUTTONMATRIX_CTRL_RECOLOR)
    LVD_BUTTONMATRIX_CTRL("reserved_1", LV_BUTTONMATRIX_CTRL_RESERVED_1)
    LVD_BUTTONMATRIX_CTRL("reserved_2", LV_BUTTONMATRIX_CTRL_RESERVED_2)
    LVD_BUTTONMATRIX_CTRL("custom_1", LV_BUTTONMATRIX_CTRL_CUSTOM_1)
    LVD_BUTTONMATRIX_CTRL("custom_2", LV_BUTTONMATRIX_CTRL_CUSTOM_2)
#undef LVD_BUTTONMATRIX_CTRL
    if(n > 6 && n <= 8 && strncmp(token, "width_", 6) == 0) {
        char text[3] = {0};
        memcpy(text, token + 6, n - 6);
        long width = strtol(text, NULL, 10);
        if(width >= 1 && width <= 15) {
            *value = (lv_buttonmatrix_ctrl_t)width;
            return 0;
        }
    }
    return -4;
}

static int buttonmatrix_apply_ctrl_map(lv_obj_t * obj, const char * value)
{
    if(!obj || !value) return -3;
    if(!value[0]) return 0;
    uint32_t button = 0;
    const char * group = value;
    while(*group) {
        const char * group_end = strchr(group, ' ');
        if(!group_end) group_end = group + strlen(group);
        uint32_t combined = 0;
        const char * token = group;
        while(token < group_end) {
            const char * token_end = memchr(token, '|', (size_t)(group_end - token));
            if(!token_end) token_end = group_end;
            lv_buttonmatrix_ctrl_t ctrl;
            if(token_end == token || buttonmatrix_ctrl_token(
                token, (size_t)(token_end - token), &ctrl) != 0) return -4;
            combined |= (uint32_t)ctrl;
            token = token_end < group_end ? token_end + 1 : group_end;
        }
        lv_buttonmatrix_set_button_ctrl(obj, button++, (lv_buttonmatrix_ctrl_t)combined);
        group = *group_end ? group_end + 1 : group_end;
        if(*group == ' ') return -4;
    }
    return 0;
}

#endif

EMSCRIPTEN_KEEPALIVE
int lvd_preview_set_string_list(const char * name, const char * key, const char * value)
{
    if(!name || !key || !value) return -3;
    lvd_preview_node_rec_t * r = find_rec(name);
    if(!r || !r->obj) return -2;
#if LV_USE_ANIMIMG
    if(strcmp(r->type, "animimage") == 0 && strcmp(key, "srcs") == 0) {
        if(!value[0]) return -4;
        uint32_t count = 1;
        for(const char * p = value; *p; p++) if(*p == 0x1f) count++;
        if(count > 127) return -4;
        const void ** items = calloc(count, sizeof(*items));
        if(!items) return -1;
        const char * start = value;
        for(uint32_t index = 0; index < count; index++) {
            const char * end = strchr(start, 0x1f);
            if(!end) end = start + strlen(start);
            size_t n = (size_t)(end - start);
            if(n == 0) {
                free(items);
                return -4;
            }
            char * asset_name = malloc(n + 1);
            if(!asset_name) {
                free(items);
                return -1;
            }
            memcpy(asset_name, start, n);
            asset_name[n] = '\0';
            items[index] = lvd_find_image_src(asset_name);
            free(asset_name);
            if(!items[index]) {
                free(items);
                return -2;
            }
            start = *end ? end + 1 : end;
        }
        const void ** old_items = r->animimage_srcs;
        r->animimage_srcs = items;
        r->animimage_src_count = count;
        lv_animimg_set_src(r->obj, items, count);
        lv_animimg_start(r->obj);
        free(old_items);
        return 0;
    }
#endif
#if LV_USE_BUTTONMATRIX
    if(strcmp(r->type, "buttonmatrix") == 0 && strcmp(key, "map") == 0) {
    uint32_t count = 1;
    for(const char * p = value; *p; p++) if(*p == 0x1f) count++;
    if(count > 4096) return -4;
    char ** items = calloc((size_t)count + 1, sizeof(*items));
    if(!items) return -1;
    const char * start = value;
    for(uint32_t index = 0; index < count; index++) {
        const char * end = strchr(start, 0x1f);
        if(!end) end = start + strlen(start);
        size_t n = (size_t)(end - start);
        items[index] = malloc(n + 1);
        if(!items[index]) {
            for(uint32_t done = 0; done < index; done++) free(items[done]);
            free(items);
            return -1;
        }
        memcpy(items[index], start, n);
        items[index][n] = '\0';
        start = *end ? end + 1 : end;
    }
    items[count] = strdup("");
    if(!items[count]) {
        for(uint32_t done = 0; done < count; done++) free(items[done]);
        free(items);
        return -1;
    }
    free_buttonmatrix_map(r);
    r->buttonmatrix_map = items;
    r->buttonmatrix_map_count = count + 1;
    lv_buttonmatrix_set_map(r->obj, (const char * const *)items);
    return 0;
    }
#endif
    return -4;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_set_string(const char * name, const char * key, const char * value)
{
    if(!name || !key || !value) return -3;
    lvd_preview_node_rec_t * r = find_rec(name);
    if(!r || !r->obj) return -2;
    if(r->structural_handle) {
#if LV_USE_SPAN
        if(strcmp(r->type, "spangroup-span") == 0) {
            lv_span_t * span = (lv_span_t *)r->structural_handle;
            if(strcmp(key, "text") == 0) {
                lv_spangroup_set_span_text(r->obj, span, value);
                return 0;
            }
            if(strcmp(key, "style") == 0) {
                lvd_preview_style_rec_t * style = find_style(value);
                if(!style) return -2;
                lv_spangroup_set_span_style(r->obj, span, &style->style);
                return 0;
            }
        }
#endif
        return -4;
    }
    if(strcmp(key, "x") == 0 || strcmp(key, "y") == 0
       || strcmp(key, "width") == 0 || strcmp(key, "height") == 0) {
        int32_t size;
        if(strcmp(value, "content") == 0) size = LV_SIZE_CONTENT;
        else {
            size_t n = strlen(value);
            if(n < 2 || value[n - 1] != '%') return -4;
            char * end = NULL;
            long pct = strtol(value, &end, 10);
            if(end != &value[n - 1] || pct < -1000 || pct > 1000) return -4;
            size = lv_pct((int32_t)pct);
        }
        if(strcmp(key, "x") == 0) lv_obj_set_x(r->obj, size);
        else if(strcmp(key, "y") == 0) lv_obj_set_y(r->obj, size);
        else if(strcmp(key, "width") == 0) lv_obj_set_width(r->obj, size);
        else lv_obj_set_height(r->obj, size);
        return 0;
    }
#if LV_USE_LABEL
    if(strcmp(r->type, "label") == 0 && strcmp(key, "text") == 0) {
        lv_label_set_text(r->obj, value);
        return 0;
    }
#endif
#if LV_USE_CHECKBOX
    if(strcmp(r->type, "checkbox") == 0 && strcmp(key, "text") == 0) {
        lv_checkbox_set_text(r->obj, value);
        return 0;
    }
#endif
#if LV_USE_MSGBOX
    if(strcmp(r->type, "msgbox") == 0) {
        if(strcmp(key, "title") == 0) lv_msgbox_add_title(r->obj, value);
        else if(strcmp(key, "text") == 0) lv_msgbox_add_text(r->obj, value);
        else return -4;
        return 0;
    }
#endif
#if LV_USE_WIN
    if(strcmp(r->type, "win") == 0 && strcmp(key, "title") == 0) {
        lv_win_add_title(r->obj, value);
        return 0;
    }
#endif
#if LV_USE_CANVAS
    if(strcmp(r->type, "canvas") == 0 && strcmp(key, "fill_color") == 0) {
        lv_color_t color;
        if(color_from_hex(value, &color) != 0) return -4;
        r->canvas_fill_color = color;
        return canvas_refresh_buf(r);
    }
#endif
#if LV_USE_LOTTIE
    if(strcmp(r->type, "lottie") == 0 && strcmp(key, "src") == 0) {
        const char * path = lvd_find_image_src(value);
        if(!path) return -2;
        if(path[0] && path[1] == ':') path += 2;
        lv_lottie_set_src_file(r->obj, path);
        return 0;
    }
#endif
#if LV_USE_MENU
    if(strcmp(r->type, "menu") == 0) {
        if(strcmp(key, "mode_header") == 0) {
            lv_menu_mode_header_t mode;
            if(strcmp(value, "top_fixed") == 0) mode = LV_MENU_HEADER_TOP_FIXED;
            else if(strcmp(value, "top_unfixed") == 0) mode = LV_MENU_HEADER_TOP_UNFIXED;
            else if(strcmp(value, "bottom_fixed") == 0) mode = LV_MENU_HEADER_BOTTOM_FIXED;
            else return -4;
            lv_menu_set_mode_header(r->obj, mode);
        }
        else if(strcmp(key, "mode_root_back_button") == 0) {
            lv_menu_mode_root_back_button_t mode;
            if(strcmp(value, "disabled") == 0) mode = LV_MENU_ROOT_BACK_BUTTON_DISABLED;
            else if(strcmp(value, "enabled") == 0) mode = LV_MENU_ROOT_BACK_BUTTON_ENABLED;
            else return -4;
            lv_menu_set_mode_root_back_button(r->obj, mode);
        }
        else return -4;
        return 0;
    }
#endif
#if LV_USE_CHART
    if(strcmp(r->type, "chart") == 0) {
        if(strcmp(key, "type") == 0) {
            lv_chart_type_t type;
            if(strcmp(value, "none") == 0) type = LV_CHART_TYPE_NONE;
            else if(strcmp(value, "line") == 0) type = LV_CHART_TYPE_LINE;
            else if(strcmp(value, "bar") == 0) type = LV_CHART_TYPE_BAR;
            else if(strcmp(value, "stacked") == 0) type = LV_CHART_TYPE_STACKED;
            else if(strcmp(value, "scatter") == 0) type = LV_CHART_TYPE_SCATTER;
            else return -4;
            lv_chart_set_type(r->obj, type);
        }
        else if(strcmp(key, "update_mode") == 0) {
            lv_chart_update_mode_t mode;
            if(strcmp(value, "shift") == 0) mode = LV_CHART_UPDATE_MODE_SHIFT;
            else if(strcmp(value, "circular") == 0) mode = LV_CHART_UPDATE_MODE_CIRCULAR;
            else return -4;
            lv_chart_set_update_mode(r->obj, mode);
        }
        else return -4;
        return 0;
    }
#endif
#if LV_USE_DROPDOWN
    if(strcmp(r->type, "dropdown") == 0) {
        if(strcmp(key, "options") == 0) lv_dropdown_set_options(r->obj, value);
        else if(strcmp(key, "text") == 0) lv_dropdown_set_text(r->obj, value);
        else if(strcmp(key, "symbol") == 0) {
            const void * src = lvd_find_image_src(value);
            if(!src) return -2;
            lv_dropdown_set_symbol(r->obj, src);
        }
        else return -4;
        return 0;
    }
#endif
#if LV_USE_ROLLER
    if(strcmp(r->type, "roller") == 0) {
        if(strcmp(key, "options") == 0) {
            char * copy = strdup(value);
            if(!copy) return -1;
            free(r->roller_options);
            r->roller_options = copy;
            lv_roller_set_options(r->obj, copy, (lv_roller_mode_t)r->roller_mode);
        }
        else if(strcmp(key, "options_mode") == 0) {
            if(strcmp(value, "normal") == 0) r->roller_mode = LV_ROLLER_MODE_NORMAL;
            else if(strcmp(value, "infinite") == 0) r->roller_mode = LV_ROLLER_MODE_INFINITE;
            else return -4;
            if(r->roller_options) {
                lv_roller_set_options(r->obj, r->roller_options, (lv_roller_mode_t)r->roller_mode);
            }
        }
        else return -4;
        return 0;
    }
#endif
#if LV_USE_TEXTAREA
    if(strcmp(r->type, "textarea") == 0) {
        if(strcmp(key, "text") == 0) lv_textarea_set_text(r->obj, value);
        else if(strcmp(key, "placeholder_text") == 0) lv_textarea_set_placeholder_text(r->obj, value);
        else return -4;
        return 0;
    }
#endif
#if LV_USE_BUTTONMATRIX
    if(strcmp(r->type, "buttonmatrix") == 0 && strcmp(key, "ctrl_map") == 0) {
        return buttonmatrix_apply_ctrl_map(r->obj, value);
    }
#endif
#if LV_USE_KEYBOARD
    if(strcmp(r->type, "keyboard") == 0) {
        if(strcmp(key, "textarea") == 0) {
            lvd_preview_node_rec_t * textarea = find_rec(value);
            if(!textarea || !textarea->obj || strcmp(textarea->type, "textarea") != 0) return -2;
            lv_keyboard_set_textarea(r->obj, textarea->obj);
            return 0;
        }
        if(strcmp(key, "mode") == 0) {
            lv_keyboard_mode_t mode;
            if(strcmp(value, "text_upper") == 0) mode = LV_KEYBOARD_MODE_TEXT_UPPER;
            else if(strcmp(value, "text_lower") == 0) mode = LV_KEYBOARD_MODE_TEXT_LOWER;
            else if(strcmp(value, "number") == 0) mode = LV_KEYBOARD_MODE_NUMBER;
            else if(strcmp(value, "special") == 0) mode = LV_KEYBOARD_MODE_SPECIAL;
            else if(strcmp(value, "user_1") == 0) mode = LV_KEYBOARD_MODE_USER_1;
            else if(strcmp(value, "user_2") == 0) mode = LV_KEYBOARD_MODE_USER_2;
            else if(strcmp(value, "user_3") == 0) mode = LV_KEYBOARD_MODE_USER_3;
            else if(strcmp(value, "user_4") == 0) mode = LV_KEYBOARD_MODE_USER_4;
#if LV_USE_ARABIC_PERSIAN_CHARS
            else if(strcmp(value, "text_arabic") == 0) mode = LV_KEYBOARD_MODE_TEXT_ARABIC;
#endif
            else return -4;
            lv_keyboard_set_mode(r->obj, mode);
            return 0;
        }
        return -4;
    }
#endif
#if LV_USE_ARCLABEL
    if(strcmp(r->type, "arclabel") == 0) {
        if(strcmp(key, "text") == 0) {
            lv_arclabel_set_text(r->obj, value);
            return 0;
        }
        if(strcmp(key, "dir") == 0) {
            if(strcmp(value, "clockwise") == 0) {
                lv_arclabel_set_dir(r->obj, LV_ARCLABEL_DIR_CLOCKWISE);
            }
            else if(strcmp(value, "counter_clockwise") == 0) {
                lv_arclabel_set_dir(r->obj, LV_ARCLABEL_DIR_COUNTER_CLOCKWISE);
            }
            else return -4;
            return 0;
        }
        lv_arclabel_text_align_t align;
        if(strcmp(value, "default") == 0) align = LV_ARCLABEL_TEXT_ALIGN_DEFAULT;
        else if(strcmp(value, "leading") == 0) align = LV_ARCLABEL_TEXT_ALIGN_LEADING;
        else if(strcmp(value, "center") == 0) align = LV_ARCLABEL_TEXT_ALIGN_CENTER;
        else if(strcmp(value, "trailing") == 0) align = LV_ARCLABEL_TEXT_ALIGN_TRAILING;
        else return -4;
        if(strcmp(key, "text_vertical_align") == 0) {
            lv_arclabel_set_text_vertical_align(r->obj, align);
            return 0;
        }
        if(strcmp(key, "text_horizontal_align") == 0) {
            lv_arclabel_set_text_horizontal_align(r->obj, align);
            return 0;
        }
        return -4;
    }
#endif
#if LV_USE_IMAGE
    if(strcmp(r->type, "image") == 0 && strcmp(key, "src") == 0) {
        const char * src = lvd_find_image_src(value);
        if(!src) return -2;
        lv_image_set_src(r->obj, src);
        return 0;
    }
#endif
#if LV_USE_TABVIEW
    if(strcmp(r->type, "tabview") == 0 && strcmp(key, "tab_bar_position") == 0) {
        lv_dir_t dir;
        if(strcmp(value, "top") == 0) dir = LV_DIR_TOP;
        else if(strcmp(value, "bottom") == 0) dir = LV_DIR_BOTTOM;
        else if(strcmp(value, "left") == 0) dir = LV_DIR_LEFT;
        else if(strcmp(value, "right") == 0) dir = LV_DIR_RIGHT;
        else return -4;
        lv_tabview_set_tab_bar_position(r->obj, dir);
        return 0;
    }
#endif
#if LV_USE_IMAGEBUTTON
    if(strcmp(r->type, "imagebutton") == 0) {
        if(strcmp(key, "state") == 0) {
            lv_imagebutton_state_t state;
            if(strcmp(value, "released") == 0) state = LV_IMAGEBUTTON_STATE_RELEASED;
            else if(strcmp(value, "pressed") == 0) state = LV_IMAGEBUTTON_STATE_PRESSED;
            else if(strcmp(value, "disabled") == 0) state = LV_IMAGEBUTTON_STATE_DISABLED;
            else if(strcmp(value, "checked_released") == 0) state = LV_IMAGEBUTTON_STATE_CHECKED_RELEASED;
            else if(strcmp(value, "checked_pressed") == 0) state = LV_IMAGEBUTTON_STATE_CHECKED_PRESSED;
            else if(strcmp(value, "checked_disabled") == 0) state = LV_IMAGEBUTTON_STATE_CHECKED_DISABLED;
            else return -4;
            lv_imagebutton_set_state(r->obj, state);
            return 0;
        }

        int state_index = -1;
        int part_index = -1;
        if(strncmp(key, "src_released_", 13) == 0) state_index = 0;
        else if(strncmp(key, "src_pressed_", 12) == 0) state_index = 1;
        if(state_index >= 0) {
            const char * part = key + (state_index == 0 ? 13 : 12);
            if(strcmp(part, "left") == 0) part_index = 0;
            else if(strcmp(part, "mid") == 0) part_index = 1;
            else if(strcmp(part, "right") == 0) part_index = 2;
        }
        if(state_index >= 0 && part_index >= 0) {
            const void * src = lvd_find_image_src(value);
            if(!src) return -2;
            r->imagebutton_src[state_index][part_index] = src;
            lv_imagebutton_set_src(
                r->obj,
                state_index == 0 ? LV_IMAGEBUTTON_STATE_RELEASED : LV_IMAGEBUTTON_STATE_PRESSED,
                r->imagebutton_src[state_index][0],
                r->imagebutton_src[state_index][1],
                r->imagebutton_src[state_index][2]
            );
            return 0;
        }
    }
#endif
#if LV_USE_SPAN
    if(strcmp(r->type, "spangroup") == 0 && strcmp(key, "overflow") == 0) {
        if(strcmp(value, "clip") == 0) {
            lv_spangroup_set_overflow(r->obj, LV_SPAN_OVERFLOW_CLIP);
        }
        else if(strcmp(value, "ellipsis") == 0) {
            lv_spangroup_set_overflow(r->obj, LV_SPAN_OVERFLOW_ELLIPSIS);
        }
        else return -4;
        return 0;
    }
#endif
#if LV_USE_LED
    if(strcmp(r->type, "led") == 0 && strcmp(key, "color") == 0) {
        lv_color_t color;
        if(color_from_hex(value, &color) != 0) return -4;
        lv_led_set_color(r->obj, color);
        return 0;
    }
#endif
#if LV_USE_QRCODE
    if(strcmp(r->type, "qrcode") == 0) {
        if(strcmp(key, "data") == 0) {
            return lv_qrcode_update(r->obj, value, (uint32_t)strlen(value)) == LV_RESULT_OK ? 0 : -4;
        }
        if(strcmp(key, "dark_color") == 0 || strcmp(key, "light_color") == 0) {
            lv_color_t color;
            if(color_from_hex(value, &color) != 0) return -4;
            if(strcmp(key, "dark_color") == 0) lv_qrcode_set_dark_color(r->obj, color);
            else lv_qrcode_set_light_color(r->obj, color);
            return 0;
        }
        return -4;
    }
#endif
#if LV_USE_SCALE
    if(strcmp(r->type, "scale") == 0 && strcmp(key, "mode") == 0) {
        lv_scale_mode_t mode;
        if(strcmp(value, "horizontal_top") == 0) mode = LV_SCALE_MODE_HORIZONTAL_TOP;
        else if(strcmp(value, "horizontal_bottom") == 0) mode = LV_SCALE_MODE_HORIZONTAL_BOTTOM;
        else if(strcmp(value, "vertical_left") == 0) mode = LV_SCALE_MODE_VERTICAL_LEFT;
        else if(strcmp(value, "vertical_right") == 0) mode = LV_SCALE_MODE_VERTICAL_RIGHT;
        else if(strcmp(value, "round_inner") == 0) mode = LV_SCALE_MODE_ROUND_INNER;
        else if(strcmp(value, "round_outer") == 0) mode = LV_SCALE_MODE_ROUND_OUTER;
        else return -4;
        lv_scale_set_mode(r->obj, mode);
        return 0;
    }
#endif
    return -4;
}

#if LV_USE_TABLE
static int table_ctrl_token(const char * token, size_t n, lv_table_cell_ctrl_t * value)
{
#define LVD_TABLE_CTRL(text, symbol) \
    if(n == sizeof(text) - 1 && strncmp(token, text, n) == 0) { *value = symbol; return 0; }
    LVD_TABLE_CTRL("none", LV_TABLE_CELL_CTRL_NONE)
    LVD_TABLE_CTRL("merge_right", LV_TABLE_CELL_CTRL_MERGE_RIGHT)
    LVD_TABLE_CTRL("text_crop", LV_TABLE_CELL_CTRL_TEXT_CROP)
    LVD_TABLE_CTRL("custom_1", LV_TABLE_CELL_CTRL_CUSTOM_1)
    LVD_TABLE_CTRL("custom_2", LV_TABLE_CELL_CTRL_CUSTOM_2)
    LVD_TABLE_CTRL("custom_3", LV_TABLE_CELL_CTRL_CUSTOM_3)
    LVD_TABLE_CTRL("custom_4", LV_TABLE_CELL_CTRL_CUSTOM_4)
#undef LVD_TABLE_CTRL
    return -4;
}

static int table_ctrl_from_name(const char * text, lv_table_cell_ctrl_t * value)
{
    if(!text || !text[0] || !value) return -3;
    uint32_t out = 0;
    const char * p = text;
    while(*p) {
        const char * end = strchr(p, '|');
        size_t n = end ? (size_t)(end - p) : strlen(p);
        lv_table_cell_ctrl_t token;
        if(n == 0 || table_ctrl_token(p, n, &token) != 0) return -4;
        out |= (uint32_t)token;
        if(!end) break;
        p = end + 1;
    }
    *value = (lv_table_cell_ctrl_t)out;
    return 0;
}
#endif

static lvd_preview_node_rec_t * find_table(const char * parent_name)
{
    lvd_preview_node_rec_t * parent = find_rec(parent_name);
    return parent && parent->obj && strcmp(parent->type, "table") == 0 ? parent : NULL;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_set_chart_axis(const char * parent_name, const char * axis_name,
                               const char * key, int32_t value)
{
    if(!parent_name || !axis_name || !key) return -3;
    lvd_preview_node_rec_t * parent = find_rec(parent_name);
    if(!parent || !parent->obj || strcmp(parent->type, "chart") != 0) return -2;
#if LV_USE_CHART
    lv_chart_axis_t axis;
    if(chart_axis_from_name(axis_name, &axis) != 0) return -4;
    if(strcmp(key, "min_value") == 0) lv_chart_set_axis_min_value(parent->obj, axis, value);
    else if(strcmp(key, "max_value") == 0) lv_chart_set_axis_max_value(parent->obj, axis, value);
    else return -4;
    return 0;
#else
    (void)value;
    return -4;
#endif
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_set_table_column(const char * parent_name, int32_t column, int32_t width)
{
    if(!parent_name || column < 0 || width < 0) return -3;
    lvd_preview_node_rec_t * parent = find_table(parent_name);
    if(!parent) return -2;
#if LV_USE_TABLE
    lv_table_set_column_width(parent->obj, (uint32_t)column, width);
    return 0;
#else
    return -4;
#endif
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_set_table_cell_value(const char * parent_name, int32_t row,
                                     int32_t column, const char * value)
{
    if(!parent_name || row < 0 || column < 0 || !value) return -3;
    lvd_preview_node_rec_t * parent = find_table(parent_name);
    if(!parent) return -2;
#if LV_USE_TABLE
    lv_table_set_cell_value(parent->obj, (uint32_t)row, (uint32_t)column, value);
    return 0;
#else
    return -4;
#endif
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_set_table_cell_ctrl(const char * parent_name, int32_t row,
                                    int32_t column, const char * ctrl)
{
    if(!parent_name || row < 0 || column < 0 || !ctrl) return -3;
    lvd_preview_node_rec_t * parent = find_table(parent_name);
    if(!parent) return -2;
#if LV_USE_TABLE
    lv_table_cell_ctrl_t value;
    if(table_ctrl_from_name(ctrl, &value) != 0) return -4;
    lv_table_set_cell_ctrl(parent->obj, (uint32_t)row, (uint32_t)column, value);
    return 0;
#else
    return -4;
#endif
}

static lv_obj_flag_t flag_from_name(const char * name)
{
    if(strcmp(name, "hidden") == 0) return LV_OBJ_FLAG_HIDDEN;
    if(strcmp(name, "clickable") == 0) return LV_OBJ_FLAG_CLICKABLE;
    if(strcmp(name, "click_focusable") == 0) return LV_OBJ_FLAG_CLICK_FOCUSABLE;
    if(strcmp(name, "checkable") == 0) return LV_OBJ_FLAG_CHECKABLE;
    if(strcmp(name, "scrollable") == 0) return LV_OBJ_FLAG_SCROLLABLE;
    if(strcmp(name, "scroll_elastic") == 0) return LV_OBJ_FLAG_SCROLL_ELASTIC;
    if(strcmp(name, "scroll_momentum") == 0) return LV_OBJ_FLAG_SCROLL_MOMENTUM;
    if(strcmp(name, "scroll_one") == 0) return LV_OBJ_FLAG_SCROLL_ONE;
    if(strcmp(name, "scroll_chain_hor") == 0) return LV_OBJ_FLAG_SCROLL_CHAIN_HOR;
    if(strcmp(name, "scroll_chain_ver") == 0) return LV_OBJ_FLAG_SCROLL_CHAIN_VER;
    if(strcmp(name, "scroll_chain") == 0) return LV_OBJ_FLAG_SCROLL_CHAIN;
    if(strcmp(name, "scroll_on_focus") == 0) return LV_OBJ_FLAG_SCROLL_ON_FOCUS;
    if(strcmp(name, "scroll_with_arrow") == 0) return LV_OBJ_FLAG_SCROLL_WITH_ARROW;
    if(strcmp(name, "snappable") == 0) return LV_OBJ_FLAG_SNAPPABLE;
    if(strcmp(name, "press_lock") == 0) return LV_OBJ_FLAG_PRESS_LOCK;
    if(strcmp(name, "event_bubble") == 0) return LV_OBJ_FLAG_EVENT_BUBBLE;
    if(strcmp(name, "event_trickle") == 0) return LV_OBJ_FLAG_EVENT_TRICKLE;
    if(strcmp(name, "state_trickle") == 0) return LV_OBJ_FLAG_STATE_TRICKLE;
    if(strcmp(name, "gesture_bubble") == 0) return LV_OBJ_FLAG_GESTURE_BUBBLE;
    if(strcmp(name, "adv_hittest") == 0) return LV_OBJ_FLAG_ADV_HITTEST;
    if(strcmp(name, "ignore_layout") == 0) return LV_OBJ_FLAG_IGNORE_LAYOUT;
    if(strcmp(name, "floating") == 0) return LV_OBJ_FLAG_FLOATING;
    if(strcmp(name, "send_draw_task_events") == 0) return LV_OBJ_FLAG_SEND_DRAW_TASK_EVENTS;
    if(strcmp(name, "overflow_visible") == 0) return LV_OBJ_FLAG_OVERFLOW_VISIBLE;
    if(strcmp(name, "flex_in_new_track") == 0) return LV_OBJ_FLAG_FLEX_IN_NEW_TRACK;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_set_flag(const char * name, const char * flag, int enabled)
{
    if(!name || !flag) return -3;
    lvd_preview_node_rec_t * r = find_rec(name);
    if(!r || !r->obj) return -2;
    lv_obj_flag_t value = flag_from_name(flag);
    if(value == 0) return -4;
    if(enabled) lv_obj_add_flag(r->obj, value);
    else lv_obj_remove_flag(r->obj, value);
    return 0;
}

static lv_state_t state_from_name(const char * name)
{
    if(strcmp(name, "checked") == 0) return LV_STATE_CHECKED;
    if(strcmp(name, "focused") == 0) return LV_STATE_FOCUSED;
    if(strcmp(name, "focus_key") == 0) return LV_STATE_FOCUS_KEY;
    if(strcmp(name, "edited") == 0) return LV_STATE_EDITED;
    if(strcmp(name, "hovered") == 0) return LV_STATE_HOVERED;
    if(strcmp(name, "pressed") == 0) return LV_STATE_PRESSED;
    if(strcmp(name, "scrolled") == 0) return LV_STATE_SCROLLED;
    if(strcmp(name, "disabled") == 0) return LV_STATE_DISABLED;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_set_state(const char * name, const char * state, int enabled)
{
    if(!name || !state) return -3;
    lvd_preview_node_rec_t * r = find_rec(name);
    if(!r || !r->obj) return -2;
    lv_state_t value = state_from_name(state);
    if(value == 0) return -4;
    if(enabled) lv_obj_add_state(r->obj, value);
    else lv_obj_remove_state(r->obj, value);
    return 0;
}

static int part_from_name(const char * name, uint32_t * value)
{
    if(!name || !value) return -3;
    if(strcmp(name, "main") == 0) *value = LV_PART_MAIN;
    else if(strcmp(name, "scrollbar") == 0) *value = LV_PART_SCROLLBAR;
    else if(strcmp(name, "indicator") == 0) *value = LV_PART_INDICATOR;
    else if(strcmp(name, "knob") == 0) *value = LV_PART_KNOB;
    else if(strcmp(name, "selected") == 0) *value = LV_PART_SELECTED;
    else if(strcmp(name, "items") == 0) *value = LV_PART_ITEMS;
    else if(strcmp(name, "cursor") == 0) *value = LV_PART_CURSOR;
    else return -4;
    return 0;
}

static int state_token(const char * token, size_t n, uint32_t * value)
{
#define LVD_STATE_TOKEN(text, symbol) \
    if(n == sizeof(text) - 1 && strncmp(token, text, n) == 0) { *value = symbol; return 0; }
    LVD_STATE_TOKEN("default", LV_STATE_DEFAULT)
    LVD_STATE_TOKEN("pressed", LV_STATE_PRESSED)
    LVD_STATE_TOKEN("checked", LV_STATE_CHECKED)
    LVD_STATE_TOKEN("scrolled", LV_STATE_SCROLLED)
    LVD_STATE_TOKEN("focused", LV_STATE_FOCUSED)
    LVD_STATE_TOKEN("focus_key", LV_STATE_FOCUS_KEY)
    LVD_STATE_TOKEN("edited", LV_STATE_EDITED)
    LVD_STATE_TOKEN("hovered", LV_STATE_HOVERED)
    LVD_STATE_TOKEN("disabled", LV_STATE_DISABLED)
    LVD_STATE_TOKEN("user_1", LV_STATE_USER_1)
    LVD_STATE_TOKEN("user_2", LV_STATE_USER_2)
    LVD_STATE_TOKEN("user_3", LV_STATE_USER_3)
    LVD_STATE_TOKEN("user_4", LV_STATE_USER_4)
#undef LVD_STATE_TOKEN
    return -4;
}

static int selector_from(const char * part, const char * states, uint32_t * selector)
{
    uint32_t out = 0;
    int rc = part_from_name(part, &out);
    if(rc != 0) return rc;
    const char * p = states ? states : "";
    while(*p) {
        const char * end = strchr(p, '|');
        size_t n = end ? (size_t)(end - p) : strlen(p);
        uint32_t state = 0;
        if(n == 0 || state_token(p, n, &state) != 0) return -4;
        out |= state;
        if(!end) break;
        p = end + 1;
    }
    *selector = out;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_set_style_i32(const char * name, const char * key, int32_t value,
                              const char * part, const char * states)
{
    if(!name || !key || !part || !states) return -3;
    lvd_preview_node_rec_t * r = find_rec(name);
    if(!r || !r->obj) return -2;
    uint32_t selector;
    if(selector_from(part, states, &selector) != 0) return -4;
    if((strcmp(key, "bg_opa") == 0 || strcmp(key, "border_opa") == 0
        || strcmp(key, "outline_opa") == 0 || strcmp(key, "shadow_opa") == 0
        || strcmp(key, "text_opa") == 0 || strcmp(key, "opa") == 0)
       && (value < 0 || value > 255)) return -4;

    if(strcmp(key, "radius") == 0) lv_obj_set_style_radius(r->obj, value, selector);
    else if(strcmp(key, "pad_hor") == 0) lv_obj_set_style_pad_hor(r->obj, value, selector);
    else if(strcmp(key, "pad_ver") == 0) lv_obj_set_style_pad_ver(r->obj, value, selector);
    else if(strcmp(key, "pad_all") == 0) lv_obj_set_style_pad_all(r->obj, value, selector);
    else if(strcmp(key, "bg_opa") == 0) lv_obj_set_style_bg_opa(r->obj, value, selector);
    else if(strcmp(key, "border_width") == 0) lv_obj_set_style_border_width(r->obj, value, selector);
    else if(strcmp(key, "border_opa") == 0) lv_obj_set_style_border_opa(r->obj, value, selector);
    else if(strcmp(key, "outline_width") == 0) lv_obj_set_style_outline_width(r->obj, value, selector);
    else if(strcmp(key, "outline_opa") == 0) lv_obj_set_style_outline_opa(r->obj, value, selector);
    else if(strcmp(key, "outline_pad") == 0) lv_obj_set_style_outline_pad(r->obj, value, selector);
    else if(strcmp(key, "shadow_width") == 0) lv_obj_set_style_shadow_width(r->obj, value, selector);
    else if(strcmp(key, "shadow_offset_x") == 0) lv_obj_set_style_shadow_offset_x(r->obj, value, selector);
    else if(strcmp(key, "shadow_offset_y") == 0) lv_obj_set_style_shadow_offset_y(r->obj, value, selector);
    else if(strcmp(key, "shadow_spread") == 0) lv_obj_set_style_shadow_spread(r->obj, value, selector);
    else if(strcmp(key, "shadow_opa") == 0) lv_obj_set_style_shadow_opa(r->obj, value, selector);
    else if(strcmp(key, "text_opa") == 0) lv_obj_set_style_text_opa(r->obj, value, selector);
    else if(strcmp(key, "opa") == 0) lv_obj_set_style_opa(r->obj, value, selector);
    else return -4;
    return 0;
}

static int color_from_hex(const char * text, lv_color_t * color)
{
    if(!text || text[0] != '#' || !color) return -4;
    size_t n = strlen(text + 1);
    char * end = NULL;
    unsigned long hex = strtoul(text + 1, &end, 16);
    if(*end != '\0' || (n != 3 && n != 6)) return -4;
    if(n == 3) {
        uint32_t r = (hex >> 8) & 0xf;
        uint32_t g = (hex >> 4) & 0xf;
        uint32_t b = hex & 0xf;
        hex = (r << 20) | (r << 16) | (g << 12) | (g << 8) | (b << 4) | b;
    }
    *color = lv_color_hex((uint32_t)hex);
    return 0;
}

static lvd_preview_subject_rec_t * alloc_subject(const char * name, lvd_preview_subject_type_t type)
{
    if(!name || !name[0] || find_subject(name)) return NULL;
    lvd_preview_subject_rec_t * r = calloc(1, sizeof(*r));
    if(!r) return NULL;
    r->name = strdup(name);
    if(!r->name) {
        free(r);
        return NULL;
    }
    r->type = type;
    return r;
}

static void track_subject(lvd_preview_subject_rec_t * r)
{
    r->next = g_subjects;
    g_subjects = r;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_create_subject_i32(const char * name, int32_t initial,
                                   int32_t min_value, int has_min,
                                   int32_t max_value, int has_max)
{
    if(!name || !name[0] || find_subject(name)) return -3;
    if(has_min && has_max && min_value > max_value) return -4;
    if((has_min && initial < min_value) || (has_max && initial > max_value)) return -4;
    lvd_preview_subject_rec_t * r = alloc_subject(name, LVD_SUBJECT_INT);
    if(!r) return -1;
    lv_subject_init_int(&r->subject, initial);
    if(has_min) lv_subject_set_min_value_int(&r->subject, min_value);
    if(has_max) lv_subject_set_max_value_int(&r->subject, max_value);
    track_subject(r);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_create_subject_float(const char * name, float initial,
                                     float min_value, int has_min,
                                     float max_value, int has_max)
{
#if LV_USE_FLOAT
    if(!name || !name[0] || find_subject(name)) return -3;
    if(!isfinite(initial) || (has_min && !isfinite(min_value))
       || (has_max && !isfinite(max_value))) return -4;
    if(has_min && has_max && min_value > max_value) return -4;
    if((has_min && initial < min_value) || (has_max && initial > max_value)) return -4;
    lvd_preview_subject_rec_t * r = alloc_subject(name, LVD_SUBJECT_FLOAT);
    if(!r) return -1;
    lv_subject_init_float(&r->subject, initial);
    if(has_min) lv_subject_set_min_value_float(&r->subject, min_value);
    if(has_max) lv_subject_set_max_value_float(&r->subject, max_value);
    track_subject(r);
    return 0;
#else
    (void)name; (void)initial; (void)min_value; (void)has_min; (void)max_value; (void)has_max;
    return -4;
#endif
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_create_subject_string(const char * name, const char * initial, int32_t capacity)
{
    if(!name || !name[0] || !initial || capacity <= 0 || find_subject(name)) return -3;
    if(strlen(initial) + 1 > (size_t)capacity) return -4;
    lvd_preview_subject_rec_t * r = alloc_subject(name, LVD_SUBJECT_STRING);
    if(!r) return -1;
    size_t size = (size_t)capacity;
    r->string_buf = malloc(size);
    r->string_prev_buf = malloc(size);
    if(!r->string_buf || !r->string_prev_buf) {
        free(r->string_buf);
        free(r->string_prev_buf);
        free(r->name);
        free(r);
        return -1;
    }
    lv_subject_init_string(&r->subject, r->string_buf, r->string_prev_buf, size, initial);
    track_subject(r);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_create_subject_color(const char * name, const char * initial)
{
    if(!name || !name[0] || !initial || find_subject(name)) return -3;
    lv_color_t color;
    if(color_from_hex(initial, &color) != 0) return -4;
    lvd_preview_subject_rec_t * r = alloc_subject(name, LVD_SUBJECT_COLOR);
    if(!r) return -1;
    lv_subject_init_color(&r->subject, color);
    track_subject(r);
    return 0;
}

static int align_from_name(const char * value, lv_align_t * align)
{
    if(strcmp(value, "top_left") == 0) *align = LV_ALIGN_TOP_LEFT;
    else if(strcmp(value, "top_mid") == 0) *align = LV_ALIGN_TOP_MID;
    else if(strcmp(value, "top_right") == 0) *align = LV_ALIGN_TOP_RIGHT;
    else if(strcmp(value, "bottom_left") == 0) *align = LV_ALIGN_BOTTOM_LEFT;
    else if(strcmp(value, "bottom_mid") == 0) *align = LV_ALIGN_BOTTOM_MID;
    else if(strcmp(value, "bottom_right") == 0) *align = LV_ALIGN_BOTTOM_RIGHT;
    else if(strcmp(value, "right_mid") == 0) *align = LV_ALIGN_RIGHT_MID;
    else if(strcmp(value, "left_mid") == 0) *align = LV_ALIGN_LEFT_MID;
    else if(strcmp(value, "center") == 0) *align = LV_ALIGN_CENTER;
    else return -4;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_create_style(const char * name)
{
    if(!name || !name[0] || find_style(name)) return -3;
    lvd_preview_style_rec_t * r = malloc(sizeof(*r));
    if(!r) return -1;
    r->name = strdup(name);
    if(!r->name) {
        free(r);
        return -1;
    }
    lv_style_init(&r->style);
    r->next = g_styles;
    g_styles = r;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_set_named_style_i32(const char * name, const char * key, int32_t value)
{
    if(!name || !key) return -3;
    lvd_preview_style_rec_t * r = find_style(name);
    if(!r) return -2;
    if((strcmp(key, "bg_opa") == 0 || strcmp(key, "border_opa") == 0
        || strcmp(key, "outline_opa") == 0 || strcmp(key, "shadow_opa") == 0
        || strcmp(key, "text_opa") == 0 || strcmp(key, "opa") == 0)
       && (value < 0 || value > 255)) return -4;

    if(strcmp(key, "radius") == 0) lv_style_set_radius(&r->style, value);
    else if(strcmp(key, "pad_hor") == 0) lv_style_set_pad_hor(&r->style, value);
    else if(strcmp(key, "pad_ver") == 0) lv_style_set_pad_ver(&r->style, value);
    else if(strcmp(key, "pad_all") == 0) lv_style_set_pad_all(&r->style, value);
    else if(strcmp(key, "bg_opa") == 0) lv_style_set_bg_opa(&r->style, value);
    else if(strcmp(key, "border_width") == 0) lv_style_set_border_width(&r->style, value);
    else if(strcmp(key, "border_opa") == 0) lv_style_set_border_opa(&r->style, value);
    else if(strcmp(key, "outline_width") == 0) lv_style_set_outline_width(&r->style, value);
    else if(strcmp(key, "outline_opa") == 0) lv_style_set_outline_opa(&r->style, value);
    else if(strcmp(key, "outline_pad") == 0) lv_style_set_outline_pad(&r->style, value);
    else if(strcmp(key, "shadow_width") == 0) lv_style_set_shadow_width(&r->style, value);
    else if(strcmp(key, "shadow_offset_x") == 0) lv_style_set_shadow_offset_x(&r->style, value);
    else if(strcmp(key, "shadow_offset_y") == 0) lv_style_set_shadow_offset_y(&r->style, value);
    else if(strcmp(key, "shadow_spread") == 0) lv_style_set_shadow_spread(&r->style, value);
    else if(strcmp(key, "shadow_opa") == 0) lv_style_set_shadow_opa(&r->style, value);
    else if(strcmp(key, "text_opa") == 0) lv_style_set_text_opa(&r->style, value);
    else if(strcmp(key, "opa") == 0) lv_style_set_opa(&r->style, value);
    else return -4;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_set_named_style_string(const char * name, const char * key, const char * value)
{
    if(!name || !key || !value) return -3;
    lvd_preview_style_rec_t * r = find_style(name);
    if(!r) return -2;
    if(strcmp(key, "bg_color") == 0 || strcmp(key, "border_color") == 0
       || strcmp(key, "outline_color") == 0 || strcmp(key, "shadow_color") == 0
       || strcmp(key, "text_color") == 0) {
        lv_color_t color;
        if(color_from_hex(value, &color) != 0) return -4;
        if(strcmp(key, "bg_color") == 0) lv_style_set_bg_color(&r->style, color);
        else if(strcmp(key, "border_color") == 0) lv_style_set_border_color(&r->style, color);
        else if(strcmp(key, "outline_color") == 0) lv_style_set_outline_color(&r->style, color);
        else if(strcmp(key, "shadow_color") == 0) lv_style_set_shadow_color(&r->style, color);
        else lv_style_set_text_color(&r->style, color);
        return 0;
    }
    if(strcmp(key, "align") == 0) {
        lv_align_t align;
        if(align_from_name(value, &align) != 0) return -4;
        lv_style_set_align(&r->style, align);
        return 0;
    }
    if(strcmp(key, "text_align") == 0) {
        lv_text_align_t align;
        if(strcmp(value, "left") == 0) align = LV_TEXT_ALIGN_LEFT;
        else if(strcmp(value, "right") == 0) align = LV_TEXT_ALIGN_RIGHT;
        else if(strcmp(value, "center") == 0) align = LV_TEXT_ALIGN_CENTER;
        else if(strcmp(value, "auto") == 0) align = LV_TEXT_ALIGN_AUTO;
        else return -4;
        lv_style_set_text_align(&r->style, align);
        return 0;
    }
    if(strcmp(key, "text_font") == 0) {
        const lv_font_t * font = lvd_find_font(value);
        if(!font) return -2;
        lv_style_set_text_font(&r->style, font);
        return 0;
    }
    if(strcmp(key, "radius") == 0) {
        int32_t size;
        if(strcmp(value, "content") == 0) size = LV_SIZE_CONTENT;
        else {
            size_t n = strlen(value);
            if(n < 2 || value[n - 1] != '%') return -4;
            char * end = NULL;
            long pct = strtol(value, &end, 10);
            if(end != &value[n - 1]) return -4;
            size = lv_pct((int32_t)pct);
        }
        lv_style_set_radius(&r->style, size);
        return 0;
    }
    if(strcmp(key, "bg_opa") == 0 || strcmp(key, "border_opa") == 0
       || strcmp(key, "outline_opa") == 0 || strcmp(key, "shadow_opa") == 0
       || strcmp(key, "text_opa") == 0 || strcmp(key, "opa") == 0) {
        size_t n = strlen(value);
        if(n < 2 || value[n - 1] != '%') return -4;
        char * end = NULL;
        long pct = strtol(value, &end, 10);
        if(end != &value[n - 1] || pct < 0 || pct > 100) return -4;
        int32_t opa = (int32_t)((pct * 255 + 50) / 100);
        return lvd_preview_set_named_style_i32(name, key, opa);
    }
    return -4;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_add_style(const char * name, const char * style_name,
                          const char * part, const char * states)
{
    if(!name || !style_name || !part || !states) return -3;
    lvd_preview_node_rec_t * node = find_rec(name);
    lvd_preview_style_rec_t * style = find_style(style_name);
    if(!node || !node->obj || !style) return -2;
    uint32_t selector;
    if(selector_from(part, states, &selector) != 0) return -4;
    lv_obj_add_style(node->obj, &style->style, selector);
    return 0;
}

static int label_format_valid(const char * format, lvd_preview_subject_type_t type)
{
    if(!format || !format[0])
        return type == LVD_SUBJECT_INT || type == LVD_SUBJECT_FLOAT || type == LVD_SUBJECT_STRING;
    int conversions = 0;
    const char * p = format;
    while(*p) {
        if(*p++ != '%') continue;
        if(*p == '%') {
            p++;
            continue;
        }
        if(type == LVD_SUBJECT_STRING) {
            if(*p++ != 's') return 0;
        }
        else {
            while(*p && strchr("-+ 0#", *p)) p++;
            while(*p >= '0' && *p <= '9') p++;
            if(*p == '.') {
                p++;
                while(*p >= '0' && *p <= '9') p++;
            }
            char expected = type == LVD_SUBJECT_INT ? 'd'
                : type == LVD_SUBJECT_FLOAT ? 'f' : '\0';
            if(expected == '\0' || *p++ != expected) return 0;
        }
        conversions++;
    }
    return conversions == 1;
}

#if LV_USE_OBSERVER
static lv_observer_t * bind_flag_op(lv_obj_t * obj, lv_subject_t * subject,
                                    lv_obj_flag_t flag, const char * op, int32_t ref_value)
{
    if(strcmp(op, "eq") == 0) return lv_obj_bind_flag_if_eq(obj, subject, flag, ref_value);
    if(strcmp(op, "not_eq") == 0) return lv_obj_bind_flag_if_not_eq(obj, subject, flag, ref_value);
    if(strcmp(op, "gt") == 0) return lv_obj_bind_flag_if_gt(obj, subject, flag, ref_value);
    if(strcmp(op, "ge") == 0) return lv_obj_bind_flag_if_ge(obj, subject, flag, ref_value);
    if(strcmp(op, "lt") == 0) return lv_obj_bind_flag_if_lt(obj, subject, flag, ref_value);
    if(strcmp(op, "le") == 0) return lv_obj_bind_flag_if_le(obj, subject, flag, ref_value);
    return NULL;
}

static lv_observer_t * bind_state_op(lv_obj_t * obj, lv_subject_t * subject,
                                     lv_state_t state, const char * op, int32_t ref_value)
{
    if(strcmp(op, "eq") == 0) return lv_obj_bind_state_if_eq(obj, subject, state, ref_value);
    if(strcmp(op, "not_eq") == 0) return lv_obj_bind_state_if_not_eq(obj, subject, state, ref_value);
    if(strcmp(op, "gt") == 0) return lv_obj_bind_state_if_gt(obj, subject, state, ref_value);
    if(strcmp(op, "ge") == 0) return lv_obj_bind_state_if_ge(obj, subject, state, ref_value);
    if(strcmp(op, "lt") == 0) return lv_obj_bind_state_if_lt(obj, subject, state, ref_value);
    if(strcmp(op, "le") == 0) return lv_obj_bind_state_if_le(obj, subject, state, ref_value);
    return NULL;
}
#endif

EMSCRIPTEN_KEEPALIVE
int lvd_preview_bind_prop(const char * name, const char * prop,
                          const char * subject_name, const char * format)
{
    if(!name || !prop || !subject_name || !format) return -3;
    lvd_preview_node_rec_t * node = find_rec(name);
    lvd_preview_subject_rec_t * subject = find_subject(subject_name);
    if(!node || !node->obj || !subject) return -2;
#if LV_USE_OBSERVER
    lv_observer_t * observer = NULL;
#if LV_USE_SPAN
    if(strcmp(prop, "span_text") == 0 && strcmp(node->type, "spangroup-span") == 0
       && node->structural_handle) {
        if(!label_format_valid(format, subject->type)) return -4;
        observer = lv_spangroup_bind_span_text(
            node->obj, (lv_span_t *)node->structural_handle,
            &subject->subject, format[0] ? format : NULL
        );
    }
    else
#endif
    if(strcmp(prop, "value") == 0) {
        if(subject->type != LVD_SUBJECT_INT && subject->type != LVD_SUBJECT_FLOAT) return -4;
#if LV_USE_SLIDER
        if(strcmp(node->type, "slider") == 0) observer = lv_slider_bind_value(node->obj, &subject->subject);
#endif
#if LV_USE_BAR
        if(strcmp(node->type, "bar") == 0) observer = lv_bar_bind_value(node->obj, &subject->subject);
#endif
#if LV_USE_ARC
        if(strcmp(node->type, "arc") == 0) observer = lv_arc_bind_value(node->obj, &subject->subject);
#endif
#if LV_USE_DROPDOWN
        if(strcmp(node->type, "dropdown") == 0) observer = lv_dropdown_bind_value(node->obj, &subject->subject);
#endif
#if LV_USE_ROLLER
        if(strcmp(node->type, "roller") == 0) observer = lv_roller_bind_value(node->obj, &subject->subject);
#endif
#if LV_USE_SPINBOX
        if(strcmp(node->type, "spinbox") == 0) observer = lv_spinbox_bind_value(node->obj, &subject->subject);
#endif
    }
    else if(strcmp(prop, "checked") == 0) {
        if(subject->type != LVD_SUBJECT_INT
           || (strcmp(node->type, "obj") != 0 && strcmp(node->type, "button") != 0
               && strcmp(node->type, "switch") != 0 && strcmp(node->type, "checkbox") != 0
               && strcmp(node->type, "imagebutton") != 0)) return -4;
        observer = lv_obj_bind_checked(node->obj, &subject->subject);
    }
#if LV_USE_LABEL
    else if(strcmp(prop, "text") == 0 && strcmp(node->type, "label") == 0) {
        if(!label_format_valid(format, subject->type)) return -4;
        observer = lv_label_bind_text(node->obj, &subject->subject, format[0] ? format : NULL);
    }
#endif
    else return -4;
    return observer ? 0 : -4;
#else
    return -4;
#endif
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_bind_flag(const char * name, const char * flag, const char * op,
                          const char * subject_name, int32_t ref_value)
{
    if(!name || !flag || !op || !subject_name) return -3;
    lvd_preview_node_rec_t * node = find_rec(name);
    lvd_preview_subject_rec_t * subject = find_subject(subject_name);
    if(!node || !node->obj || !subject) return -2;
    if(subject->type != LVD_SUBJECT_INT) return -4;
    lv_obj_flag_t value = flag_from_name(flag);
    if(value == 0) return -4;
#if LV_USE_OBSERVER
    return bind_flag_op(node->obj, &subject->subject, value, op, ref_value) ? 0 : -4;
#else
    return -4;
#endif
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_bind_state(const char * name, const char * state, const char * op,
                           const char * subject_name, int32_t ref_value)
{
    if(!name || !state || !op || !subject_name) return -3;
    lvd_preview_node_rec_t * node = find_rec(name);
    lvd_preview_subject_rec_t * subject = find_subject(subject_name);
    if(!node || !node->obj || !subject) return -2;
    if(subject->type != LVD_SUBJECT_INT) return -4;
    lv_state_t value = state_from_name(state);
    if(value == 0) return -4;
#if LV_USE_OBSERVER
    return bind_state_op(node->obj, &subject->subject, value, op, ref_value) ? 0 : -4;
#else
    return -4;
#endif
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_set_style_string(const char * name, const char * key, const char * value,
                                 const char * part, const char * states)
{
    if(!name || !key || !value || !part || !states) return -3;
    lvd_preview_node_rec_t * r = find_rec(name);
    if(!r || !r->obj) return -2;
    uint32_t selector;
    if(selector_from(part, states, &selector) != 0) return -4;

    if(strcmp(key, "bg_color") == 0 || strcmp(key, "border_color") == 0
       || strcmp(key, "outline_color") == 0 || strcmp(key, "shadow_color") == 0
       || strcmp(key, "text_color") == 0) {
        lv_color_t color;
        if(color_from_hex(value, &color) != 0) return -4;
        if(strcmp(key, "bg_color") == 0) lv_obj_set_style_bg_color(r->obj, color, selector);
        else if(strcmp(key, "border_color") == 0) lv_obj_set_style_border_color(r->obj, color, selector);
        else if(strcmp(key, "outline_color") == 0) lv_obj_set_style_outline_color(r->obj, color, selector);
        else if(strcmp(key, "shadow_color") == 0) lv_obj_set_style_shadow_color(r->obj, color, selector);
        else lv_obj_set_style_text_color(r->obj, color, selector);
        return 0;
    }
    if(strcmp(key, "align") == 0) {
        lv_align_t align;
        if(align_from_name(value, &align) != 0) return -4;
        lv_obj_set_style_align(r->obj, align, selector);
        return 0;
    }
    if(strcmp(key, "text_align") == 0) {
        lv_text_align_t align;
        if(strcmp(value, "left") == 0) align = LV_TEXT_ALIGN_LEFT;
        else if(strcmp(value, "right") == 0) align = LV_TEXT_ALIGN_RIGHT;
        else if(strcmp(value, "center") == 0) align = LV_TEXT_ALIGN_CENTER;
        else if(strcmp(value, "auto") == 0) align = LV_TEXT_ALIGN_AUTO;
        else return -4;
        lv_obj_set_style_text_align(r->obj, align, selector);
        return 0;
    }
    if(strcmp(key, "text_font") == 0) {
        const lv_font_t * font = lvd_find_font(value);
        if(!font) return -2;
        lv_obj_set_style_text_font(r->obj, font, selector);
        return 0;
    }
    if(strcmp(key, "radius") == 0) {
        int32_t size;
        if(strcmp(value, "content") == 0) size = LV_SIZE_CONTENT;
        else {
            size_t n = strlen(value);
            if(n < 2 || value[n - 1] != '%') return -4;
            char * end = NULL;
            long pct = strtol(value, &end, 10);
            if(end != &value[n - 1]) return -4;
            size = lv_pct((int32_t)pct);
        }
        lv_obj_set_style_radius(r->obj, size, selector);
        return 0;
    }
    if(strcmp(key, "bg_opa") == 0 || strcmp(key, "border_opa") == 0
       || strcmp(key, "outline_opa") == 0 || strcmp(key, "shadow_opa") == 0
       || strcmp(key, "text_opa") == 0 || strcmp(key, "opa") == 0) {
        size_t n = strlen(value);
        if(n < 2 || value[n - 1] != '%') return -4;
        char * end = NULL;
        long pct = strtol(value, &end, 10);
        if(end != &value[n - 1] || pct < 0 || pct > 100) return -4;
        int32_t opa = (int32_t)((pct * 255 + 50) / 100);
        return lvd_preview_set_style_i32(name, key, opa, part, states);
    }
    return -4;
}

static int event_from_name(const char * name, lv_event_code_t * value)
{
    if(!name || !value) return -3;
#define LVD_EVENT(text, symbol) if(strcmp(name, text) == 0) { *value = symbol; return 0; }
    LVD_EVENT("all", LV_EVENT_ALL)
    LVD_EVENT("pressed", LV_EVENT_PRESSED)
    LVD_EVENT("pressing", LV_EVENT_PRESSING)
    LVD_EVENT("press_lost", LV_EVENT_PRESS_LOST)
    LVD_EVENT("short_clicked", LV_EVENT_SHORT_CLICKED)
    LVD_EVENT("single_clicked", LV_EVENT_SINGLE_CLICKED)
    LVD_EVENT("double_clicked", LV_EVENT_DOUBLE_CLICKED)
    LVD_EVENT("triple_clicked", LV_EVENT_TRIPLE_CLICKED)
    LVD_EVENT("long_pressed", LV_EVENT_LONG_PRESSED)
    LVD_EVENT("long_pressed_repeat", LV_EVENT_LONG_PRESSED_REPEAT)
    LVD_EVENT("clicked", LV_EVENT_CLICKED)
    LVD_EVENT("released", LV_EVENT_RELEASED)
    LVD_EVENT("scroll_begin", LV_EVENT_SCROLL_BEGIN)
    LVD_EVENT("scroll_throw_begin", LV_EVENT_SCROLL_THROW_BEGIN)
    LVD_EVENT("scroll_end", LV_EVENT_SCROLL_END)
    LVD_EVENT("scroll", LV_EVENT_SCROLL)
    LVD_EVENT("gesture", LV_EVENT_GESTURE)
    LVD_EVENT("key", LV_EVENT_KEY)
    LVD_EVENT("rotary", LV_EVENT_ROTARY)
    LVD_EVENT("focused", LV_EVENT_FOCUSED)
    LVD_EVENT("defocused", LV_EVENT_DEFOCUSED)
    LVD_EVENT("leave", LV_EVENT_LEAVE)
    LVD_EVENT("hit_test", LV_EVENT_HIT_TEST)
    LVD_EVENT("indev_reset", LV_EVENT_INDEV_RESET)
    LVD_EVENT("hover_over", LV_EVENT_HOVER_OVER)
    LVD_EVENT("hover_leave", LV_EVENT_HOVER_LEAVE)
    LVD_EVENT("cover_check", LV_EVENT_COVER_CHECK)
    LVD_EVENT("refr_ext_draw_size", LV_EVENT_REFR_EXT_DRAW_SIZE)
    LVD_EVENT("draw_main_begin", LV_EVENT_DRAW_MAIN_BEGIN)
    LVD_EVENT("draw_main", LV_EVENT_DRAW_MAIN)
    LVD_EVENT("draw_main_end", LV_EVENT_DRAW_MAIN_END)
    LVD_EVENT("draw_post_begin", LV_EVENT_DRAW_POST_BEGIN)
    LVD_EVENT("draw_post", LV_EVENT_DRAW_POST)
    LVD_EVENT("draw_post_end", LV_EVENT_DRAW_POST_END)
    LVD_EVENT("draw_task_added", LV_EVENT_DRAW_TASK_ADDED)
    LVD_EVENT("value_changed", LV_EVENT_VALUE_CHANGED)
    LVD_EVENT("insert", LV_EVENT_INSERT)
    LVD_EVENT("refresh", LV_EVENT_REFRESH)
    LVD_EVENT("ready", LV_EVENT_READY)
    LVD_EVENT("cancel", LV_EVENT_CANCEL)
    LVD_EVENT("create", LV_EVENT_CREATE)
    LVD_EVENT("delete", LV_EVENT_DELETE)
    LVD_EVENT("child_changed", LV_EVENT_CHILD_CHANGED)
    LVD_EVENT("child_created", LV_EVENT_CHILD_CREATED)
    LVD_EVENT("child_deleted", LV_EVENT_CHILD_DELETED)
    LVD_EVENT("screen_unload_start", LV_EVENT_SCREEN_UNLOAD_START)
    LVD_EVENT("screen_load_start", LV_EVENT_SCREEN_LOAD_START)
    LVD_EVENT("screen_loaded", LV_EVENT_SCREEN_LOADED)
    LVD_EVENT("screen_unloaded", LV_EVENT_SCREEN_UNLOADED)
    LVD_EVENT("size_changed", LV_EVENT_SIZE_CHANGED)
    LVD_EVENT("style_changed", LV_EVENT_STYLE_CHANGED)
    LVD_EVENT("layout_changed", LV_EVENT_LAYOUT_CHANGED)
    LVD_EVENT("get_self_size", LV_EVENT_GET_SELF_SIZE)
    LVD_EVENT("invalidate_area", LV_EVENT_INVALIDATE_AREA)
    LVD_EVENT("resolution_changed", LV_EVENT_RESOLUTION_CHANGED)
    LVD_EVENT("color_format_changed", LV_EVENT_COLOR_FORMAT_CHANGED)
    LVD_EVENT("refr_request", LV_EVENT_REFR_REQUEST)
    LVD_EVENT("refr_start", LV_EVENT_REFR_START)
    LVD_EVENT("refr_ready", LV_EVENT_REFR_READY)
    LVD_EVENT("render_start", LV_EVENT_RENDER_START)
    LVD_EVENT("render_ready", LV_EVENT_RENDER_READY)
    LVD_EVENT("flush_start", LV_EVENT_FLUSH_START)
    LVD_EVENT("flush_finish", LV_EVENT_FLUSH_FINISH)
    LVD_EVENT("flush_wait_start", LV_EVENT_FLUSH_WAIT_START)
    LVD_EVENT("flush_wait_finish", LV_EVENT_FLUSH_WAIT_FINISH)
    LVD_EVENT("vsync", LV_EVENT_VSYNC)
#undef LVD_EVENT
    return -4;
}

static int screen_anim_from_name(const char * name, lv_screen_load_anim_t * value)
{
    if(!name || !value) return -3;
#define LVD_ANIM(text, symbol) if(strcmp(name, text) == 0) { *value = symbol; return 0; }
    LVD_ANIM("none", LV_SCREEN_LOAD_ANIM_NONE)
    LVD_ANIM("over_left", LV_SCREEN_LOAD_ANIM_OVER_LEFT)
    LVD_ANIM("over_right", LV_SCREEN_LOAD_ANIM_OVER_RIGHT)
    LVD_ANIM("over_top", LV_SCREEN_LOAD_ANIM_OVER_TOP)
    LVD_ANIM("over_bottom", LV_SCREEN_LOAD_ANIM_OVER_BOTTOM)
    LVD_ANIM("move_left", LV_SCREEN_LOAD_ANIM_MOVE_LEFT)
    LVD_ANIM("move_right", LV_SCREEN_LOAD_ANIM_MOVE_RIGHT)
    LVD_ANIM("move_top", LV_SCREEN_LOAD_ANIM_MOVE_TOP)
    LVD_ANIM("move_bottom", LV_SCREEN_LOAD_ANIM_MOVE_BOTTOM)
    LVD_ANIM("fade_in", LV_SCREEN_LOAD_ANIM_FADE_IN)
    LVD_ANIM("fade_on", LV_SCREEN_LOAD_ANIM_FADE_ON)
    LVD_ANIM("fade_out", LV_SCREEN_LOAD_ANIM_FADE_OUT)
    LVD_ANIM("out_left", LV_SCREEN_LOAD_ANIM_OUT_LEFT)
    LVD_ANIM("out_right", LV_SCREEN_LOAD_ANIM_OUT_RIGHT)
    LVD_ANIM("out_top", LV_SCREEN_LOAD_ANIM_OUT_TOP)
    LVD_ANIM("out_bottom", LV_SCREEN_LOAD_ANIM_OUT_BOTTOM)
#undef LVD_ANIM
    return -4;
}

static void preview_custom_event_cb(lv_event_t * e)
{
    if(g_clearing) return;
    lvd_preview_event_rec_t * event = lv_event_get_user_data(e);
    if(!event) return;
    if(event->kind == LVD_PREVIEW_EVENT_CALLBACK) {
        lvd_preview_js_event_stub(event->callback, (int)lv_event_get_code(e),
                                  event->user_data, event->has_user_data);
        return;
    }
    lvd_preview_node_rec_t * target = find_rec(event->screen_name);
    if(target && target->obj && strcmp(target->type, "screen") == 0) {
        lv_screen_load_anim(target->obj, event->anim, event->duration, event->delay, false);
    }
}

static void free_event(lvd_preview_event_rec_t * event)
{
    if(!event) return;
    free(event->callback);
    free(event->user_data);
    free(event->screen_name);
    free(event);
}

static int attach_custom_event(lvd_preview_node_rec_t * node, lv_event_code_t trigger,
                               lvd_preview_event_rec_t * event)
{
    if(!lv_obj_add_event_cb(node->obj, preview_custom_event_cb, trigger, event)) {
        free_event(event);
        return -1;
    }
    event->next = g_events;
    g_events = event;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_add_callback_event(const char * name, const char * trigger,
                                   const char * callback, const char * user_data,
                                   int has_user_data)
{
    if(!name || !trigger || !callback || !callback[0] || !user_data) return -3;
    lvd_preview_node_rec_t * node = find_rec(name);
    if(!node || !node->obj) return -2;
    lv_event_code_t code;
    if(event_from_name(trigger, &code) != 0) return -4;
    lvd_preview_event_rec_t * event = calloc(1, sizeof(*event));
    if(!event) return -1;
    event->kind = LVD_PREVIEW_EVENT_CALLBACK;
    event->callback = strdup(callback);
    event->user_data = strdup(user_data);
    event->has_user_data = has_user_data != 0;
    if(!event->callback || !event->user_data) {
        free_event(event);
        return -1;
    }
    return attach_custom_event(node, code, event);
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_add_subject_set_event(const char * name, const char * trigger,
                                      const char * subject_name, const char * subject_type,
                                      const char * value)
{
    if(!name || !trigger || !subject_name || !subject_type || !value) return -3;
    lvd_preview_node_rec_t * node = find_rec(name);
    lvd_preview_subject_rec_t * subject = find_subject(subject_name);
    if(!node || !node->obj || !subject) return -2;
    lv_event_code_t code;
    if(event_from_name(trigger, &code) != 0) return -4;
    if(strcmp(subject_type, "int") == 0 && subject->type == LVD_SUBJECT_INT) {
        char * end = NULL;
        errno = 0;
        long parsed = strtol(value, &end, 10);
        if(errno == ERANGE || end == value || *end != '\0'
           || parsed < INT32_MIN || parsed > INT32_MAX) return -4;
        lv_obj_add_subject_set_int_event(node->obj, &subject->subject, code, (int32_t)parsed);
        return 0;
    }
    if(strcmp(subject_type, "float") == 0 && subject->type == LVD_SUBJECT_FLOAT) {
#if LV_USE_FLOAT
        char * end = NULL;
        float parsed = strtof(value, &end);
        if(end == value || *end != '\0' || !isfinite(parsed)) return -4;
        lv_obj_add_subject_set_float_event(node->obj, &subject->subject, code, parsed);
        return 0;
#else
        return -4;
#endif
    }
    if(strcmp(subject_type, "string") == 0 && subject->type == LVD_SUBJECT_STRING) {
        lv_obj_add_subject_set_string_event(node->obj, &subject->subject, code, value);
        return 0;
    }
    return -4;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_add_subject_toggle_event(const char * name, const char * trigger,
                                         const char * subject_name)
{
    if(!name || !trigger || !subject_name) return -3;
    lvd_preview_node_rec_t * node = find_rec(name);
    lvd_preview_subject_rec_t * subject = find_subject(subject_name);
    if(!node || !node->obj || !subject) return -2;
    if(subject->type != LVD_SUBJECT_INT) return -4;
    lv_event_code_t code;
    if(event_from_name(trigger, &code) != 0) return -4;
    lv_obj_add_subject_toggle_event(node->obj, &subject->subject, code);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_add_subject_increment_event(
    const char * name, const char * trigger, const char * subject_name, int32_t step,
    int32_t min_value, int has_min, int32_t max_value, int has_max,
    int rollover, int has_rollover)
{
    if(!name || !trigger || !subject_name) return -3;
    lvd_preview_node_rec_t * node = find_rec(name);
    lvd_preview_subject_rec_t * subject = find_subject(subject_name);
    if(!node || !node->obj || !subject) return -2;
    if(subject->type != LVD_SUBJECT_INT && subject->type != LVD_SUBJECT_FLOAT) return -4;
    if(has_min && has_max && min_value > max_value) return -4;
    lv_event_code_t code;
    if(event_from_name(trigger, &code) != 0) return -4;
#if LV_USE_OBSERVER
    lv_subject_increment_dsc_t * dsc = lv_obj_add_subject_increment_event(
        node->obj, &subject->subject, code, step);
    if(!dsc) return -1;
    if(has_min) lv_obj_set_subject_increment_event_min_value(node->obj, dsc, min_value);
    if(has_max) lv_obj_set_subject_increment_event_max_value(node->obj, dsc, max_value);
    if(has_rollover) lv_obj_set_subject_increment_event_rollover(node->obj, dsc, rollover != 0);
    return 0;
#else
    return -4;
#endif
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_add_screen_event(const char * name, const char * trigger,
                                 const char * action, const char * screen_name,
                                 const char * anim_type, uint32_t duration, uint32_t delay)
{
    if(!name || !trigger || !action || !screen_name || !screen_name[0] || !anim_type) return -3;
    if(strcmp(action, "screen_load") != 0 && strcmp(action, "screen_create") != 0) return -4;
    lvd_preview_node_rec_t * node = find_rec(name);
    if(!node || !node->obj) return -2;
    lv_event_code_t code;
    lv_screen_load_anim_t anim;
    if(event_from_name(trigger, &code) != 0 || screen_anim_from_name(anim_type, &anim) != 0) return -4;
    lvd_preview_event_rec_t * event = calloc(1, sizeof(*event));
    if(!event) return -1;
    event->kind = LVD_PREVIEW_EVENT_SCREEN;
    event->screen_name = strdup(screen_name);
    event->anim = anim;
    event->duration = duration;
    event->delay = delay;
    if(!event->screen_name) {
        free_event(event);
        return -1;
    }
    return attach_custom_event(node, code, event);
}

EMSCRIPTEN_KEEPALIVE
int lvd_preview_finish(const char * home_screen_name)
{
    lvd_preview_node_rec_t * home = find_rec(home_screen_name);
    if(!home || strcmp(home->type, "screen") != 0 || !home->obj) return -2;
    lv_screen_load(home->obj);
    lv_obj_update_layout(home->obj);
    if(g_pad) { lv_obj_delete(g_pad); g_pad = NULL; }
    return 0;
}
