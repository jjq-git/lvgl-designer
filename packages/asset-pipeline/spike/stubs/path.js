// minimal path shim: only extname/basename are used (lv_font.js font-name derivation)
export function extname(p) { const i = p.lastIndexOf('.'); return i > 0 ? p.slice(i) : ''; }
export function basename(p, ext) {
  let b = p.replace(/\\/g, '/').split('/').pop();
  if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length);
  return b;
}
export function dirname(p) { const s = p.replace(/\\/g, '/'); const i = s.lastIndexOf('/'); return i === -1 ? '.' : s.slice(0, i) || '/'; }
export function normalize(p) { return p; }
export function join(...a) { return a.join('/'); }
export default { extname, basename, dirname, normalize, join };
