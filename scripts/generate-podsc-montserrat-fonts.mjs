// Rebuild every enabled built-in size with the same product-owned symbol.
// Usage: node scripts/generate-podsc-montserrat-fonts.mjs <lv_font_conv.js>
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const converter = process.argv[2];
if (!converter) throw new Error('Pass the path to lv_font_conv@1.5.3/lv_font_conv.js');
const config = readFileSync(resolve(root, 'runtime/lv_conf.h'), 'utf8');
const sizes = [...config.matchAll(/^#define LV_FONT_MONTSERRAT_(\d+)\s+1\s*$/gm)].map((match) => Number(match[1]));
const source = readFileSync(resolve(root, 'vendor/lvgl/scripts/built_in_font/built_in_font_gen.py'), 'utf8');
const symbols = source.match(/^syms = "([\d,]+)"/m)?.[1];
if (!symbols || !sizes.length) throw new Error('Cannot read the LVGL built-in symbol list or enabled sizes');

for (const size of sizes) {
  const output = `../../../../runtime/font-overrides/lv_font_montserrat_${size}.c`;
  execFileSync(process.execPath, [resolve(converter),
    '--no-compress', '--no-prefilter', '--bpp', '4', '--size', String(size),
    '--font', 'Montserrat-Medium.ttf', '-r', '0x20-0x7F,176,8226',
    '--font', 'FontAwesome5-Solid+Brands+Regular.woff', '-r', symbols,
    '--font', '../../../../runtime/font-overrides/PodscSymbols.ttf', '-r', '62763',
    '--format', 'lvgl', '-o', output, '--force-fast-kern-format',
  ], { cwd: resolve(root, 'vendor/lvgl/scripts/built_in_font'), stdio: 'inherit' });
  const outputPath = resolve(root, `runtime/font-overrides/lv_font_montserrat_${size}.c`);
  writeFileSync(outputPath, `${readFileSync(outputPath, 'utf8').trimEnd()}\n`);
  console.log(`Generated Montserrat ${size}px with U+F52B`);
}
