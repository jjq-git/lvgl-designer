/**
 * @file lv_conf.h
 * LVGL Web Designer — WASM runtime configuration (LVGL 9.4.0)
 *
 * Minimal override style: only the options that differ from the defaults in
 * `src/lv_conf_internal.h` are defined here; everything else falls back to
 * the internal defaults. See docs/design/02 §1.3 for the rationale table.
 */

#ifndef LV_CONF_H
#define LV_CONF_H

/*====================
 * COLOR / MATH
 *====================*/

/* SDL texture is ARGB; snapshots come out as ARGB8888 with zero conversion */
#define LV_COLOR_DEPTH 32

/* Float support (lv_value_precise_t = float); needed by scale/anim precision */
#define LV_USE_FLOAT 1

/*====================
 * STDLIB
 *====================*/

/* Use emscripten dlmalloc: grows with ALLOW_MEMORY_GROWTH, no fixed LV_MEM pool */
#define LV_USE_STDLIB_MALLOC  LV_STDLIB_CLIB
#define LV_USE_STDLIB_STRING  LV_STDLIB_CLIB
#define LV_USE_STDLIB_SPRINTF LV_STDLIB_CLIB

/*====================
 * HAL
 *====================*/

/* Desktop browser, 60 fps */
#define LV_DEF_REFR_PERIOD 16

/*====================
 * LOGGING
 *====================*/

/* XML parse errors are only reported through the log callback (bridge_log.c) */
#define LV_USE_LOG     1
#define LV_LOG_LEVEL   LV_LOG_LEVEL_WARN
#define LV_LOG_PRINTF  0   /* 0 = use lv_log_register_print_cb() */

/*====================
 * CORE FEATURES
 *====================*/

/* Hard prerequisite for name lookup (lv_obj_find_by_name) and XML name binding */
#define LV_USE_OBJ_NAME 1

/* lv_xml.h depends on subject registration */
#define LV_USE_OBSERVER 1

/* The whole designer preview channel */
#define LV_USE_XML 1

/* Screenshot export (lvd_snapshot) */
#define LV_USE_SNAPSHOT 1

/*====================
 * FILESYSTEM (MEMFS via emscripten stdio)
 *====================*/

#define LV_USE_FS_STDIO 1
#define LV_FS_STDIO_LETTER 'A'
#define LV_FS_STDIO_PATH ""
#define LV_FS_STDIO_CACHE_SIZE 0

/*====================
 * IMAGE DECODERS / FONT ENGINE
 *====================*/

#define LV_USE_LODEPNG 1
#define LV_USE_TJPGD   1

/* Runtime TTF rendering for user-uploaded fonts (preview channel) */
#define LV_USE_TINY_TTF 1
#define LV_TINY_TTF_FILE_SUPPORT 0

/*====================
 * SDL DRIVER (emscripten SDL2 port -> <canvas>)
 *====================*/

#ifndef LV_USE_SDL
#define LV_USE_SDL 0
#endif
#define LV_SDL_INCLUDE_PATH     <SDL2/SDL.h>
#define LV_SDL_RENDER_MODE      LV_DISPLAY_RENDER_MODE_DIRECT
#define LV_SDL_BUF_COUNT        1
#define LV_SDL_ACCELERATED      1
#define LV_SDL_FULLSCREEN       0
#define LV_SDL_DIRECT_EXIT      0   /* never let SDL tear down the runtime */
#define LV_SDL_MOUSEWHEEL_MODE  LV_SDL_MOUSEWHEEL_MODE_ENCODER

/*====================
 * 3RD-PARTY WIDGET LIBS
 *====================*/

/* qrcode 是官方 22 控件之一,默认 0,必须显式开(任务 D 补,e2e 实测缺失) */
#define LV_USE_QRCODE 1

/*====================
 * VECTOR / LOTTIE (thorvg internal; wasm size cost accepted, see build log)
 *====================*/

#define LV_USE_MATRIX          1   /* prerequisite of LV_USE_VECTOR_GRAPHIC */
#define LV_USE_VECTOR_GRAPHIC  1
#define LV_USE_THORVG_INTERNAL 1
#define LV_USE_LOTTIE          1   /* requires canvas (default-on) + thorvg */

/*====================
 * FONTS (all Montserrat sizes: designer must switch sizes instantly)
 *====================*/

#define LV_FONT_MONTSERRAT_8  1
#define LV_FONT_MONTSERRAT_10 1
#define LV_FONT_MONTSERRAT_12 1
#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_16 1
#define LV_FONT_MONTSERRAT_18 1
#define LV_FONT_MONTSERRAT_20 1
#define LV_FONT_MONTSERRAT_22 1
#define LV_FONT_MONTSERRAT_24 1
#define LV_FONT_MONTSERRAT_26 1
#define LV_FONT_MONTSERRAT_28 1
#define LV_FONT_MONTSERRAT_30 1
#define LV_FONT_MONTSERRAT_32 1
#define LV_FONT_MONTSERRAT_34 1
#define LV_FONT_MONTSERRAT_36 1
#define LV_FONT_MONTSERRAT_38 1
#define LV_FONT_MONTSERRAT_40 1
#define LV_FONT_MONTSERRAT_42 1
#define LV_FONT_MONTSERRAT_44 1
#define LV_FONT_MONTSERRAT_46 1
#define LV_FONT_MONTSERRAT_48 1

#endif /* LV_CONF_H */
