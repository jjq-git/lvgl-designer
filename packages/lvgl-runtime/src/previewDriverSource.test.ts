import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(
  new URL('../../../runtime/src/preview_driver.c', import.meta.url),
), 'utf8');
const hostSource = readFileSync(fileURLToPath(
  new URL('../../../runtime/src/preview_host.c', import.meta.url),
), 'utf8');
const cmakeSource = readFileSync(fileURLToPath(
  new URL('../../../runtime/CMakeLists.txt', import.meta.url),
), 'utf8');
const symbolsPath = fileURLToPath(new URL('../../../scripts/out/lvgl-symbols.json', import.meta.url));
const symbols = existsSync(symbolsPath)
  ? JSON.parse(readFileSync(symbolsPath, 'utf8')) as Record<'v9.5.0', string[]>
  : null;

describe('preview_driver.c 协议边界', () => {
  it('导出 PreviewProgram v1 需要的全部受控操作', () => {
    for (const symbol of [
      'lvd_preview_begin',
      'lvd_preview_create_subject_i32',
      'lvd_preview_create_subject_float',
      'lvd_preview_create_subject_string',
      'lvd_preview_create_subject_color',
      'lvd_preview_create_style',
      'lvd_preview_set_named_style_i32',
      'lvd_preview_set_named_style_string',
      'lvd_preview_create_screen',
      'lvd_preview_create_node',
      'lvd_preview_create_structural',
      'lvd_preview_create_list_item',
      'lvd_preview_set_table_column',
      'lvd_preview_set_table_cell_value',
      'lvd_preview_set_table_cell_ctrl',
      'lvd_preview_set_i32',
      'lvd_preview_set_string',
      'lvd_preview_set_point_list',
      'lvd_preview_set_string_list',
      'lvd_preview_set_i32_list',
      'lvd_preview_set_chart_axis',
      'lvd_preview_set_flag',
      'lvd_preview_set_state',
      'lvd_preview_set_style_i32',
      'lvd_preview_set_style_string',
      'lvd_preview_add_style',
      'lvd_preview_bind_prop',
      'lvd_preview_bind_flag',
      'lvd_preview_bind_state',
      'lvd_preview_bind_style',
      'lvd_preview_add_callback_event',
      'lvd_preview_add_subject_set_event',
      'lvd_preview_add_subject_toggle_event',
      'lvd_preview_add_subject_increment_event',
      'lvd_preview_add_screen_event',
      'lvd_preview_finish',
    ]) {
      expect(source).toContain(`int ${symbol}(`);
    }
  });

  it('不依赖 XML 宿主，不提供通用 C/符号执行通道', () => {
    expect(source).not.toMatch(/\blv_xml_/);
    expect(source).not.toMatch(/\bdlsym\b|\beval\b|cPatch|\bc_create\b|setter_template/i);
  });

  it('9.5 host 与 legacy XML bridge 在 CMake 中严格二选一', () => {
    expect(hostSource).not.toMatch(/\blv_xml_/);
    expect(cmakeSource).toContain('option(LVD_LEGACY_XML_BRIDGE');
    expect(cmakeSource).toMatch(
      /if\(LVD_LEGACY_XML_BRIDGE\)[\s\S]*src\/bridge\.c[\s\S]*else\(\)[\s\S]*src\/preview_host\.c[\s\S]*src\/preview_driver\.c/,
    );
  });

  it('9.5 host 使用自建 display、partial buffer、Canvas flush 与浏览器输入', () => {
    for (const api of [
      'lv_display_create(',
      'lv_display_set_color_format(',
      'lv_display_set_buffers(',
      'lv_display_set_flush_cb(',
      'lv_display_flush_ready(',
      'lv_indev_create(',
      'lv_indev_set_read_cb(',
      'Module.canvas',
      "addEventListener('pointerdown'",
      "addEventListener('wheel'",
    ]) expect(hostSource).toContain(api);
    for (const format of [
      'LV_COLOR_FORMAT_RGB565',
      'LV_COLOR_FORMAT_RGB565_SWAPPED',
      'LV_COLOR_FORMAT_RGB888',
      'LV_COLOR_FORMAT_XRGB8888',
      'LV_COLOR_FORMAT_ARGB8888',
    ]) expect(hostSource).toContain(format);
    expect(hostSource).not.toMatch(/\blv_sdl_/);
    expect(cmakeSource).toMatch(
      /if\(LVD_LEGACY_XML_BRIDGE\)[\s\S]*--use-port=sdl2[\s\S]*endif\(\)/,
    );
  });

  it('首批创建器覆盖 P0 八控件、line、arclabel 及 spangroup', () => {
    for (const type of [
      'obj', 'label', 'button', 'image', 'slider', 'switch', 'arc', 'bar',
      'line', 'arclabel', 'spangroup', 'checkbox', 'dropdown',
      'roller', 'textarea', 'spinbox', 'buttonmatrix', 'keyboard', 'led', 'spinner',
      'qrcode', 'scale', 'calendar', 'msgbox', 'menu', 'win', 'tileview', 'chart', 'animimage', 'canvas', 'lottie',
    ]) {
      expect(source).toContain(`strcmp(type, "${type}")`);
    }
    expect(source).toContain('lv_line_set_points(');
    expect(source).toContain('lv_line_set_y_invert(');
    expect(source).toContain('lv_arclabel_set_text(');
    expect(source).toContain('lv_spangroup_add_span(');
    expect(source).toContain('lv_spangroup_set_span_text(');
    expect(source).toContain('lv_spangroup_set_span_style(');
    expect(source).toContain('lv_spangroup_bind_span_text(');
    expect(source).toContain('lv_checkbox_set_text(');
    expect(source).toContain('lv_obj_set_flex_flow(');
    expect(source).toContain('lv_obj_set_scroll_snap_x(');
    expect(source).toContain('lv_obj_set_scroll_snap_y(');
    expect(source).toContain('lv_obj_set_scrollbar_mode(');
    expect(source).toContain('lv_obj_set_style_line_color(');
    expect(source).toContain('lv_obj_set_style_line_width(');
    expect(source).toContain('lv_style_set_line_color(');
    expect(source).toContain('lv_style_set_line_width(');
    expect(source).toContain('lv_obj_set_style_arc_color(');
    expect(source).toContain('lv_obj_set_style_arc_width(');
    expect(source).toContain('lv_style_set_arc_color(');
    expect(source).toContain('lv_style_set_arc_width(');
    expect(source).toContain('lv_dropdown_get_list(');
    expect(source).toContain('lv_dropdown_set_options(');
    expect(source).toContain('lv_dropdown_bind_value(');
    expect(source).toContain('lv_roller_set_options(');
    expect(source).toContain('lv_roller_bind_value(');
    expect(source).toContain('lv_textarea_set_placeholder_text(');
    expect(source).toContain('lv_spinbox_set_digit_count(');
    expect(source).toContain('lv_spinbox_bind_value(');
    expect(source).toContain('lv_buttonmatrix_set_map(');
    expect(source).toContain('lv_buttonmatrix_set_button_ctrl(');
    expect(source).toContain('lv_keyboard_set_mode(');
    expect(source).toContain('lv_keyboard_set_textarea(');
    expect(source).toContain('lv_led_set_color(');
    expect(source).toContain('lv_led_set_brightness(');
    expect(source).toContain('lv_spinner_set_anim_params(');
    expect(source).toContain('lv_qrcode_update(');
    expect(source).toContain('lv_qrcode_set_quiet_zone(');
    expect(source).toContain('lv_scale_set_mode(');
    expect(source).toContain('lv_scale_set_total_tick_count(');
    expect(source).toContain('lv_calendar_set_today_year(');
    expect(source).toContain('lv_calendar_set_shown_month(');
    expect(source).toContain('lv_calendar_add_header_arrow(');
    expect(source).toContain('lv_calendar_add_header_dropdown(');
    expect(source).toContain('lv_msgbox_add_title(');
    expect(source).toContain('lv_msgbox_add_text(');
    expect(source).toContain('lv_msgbox_add_close_button(');
    expect(source).toContain('lv_msgbox_add_footer_button(');
    expect(source).toContain('lv_menu_page_create(');
    expect(source).toContain('lv_menu_set_page(');
    expect(source).toContain('lv_menu_set_mode_header(');
    expect(source).toContain('lv_menu_set_mode_root_back_button(');
    expect(source).toContain('lv_win_add_title(');
    expect(source).toContain('lv_win_add_button(');
    expect(source).toContain('lv_tileview_add_tile(');
    expect(source).toContain('lv_chart_add_series(');
    expect(source).toContain('lv_chart_set_next_value(');
    expect(source).toContain('lv_chart_add_cursor(');
    expect(source).toContain('lv_chart_set_axis_min_value(');
    expect(source).toMatch(/return track_structural_handle\(name, type, parent->obj, cursor\);\s*}\s*else\s*#endif\s*#if LV_USE_DROPDOWN/);
    expect(source).toContain('lv_animimg_set_src(');
    expect(source).toContain('lv_animimg_start(');
    expect(source).toContain('lv_draw_buf_create(');
    expect(source).toContain('lv_canvas_set_draw_buf(');
    expect(source).toContain('lv_canvas_fill_bg(');
    expect(source).toContain('lv_draw_buf_destroy(');
    expect(source).toContain('lv_lottie_set_draw_buf(');
    expect(source).toContain('lv_lottie_set_src_file(');
  });

  it('结构切片覆盖 tabview add/getter 与 table virtual', () => {
    for (const type of ['table', 'tabview']) expect(source).toContain(`strcmp(type, "${type}")`);
    expect(source).toContain('lv_tabview_add_tab(');
    expect(source).toContain('lv_tabview_get_tab_bar(');
    expect(source).toContain('lv_tabview_get_tab_button(');
    expect(source).toContain('lv_table_set_column_width(');
    expect(source).toContain('lv_table_set_cell_value(');
    expect(source).toContain('lv_table_set_cell_ctrl(');
  });

  it('PreviewProgram 原生创建 list/imagebutton 并映射其专属 API', () => {
    for (const type of ['list', 'imagebutton']) expect(source).toContain(`strcmp(type, "${type}")`);
    expect(source).toContain('lv_list_add_text(');
    expect(source).toContain('lv_list_add_button(');
    expect(source).toContain('lv_imagebutton_set_src(');
    expect(source).toContain('lv_imagebutton_set_state(');
  });

  it('chart 数值列表先完整校验再写入，animimage 换帧后再释放旧数组', () => {
    const chartList = source.slice(source.indexOf('int lvd_preview_set_i32_list('),
      source.indexOf('#else', source.indexOf('int lvd_preview_set_i32_list(')));
    expect(chartList).toMatch(/while\(\*cursor\)[\s\S]*if\(\*end && \(!end\[1\] \|\| end\[1\] == ' '\)\) return -4;[\s\S]*while\(\*cursor\)[\s\S]*lv_chart_set_next_value\(/);
    expect(source).toMatch(/lv_animimg_set_src\(r->obj, items, count\);\s*lv_animimg_start\(r->obj\);\s*free\(old_items\);/);
  });

  it('命名 style 使用独立 lv_style_t，不退化为 inline style', () => {
    expect(source).toContain('lv_style_init(&r->style)');
    expect(source).toContain('lv_style_reset(&dead->style)');
    expect(source).toContain('lv_obj_add_style(node->obj, &style->style, selector)');
  });

  it('subject 在对象 observer 自动解绑后才 deinit', () => {
    expect(source).toMatch(
      /clear_tracked\(\);[\s\S]*clear_events\(\);[\s\S]*clear_subjects\(\);[\s\S]*clear_styles\(\);/,
    );
    expect(source).toContain('lv_subject_deinit(&dead->subject)');
  });

  it('事件仅映射固定 trigger/action，并在清场期间禁止自定义回调重入', () => {
    expect(source).toContain('static int event_from_name(');
    expect(source).toContain('static int screen_anim_from_name(');
    expect(source).toContain('if(g_clearing) return;');
    expect(source).toContain('lv_obj_add_subject_set_int_event(');
    expect(source).toContain('lv_obj_add_subject_toggle_event(');
    expect(source).toContain('lv_obj_add_subject_increment_event(');
    expect(source).toContain('lv_screen_load_anim(');
    expect(source).toContain('Module.__lvEventStub(');
  });

  it.skipIf(symbols === null)('调用的每个 LVGL 符号都存在于 9.5.0 实测符号表', () => {
    const calls = [...source.matchAll(/\b(lv_[a-zA-Z0-9_]+)\s*\(/g)]
      .map((match) => match[1]!);
    const known = new Set(symbols!['v9.5.0']);
    expect([...new Set(calls)].filter((name) => !known.has(name))).toEqual([]);
  });
});
