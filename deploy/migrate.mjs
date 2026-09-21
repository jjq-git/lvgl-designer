// Schema 迁移:全部 IF NOT EXISTS,幂等可重复执行。启动时(有 DATABASE_URL)自动跑一次。
// 也可 `node migrate.mjs` 手动跑,或把下面 SCHEMA_SQL 拿去 psql 验证语法。
import { isDbEnabled, query } from './db.mjs';

// 一整块 DDL,靠 IF NOT EXISTS / OR REPLACE 保证幂等。索引单独 IF NOT EXISTS。
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id         text PRIMARY KEY,
  username   text UNIQUE NOT NULL,
  role       text NOT NULL,
  salt       text,
  hash       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id         text PRIMARY KEY,
  owner_id   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  doc        jsonb NOT NULL,
  version    int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_versions (
  id         bigserial PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq        int NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('auto','manual','restore')),
  note       text,
  doc        jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, seq)
);

-- 可选:会话表(默认仍用文件 sessions.json;若 LVD_SESSIONS_DB=1 则读写这里)
CREATE TABLE IF NOT EXISTS sessions (
  sid        text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username   text NOT NULL,
  role       text NOT NULL,
  expires    bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_owner_updated
  ON projects (owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pv_project_seq
  ON project_versions (project_id, seq DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_expires
  ON sessions (expires);
`;

// 跑迁移。无 DATABASE_URL 直接跳过(返回 false),不视作错误。
export async function migrate() {
  if (!isDbEnabled()) {
    console.log('[migrate] 未配置 DATABASE_URL,跳过迁移(文件回退模式)');
    return false;
  }
  try {
    await query(SCHEMA_SQL);
    console.log('[migrate] schema 已就绪(幂等)');
    return true;
  } catch (e) {
    console.error('[migrate] 迁移失败:', e?.message || e);
    // 不抛:让服务继续起来(相关 API 会在实际用到库时按 503/降级处理)
    return false;
  }
}

// 允许 `node migrate.mjs` 直接跑
if (import.meta.url === `file://${process.argv[1]}`) {
  const { closePool } = await import('./db.mjs');
  const ok = await migrate();
  await closePool();
  process.exit(ok ? 0 : 1);
}
