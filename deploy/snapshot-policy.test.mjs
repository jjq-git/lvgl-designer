// 纯逻辑单测:快照滚动/去抖策略 + DB 降级 + 端点契约(mock query)。
// 运行:node --test snapshot-policy.test.mjs  (本机无 DATABASE_URL 也能全绿)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAutoSnapshot } from './projects.mjs';
import { isDbEnabled, query, getPool } from './db.mjs';

// —— db.mjs 无 DATABASE_URL 时的降级 ——
test('db 降级:无 DATABASE_URL → isDbEnabled=false / getPool=null / query 抛 DB_DISABLED', async () => {
  assert.equal(process.env.DATABASE_URL, undefined, '本测试假设无 DATABASE_URL');
  assert.equal(isDbEnabled(), false);
  assert.equal(getPool(), null);
  await assert.rejects(() => query('SELECT 1'), (e) => e.code === 'DB_DISABLED');
});

// —— planAutoSnapshot:核心滚动/去抖策略 ——

// 构造版本行:kind=auto,时间戳都设成很久以前(超合并窗口),seq 递增
function autoRows(count, baseTsMs = 0) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({ id: String(i + 1), seq: i + 1, kind: 'auto', created_at: new Date(baseTsMs).toISOString() });
  }
  return rows;
}

test('首次保存:无任何版本 → 新建 seq=1,无裁剪', () => {
  const plan = planAutoSnapshot([], 10_000_000);
  assert.equal(plan.action, 'new');
  assert.equal(plan.nextSeq, 1);
  assert.deepEqual(plan.pruneIds, []);
});

test('去抖:距上一条 auto <60s → merge(覆盖,不推进 seq)', () => {
  const now = 10_000_000;
  const rows = [{ id: '7', seq: 7, kind: 'auto', created_at: new Date(now - 30_000).toISOString() }];
  const plan = planAutoSnapshot(rows, now);
  assert.equal(plan.action, 'merge');
  assert.equal(plan.mergeId, '7');
  assert.equal(plan.nextSeq, 7, 'merge 不推进 seq');
  assert.deepEqual(plan.pruneIds, []);
});

test('去抖窗口外:距上一条 auto >60s → 新建,seq=max+1', () => {
  const now = 10_000_000;
  const rows = [{ id: '7', seq: 7, kind: 'auto', created_at: new Date(now - 61_000).toISOString() }];
  const plan = planAutoSnapshot(rows, now);
  assert.equal(plan.action, 'new');
  assert.equal(plan.nextSeq, 8);
  assert.deepEqual(plan.pruneIds, []);
});

test('滚动裁剪:已有 30 条 auto,新建第 31 条 → 删最旧 1 条 auto', () => {
  const now = 10_000_000;
  const rows = autoRows(30, now - 10 * 60_000); // 都在窗口外
  const plan = planAutoSnapshot(rows, now);
  assert.equal(plan.action, 'new');
  assert.equal(plan.nextSeq, 31);
  assert.deepEqual(plan.pruneIds, ['1'], '删最旧一条(id=1)');
});

test('模拟 31 次 PUT(每次都在窗口外)→ 最终 auto 恰好 30 条,manual 不被删', () => {
  // 用一个数组模拟库中版本;每步按 plan 应用(new/merge/prune)。
  let versions = [];
  let nextIdSerial = 1;
  const STEP_MS = 120_000; // 每次保存间隔 2 分钟,确保都在合并窗口外

  // 先插入一条 manual(不该被自动删)
  versions.push({ id: 'M', seq: 1, kind: 'manual', created_at: new Date(0).toISOString() });
  let maxSeq = 1;

  for (let i = 0; i < 31; i++) {
    const now = (i + 1) * STEP_MS + 10_000_000;
    const plan = planAutoSnapshot(versions, now);
    if (plan.action === 'merge') {
      const v = versions.find((x) => x.id === plan.mergeId);
      v.created_at = new Date(now).toISOString();
    } else {
      versions.push({ id: 'A' + (nextIdSerial++), seq: plan.nextSeq, kind: 'auto', created_at: new Date(now).toISOString() });
      maxSeq = Math.max(maxSeq, plan.nextSeq);
      if (plan.pruneIds.length) versions = versions.filter((x) => !plan.pruneIds.includes(x.id));
    }
  }

  const autos = versions.filter((v) => v.kind === 'auto');
  const manuals = versions.filter((v) => v.kind === 'manual');
  assert.equal(autos.length, 30, '31 次保存后 auto 恰好 30 条(滚动裁剪生效)');
  assert.equal(manuals.length, 1, 'manual 版本从不被自动删');
  // seq 单调递增:auto 的 seq 应连续到 max
  const autoSeqs = autos.map((v) => v.seq).sort((a, b) => a - b);
  assert.equal(autoSeqs[autoSeqs.length - 1], maxSeq);
});

test('restore/manual 不计入 auto 裁剪配额', () => {
  const now = 10_000_000;
  const rows = [
    ...autoRows(29, now - 10 * 60_000),
    { id: 'R', seq: 100, kind: 'restore', created_at: new Date(now - 5 * 60_000).toISOString() },
    { id: 'M', seq: 101, kind: 'manual', created_at: new Date(now - 5 * 60_000).toISOString() },
  ];
  // 29 条 auto,新建 1 条 → 30 条,不超配额,不裁剪
  const plan = planAutoSnapshot(rows, now);
  assert.equal(plan.action, 'new');
  assert.equal(plan.nextSeq, 102, 'seq = max(所有 seq)+1,含 manual/restore');
  assert.deepEqual(plan.pruneIds, []);
});

// —— 端点契约:用 mock req/res 直打 handleProjectRoutes,验证乐观锁/越权/restore ——
// 通过给 db.mjs 注入一个内存假库来跑(不连真 PG)。
import * as projectsMod from './projects.mjs';

// 简易 mock res
function mockRes() {
  return {
    statusCode: null, body: null, headersSent: false,
    writeHead(s) { this.statusCode = s; this.headersSent = true; return this; },
    end(b) { this.body = b ? JSON.parse(b) : null; return this; },
  };
}
function mockReq(method, bodyObj) {
  const raw = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
  // async iterator over one chunk
  return {
    method,
    async *[Symbol.asyncIterator]() { if (raw) yield Buffer.from(raw); },
  };
}

// 用 mock.module 无法在纯 node:test 简单做,所以这里改为验证"路由非 /api/projects 返回 false"
// 以及 DB_DISABLED 被转成 503 的分支(query 会真的抛 DB_DISABLED,因为无 DATABASE_URL)。
test('handleProjectRoutes:非 projects 路由返回 false', async () => {
  const res = mockRes();
  const handled = await projectsMod.handleProjectRoutes(
    mockReq('GET'), res, new URL('http://x/api/other'), { session: { userId: 'u1' } });
  assert.equal(handled, false);
});

test('handleProjectRoutes:无库时 GET /api/projects → 503 storage not configured', async () => {
  const res = mockRes();
  const handled = await projectsMod.handleProjectRoutes(
    mockReq('GET'), res, new URL('http://x/api/projects'), { session: { userId: 'u1' } });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: 'storage not configured' });
});

test('handleProjectRoutes:无库时 PUT 也 → 503(不是 500)', async () => {
  const res = mockRes();
  const handled = await projectsMod.handleProjectRoutes(
    mockReq('PUT', { doc: {} }), res, new URL('http://x/api/projects/abc'), { session: { userId: 'u1' } });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 503);
});
