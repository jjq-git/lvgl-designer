// 账号鉴权系统。两种后端二选一(按 isDbEnabled()):
//   - 无 DATABASE_URL:文件式(users.json / sessions.json,scrypt 哈希,chmod 0600)—— 原行为完全保留。
//   - 有 DATABASE_URL:用户落 PostgreSQL users 表;会话默认仍走文件(可设 LVD_SESSIONS_DB=1 落库)。
//
// 抽象:createAuth() 返回的所有 store 方法均为 async,内部按后端二选一。
// 首启若库里无用户但 users.json 有 → 一次性迁移导入,导入后 users.json 改名 .bak。
// 所有 /api/auth/* 与 /api/admin/* 端点契约(状态码/字段)与旧版完全一致,前端零改动。
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, chmodSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDbEnabled, query } from './db.mjs';

const SESSION_COOKIE = 'lvd_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 天
const SCRYPT_KEYLEN = 64;
const SESSIONS_IN_DB = process.env.LVD_SESSIONS_DB === '1';

// —— 文件路径 ——
export function resolvePaths(defaultDir) {
  const usersFile = process.env.LVD_USERS_FILE || join(defaultDir, 'users.json');
  const sessionsFile = join(dirname(usersFile), 'sessions.json');
  return { usersFile, sessionsFile };
}

// —— 写入 + 0600 ——
function writeJson(file, obj) {
  writeFileSync(file, JSON.stringify(obj, null, 2), { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* ignore */ }
}
function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback;
    const txt = readFileSync(file, 'utf8');
    if (!txt.trim()) return fallback;
    return JSON.parse(txt);
  } catch (e) {
    console.error(`[auth] 读取 ${file} 失败:`, e?.message || e);
    return fallback;
  }
}

// —— 密码哈希 ——
function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
}
function makeSalt() { return randomBytes(16).toString('hex'); }
function verifyPassword(password, saltHex, expectedHashHex) {
  let got;
  try { got = Buffer.from(hashPassword(password, saltHex), 'hex'); }
  catch { return false; }
  let want;
  try { want = Buffer.from(expectedHashHex, 'hex'); }
  catch { return false; }
  if (got.length !== want.length) return false;
  try { return timingSafeEqual(got, want); } catch { return false; }
}

// =====================================================================
//  Store 层:文件式 与 DB 式,统一 async 接口。
//  user 形状统一为 { id, username, role, salt, hash, createdAt }。
// =====================================================================

function makeFileStore(usersFile, sessionsFile) {
  function loadUsersRaw() {
    const data = readJson(usersFile, { users: [] });
    if (!data || !Array.isArray(data.users)) return { users: [] };
    return data;
  }
  function saveUsersRaw(data) {
    try { writeJson(usersFile, data); }
    catch (e) { console.error('[auth] 写 users.json 失败:', e?.message || e); }
  }
  function loadSessions() {
    const data = readJson(sessionsFile, {});
    if (!data || typeof data !== 'object') return {};
    const now = Date.now();
    let changed = false;
    for (const [sid, s] of Object.entries(data)) {
      if (!s || typeof s.expires !== 'number' || s.expires <= now) { delete data[sid]; changed = true; }
    }
    if (changed) saveSessions(data);
    return data;
  }
  function saveSessions(data) {
    try { writeJson(sessionsFile, data); }
    catch (e) { console.error('[auth] 写 sessions.json 失败:', e?.message || e); }
  }

  return {
    kind: 'file',
    async listUsers() { return loadUsersRaw().users; },
    async findUserById(id) { return loadUsersRaw().users.find((u) => u.id === id) || null; },
    async findUserByName(name) { return loadUsersRaw().users.find((u) => u.username === name) || null; },
    async createUser(user) {
      const data = loadUsersRaw();
      if (data.users.some((u) => u.username === user.username)) return { conflict: true };
      data.users.push(user);
      saveUsersRaw(data);
      return { user };
    },
    async updateUserPassword(id, salt, hash) {
      const data = loadUsersRaw();
      const u = data.users.find((x) => x.id === id);
      if (!u) return false;
      u.salt = salt; u.hash = hash;
      saveUsersRaw(data);
      return true;
    },
    async updateUserRole(id, role) {
      const data = loadUsersRaw();
      const u = data.users.find((x) => x.id === id);
      if (!u) return false;
      u.role = role;
      saveUsersRaw(data);
      return true;
    },
    async deleteUser(id) {
      const data = loadUsersRaw();
      const before = data.users.length;
      data.users = data.users.filter((u) => u.id !== id);
      if (data.users.length === before) return false;
      saveUsersRaw(data);
      return true;
    },
    // 会话(文件)
    async createSession(sid, s) { const d = loadSessions(); d[sid] = s; saveSessions(d); },
    async getSession(sid) {
      const d = loadSessions();
      const s = d[sid];
      if (!s) return null;
      if (typeof s.expires !== 'number' || s.expires <= Date.now()) { delete d[sid]; saveSessions(d); return null; }
      return s;
    },
    async destroySession(sid) { const d = loadSessions(); if (d[sid]) { delete d[sid]; saveSessions(d); } },
  };
}

// DB 行 → user 形状(createdAt 用 ISO 字符串,与文件式一致)
function rowToUser(r) {
  return {
    id: r.id, username: r.username, role: r.role,
    salt: r.salt, hash: r.hash,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

function makeDbStore(fileStore) {
  // 会话:默认沿用文件式(复用 fileStore 的三个方法);LVD_SESSIONS_DB=1 才落库。
  const sessionOps = SESSIONS_IN_DB ? {
    async createSession(sid, s) {
      await query(
        'INSERT INTO sessions (sid, user_id, username, role, expires) VALUES ($1,$2,$3,$4,$5) ' +
        'ON CONFLICT (sid) DO UPDATE SET expires = EXCLUDED.expires',
        [sid, s.userId, s.username, s.role, s.expires]
      );
    },
    async getSession(sid) {
      const { rows } = await query('SELECT user_id, username, role, expires FROM sessions WHERE sid = $1', [sid]);
      const r = rows[0];
      if (!r) return null;
      const expires = Number(r.expires);
      if (!Number.isFinite(expires) || expires <= Date.now()) {
        await query('DELETE FROM sessions WHERE sid = $1', [sid]).catch(() => {});
        return null;
      }
      return { userId: r.user_id, username: r.username, role: r.role, expires };
    },
    async destroySession(sid) { await query('DELETE FROM sessions WHERE sid = $1', [sid]).catch(() => {}); },
  } : {
    createSession: fileStore.createSession,
    getSession: fileStore.getSession,
    destroySession: fileStore.destroySession,
  };

  return {
    kind: 'db',
    async listUsers() {
      const { rows } = await query('SELECT id, username, role, salt, hash, created_at FROM users ORDER BY created_at ASC');
      return rows.map(rowToUser);
    },
    async findUserById(id) {
      const { rows } = await query('SELECT id, username, role, salt, hash, created_at FROM users WHERE id = $1', [id]);
      return rows[0] ? rowToUser(rows[0]) : null;
    },
    async findUserByName(name) {
      const { rows } = await query('SELECT id, username, role, salt, hash, created_at FROM users WHERE username = $1', [name]);
      return rows[0] ? rowToUser(rows[0]) : null;
    },
    async createUser(user) {
      try {
        await query(
          'INSERT INTO users (id, username, role, salt, hash) VALUES ($1,$2,$3,$4,$5)',
          [user.id, user.username, user.role, user.salt, user.hash]
        );
        return { user };
      } catch (e) {
        if (e?.code === '23505') return { conflict: true }; // unique_violation
        throw e;
      }
    },
    async updateUserPassword(id, salt, hash) {
      const { rowCount } = await query('UPDATE users SET salt = $1, hash = $2 WHERE id = $3', [salt, hash, id]);
      return rowCount > 0;
    },
    async updateUserRole(id, role) {
      const { rowCount } = await query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
      return rowCount > 0;
    },
    async deleteUser(id) {
      const { rowCount } = await query('DELETE FROM users WHERE id = $1', [id]);
      return rowCount > 0;
    },
    ...sessionOps,
  };
}

// —— Auth 实例 ——
export function createAuth(defaultDir) {
  const { usersFile, sessionsFile } = resolvePaths(defaultDir);
  const fileStore = makeFileStore(usersFile, sessionsFile);
  const useDb = isDbEnabled();
  const store = useDb ? makeDbStore(fileStore) : fileStore;

  // 首启迁移:库空但 users.json 有 → 导入,再把 users.json 改名 .bak(仅 DB 模式)。
  async function migrateUsersFromFileIfNeeded() {
    if (!useDb) return;
    let existing;
    try { existing = await store.listUsers(); }
    catch (e) { console.error('[auth] 读 users 表失败,跳过文件迁移:', e?.message || e); return; }
    if (existing.length > 0) return; // 库里已有用户,不迁移
    const fileData = readJson(usersFile, null);
    if (!fileData || !Array.isArray(fileData.users) || fileData.users.length === 0) return;
    let imported = 0;
    for (const u of fileData.users) {
      if (!u || !u.id || !u.username) continue;
      try {
        const r = await store.createUser({
          id: u.id, username: u.username, role: u.role || 'normal',
          salt: u.salt || null, hash: u.hash || null,
        });
        if (r.user) imported++;
      } catch (e) { console.error('[auth] 迁移用户失败', u.username, e?.message || e); }
    }
    if (imported > 0) {
      console.log(`[auth] 已从 users.json 迁移 ${imported} 个用户到数据库`);
      try { renameSync(usersFile, usersFile + '.bak'); console.log(`[auth] users.json 已改名为 ${usersFile}.bak`); }
      catch (e) { console.error('[auth] users.json 改名失败:', e?.message || e); }
    }
  }

  // Bootstrap:无任何用户时建管理员(落当前 store)。
  async function bootstrap() {
    await migrateUsersFromFileIfNeeded();
    let users;
    try { users = await store.listUsers(); }
    catch (e) { console.error('[auth] bootstrap 读用户失败:', e?.message || e); return; }
    if (users.length > 0) return;
    const username = (process.env.LVD_ADMIN_USER || 'admin').trim() || 'admin';
    let password = process.env.LVD_ADMIN_PASS;
    let generated = false;
    if (!password) { password = randomBytes(9).toString('base64url'); generated = true; }
    const salt = makeSalt();
    const user = {
      id: randomBytes(8).toString('hex'),
      username, role: 'admin', salt,
      hash: hashPassword(password, salt),
      createdAt: new Date().toISOString(),
    };
    await store.createUser(user);
    if (generated) {
      console.log(`===== 初始管理员 ${username} / ${password} ,请尽快登录后修改 =====`);
    } else {
      console.log(`===== 初始管理员 ${username} 已创建(密码取自 LVD_ADMIN_PASS),请尽快登录后修改 =====`);
    }
  }

  // 会话
  async function createSession(user) {
    const sid = randomBytes(32).toString('hex');
    const s = { userId: user.id, username: user.username, role: user.role, expires: Date.now() + SESSION_TTL_MS };
    await store.createSession(sid, s);
    return sid;
  }
  async function getSession(sid) {
    if (!sid) return null;
    try { return await store.getSession(sid); }
    catch (e) { console.error('[auth] getSession 失败:', e?.message || e); return null; }
  }
  async function destroySession(sid) {
    if (!sid) return;
    try { await store.destroySession(sid); }
    catch (e) { console.error('[auth] destroySession 失败:', e?.message || e); }
  }

  async function countAdmins() {
    const users = await store.listUsers();
    return users.filter((u) => u.role === 'admin').length;
  }

  return {
    usersFile, sessionsFile, storeKind: store.kind,
    bootstrap,
    store,
    createSession, getSession, destroySession,
    countAdmins,
  };
}

// —— cookie ——
export function parseCookies(header) {
  return Object.fromEntries((header || '').split(';').map((c) => {
    const i = c.indexOf('=');
    return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }).filter(([k]) => k));
}
export function sessionCookie(sid) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
export function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
export const SESSION_COOKIE_NAME = SESSION_COOKIE;

// —— JSON helpers ——
function json(res, status, obj, extraHeaders) {
  const headers = { 'content-type': 'application/json' };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  res.writeHead(status, headers);
  res.end(JSON.stringify(obj));
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { return null; }
}

// —— 端点处理(契约与旧版逐字一致;仅把 store 调用改为 await) ——
// 返回 true=已处理;false=非 auth 端点。
export async function handleAuthRoutes(auth, req, res, url, ctx) {
  const p = url.pathname;
  const method = req.method;
  const store = auth.store;

  // 登录
  if (p === '/api/auth/login' && method === 'POST') {
    const body = await readJsonBody(req);
    if (!body) return json(res, 400, { error: 'bad request' }), true;
    const { username, password } = body;
    const user = (typeof username === 'string') ? await store.findUserByName(username) : null;
    if (!user || !verifyPassword(password, user.salt, user.hash)) {
      return json(res, 401, { error: 'invalid credentials' }), true;
    }
    const sid = await auth.createSession(user);
    return json(res, 200, { username: user.username, role: user.role }, { 'set-cookie': sessionCookie(sid) }), true;
  }

  // 登出
  if (p === '/api/auth/logout' && method === 'POST') {
    if (ctx?.sid) await auth.destroySession(ctx.sid);
    return json(res, 200, { ok: true }, { 'set-cookie': clearCookie() }), true;
  }

  // me
  if (p === '/api/auth/me') {
    if (method !== 'GET') return json(res, 405, { error: 'method not allowed' }), true;
    if (!ctx?.session) return json(res, 401, { error: 'unauthorized' }), true;
    return json(res, 200, { username: ctx.session.username, role: ctx.session.role }), true;
  }

  // 改自己密码
  if (p === '/api/auth/password' && method === 'POST') {
    if (!ctx?.session) return json(res, 401, { error: 'unauthorized' }), true;
    const body = await readJsonBody(req);
    if (!body) return json(res, 400, { error: 'bad request' }), true;
    const { oldPassword, newPassword } = body;
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return json(res, 400, { error: 'password too short' }), true;
    }
    const user = await store.findUserById(ctx.session.userId);
    if (!user) return json(res, 401, { error: 'unauthorized' }), true;
    if (!verifyPassword(oldPassword, user.salt, user.hash)) {
      return json(res, 401, { error: 'invalid credentials' }), true;
    }
    const salt = makeSalt();
    await store.updateUserPassword(user.id, salt, hashPassword(newPassword, salt));
    return json(res, 200, { ok: true }), true;
  }

  // 管理员端点
  if (p.startsWith('/api/admin/')) {
    if (!ctx?.session) return json(res, 401, { error: 'unauthorized' }), true;
    if (ctx.session.role !== 'admin') return json(res, 403, { error: 'forbidden' }), true;

    if (p === '/api/admin/users' && method === 'GET') {
      const users = await store.listUsers();
      const out = users.map((u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt }));
      return json(res, 200, { users: out }), true;
    }

    if (p === '/api/admin/users' && method === 'POST') {
      const body = await readJsonBody(req);
      if (!body) return json(res, 400, { error: 'bad request' }), true;
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = body.password;
      const role = body.role;
      if (!username) return json(res, 400, { error: 'username required' }), true;
      if (typeof password !== 'string' || password.length < 6) return json(res, 400, { error: 'password too short' }), true;
      if (role !== 'admin' && role !== 'normal') return json(res, 400, { error: 'invalid role' }), true;
      const salt = makeSalt();
      const user = {
        id: randomBytes(8).toString('hex'),
        username, role, salt,
        hash: hashPassword(password, salt),
        createdAt: new Date().toISOString(),
      };
      const r = await store.createUser(user);
      if (r.conflict) return json(res, 409, { error: 'username taken' }), true;
      return json(res, 201, { id: user.id, username: user.username, role: user.role }), true;
    }

    const m = p.match(/^\/api\/admin\/users\/([^/]+)(?:\/(password|role))?$/);
    if (m) {
      const id = m[1];
      const sub = m[2];

      if (!sub && method === 'DELETE') {
        const target = await store.findUserById(id);
        if (!target) return json(res, 404, { error: 'not found' }), true;
        if (target.id === ctx.session.userId) return json(res, 400, { error: 'cannot delete self' }), true;
        if (target.role === 'admin' && (await auth.countAdmins()) <= 1) {
          return json(res, 400, { error: 'cannot delete last admin' }), true;
        }
        await store.deleteUser(id);
        return json(res, 200, { ok: true }), true;
      }

      if (sub === 'password' && method === 'POST') {
        const body = await readJsonBody(req);
        if (!body) return json(res, 400, { error: 'bad request' }), true;
        const { newPassword } = body;
        if (typeof newPassword !== 'string' || newPassword.length < 6) return json(res, 400, { error: 'password too short' }), true;
        const target = await store.findUserById(id);
        if (!target) return json(res, 404, { error: 'not found' }), true;
        const salt = makeSalt();
        await store.updateUserPassword(target.id, salt, hashPassword(newPassword, salt));
        return json(res, 200, { ok: true }), true;
      }

      if (sub === 'role' && method === 'POST') {
        const body = await readJsonBody(req);
        if (!body) return json(res, 400, { error: 'bad request' }), true;
        const { role } = body;
        if (role !== 'admin' && role !== 'normal') return json(res, 400, { error: 'invalid role' }), true;
        const target = await store.findUserById(id);
        if (!target) return json(res, 404, { error: 'not found' }), true;
        if (target.role === 'admin' && role === 'normal' && (await auth.countAdmins()) <= 1) {
          return json(res, 400, { error: 'cannot delete last admin' }), true;
        }
        await store.updateUserRole(target.id, role);
        return json(res, 200, { ok: true, id: target.id, role }), true;
      }

      return json(res, 405, { error: 'method not allowed' }), true;
    }

    return json(res, 404, { error: 'not found' }), true;
  }

  return false;
}
