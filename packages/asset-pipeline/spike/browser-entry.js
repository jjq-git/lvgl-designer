// Browser entry: wraps lv_font_conv/lib/convert for in-browser use.
// Input font must be passed as source_bin (Uint8Array/ArrayBuffer/Buffer-polyfill) — no fs.
import convert from 'lv_font_conv/lib/convert';
import opentype from 'lv_font_conv/node_modules/opentype.js';
import { Buffer } from 'buffer';

function toArrayBuffer(fontBin) {
  const bin = Buffer.isBuffer(fontBin) ? fontBin : Buffer.from(fontBin.buffer || fontBin, fontBin.byteOffset || 0, fontBin.byteLength);
  return bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
}

/** Return the requested Unicode code points that are absent from the font cmap. */
export function findMissingCodePoints(fontBin, codePoints) {
  const font = opentype.parse(toArrayBuffer(fontBin));
  return codePoints.filter((point) => font.charToGlyphIndex(String.fromCodePoint(point)) <= 0);
}

/**
 * @param {Uint8Array|ArrayBuffer} fontBin - raw TTF/WOFF bytes (e.g. from <input type=file>)
 * @param {object} o - { size, bpp, format: 'lvgl'|'bin', name, range }
 * @returns {Promise<Uint8Array|string>} single output artifact
 */
export async function convertFont(fontBin, { size = 16, bpp = 4, format = 'bin', name = 'font', range = [0x20, 0x7f, 0x20] } = {}) {
  // collect_font_data 期望 Buffer(会转 ArrayBuffer 给 opentype.js);裸 Uint8Array 会挂,须包一层
  const bin = Buffer.isBuffer(fontBin) ? fontBin : Buffer.from(fontBin.buffer || fontBin, fontBin.byteOffset || 0, fontBin.byteLength);
  const args = {
    font: [ { source_path: name, source_bin: bin, ranges: [ { range } ] } ],
    size, bpp, format,
    output: name,
    lv_include: null, lv_fallback: null, lv_font_name: name,
    no_compress: false, no_prefilter: false, no_kerning: false,
    fast_kerning: false, use_color_info: false, lcd: false, lcd_v: false,
    opts_string: '',
  };
  const files = await convert(args);
  return files[Object.keys(files)[0]];
}

export { convert };
