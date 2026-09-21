// PostgreSQL 数据层:lazy 建 pool、query、事务、可用性探测。
// 无 DATABASE_URL 时全部优雅降级(getPool()→null,isDbEnabled()→false),
// 上层据此走文件回退或返回 503,进程绝不因缺库/连库失败而崩。
//
// pg 是 deploy 目录唯一运行时依赖(纯 JS,node-postgres)。
import pg from 'pg';

const { Pool } = pg;

let _pool = null;          // 已建的连接池(单例)
let _poolTried = false;    // 是否已尝试建池(避免反复 new)
let _enabled = null;       // isDbEnabled 缓存

function hasUrl() {
  return typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.trim() !== '';
}

// 是否启用数据库:仅看有无 DATABASE_URL(连不连得上是运行期的事,由 query catch 处理)。
export function isDbEnabled() {
  if (_enabled === null) _enabled = hasUrl();
  return _enabled;
}

// lazy 建 pg.Pool;无 DATABASE_URL 返回 null。建池本身不发起连接,失败极少;
// 万一构造抛错也 catch 掉,返回 null,让上层降级。
export function getPool() {
  if (!hasUrl()) return null;
  if (_pool) return _pool;
  if (_poolTried) return _pool; // 已试过且失败,别再刷日志
  _poolTried = true;
  try {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PGPOOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // 池级错误(如后端断连)不能让进程崩;记日志,pool 自行重连。
    _pool.on('error', (err) => {
      console.error('[db] pool error:', err?.message || err);
    });
  } catch (e) {
    console.error('[db] 建池失败,数据库功能降级:', e?.message || e);
    _pool = null;
  }
  return _pool;
}

// 单条查询。无池 → 抛 DB_DISABLED,让上层转 503;连接/SQL 错误原样抛给 caller 处理。
export async function query(sql, params) {
  const pool = getPool();
  if (!pool) {
    const err = new Error('database not configured');
    err.code = 'DB_DISABLED';
    throw err;
  }
  return pool.query(sql, params);
}

// 事务:拿一条连接,BEGIN → fn(client) → COMMIT;抛错则 ROLLBACK。
// fn 收到的 client 有 .query(sql,params)。
export async function tx(fn) {
  const pool = getPool();
  if (!pool) {
    const err = new Error('database not configured');
    err.code = 'DB_DISABLED';
    throw err;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

// 探活:能连上且 select 1 通过返回 true。启动时可用来决定是否 fallback,不抛。
export async function ping() {
  if (!isDbEnabled()) return false;
  try {
    await query('SELECT 1');
    return true;
  } catch (e) {
    console.error('[db] ping 失败,数据库暂不可用:', e?.message || e);
    return false;
  }
}

// 优雅关闭(测试/退出用)。
export async function closePool() {
  if (_pool) {
    const p = _pool;
    _pool = null;
    _poolTried = false;
    try { await p.end(); } catch { /* ignore */ }
  }
}
