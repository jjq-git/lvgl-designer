#!/usr/bin/env node
// LVGL Web Designer 本机静态服务 + DeepSeek AI 代理(systemd 常驻)。
// 以 serve.mjs 为底的增强版:静态托管逻辑全保留,新增 POST /api/deepseek/chat。
// 用法: node server-ai.mjs [port] [distDir]
// 环境变量: DS_UPSTREAM 覆盖上游地址(默认 https://api.deepseek.com/chat/completions,自测 mock 用)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { createAuth, handleAuthRoutes, parseCookies, SESSION_COOKIE_NAME } from './auth.mjs';
import { isDbEnabled } from './db.mjs';
import { migrate } from './migrate.mjs';
import { handleProjectRoutes } from './projects.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8318);
const ROOT = resolve(process.argv[3] || join(import.meta.dirname, '../apps/designer/dist'));
const UPSTREAM = process.env.DS_UPSTREAM || 'https://api.deepseek.com/chat/completions';
const UPSTREAM_TIMEOUT_MS = 120_000;
const HOST = process.env.HOST || '127.0.0.1';          // 容器/公网部署时设 HOST=0.0.0.0
const AUTH_DISABLED = process.env.AUTH_DISABLED === '1'; // 本地开发逃生舱:完全跳过鉴权

// 数据库(有 DATABASE_URL 时):启动跑迁移;用户/工程数据落库。无则文件回退。
const DB_ENABLED = isDbEnabled();
if (DB_ENABLED) {
  try { await migrate(); }
  catch (e) { console.error('[migrate] 启动迁移失败:', e?.message || e); }
} else {
  console.log('[db] 未配置 DATABASE_URL:用户走文件、/api/projects* 返回 503(前端 fallback 本地存储)');
}

// 账号系统:DB 模式落 users 表;否则 users.json / sessions.json 存于 LVD_USERS_FILE 目录
const auth = createAuth(import.meta.dirname);
if (!AUTH_DISABLED) {
  try { await auth.bootstrap(); }
  catch (e) { console.error('[auth] bootstrap 失败:', e?.message || e); }
}

// 登录页(自包含,内联 CSS/JS,不引用任何 gated 资源)
let LOGIN_HTML = '<!doctype html><meta charset="utf-8"><title>登录</title><body>login page missing</body>';
try { LOGIN_HTML = await readFile(join(import.meta.dirname, 'login.html'), 'utf8'); }
catch (e) { console.error('[auth] 读取 login.html 失败:', e?.message || e); }

function sendLoginPage(res) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(LOGIN_HTML);
}

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

function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// POST /api/deepseek/chat → 转发 DeepSeek /chat/completions
// x-ds-key 头 → Authorization: Bearer;body 原样转发;流式逐块透传;4xx/5xx 原样透传。
async function proxyDeepseek(req, res) {
  // 浏览器带 x-ds-key 优先;否则回落服务端预置 key(systemd EnvironmentFile → DS_KEY)
  const headerKey = req.headers['x-ds-key'];
  const key = (typeof headerKey === 'string' && headerKey.trim()) ? headerKey : (process.env.DS_KEY || '');
  if (!key.trim()) {
    return sendJson(res, 401, { error: 'missing key' });
  }

  const body = await readBody(req);

  // client 断开(abort)→ 中断上游 fetch;120s 上游超时
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]);

  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'content-type': req.headers['content-type'] || 'application/json',
        authorization: `Bearer ${key.trim()}`,
        accept: req.headers['accept'] || '*/*',
      },
      body,
      signal,
    });
  } catch (e) {
    if (controller.signal.aborted) return; // client 已断开,静默收尾
    if (e?.name === 'TimeoutError' || e?.cause?.name === 'TimeoutError') {
      return sendJson(res, 504, { error: 'upstream timeout' });
    }
    return sendJson(res, 502, { error: 'upstream unreachable' });
  }

  // 状态码与 content-type 原样透传(4xx/5xx 一样走这里,body 原样吐回)
  const headers = { 'content-type': upstream.headers.get('content-type') || 'application/json' };
  if ((headers['content-type'] || '').includes('text/event-stream')) {
    headers['cache-control'] = 'no-cache';
    headers.connection = 'keep-alive';
  }
  res.writeHead(upstream.status, headers);

  if (!upstream.body) return res.end();
  try {
    // 流式与非流式统一按块透传:SSE 每个 data: 块到达即 res.write,即时可见
    for await (const chunk of upstream.body) {
      if (res.destroyed) { controller.abort(); return; }
      res.write(chunk);
    }
    res.end();
  } catch {
    // 上游中途断/超时/被 abort:能收尾就收尾
    try { res.end(); } catch { /* ignore */ }
  }
}

// —— 门禁:解析 lvd_session cookie 找会话;登录/登出/登录页豁免 ——
// 登录页导航返回内联 login.html;其余未登录一律 401(不下发 SPA 资源,防泄漏)。
const AUTH_EXEMPT = new Set(['/api/auth/login', '/api/auth/logout']);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;

    // 逃生舱:完全跳过鉴权
    if (AUTH_DISABLED) {
      if (path === '/api/deepseek/chat') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
        return await proxyDeepseek(req, res);
      }
      return await serveStatic(req, res, url);
    }

    // 解析会话
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies[SESSION_COOKIE_NAME] || '';
    const session = await auth.getSession(sid);
    const ctx = { sid, session };

    // 先处理 auth/admin 端点(登录/登出豁免;其余端点内部各自校验会话)
    if (path.startsWith('/api/auth/') || path.startsWith('/api/admin/')) {
      const handled = await handleAuthRoutes(auth, req, res, url, ctx);
      if (handled) return;
    }

    // 门禁判定
    if (!session && !AUTH_EXEMPT.has(path)) {
      const accept = String(req.headers.accept || '');
      if (accept.includes('text/html')) return sendLoginPage(res);   // 页面导航 → 登录页
      return sendJson(res, 401, { error: 'unauthorized' });          // 静态/API → 401,不下发资源
    }

    // 工程 + 版本存储(登录后)。无 DATABASE_URL → 503,前端 fallback 本地 IndexedDB。
    if (path.startsWith('/api/projects')) {
      if (!DB_ENABLED) return sendJson(res, 503, { error: 'storage not configured' });
      const handled = await handleProjectRoutes(req, res, url, ctx);
      if (handled) return;
    }

    if (path === '/api/deepseek/chat') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return await proxyDeepseek(req, res);   // 登录后才可用,防盗刷
    }

    return await serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(e));
    } else {
      try { res.end(); } catch { /* ignore */ }
    }
  }
}).listen(PORT, HOST, () =>
  console.log(`lvgl-designer(+ai proxy) serving ${ROOT} on http://${HOST}:${PORT} → ${UPSTREAM}${AUTH_DISABLED ? ' [auth OFF]' : ' [auth ON]'}`));

// —— 静态托管(逻辑与 serve.mjs 完全一致) ——
async function serveStatic(req, res, url) {
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
}
