// 端点逻辑单测:用 mock 的 db.mjs(内存假库)驱动 projects.mjs 的真实 handler,
// 验证乐观锁冲突、owner 越权拦截、restore 产生备份快照、快照滚动。
// 需要模块 mock:运行 `node --experimental-test-module-mocks --test handlers-logic.test.mjs`
// (test-all.mjs 会带上这个 flag;单跑 snapshot-policy.test.mjs 不需要。)
import { test, mock, before } from 'node:test';
import assert from 'node:assert/strict';

// —— 内存假库:只实现 projects.mjs 用到的那几条 SQL 的语义 ——
// 数据模型
const DB = {
  projects: new Map(),        // id -> {id, owner_id, name, doc, version, updated_at}
  versions: [],               // {id(bigserial), project_id, seq, kind, note, doc, created_at}
  _verId: 1,
};
function resetDb() { DB.projects.clear(); DB.versions.length = 0; DB._verId = 1; }

// 极简 SQL 路由:匹配我们代码里出现的语句片段
function runSql(sql, params) {
  const s = sql.replace(/\s+/g, ' ').trim();

  // SELECT list of my projects
  if (s.startsWith('SELECT id, name, version, updated_at FROM projects WHERE owner_id')) {
    const [owner] = params;
    const rows = [...DB.projects.values()].filter((p) => p.owner_id === owner)
      .sort((a, b) => b.updated_at - a.updated_at)
      .map((p) => ({ id: p.id, name: p.name, version: p.version, updated_at: p.updated_at }));
    return { rows, rowCount: rows.length };
  }
  // INSERT project
  if (s.startsWith('INSERT INTO projects')) {
    const [id, owner, name, doc] = params;
    DB.projects.set(id, { id, owner_id: owner, name, doc: JSON.parse(doc), version: 1, updated_at: Date.now() });
    return { rows: [], rowCount: 1 };
  }
  // SELECT full project (get)
  if (s.startsWith('SELECT id, owner_id, name, doc, version, updated_at FROM projects WHERE id')) {
    const p = DB.projects.get(params[0]);
    return { rows: p ? [{ ...p }] : [], rowCount: p ? 1 : 0 };
  }
  // SELECT owner_id, version FOR UPDATE (PUT)
  if (s.startsWith('SELECT owner_id, version FROM projects WHERE id')) {
    const p = DB.projects.get(params[0]);
    return { rows: p ? [{ owner_id: p.owner_id, version: p.version }] : [], rowCount: p ? 1 : 0 };
  }
  // SELECT owner_id, doc FOR UPDATE (mark manual)
  if (s.startsWith('SELECT owner_id, doc FROM projects WHERE id')) {
    const p = DB.projects.get(params[0]);
    return { rows: p ? [{ owner_id: p.owner_id, doc: p.doc }] : [], rowCount: p ? 1 : 0 };
  }
  // SELECT owner_id, doc, version FOR UPDATE (restore)
  if (s.startsWith('SELECT owner_id, doc, version FROM projects WHERE id')) {
    const p = DB.projects.get(params[0]);
    return { rows: p ? [{ owner_id: p.owner_id, doc: p.doc, version: p.version }] : [], rowCount: p ? 1 : 0 };
  }
  // SELECT version rows for snapshot plan
  if (s.startsWith('SELECT id, seq, kind, created_at FROM project_versions WHERE project_id')) {
    const rows = DB.versions.filter((v) => v.project_id === params[0])
      .map((v) => ({ id: String(v.id), seq: v.seq, kind: v.kind, created_at: v.created_at }));
    return { rows, rowCount: rows.length };
  }
  // MAX(seq)
  if (s.includes('MAX(seq)') || s.includes('COALESCE(MAX(seq)')) {
    const pid = params[0];
    const m = DB.versions.filter((v) => v.project_id === pid).reduce((mx, v) => Math.max(mx, v.seq), 0);
    return { rows: [{ m }], rowCount: 1 };
  }
  // INSERT version
  if (s.startsWith('INSERT INTO project_versions')) {
    // params order: (project_id, seq, [note?], doc) — infer by count
    // our inserts: auto: (pid, seq, doc); manual: (pid, seq, note, doc); restore: (pid, seq, doc)
    let project_id, seq, kind, note, doc;
    if (s.includes("'auto'")) { [project_id, seq, doc] = params; kind = 'auto'; note = null; }
    else if (s.includes("'manual'")) { [project_id, seq, note, doc] = params; kind = 'manual'; }
    else if (s.includes("'restore'")) { [project_id, seq, doc] = params; kind = 'restore'; note = '回滚前自动备份'; }
    DB.versions.push({ id: DB._verId++, project_id, seq, kind, note, doc: JSON.parse(doc), created_at: new Date().toISOString() });
    return { rows: [], rowCount: 1 };
  }
  // UPDATE version doc (merge)
  if (s.startsWith('UPDATE project_versions SET doc')) {
    const [doc, id] = params;
    const v = DB.versions.find((x) => x.id === Number(id));
    if (v) { v.doc = JSON.parse(doc); v.created_at = new Date().toISOString(); }
    return { rows: [], rowCount: v ? 1 : 0 };
  }
  // DELETE versions by id ANY
  if (s.startsWith('DELETE FROM project_versions WHERE id = ANY')) {
    const ids = params[0].map(Number);
    const before = DB.versions.length;
    for (let i = DB.versions.length - 1; i >= 0; i--) if (ids.includes(DB.versions[i].id)) DB.versions.splice(i, 1);
    return { rows: [], rowCount: before - DB.versions.length };
  }
  // UPDATE projects doc+version (+name)
  if (s.startsWith('UPDATE projects SET doc')) {
    // params: [doc, version, id] or [doc, version, id, name]
    const [doc, version, id, name] = params;
    const p = DB.projects.get(id);
    if (p) { p.doc = JSON.parse(doc); p.version = version; p.updated_at = Date.now(); if (name) p.name = name; }
    return { rows: [], rowCount: p ? 1 : 0 };
  }
  // UPDATE projects rename
  if (s.startsWith('UPDATE projects SET name')) {
    const [name, id, owner] = params;
    const p = DB.projects.get(id);
    if (p && p.owner_id === owner) { p.name = name; p.updated_at = Date.now(); return { rows: [], rowCount: 1 }; }
    return { rows: [], rowCount: 0 };
  }
  // DELETE project
  if (s.startsWith('DELETE FROM projects WHERE id')) {
    const [id, owner] = params;
    const p = DB.projects.get(id);
    if (p && p.owner_id === owner) {
      DB.projects.delete(id);
      for (let i = DB.versions.length - 1; i >= 0; i--) if (DB.versions[i].project_id === id) DB.versions.splice(i, 1);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  // SELECT doc FROM project_versions WHERE project_id AND seq
  if (s.startsWith('SELECT doc FROM project_versions WHERE project_id')) {
    const [pid, seq] = params;
    const v = DB.versions.find((x) => x.project_id === pid && x.seq === seq);
    return { rows: v ? [{ doc: v.doc }] : [], rowCount: v ? 1 : 0 };
  }
  // SELECT seq,kind,note,created_at list
  if (s.startsWith('SELECT seq, kind, note, created_at FROM project_versions')) {
    const rows = DB.versions.filter((v) => v.project_id === params[0])
      .sort((a, b) => b.seq - a.seq)
      .map((v) => ({ seq: v.seq, kind: v.kind, note: v.note, created_at: v.created_at }));
    return { rows, rowCount: rows.length };
  }
  // SELECT kind for delete manual
  if (s.startsWith('SELECT kind FROM project_versions')) {
    const [pid, seq] = params;
    const v = DB.versions.find((x) => x.project_id === pid && x.seq === seq);
    return { rows: v ? [{ kind: v.kind }] : [], rowCount: v ? 1 : 0 };
  }
  // DELETE one version by project_id+seq
  if (s.startsWith('DELETE FROM project_versions WHERE project_id = $1 AND seq')) {
    const [pid, seq] = params;
    const before = DB.versions.length;
    for (let i = DB.versions.length - 1; i >= 0; i--) if (DB.versions[i].project_id === pid && DB.versions[i].seq === seq) DB.versions.splice(i, 1);
    return { rows: [], rowCount: before - DB.versions.length };
  }
  throw new Error('mock db: unhandled SQL: ' + s);
}

const fakeDb = {
  isDbEnabled: () => true,
  getPool: () => ({}),
  async query(sql, params) { return runSql(sql, params); },
  async tx(fn) {
    // 单线程内存,无需真事务;直接给一个 client.query
    return fn({ query: (sql, params) => Promise.resolve(runSql(sql, params)) });
  },
  async ping() { return true; },
  async closePool() {},
};

let handleProjectRoutes;
before(async () => {
  mock.module('./db.mjs', { exports: fakeDb });
  ({ handleProjectRoutes } = await import('./projects.mjs?fakedb'));
});

// —— mock req/res ——
function mockRes() {
  return {
    statusCode: null, body: null, headersSent: false,
    writeHead(s) { this.statusCode = s; this.headersSent = true; return this; },
    end(b) { this.body = b ? JSON.parse(b) : null; return this; },
  };
}
function mockReq(method, bodyObj) {
  const raw = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
  return { method, async *[Symbol.asyncIterator]() { if (raw) yield Buffer.from(raw); } };
}
async function call(method, path, body, session) {
  const res = mockRes();
  const handled = await handleProjectRoutes(mockReq(method, body), res, new URL('http://x' + path), { session });
  return { handled, status: res.statusCode, body: res.body };
}

const ALICE = { userId: 'alice' };
const BOB = { userId: 'bob' };

test('创建 → 列表 → 读取(owner 可见)', async () => {
  resetDb();
  const c = await call('POST', '/api/projects', { name: 'P1', doc: { a: 1 } }, ALICE);
  assert.equal(c.status, 201);
  assert.equal(c.body.version, 1);
  const id = c.body.id;

  const list = await call('GET', '/api/projects', undefined, ALICE);
  assert.equal(list.status, 200);
  assert.equal(list.body.projects.length, 1);
  assert.equal(list.body.projects[0].id, id);

  const g = await call('GET', '/api/projects/' + id, undefined, ALICE);
  assert.equal(g.status, 200);
  assert.deepEqual(g.body.doc, { a: 1 });
});

test('owner 越权:Bob 读/改/删 Alice 的工程 → 404(不泄露存在性)', async () => {
  resetDb();
  const c = await call('POST', '/api/projects', { name: 'P', doc: { x: 1 } }, ALICE);
  const id = c.body.id;

  assert.equal((await call('GET', '/api/projects/' + id, undefined, BOB)).status, 404);
  assert.equal((await call('PUT', '/api/projects/' + id, { doc: { x: 2 } }, BOB)).status, 404);
  assert.equal((await call('DELETE', '/api/projects/' + id, undefined, BOB)).status, 404);
  assert.equal((await call('GET', '/api/projects/' + id + '/versions', undefined, BOB)).status, 404);
  // Bob 的列表看不到 Alice 的工程
  assert.equal((await call('GET', '/api/projects', undefined, BOB)).body.projects.length, 0);
});

test('乐观锁:baseVersion 不符 → 409 {error, current}', async () => {
  resetDb();
  const c = await call('POST', '/api/projects', { name: 'P', doc: { v: 0 } }, ALICE);
  const id = c.body.id; // version=1

  // 用对的 baseVersion=1 保存 → version 2
  const ok = await call('PUT', '/api/projects/' + id, { doc: { v: 1 }, baseVersion: 1 }, ALICE);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.version, 2);

  // 再用陈旧 baseVersion=1 → 409,current=2
  const conflict = await call('PUT', '/api/projects/' + id, { doc: { v: 2 }, baseVersion: 1 }, ALICE);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, 'version conflict');
  assert.equal(conflict.body.current, 2);

  // 不传 baseVersion → 跳过乐观锁,正常保存 → version 3
  const noBase = await call('PUT', '/api/projects/' + id, { doc: { v: 3 } }, ALICE);
  assert.equal(noBase.status, 200);
  assert.equal(noBase.body.version, 3);
});

test('restore:回滚前自动备份 kind=restore,并推进 version', async () => {
  resetDb();
  const c = await call('POST', '/api/projects', { name: 'P', doc: { step: 'v1' } }, ALICE);
  const id = c.body.id;

  // 手动标一个版本(记录 doc=step v1)→ seq=1
  const mk = await call('POST', '/api/projects/' + id + '/versions', { note: 'good' }, ALICE);
  assert.equal(mk.status, 201);
  const goodSeq = mk.body.seq;

  // 改到 v2(auto 快照)
  await call('PUT', '/api/projects/' + id, { doc: { step: 'v2' } }, ALICE);
  const beforeVer = (await call('GET', '/api/projects/' + id, undefined, ALICE)).body.version;

  // 回滚到 goodSeq(v1)
  const r = await call('POST', '/api/projects/' + id + '/restore/' + goodSeq, undefined, ALICE);
  assert.equal(r.status, 200);
  assert.equal(r.body.version, beforeVer + 1, 'restore 推进 version');

  // 当前 doc 已是 v1
  const now = await call('GET', '/api/projects/' + id, undefined, ALICE);
  assert.deepEqual(now.body.doc, { step: 'v1' });

  // 版本列表里应出现一条 kind=restore 的"回滚前自动备份"(备份的是回滚前的 v2)
  const vers = (await call('GET', '/api/projects/' + id + '/versions', undefined, ALICE)).body.versions;
  const restoreRow = vers.find((v) => v.kind === 'restore');
  assert.ok(restoreRow, '存在 restore 备份快照');
  assert.equal(restoreRow.note, '回滚前自动备份');
});

test('删除工程级联删版本;rename 生效', async () => {
  resetDb();
  const c = await call('POST', '/api/projects', { name: 'P', doc: {} }, ALICE);
  const id = c.body.id;
  await call('POST', '/api/projects/' + id + '/versions', { note: 'm' }, ALICE);

  const rn = await call('POST', '/api/projects/' + id + '/rename', { name: 'P-renamed' }, ALICE);
  assert.equal(rn.status, 200);
  assert.equal((await call('GET', '/api/projects/' + id, undefined, ALICE)).body.name, 'P-renamed');

  const del = await call('DELETE', '/api/projects/' + id, undefined, ALICE);
  assert.equal(del.status, 200);
  assert.equal((await call('GET', '/api/projects/' + id, undefined, ALICE)).status, 404);
  // 版本也没了(级联)
  assert.equal(DB.versions.filter((v) => v.project_id === id).length, 0);
});

test('删版本:manual 可删,auto/restore 不可删(400)', async () => {
  resetDb();
  const c = await call('POST', '/api/projects', { name: 'P', doc: { n: 0 } }, ALICE);
  const id = c.body.id;

  // 造一条 auto:PUT 一次
  await call('PUT', '/api/projects/' + id, { doc: { n: 1 } }, ALICE);
  const autoSeq = DB.versions.find((v) => v.kind === 'auto').seq;
  const delAuto = await call('DELETE', '/api/projects/' + id + '/versions/' + autoSeq, undefined, ALICE);
  assert.equal(delAuto.status, 400);

  // 造一条 manual 并删掉
  const mk = await call('POST', '/api/projects/' + id + '/versions', { note: 'm' }, ALICE);
  const delManual = await call('DELETE', '/api/projects/' + id + '/versions/' + mk.body.seq, undefined, ALICE);
  assert.equal(delManual.status, 200);
});
