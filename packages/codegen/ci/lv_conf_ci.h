/**
 * lv_conf_ci.h — 编译冒烟用最小配置(scripts/compile-smoke.sh)。
 * 只声明生成代码依赖的开关,其余取 lv_conf_internal.h 默认值。
 * LV_USE_OBJ_NAME 允许外部 -D 覆盖(0/1 两种各编一遍,验证宏守卫)。
 */
#ifndef LV_CONF_H
#define LV_CONF_H   /* lv_conf_internal.h 用这个宏确认 conf 已被真实包含 */

#define LV_COLOR_DEPTH 32

#ifndef LV_USE_OBJ_NAME
#define LV_USE_OBJ_NAME 1
#endif

/* golden 用到的可选 widget / 字体 */
#define LV_USE_QRCODE 1
#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_16 1   /* target-* 三 case 的 s_title */
#define LV_FONT_MONTSERRAT_24 1

/* M2 官方 7 控件 */
#define LV_USE_BUTTONMATRIX 1
#define LV_USE_CALENDAR 1
#define LV_USE_CALENDAR_HEADER_ARROW 1
#define LV_USE_CALENDAR_HEADER_DROPDOWN 1
#define LV_USE_CHART 1
#define LV_USE_KEYBOARD 1
#define LV_USE_SPAN 1
#define LV_USE_TABLE 1
#define LV_USE_TABVIEW 1

/* M3 自研 13 控件:其余(led/line/…/canvas)lv_conf_internal.h 默认已开,
 * 仅 lottie 链默认 0(与 runtime/lv_conf.h 同步;matrix 依赖 float) */
#define LV_USE_FLOAT 1
#define LV_USE_LOTTIE 1
#define LV_USE_THORVG_INTERNAL 1
#define LV_USE_VECTOR_GRAPHIC 1
#define LV_USE_MATRIX 1

/* subjects / bind_* 依赖 */
#define LV_USE_OBSERVER 1

#endif /* LV_CONF_H */
