# LVGL font overrides

`lv_font_montserrat_20.c` is LVGL 9.5's standard Montserrat 20 px font with the
product-owned outlined `door-open` glyph (`U+F52B`) from `PodscSymbols.ttf`.
Quiet-pod brand labels use that code point at 20 px, so the designer preview and
generated device build render the same mark without a project image asset.

Generate the source font with:

```powershell
python scripts/generate-podsc-symbol-font.py `
  --ttf runtime/font-overrides/PodscSymbols.ttf `
  --woff runtime/font-overrides/podsc-symbols.woff
```

Then generate the C font with `lv_font_conv` from LVGL's vendored
`Montserrat-Medium.ttf`, `FontAwesome5-Solid+Brands+Regular.woff`, and
`PodscSymbols.ttf`. Keep the standard LVGL symbol list on Font Awesome and add
decimal code point `62763` from `PodscSymbols.ttf`.
