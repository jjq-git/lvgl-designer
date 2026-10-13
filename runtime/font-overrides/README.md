# LVGL font overrides

`lv_font_montserrat_*.c` are LVGL 9.5's standard Montserrat 8–48 px fonts with the
product-owned outlined `door-open` glyph (`U+F52B`) from `PodscSymbols.ttf`.
All 21 enabled sizes include that code point, so changing a brand label's text
size preserves the mark in the designer preview and container device build.
No project image asset or fixed-size fallback is needed.

Generate the source font with:

```powershell
python scripts/generate-podsc-symbol-font.py `
  --ttf runtime/font-overrides/PodscSymbols.ttf `
  --woff runtime/font-overrides/podsc-symbols.woff
```

Then run (using `lv_font_conv` version 1.5.3):

```powershell
node scripts/generate-podsc-montserrat-fonts.mjs <path-to-lv_font_conv.js>
```

The generator reads enabled sizes from `runtime/lv_conf.h`, preserves LVGL's
standard Montserrat and Font Awesome character ranges, and adds code point
`62763` from `PodscSymbols.ttf`. CMake replaces all corresponding built-in
sources; Docker installs the same overrides for host/device build validation.
After regeneration rebuild the WASM runtime and the designer web bundle.
