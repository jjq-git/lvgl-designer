#!/usr/bin/env node
// LVGL Web Designer 本机静态服务(systemd 常驻)。
// 用法: node serve.mjs [port] [distDir]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const PORT = Number(process.argv[2] || process.env.PORT || 8318);
const ROOT = resolve(process.argv[3] || join(import.meta.dirname, '../apps/designer/dist'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path === '/' || path === '\\') path = '/index.html';
    let file = join(ROOT, path);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    try { await stat(file); } catch { file = join(ROOT, 'index.html'); } // SPA fallback
    const body = await readFile(file);
    const type = MIME[extname(file)] || 'application/octet-stream';
    // 指纹资产可长缓存,index.html 不缓存
    const cache = file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable';
    res.writeHead(200, { 'content-type': type, 'cache-control': cache });
    res.end(body);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e));
  }
}).listen(PORT, () => console.log(`lvgl-designer serving ${ROOT} on http://localhost:${PORT}`));
