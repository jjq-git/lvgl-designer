/**
 * @file bridge.c
 * LVGL Web Designer — all EMSCRIPTEN_KEEPALIVE exports
 * (design/02 §2 full set + ARCHITECTURE §3.3 review additions G1/G3/G4/G6/X6).
 *
 * Conventions (§2.1):
 *  - prefix lvd_; int returns: 0=OK, -1 generic failure, -2 not found, -3 bad arg
 *  - objects are referenced by NAME strings only (never lv_obj_t* across the
 *    boundary — hot reload destroys/rebuilds instances, raw pointers dangle)
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <emscripten.h>
#include <SDL2/SDL.h>

#include "lvgl.h"
/* Private include, justified (allowed per review note for bridge units only):
 *  - lv_display_t::screens/screen_cnt: no public API enumerates the screens of
 *    a display, and L4 (lvd_reload_all) must destroy ALL screen instances,
 *    including not-loaded ones;
 *  - lv_xml_component_init() (lv_xml_component_private.h): after unregistering
 *    the "globals" scope there is no public way to recreate it, and
 *    lv_xml_register_component_from_data("globals", ...) dereferences the
 *    globals scope unconditionally (lv_xml_component.c:138+). */
#include "lvgl_private.h"
#include "src/others/xml/lv_xml.h"
#include "src/others/xml/lv_xml_widget.h"
#include "src/others/xml/lv_xml_parser.h"
#include "src/others/xml/lv_xml_component_private.h"

#include "bridge_internal.h"
#include "xml_parsers_extra/lvd_xml_extra.h"

/*====================================================================
 * Shared state
 *====================================================================*/

lv_display_t * lvd_disp = NULL;
static lv_indev_t * g_mouse = NULL;
static lv_indev_t * g_wheel = NULL;

/*--------------------------------------------------------------------
 * Bridge-side registries.
 *
 * Rationale: L4 (lvd_reload_all) nukes the whole "globals" scope, which is
 * also where images / fonts / event stubs / lv_font_default live. The bridge
 * therefore keeps its own copy of everything it registered and replays the
 * registrations into the fresh globals scope inside lvd_reload_all, so the
 * JS side never has to re-push assets on L4.
 *-------------------------------------------------------------------*/

typedef struct lvd_comp_rec {
    char * name;
    struct lvd_comp_rec * next;
} lvd_comp_rec_t;
static lvd_comp_rec_t * g_comps = NULL;      /* every registered component name */

typedef struct lvd_img_rec {
    char * name;
    char * path;                             /* MEMFS path, e.g. "A:assets/x.png" */
    struct lvd_img_rec * next;
} lvd_img_rec_t;
static lvd_img_rec_t * g_imgs = NULL;

const char * lvd_find_image_src(const char * name)
{
    if(!name || !name[0]) return NULL;
    for(lvd_img_rec_t * r = g_imgs; r; r = r->next)
        if(strcmp(r->name, name) == 0) return r->path;
    return NULL;
}

typedef struct lvd_font_rec {
    char * name;
    lv_font_t * font;                        /* tiny_ttf instance */
    uint8_t * data;                          /* TTF bytes, owned by C side */
    struct lvd_font_rec * next;
} lvd_font_rec_t;
static lvd_font_rec_t * g_fonts = NULL;

const lv_font_t * lvd_find_font(const char * name)
{
    if(!name || !name[0]) return NULL;
    if(strcmp(name, "lv_font_default") == 0 || strcmp(name, "default") == 0)
        return lv_font_get_default();
#if LV_FONT_MONTSERRAT_8
    if(strcmp(name, "montserrat_8") == 0) return &lv_font_montserrat_8;
#endif
#if LV_FONT_MONTSERRAT_10
    if(strcmp(name, "montserrat_10") == 0) return &lv_font_montserrat_10;
#endif
#if LV_FONT_MONTSERRAT_12
    if(strcmp(name, "montserrat_12") == 0) return &lv_font_montserrat_12;
#endif
#if LV_FONT_MONTSERRAT_14
    if(strcmp(name, "montserrat_14") == 0) return &lv_font_montserrat_14;
#endif
#if LV_FONT_MONTSERRAT_16
    if(strcmp(name, "montserrat_16") == 0) return &lv_font_montserrat_16;
#endif
#if LV_FONT_MONTSERRAT_18
    if(strcmp(name, "montserrat_18") == 0) return &lv_font_montserrat_18;
#endif
#if LV_FONT_MONTSERRAT_20
    if(strcmp(name, "montserrat_20") == 0) return &lv_font_montserrat_20;
#endif
#if LV_FONT_MONTSERRAT_22
    if(strcmp(name, "montserrat_22") == 0) return &lv_font_montserrat_22;
#endif
#if LV_FONT_MONTSERRAT_24
    if(strcmp(name, "montserrat_24") == 0) return &lv_font_montserrat_24;
#endif
#if LV_FONT_MONTSERRAT_26
    if(strcmp(name, "montserrat_26") == 0) return &lv_font_montserrat_26;
#endif
#if LV_FONT_MONTSERRAT_28
    if(strcmp(name, "montserrat_28") == 0) return &lv_font_montserrat_28;
#endif
#if LV_FONT_MONTSERRAT_30
    if(strcmp(name, "montserrat_30") == 0) return &lv_font_montserrat_30;
#endif
#if LV_FONT_MONTSERRAT_32
    if(strcmp(name, "montserrat_32") == 0) return &lv_font_montserrat_32;
#endif
#if LV_FONT_MONTSERRAT_34
    if(strcmp(name, "montserrat_34") == 0) return &lv_font_montserrat_34;
#endif
#if LV_FONT_MONTSERRAT_36
    if(strcmp(name, "montserrat_36") == 0) return &lv_font_montserrat_36;
#endif
#if LV_FONT_MONTSERRAT_38
    if(strcmp(name, "montserrat_38") == 0) return &lv_font_montserrat_38;
#endif
#if LV_FONT_MONTSERRAT_40
    if(strcmp(name, "montserrat_40") == 0) return &lv_font_montserrat_40;
#endif
#if LV_FONT_MONTSERRAT_42
    if(strcmp(name, "montserrat_42") == 0) return &lv_font_montserrat_42;
#endif
#if LV_FONT_MONTSERRAT_44
    if(strcmp(name, "montserrat_44") == 0) return &lv_font_montserrat_44;
#endif
#if LV_FONT_MONTSERRAT_46
    if(strcmp(name, "montserrat_46") == 0) return &lv_font_montserrat_46;
#endif
#if LV_FONT_MONTSERRAT_48
    if(strcmp(name, "montserrat_48") == 0) return &lv_font_montserrat_48;
#endif
    for(lvd_font_rec_t * r = g_fonts; r; r = r->next)
        if(strcmp(r->name, name) == 0) return r->font;
    return NULL;
}

static void comp_track(const char * name)
{
    if(lv_streq(name, "globals")) return;
    for(lvd_comp_rec_t * r = g_comps; r; r = r->next)
        if(strcmp(r->name, name) == 0) return;
    lvd_comp_rec_t * r = malloc(sizeof(*r));
    r->name = strdup(name);
    r->next = g_comps;
    g_comps = r;
}

static void comp_untrack(const char * name)
{
    lvd_comp_rec_t ** pp = &g_comps;
    while(*pp) {
        if(strcmp((*pp)->name, name) == 0) {
            lvd_comp_rec_t * dead = *pp;
            *pp = dead->next;
            free(dead->name);
            free(dead);
            return;
        }
        pp = &(*pp)->next;
    }
}

/*====================================================================
 * name -> obj lookup helper (shared with bridge_hit.c)
 *====================================================================*/

lv_obj_t * lvd_find_obj(const char * name)
{
    if(!name || !name[0]) return NULL;
    lv_obj_t * act = lv_screen_active();
    if(act) {
        const char * scr_name = lv_obj_get_name(act);
        if(scr_name && strcmp(scr_name, name) == 0) return act;
        lv_obj_t * o = lv_obj_find_by_name(act, name);   /* recursive, µs range */
        if(o) return o;
    }
    /* fall back to (possibly not-loaded) screens of the display */
    if(lvd_disp) return lv_display_get_screen_by_name(lvd_disp, name);
    return NULL;
}

/*====================================================================
 * §2.2 Lifecycle / main loop / canvas
 *====================================================================*/

EMSCRIPTEN_KEEPALIVE
int lvd_init(int32_t hor, int32_t ver)
{
    lv_init();                       /* lv_init() calls lv_xml_init() itself */
    lvd_register_extra_widgets();    /* 13 self-written parsers; overrides lv_canvas */
    lvd_log_init();                  /* log hook must be live before first XML op */
    lvd_disp  = lv_sdl_window_create(hor, ver);
    g_mouse = lv_sdl_mouse_create(); /* used in play mode; disabled in design mode */
    g_wheel = lv_sdl_mousewheel_create();
    return lvd_disp ? 0 : -1;
}

/* JS rAF calls this every frame; returns ms until the next timer expiry */
EMSCRIPTEN_KEEPALIVE
uint32_t lvd_tick(void)
{
    return lv_timer_handler();
}

/* Change canvas resolution (target panel switch). The SDL driver resizes its
 * texture in its LV_EVENT_RESOLUTION_CHANGED handler. */
EMSCRIPTEN_KEEPALIVE
void lvd_set_resolution(int32_t hor, int32_t ver)
{
    lv_display_set_resolution(lvd_disp, hor, ver);
}

/*====================================================================
 * §2.3 XML registration / screen build / hot reload
 *
 * Source-level traps this code exists to avoid:
 *  1. register_component_from_data does NOT deduplicate -> always unregister
 *     the same name first (otherwise: leaked + shadowed scope).
 *  2. shared lv_style_t live INSIDE the scope; instances hold pointers into
 *     it -> instances must die BEFORE unregister (dangling style pointers).
 *====================================================================*/

EMSCRIPTEN_KEEPALIVE
int lvd_register_component(const char * name, const char * xml)
{
    if(!name || !xml) return -3;
    lv_xml_component_unregister(name);   /* returns INVALID when absent; fine */
    if(lv_xml_register_component_from_data(name, xml) != LV_RESULT_OK) return -1;
    comp_track(name);
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int lvd_unregister_component(const char * name)
{
    if(!name) return -3;
    comp_untrack(name);
    return lv_xml_component_unregister(name) == LV_RESULT_OK ? 0 : -2;
}

/* L3 screen-level hot reload. Strict order:
 * delete old instance -> unregister -> register -> create -> load */
EMSCRIPTEN_KEEPALIVE
int lvd_reload_screen(const char * name, const char * xml)
{
    if(!name || !xml) return -3;
    lv_obj_t * old_scr = lv_display_get_screen_by_name(lvd_disp, name);
    lv_obj_t * fallback = NULL;
    if(old_scr && old_scr == lv_screen_active()) {
        fallback = lv_obj_create(NULL);  /* blank pad screen: never delete the active screen */
        lv_screen_load(fallback);
    }
    if(old_scr) lv_obj_delete(old_scr);  /* (1) instance dies first */
    lv_xml_component_unregister(name);   /* (2) then the scope (styles now unreferenced) */
    if(lv_xml_register_component_from_data(name, xml) != LV_RESULT_OK) return -1;
    comp_track(name);
    lv_obj_t * scr = lv_xml_create_screen(name);
    if(scr == NULL) return -1;           /* parse error already sent via log hook */
    lv_screen_load(scr);
    if(fallback) lv_obj_delete(fallback);
    lv_obj_update_layout(scr);           /* JS can read bboxes right away */
    return 0;
}

/* L2: append a child widget/component. parent_name NULL/"" = active screen
 * root. attrs = flat key,value alternating array, NULL-terminated. */
EMSCRIPTEN_KEEPALIVE
int lvd_create_child(const char * parent_name,
                     const char * widget_or_comp,
                     const char ** attrs)
{
    if(!widget_or_comp) return -3;
    lv_obj_t * parent = (parent_name && parent_name[0])
                        ? lvd_find_obj(parent_name)
                        : lv_screen_active();
    if(!parent) return -2;
    return lv_xml_create(parent, widget_or_comp, attrs) ? 0 : -1;
}

EMSCRIPTEN_KEEPALIVE
int lvd_delete_obj(const char * name)
{
    lv_obj_t * o = lvd_find_obj(name);
    if(!o) return -2;
    lv_obj_delete(o);
    return 0;
}

/*====================================================================
 * §2.11 / §5.1 L1 attribute-level update: call the widget processor's
 * apply_cb directly (bypasses lv_xml_update's full-path restriction).
 * attrs must NOT contain the "name" key (JS side guarantees).
 *====================================================================*/

EMSCRIPTEN_KEEPALIVE
int lvd_update_attrs(const char * name, const char * widget_class, const char ** attrs)
{
    if(!name || !widget_class || !attrs) return -3;
    lv_widget_processor_t * proc = lv_xml_widget_get_processor(widget_class);
    if(!proc) return -3;
    lv_obj_t * obj = lvd_find_obj(name);
    if(!obj) return -2;

    /* Replicate lv_xml.c's static resolve_consts(): apply_cb is called directly,
     * bypassing view_start_element_handler, so "#name" const references would
     * otherwise reach the value parsers unresolved. NULL scope = "globals". */
    for(int i = 0; attrs[i]; i += 2) {
        const char * v = attrs[i + 1];
        if(!v) break;
        if(lv_streq(attrs[i], "styles")) continue;  /* styles resolve themselves */
        if(v[0] == '#') {
            const char * cv = lv_xml_get_const(NULL, &v[1]);
            if(cv) attrs[i + 1] = cv;
            else { attrs[i] = ""; attrs[i + 1] = ""; }  /* same as resolve_consts */
        }
    }

    lv_xml_parser_state_t state;
    lv_xml_parser_state_init(&state);    /* empty scope = globals, same as lv_xml_update */
    state.item = obj;
    proc->apply_cb(&state, attrs);
    lv_obj_update_layout(obj);
    return 0;
}

/*====================================================================
 * §2.7 Snapshot
 *====================================================================*/

static lv_draw_buf_t * g_snap = NULL;

/* Returns pixel data pointer (ARGB8888); w/h/stride written to meta_out[3].
 * JS must copy the pixels and then call lvd_snapshot_free(). */
EMSCRIPTEN_KEEPALIVE
uint8_t * lvd_snapshot(const char * screen_name, int32_t * meta_out)
{
    lv_obj_t * scr = (screen_name && screen_name[0])
                     ? lv_display_get_screen_by_name(lvd_disp, screen_name)
                     : lv_screen_active();
    if(!scr || !meta_out) return NULL;
    lv_obj_update_layout(scr);
    if(g_snap) { lv_draw_buf_destroy(g_snap); g_snap = NULL; }
    g_snap = lv_snapshot_take(scr, LV_COLOR_FORMAT_ARGB8888);
    if(!g_snap) return NULL;
    meta_out[0] = (int32_t)g_snap->header.w;
    meta_out[1] = (int32_t)g_snap->header.h;
    meta_out[2] = (int32_t)g_snap->header.stride;
    return g_snap->data;
}

EMSCRIPTEN_KEEPALIVE
void lvd_snapshot_free(void)
{
    if(g_snap) { lv_draw_buf_destroy(g_snap); g_snap = NULL; }
}

/*====================================================================
 * §2.8 Design mode: disable real interaction / freeze animations
 *====================================================================*/

EMSCRIPTEN_KEEPALIVE
void lvd_set_interactive(int enable)
{
    for(lv_indev_t * i = lv_indev_get_next(NULL); i; i = lv_indev_get_next(i))
        lv_indev_enable(i, enable != 0);
}

/* Global animation freeze: pause/resume the single lv_anim engine timer.
 * Also freezes animations created while paused. */
EMSCRIPTEN_KEEPALIVE
void lvd_pause_anims(int pause)
{
    lv_timer_t * t = lv_anim_get_timer();
    if(!t) return;
    if(pause) lv_timer_pause(t);
    else lv_timer_resume(t);
}

/*====================================================================
 * §2.9 Asset injection (images / fonts)
 *====================================================================*/

/* memfs_path e.g. "A:assets/logo.png" (bytes written by JS via Module.FS).
 * lv_xml_register_image strdups file paths itself and dedups by name. */
EMSCRIPTEN_KEEPALIVE
int lvd_register_image(const char * name, const char * memfs_path)
{
    if(!name || !memfs_path) return -3;
    /* upsert bridge registry (replayed on L4) */
    lvd_img_rec_t * r = g_imgs;
    for(; r; r = r->next) if(strcmp(r->name, name) == 0) break;
    if(r) {
        free(r->path);
        r->path = strdup(memfs_path);
    }
    else {
        r = malloc(sizeof(*r));
        r->name = strdup(name);
        r->path = strdup(memfs_path);
        r->next = g_imgs;
        g_imgs = r;
    }
    return lv_xml_register_image(NULL, name, memfs_path) == LV_RESULT_OK ? 0 : -1;
}

/* data is malloc'd on the JS side; ownership moves to the C side (tiny_ttf
 * keeps reading from it). Re-registering an existing name only takes effect
 * on the next L4 reload (lv_xml_register_font dedups by name); the previous
 * font instance is intentionally leaked — live widgets may still render with
 * it until the L4 that necessarily follows any font change. */
EMSCRIPTEN_KEEPALIVE
int lvd_register_font_tiny_ttf(const char * name, uint8_t * data, int len, int size_px)
{
    if(!name || !data || len <= 0 || size_px <= 0) return -3;
    lv_font_t * font = lv_tiny_ttf_create_data(data, (size_t)len, size_px);
    if(!font) return -1;

    lvd_font_rec_t * r = g_fonts;
    for(; r; r = r->next) if(strcmp(r->name, name) == 0) break;
    if(r) {
        r->font = font;    /* old font/data leaked on purpose, see above */
        r->data = data;
    }
    else {
        r = malloc(sizeof(*r));
        r->name = strdup(name);
        r->font = font;
        r->data = data;
        r->next = g_fonts;
        g_fonts = r;
    }
    return lv_xml_register_font(NULL, name, font) == LV_RESULT_OK ? 0 : -1;
}

EMSCRIPTEN_KEEPALIVE
void lvd_set_asset_prefix(const char * p)
{
    lv_xml_set_default_asset_path(p);
}

/*====================================================================
 * Review G4: drop decoded image cache after replacing MEMFS content.
 * src = the image source path; NULL/"" drops the whole cache.
 *====================================================================*/

EMSCRIPTEN_KEEPALIVE
void lvd_drop_image_cache(const char * src)
{
    lv_image_cache_drop((src && src[0]) ? (const void *)src : NULL);
}

/*====================================================================
 * Review G6: pure screen switch, no rebuild
 *====================================================================*/

EMSCRIPTEN_KEEPALIVE
int lvd_load_screen(const char * name)
{
    if(!name || !name[0]) return -3;
    lv_obj_t * scr = lv_display_get_screen_by_name(lvd_disp, name);
    if(!scr) return -2;
    lv_screen_load(scr);
    lv_obj_update_layout(scr);
    return 0;
}

/*====================================================================
 * Review G3: event callback stubs for play mode.
 * One shared C trampoline can't recover the callback NAME from lv_event_t
 * (user_data carries the XML author's payload), so a fixed pool of
 * trampolines is generated, one slot per registered callback name.
 * Fired events are reported to Module.__lvEventStub(cb_name, event_code).
 *====================================================================*/

EM_JS(void, lvd_js_event_stub, (const char * name, int code), {
    if(Module.__lvEventStub) Module.__lvEventStub(UTF8ToString(name), code);
});

#define LVD_STUB_MAX 64
static char * g_stub_names[LVD_STUB_MAX];
static int g_stub_cnt = 0;

static void stub_fire(int idx, lv_event_t * e)
{
    lvd_js_event_stub(g_stub_names[idx], (int)lv_event_get_code(e));
}

#define LVD_STUB_LIST(X) \
    X(0)  X(1)  X(2)  X(3)  X(4)  X(5)  X(6)  X(7)  \
    X(8)  X(9)  X(10) X(11) X(12) X(13) X(14) X(15) \
    X(16) X(17) X(18) X(19) X(20) X(21) X(22) X(23) \
    X(24) X(25) X(26) X(27) X(28) X(29) X(30) X(31) \
    X(32) X(33) X(34) X(35) X(36) X(37) X(38) X(39) \
    X(40) X(41) X(42) X(43) X(44) X(45) X(46) X(47) \
    X(48) X(49) X(50) X(51) X(52) X(53) X(54) X(55) \
    X(56) X(57) X(58) X(59) X(60) X(61) X(62) X(63)

#define LVD_STUB_DEF(i) static void lvd_stub_cb_##i(lv_event_t * e) { stub_fire(i, e); }
LVD_STUB_LIST(LVD_STUB_DEF)

#define LVD_STUB_REF(i) lvd_stub_cb_##i,
static lv_event_cb_t const g_stub_cbs[LVD_STUB_MAX] = { LVD_STUB_LIST(LVD_STUB_REF) };

EMSCRIPTEN_KEEPALIVE
int lvd_register_event_stub(const char * cb_name)
{
    if(!cb_name || !cb_name[0]) return -3;
    for(int i = 0; i < g_stub_cnt; i++) {
        if(strcmp(g_stub_names[i], cb_name) == 0) {
            /* idempotent: make sure the fresh globals scope knows it too */
            lv_xml_register_event_cb(NULL, cb_name, g_stub_cbs[i]);
            return 0;
        }
    }
    if(g_stub_cnt >= LVD_STUB_MAX) return -1;     /* pool exhausted */
    int idx = g_stub_cnt++;
    g_stub_names[idx] = strdup(cb_name);
    return lv_xml_register_event_cb(NULL, cb_name, g_stub_cbs[idx]) == LV_RESULT_OK ? 0 : -1;
}

/*====================================================================
 * Review G1: L4 full-project reload.
 * destroy ALL screen instances (incl. not-loaded ones, via the display's
 * screen array) -> unregister all components + "globals" -> recreate the
 * globals scope -> replay bridge-side registrations (default font, images,
 * fonts, event stubs) -> register globals XML -> register+create each
 * screen -> load the first one.
 *====================================================================*/

EMSCRIPTEN_KEEPALIVE
int lvd_reload_all(const char * globals_xml,
                   const char ** screen_names,
                   const char ** screen_xmls,
                   int n)
{
    if(n < 0 || (n > 0 && (!screen_names || !screen_xmls))) return -3;

    /* (1) pad screen so the active screen is never deleted under us */
    lv_obj_t * fallback = lv_obj_create(NULL);
    lv_screen_load(fallback);

    /* (2) delete every screen instance except the pad and the built-in layers.
     * Private access: no public screen-enumeration API exists. Collect first —
     * lv_obj_delete mutates disp->screens. */
    lv_obj_t * layer_top = lv_display_get_layer_top(lvd_disp);
    lv_obj_t * layer_sys = lv_display_get_layer_sys(lvd_disp);
    lv_obj_t * layer_bot = lv_display_get_layer_bottom(lvd_disp);
    uint32_t total = lvd_disp->screen_cnt;
    lv_obj_t ** doomed = malloc(sizeof(lv_obj_t *) * (total ? total : 1));
    uint32_t m = 0;
    for(uint32_t i = 0; i < total; i++) {
        lv_obj_t * s = lvd_disp->screens[i];
        if(s == fallback || s == layer_top || s == layer_sys || s == layer_bot) continue;
        doomed[m++] = s;
    }
    for(uint32_t i = 0; i < m; i++) lv_obj_delete(doomed[i]);
    free(doomed);

    /* (3) unregister every component the bridge ever registered */
    while(g_comps) {
        lvd_comp_rec_t * r = g_comps;
        g_comps = r->next;
        lv_xml_component_unregister(r->name);
        free(r->name);
        free(r);
    }
    for(int i = 0; i < n; i++) lv_xml_component_unregister(screen_names[i]); /* belt & braces */

    /* (4) tear down "globals" and recreate an empty scope list + globals.
     * lv_xml_component_init() re-inits the (now empty) scope ll and inserts a
     * fresh "globals" — the only way, the ll is a static in lv_xml_component.c. */
    lv_xml_component_unregister("globals");
    lv_xml_component_init();

    /* (5) replay registrations lv_xml_init()/the bridge had put into globals */
    lv_xml_register_font(NULL, "lv_font_default", lv_font_get_default());
    for(lvd_img_rec_t * ir = g_imgs; ir; ir = ir->next)
        lv_xml_register_image(NULL, ir->name, ir->path);
    for(lvd_font_rec_t * fr = g_fonts; fr; fr = fr->next)
        lv_xml_register_font(NULL, fr->name, fr->font);
    for(int i = 0; i < g_stub_cnt; i++)
        lv_xml_register_event_cb(NULL, g_stub_names[i], g_stub_cbs[i]);

    /* (6) globals XML (consts/styles/subjects); optional */
    if(globals_xml && globals_xml[0]) {
        if(lv_xml_register_component_from_data("globals", globals_xml) != LV_RESULT_OK)
            return -1;   /* pad screen stays loaded; error text went via log hook */
    }

    /* (7) register + create every screen, load the first */
    lv_obj_t * first = NULL;
    for(int i = 0; i < n; i++) {
        if(!screen_names[i] || !screen_xmls[i]) return -3;
        if(lv_xml_register_component_from_data(screen_names[i], screen_xmls[i]) != LV_RESULT_OK)
            return -1;
        comp_track(screen_names[i]);
        lv_obj_t * scr = lv_xml_create_screen(screen_names[i]);
        if(!scr) return -1;
        if(!first) first = scr;
    }

    if(first) {
        lv_screen_load(first);
        lv_obj_delete(fallback);
        lv_obj_update_layout(first);
    }
    /* n == 0: keep the pad screen as the active screen */
    return 0;
}

/*====================================================================
 * Review X6: manual tick for deterministic e2e screenshots.
 * Switches the LVGL tick source between SDL_GetTicks (wall clock, set by
 * lv_sdl_window_create) and a bridge-owned counter.
 *====================================================================*/

static uint32_t g_manual_ms = 0;

static uint32_t manual_tick_cb(void)
{
    return g_manual_ms;
}

EMSCRIPTEN_KEEPALIVE
void lvd_set_manual_tick(int enable)
{
    if(enable) {
        /* seed with the wall clock so time never jumps backwards */
        g_manual_ms = SDL_GetTicks();
        lv_tick_set_cb(manual_tick_cb);
    }
    else {
        /* NOTE: if the manual counter was advanced past the wall clock, time
         * jumps backwards here; only use in throwaway e2e sessions. */
        lv_tick_set_cb((lv_tick_get_cb_t)SDL_GetTicks);
    }
}

/* Advance virtual time and run the timer/refresh machinery once.
 * Returns ms until the next timer expiry (like lvd_tick). */
EMSCRIPTEN_KEEPALIVE
uint32_t lvd_advance_tick(uint32_t ms)
{
    g_manual_ms += ms;
    return lv_timer_handler();
}
