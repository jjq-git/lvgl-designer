import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = new URL('./', import.meta.url);
const local = (path) => fileURLToPath(new URL(path, here));
const outfile = local('browser-bundle.mjs');

await build({
  entryPoints: [local('browser-entry.js')],
  outfile,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  alias: {
    fs: local('stubs/empty.js'),
    path: local('stubs/path.js'),
    assert: local('stubs/assert.js'),
    pngjs: local('stubs/pngjs.js'),
    buffer: 'buffer',
  },
  inject: [local('stubs/buffer-shim.js')],
  define: { 'process.env.NODE_DEBUG': 'undefined' },
});

const unsafeRunScript = /function _emscripten_run_script\(ptr\) \{\s*eval\(UTF8ToString\(ptr\)\);\s*\}/;
const safeRunScript = `function _emscripten_run_script(ptr) {
          var script = UTF8ToString(ptr);
          var constant = /^Module\\.([A-Z][A-Z0-9_]+) = (-?(?:0x[0-9a-fA-F]+|[0-9]+));$/.exec(script);
          if (!constant) throw new Error("emscripten dynamic script execution is disabled");
          Module[constant[1]] = Number(constant[2]);
        }`;

let source = await readFile(outfile, 'utf8');
if (unsafeRunScript.test(source)) source = source.replace(unsafeRunScript, safeRunScript);
if (!source.includes(safeRunScript) || /\beval\s*\(/.test(source)) {
  throw new Error('bundle hardening failed: dynamic eval remains or whitelist parser is missing');
}
await writeFile(outfile, source, 'utf8');
