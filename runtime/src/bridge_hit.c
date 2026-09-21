/**
 * @file bridge_hit.c
 * Design-mode hit testing, bounding-box queries and tree dump
 * (design/02 §2.4/2.5/2.6, review R9: coords via public lv_obj_get_coords).
 */
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <emscripten.h>

#include "lvgl.h"
/* Private include, justified (allowed per review note for bridge units only):
 *  - lv_obj_get_ext_draw_size() (lv_obj_draw_private.h) for the
 *    OVERFLOW_VISIBLE search-area expansion, same as lv_indev's search;
 *  - lv_obj_class_t::name (lv_obj_class_private.h) for lvd_dump_tree.
 * Object coordinates themselves are read with the public lv_obj_get_coords(). */
#include "lvgl_private.h"

#include "bridge_internal.h"

/*====================================================================
 * Hit test (§2.4)
 *
 * lv_indev_search_obj() can't be used: lv_obj_hit_test() bails out on
 * objects without LV_OBJ_FLAG_CLICKABLE (labels, images...), which must
 * be selectable in the designer. Same traversal skeleton, but a pure
 * geometric point-in-rect check that ignores CLICKABLE.
 *====================================================================*/

static bool point_on_area(const lv_area_t * a, const lv_point_t * p)
{
    return p->x >= a->x1 && p->x <= a->x2 && p->y >= a->y1 && p->y <= a->y2;
}

static lv_obj_t * search_obj_design(lv_obj_t * obj, lv_point_t * point)
{
    if(lv_obj_has_flag(obj, LV_OBJ_FLAG_HIDDEN)) return NULL;

    lv_point_t p = *point;
    lv_obj_transform_point(obj, &p, LV_OBJ_POINT_TRANSFORM_FLAG_INVERSE);

    lv_area_t coords;
    lv_obj_get_coords(obj, &coords);            /* public API (review R9) */
    bool self_hit = point_on_area(&coords, &p);

    lv_area_t search_area = coords;
    if(lv_obj_has_flag(obj, LV_OBJ_FLAG_OVERFLOW_VISIBLE)) {
        int32_t ext = lv_obj_get_ext_draw_size(obj);
        lv_area_increase(&search_area, ext, ext);
    }

    if(point_on_area(&search_area, &p)) {
        int32_t i;
        for(i = (int32_t)lv_obj_get_child_count(obj) - 1; i >= 0; i--) {
            lv_obj_t * hit = search_obj_design(lv_obj_get_child(obj, i), &p);
            if(hit) return hit;
        }
    }
    return self_hit ? obj : NULL;
}

/* Returns the name of the hit object (static buffer, JS must copy it
 * immediately); NULL if nothing was hit. */
EMSCRIPTEN_KEEPALIVE
const char * lvd_obj_at_point(int32_t x, int32_t y)
{
    lv_obj_t * act = lv_screen_active();
    if(!act) return NULL;
    lv_obj_update_layout(act);                  /* invariant: fresh coords (§2.5) */
    lv_point_t p = { x, y };
    lv_obj_t * hit = search_obj_design(act, &p);
    if(!hit) return NULL;
    static char buf[256];
    lv_obj_get_name_resolved(hit, buf, sizeof(buf));  /* resolves "_#" template names */
    return buf;
}

/*====================================================================
 * Bounding boxes (§2.5)
 *====================================================================*/

/* out: int32[4] = {x1, y1, w, h} in screen coords. include_transform != 0
 * gives the visual envelope of rotated/scaled widgets. */
EMSCRIPTEN_KEEPALIVE
int lvd_get_obj_rect(const char * name, int32_t * out, int include_transform)
{
    if(!name || !out) return -3;
    lv_obj_t * o = lvd_find_obj(name);
    if(!o) return -2;
    lv_obj_update_layout(o);
    lv_area_t a;
    lv_obj_get_coords(o, &a);
    if(include_transform)
        lv_obj_get_transformed_area(o, &a, LV_OBJ_POINT_TRANSFORM_FLAG_RECURSIVE);
    out[0] = a.x1;
    out[1] = a.y1;
    out[2] = lv_area_get_width(&a);
    out[3] = lv_area_get_height(&a);
    return 0;
}

/* Batch version for the overlay: names joined with '\n', out gets 4 int32
 * per name IN INPUT ORDER (missing objects get w = h = -1 so JS can map by
 * index). Returns the number of objects found. */
EMSCRIPTEN_KEEPALIVE
int lvd_get_obj_rects(const char * names_joined, int32_t * out)
{
    if(!names_joined || !out) return -3;
    lv_obj_t * act = lv_screen_active();
    if(act) lv_obj_update_layout(act);          /* once for the whole batch */

    int found = 0;
    int idx = 0;
    const char * s = names_joined;
    while(*s) {
        const char * e = strchr(s, '\n');
        size_t len = e ? (size_t)(e - s) : strlen(s);
        char name[256];
        if(len >= sizeof(name)) len = sizeof(name) - 1;
        memcpy(name, s, len);
        name[len] = '\0';

        lv_obj_t * o = len ? lvd_find_obj(name) : NULL;
        if(o) {
            lv_area_t a;
            lv_obj_get_coords(o, &a);
            out[idx * 4 + 0] = a.x1;
            out[idx * 4 + 1] = a.y1;
            out[idx * 4 + 2] = lv_area_get_width(&a);
            out[idx * 4 + 3] = lv_area_get_height(&a);
            found++;
        }
        else {
            out[idx * 4 + 0] = 0;
            out[idx * 4 + 1] = 0;
            out[idx * 4 + 2] = -1;
            out[idx * 4 + 3] = -1;
        }
        idx++;
        if(!e) break;
        s = e + 1;
    }
    return found;
}

/*====================================================================
 * Tree dump (§2.6) — dev-time assertion "WASM tree == JSON model tree"
 *====================================================================*/

typedef struct {
    char * out;
    int cap;
    int pos;
    bool overflow;
} dump_ctx_t;

static void dump_putc(dump_ctx_t * c, char ch)
{
    if(c->pos + 1 >= c->cap) { c->overflow = true; return; }
    c->out[c->pos++] = ch;
}

static void dump_str_escaped(dump_ctx_t * c, const char * s)
{
    for(; s && *s; s++) {
        if(*s == '"' || *s == '\\') dump_putc(c, '\\');
        if((unsigned char)*s < 0x20) { dump_putc(c, '?'); continue; }
        dump_putc(c, *s);
    }
}

static void dump_raw(dump_ctx_t * c, const char * s)
{
    for(; *s; s++) dump_putc(c, *s);
}

static void dump_obj(dump_ctx_t * c, lv_obj_t * o)
{
    if(c->overflow) return;
    char tmp[300];

    lv_obj_get_name_resolved(o, tmp, sizeof(tmp));
    dump_raw(c, "{\"name\":\"");
    dump_str_escaped(c, tmp);
    dump_raw(c, "\",\"class\":\"");
    const lv_obj_class_t * cls = lv_obj_get_class(o);
    dump_str_escaped(c, (cls && cls->name) ? cls->name : "unknown");

    lv_area_t a;
    lv_obj_get_coords(o, &a);
    snprintf(tmp, sizeof(tmp), "\",\"rect\":[%d,%d,%d,%d],\"children\":[",
             (int)a.x1, (int)a.y1, (int)lv_area_get_width(&a), (int)lv_area_get_height(&a));
    dump_raw(c, tmp);

    uint32_t n = lv_obj_get_child_count(o);
    for(uint32_t i = 0; i < n; i++) {
        if(i) dump_putc(c, ',');
        dump_obj(c, lv_obj_get_child(o, i));
    }
    dump_raw(c, "]}");
}

/* Writes the active screen tree (name + class + rect) as JSON into out
 * (capacity cap). Returns bytes written, or -3 on overflow / -2 no screen. */
EMSCRIPTEN_KEEPALIVE
int lvd_dump_tree(char * out, int cap)
{
    if(!out || cap < 2) return -3;
    lv_obj_t * act = lv_screen_active();
    if(!act) return -2;
    lv_obj_update_layout(act);

    dump_ctx_t c = { .out = out, .cap = cap, .pos = 0, .overflow = false };
    dump_obj(&c, act);
    if(c.overflow) return -3;
    out[c.pos] = '\0';
    return c.pos;
}
