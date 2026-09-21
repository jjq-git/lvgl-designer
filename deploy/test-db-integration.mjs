// 真库集成测试:需要真实 DATABASE_URL(在服务器上跑)。
// 用法(服务器):
//   set -a; . /opt/lvgl-designer/env; set +a   # 载入 DATABASE_URL(别 echo 出来)
//   node /path/to/deploy/test-db-integration.mjs
// 或经 docker exec 在 postgres 容器所在网络里跑 node。
//
// 覆盖:migrate 幂等 → 建测试用户 → 工程 CRUD → PUT 快照滚动(31 次后 auto=30)→
//       乐观锁 409 → owner 越权 404 → restore 备份 → 删版本 → 清理测试数据。
// 全程用独立前缀的测试数据,结束 DELETE 掉,不污染真实库。
import assert from 'node:assert/strict';
import { migrate } from './migrate.mjs';
import { handleProjectRoutes } from './projects.mjs';
import { query, closePool, isDbEnabled } from './db.mjs';

if (!isDbEnabled()) {
  console.error('需要 DATABASE_URL 才能跑真库集成测试'); process.exit(2);
}

// —— 复用 handler,通过 mock req/res 直打 ——
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
  await handleProjectRoutes(mockReq(method, body), res, new URL('http://x' + path), { session });
  return { status: res.statusCode, body: res.body };
}

const TAG = '__itest_' + Date.now();
const uAlice = TAG + '_alice';
const uBob = TAG + '_bob';
let pass = 0;
function ok(name) { pass++; console.log('  ✔ ' + name); }

async function cleanup() {
  await query('DELETE FROM users WHERE id IN ($1,$2)', [uAlice, uBob]).catch(() => {});
}

try {
  console.log('[1] migrate 幂等');
  assert.equal(await migrate(), true);
  assert.equal(await migrate(), true); // 重跑无错
  ok('migrate 可重复执行');

  await cleanup();
  await query('INSERT INTO users (id, username, role) VALUES ($1,$2,$3),($4,$5,$6)',
    [uAlice, uAlice, 'normal', uBob, uBob, 'normal']);
  const ALICE = { userId: uAlice }; const BOB = { userId: uBob };

  console.log('[2] 工程 CRUD');
  const created = await call('POST', '/api/projects', { name: 'IT', doc: { k: 0 } }, ALICE);
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal((await call('GET', '/api/projects/' + id, undefined, ALICE)).body.doc.k, 0);
  ok('create/get');

  console.log('[3] owner 越权 → 404');
  assert.equal((await call('GET', '/api/projects/' + id, undefined, BOB)).status, 404);
  assert.equal((await call('PUT', '/api/projects/' + id, { doc: {} }, BOB)).status, 404);
  ok('越权拦截');

  console.log('[4] PUT 快照滚动(31 次,间隔>60s 用 SQL 回拨 created_at 模拟)');
  for (let i = 1; i <= 31; i++) {
    const r = await call('PUT', '/api/projects/' + id, { doc: { k: i } }, ALICE);
    assert.equal(r.status, 200, 'PUT #' + i);
    // 把刚写的 auto 版本 created_at 拨到很久以前,避免被下次 merge 掉
    await query(
      `UPDATE project_versions SET created_at = now() - interval '10 minutes'
       WHERE project_id = $1 AND kind = 'auto'`, [id]);
  }
  const autoCount = (await query(
    `SELECT count(*)::int AS c FROM project_versions WHERE project_id = $1 AND kind = 'auto'`, [id])).rows[0].c;
  assert.equal(autoCount, 30, `auto 应恰好 30,实得 ${autoCount}`);
  ok('31 次 PUT 后 auto=30(滚动裁剪)');

  console.log('[5] 乐观锁');
  const cur = (await call('GET', '/api/projects/' + id, undefined, ALICE)).body.version;
  const conflict = await call('PUT', '/api/projects/' + id, { doc: { k: 999 }, baseVersion: 1 }, ALICE);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.current, cur);
  ok('陈旧 baseVersion → 409 current');

  console.log('[6] manual 版本 + restore 备份');
  const mk = await call('POST', '/api/projects/' + id + '/versions', { note: 'milestone' }, ALICE);
  assert.equal(mk.status, 201);
  const beforeRestore = (await call('GET', '/api/projects/' + id, undefined, ALICE)).body.version;
  const r = await call('POST', '/api/projects/' + id + '/restore/' + mk.body.seq, undefined, ALICE);
  assert.equal(r.status, 200);
  assert.equal(r.body.version, beforeRestore + 1);
  const restoreCount = (await query(
    `SELECT count(*)::int AS c FROM project_versions WHERE project_id = $1 AND kind = 'restore'`, [id])).rows[0].c;
  assert.ok(restoreCount >= 1);
  ok('restore 产生 kind=restore 备份 + version+1');

  console.log('[7] 删 manual OK,删 auto → 400');
  const anyAuto = (await query(
    `SELECT seq FROM project_versions WHERE project_id = $1 AND kind = 'auto' LIMIT 1`, [id])).rows[0].seq;
  assert.equal((await call('DELETE', '/api/projects/' + id + '/versions/' + anyAuto, undefined, ALICE)).status, 400);
  assert.equal((await call('DELETE', '/api/projects/' + id + '/versions/' + mk.body.seq, undefined, ALICE)).status, 200);
  ok('删版本权限正确');

  console.log('[8] 删工程级联');
  assert.equal((await call('DELETE', '/api/projects/' + id, undefined, ALICE)).status, 200);
  const leftover = (await query(
    'SELECT count(*)::int AS c FROM project_versions WHERE project_id = $1', [id])).rows[0].c;
  assert.equal(leftover, 0, '级联删版本');
  ok('删工程级联删版本');

  console.log(`\n真库集成测试全部通过(${pass} 项)`);
} catch (e) {
  console.error('\n真库集成测试失败:', e?.message || e);
  process.exitCode = 1;
} finally {
  await cleanup();
  await closePool();
}
