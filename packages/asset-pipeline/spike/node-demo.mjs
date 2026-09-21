// Node-side lv_font_conv library-API demo (no CLI).
// Entry: require('lv_font_conv/lib/convert') — async (args) => { [filename]: Buffer|string }
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const convert = require('lv_font_conv/lib/convert');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TTF = '/home/rie/lvgl-web-designer/vendor/lvgl/scripts/built_in_font/Montserrat-Medium.ttf';
const outDir = path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

const source_bin = fs.readFileSync(TTF); // Buffer 直传，convert 内部不再碰 fs

function baseArgs(format, output) {
  return {
    font: [
      {
        source_path: TTF,               // 仅作 key/报错用，不会被读取
        source_bin,                     // Buffer 或 ArrayBuffer 都可
        ranges: [ { range: [0x20, 0x7f, 0x20] } ], // [start, end, mapped_start]*
      },
    ],
    size: 16,
    bpp: 4,
    format,                             // 'lvgl' | 'bin' | 'dump'
    output,                             // 作为产物 hash 的文件名 & lvgl 字体名来源
    lv_include: null,
    lv_fallback: null,
    lv_font_name: null,                 // null => 从 output basename 推导
    no_compress: false,
    no_prefilter: false,
    no_kerning: false,
    fast_kerning: false,
    use_color_info: false,
    lcd: false,
    lcd_v: false,
    opts_string: '--demo',              // 写进 C 文件注释
  };
}

// 1) LVGL C file
const cFiles = await convert(baseArgs('lvgl', path.join(outDir, 'montserrat_16.c')));
for (const [name, data] of Object.entries(cFiles)) fs.writeFileSync(name, data);

// 2) bin
const binFiles = await convert(baseArgs('bin', path.join(outDir, 'montserrat_16.bin')));
for (const [name, data] of Object.entries(binFiles)) fs.writeFileSync(name, data);

// assertions
const cPath = path.join(outDir, 'montserrat_16.c');
const bPath = path.join(outDir, 'montserrat_16.bin');
const cTxt = fs.readFileSync(cPath, 'utf8');
const bLen = fs.statSync(bPath).size;
console.assert(cTxt.length > 0, 'C file empty');
console.assert(cTxt.includes('lv_font_t'), 'C file missing lv_font_t');
console.assert(bLen > 0, 'bin empty');
console.log(JSON.stringify({ ok: true, c_bytes: cTxt.length, has_lv_font_t: cTxt.includes('lv_font_t'), bin_bytes: bLen }));
