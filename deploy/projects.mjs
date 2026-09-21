// 工程 + 版本历史 API。全部需登录(caller 已过门禁,ctx.session 必有)。
// owner 校验:普通用户与管理员默认都只操作自己的工程(阶段二再做"管理员看全部",见 TODO)。
// 越权/不存在一律 404(不泄露存在性),写冲突 409(乐观锁)。
//
// 存储走 db.mjs;无 DATABASE_URL 时本文件不应被挂上路由(server-ai.mjs 直接回 503)。
import { randomBytes } from 'node:crypto';
import { query, tx } from './db.mjs';

const AUTO_KEEP = 30;                 // 每工程 auto 版本最多保留条数
const AUTO_MERGE_WINDOW_MS = 60_000;  // 距上一条 auto <60s 则覆盖而非新建(去抖)

function newId() { return randomBytes(8).toString('hex'); }

// —— 纯逻辑:快照滚动/去抖决策。抽出来便于单测(mock 数据即可验证)。——
// 入参:现有该工程的版本行(至少含 {id, seq, kind, created_at})、当前时间戳。
// 出参:{ action: 'merge'|'new', mergeId?, nextSeq, pruneIds:[...] }
//   - merge:距最后一条 auto <窗口 → 覆盖它(mergeId 指向要更新的行)。
//   - new  :新建一条 auto,seq = max(seq)+1。
//   - pruneIds:新建后 auto 总数超 AUTO_KEEP,需删除的最旧 auto 版本 id(manual/restore 永不入列)。
export function planAutoSnapshot(versions, nowMs = Date.now(), keep = AUTO_KEEP, mergeWindowMs = AUTO_MERGE_WINDOW_MS) {
  const seqs = versions.map((v) => Number(v.seq)).filter((n) => Number.isFinite(n));
  const maxSeq = seqs.length ? Math.max(...seqs) : 0;
  const nextSeq = maxSeq + 1;

  const autos = versions
    .filter((v) => v.kind === 'auto')
    .sort((a, b) => Number(a.seq) - Number(b.seq));

  // 去抖:最新一条 auto 若在合并窗口内 → 覆盖它(不新建、不推进 seq)。
  const lastAuto = autos.length ? autos[autos.length - 1] : null;
  if (lastAuto) {
    const t = new Date(lastAuto.created_at).getTime();
    if (Number.isFinite(t) && nowMs - t < mergeWindowMs) {
      return { action: 'merge', mergeId: lastAuto.id, nextSeq: Number(lastAuto.seq), pruneIds: [] };
    }
  }

  // 新建:算上这条后 auto 数量 = autos.length + 1,超出 keep 则删最旧的若干条。
  const overflow = (autos.length + 1) - keep;
  const pruneIds = overflow > 0 ? autos.slice(0, overflow).map((v) => v.id) : [];
  return { action: 'new', nextSeq, pruneIds };
}

// —— HTTP helpers ——
function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { return null; }
}

// 取工程并校验 owner。返回 row 或 null(不存在或非本人 → 都当 null,由 caller 回 404)。
async function loadOwnedProject(id, userId) {
  const { rows } = await query(
    'SELECT id, owner_id, name, doc, version, updated_at FROM projects WHERE id = $1',
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.owner_id !== userId) return null; // 越权当作不存在,不泄露存在性
  return row;
}

// —— 主路由分发。返回 true=已处理;false=非 /api/projects 路由。——
// 约定:调用前 caller 已确保 ctx.session 存在(登录门禁)。
export async function handleProjectRoutes(req, res, url, ctx) {
  const p = url.pathname;
  if (!p.startsWith('/api/projects')) return false;

  const userId = ctx.session.userId;
  const method = req.method;

  try {
    // /api/projects  (list / create)
    if (p === '/api/projects') {
      if (method === 'GET') return await listProjects(res, userId), true;
      if (method === 'POST') return await createProject(req, res, userId), true;
      return json(res, 405, { error: 'method not allowed' }), true;
    }

    // /api/projects/:id/versions/:seq
    let m = p.match(/^\/api\/projects\/([^/]+)\/versions\/([^/]+)$/);
    if (m) {
      const [, id, seqStr] = m;
      const seq = Number(seqStr);
      if (!Number.isInteger(seq)) return json(res, 400, { error: 'bad seq' }), true;
      if (method === 'GET') return await getVersionDoc(res, id, userId, seq), true;
      if (method === 'DELETE') return await deleteManualVersion(res, id, userId, seq), true;
      return json(res, 405, { error: 'method not allowed' }), true;
    }

    // /api/projects/:id/versions  (list / mark manual)
    m = p.match(/^\/api\/projects\/([^/]+)\/versions$/);
    if (m) {
      const [, id] = m;
      if (method === 'GET') return await listVersions(res, id, userId), true;
      if (method === 'POST') return await markManualVersion(req, res, id, userId), true;
      return json(res, 405, { error: 'method not allowed' }), true;
    }

    // /api/projects/:id/restore/:seq
    m = p.match(/^\/api\/projects\/([^/]+)\/restore\/([^/]+)$/);
    if (m) {
      const [, id, seqStr] = m;
      const seq = Number(seqStr);
      if (!Number.isInteger(seq)) return json(res, 400, { error: 'bad seq' }), true;
      if (method === 'POST') return await restoreVersion(res, id, userId, seq), true;
      return json(res, 405, { error: 'method not allowed' }), true;
    }

    // /api/projects/:id/rename
    m = p.match(/^\/api\/projects\/([^/]+)\/rename$/);
    if (m) {
      const [, id] = m;
      if (method === 'POST') return await renameProject(req, res, id, userId), true;
      return json(res, 405, { error: 'method not allowed' }), true;
    }

    // /api/projects/:id  (get / update / delete)
    m = p.match(/^\/api\/projects\/([^/]+)$/);
    if (m) {
      const [, id] = m;
      if (method === 'GET') return await getProject(res, id, userId), true;
      if (method === 'PUT') return await updateProject(req, res, id, userId), true;
      if (method === 'DELETE') return await deleteProject(res, id, userId), true;
      return json(res, 405, { error: 'method not allowed' }), true;
    }

    return json(res, 404, { error: 'not found' }), true;
  } catch (e) {
    if (e?.code === 'DB_DISABLED') return json(res, 503, { error: 'storage not configured' }), true;
    console.error('[projects] 处理失败:', e?.message || e);
    if (!res.headersSent) json(res, 500, { error: 'internal error' });
    return true;
  }
}

// —— 工程 CRUD ——

async function listProjects(res, userId) {
  const { rows } = await query(
    'SELECT id, name, version, updated_at FROM projects WHERE owner_id = $1 ORDER BY updated_at DESC',
    [userId]
  );
  return json(res, 200, { projects: rows });
}

async function createProject(req, res, userId) {
  const body = await readJsonBody(req);
  if (!body) return json(res, 400, { error: 'bad request' });
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const doc = body.doc;
  if (!name) return json(res, 400, { error: 'name required' });
  if (doc === undefined || doc === null || typeof doc !== 'object') {
    return json(res, 400, { error: 'doc required' });
  }
  const id = newId();
  await query(
    'INSERT INTO projects (id, owner_id, name, doc, version) VALUES ($1, $2, $3, $4, 1)',
    [id, userId, name, JSON.stringify(doc)]
  );
  return json(res, 201, { id, name, version: 1 });
}

async function getProject(res, id, userId) {
  const row = await loadOwnedProject(id, userId);
  if (!row) return json(res, 404, { error: 'not found' });
  return json(res, 200, {
    id: row.id, name: row.name, doc: row.doc,
    version: row.version, updated_at: row.updated_at,
  });
}

// PUT 保存:乐观锁 + 追加/合并 auto 快照 + 滚动裁剪。全程一个事务。
async function updateProject(req, res, id, userId) {
  const body = await readJsonBody(req);
  if (!body) return json(res, 400, { error: 'bad request' });
  const doc = body.doc;
  if (doc === undefined || doc === null || typeof doc !== 'object') {
    return json(res, 400, { error: 'doc required' });
  }
  const newName = (typeof body.name === 'string' && body.name.trim()) ? body.name.trim() : null;
  const baseVersion = (body.baseVersion === undefined || body.baseVersion === null)
    ? null : Number(body.baseVersion);
  const docJson = JSON.stringify(doc);

  const result = await tx(async (c) => {
    // 锁住工程行,防并发保存竞态
    const { rows } = await c.query(
      'SELECT owner_id, version FROM projects WHERE id = $1 FOR UPDATE',
      [id]
    );
    const cur = rows[0];
    if (!cur || cur.owner_id !== userId) return { code: 404 };

    // 乐观锁:baseVersion 不为空且与库中 version 不符 → 冲突
    if (baseVersion !== null && Number.isFinite(baseVersion) && baseVersion !== cur.version) {
      return { code: 409, current: cur.version };
    }

    // 决策快照(读现有版本行做去抖/滚动)
    const { rows: verRows } = await c.query(
      'SELECT id, seq, kind, created_at FROM project_versions WHERE project_id = $1',
      [id]
    );
    const plan = planAutoSnapshot(verRows, Date.now());

    if (plan.action === 'merge') {
      // 覆盖最后一条 auto:更新其 doc 与时间戳(seq 不变)
      await c.query(
        'UPDATE project_versions SET doc = $1, created_at = now() WHERE id = $2',
        [docJson, plan.mergeId]
      );
    } else {
      await c.query(
        `INSERT INTO project_versions (project_id, seq, kind, note, doc)
         VALUES ($1, $2, 'auto', NULL, $3)`,
        [id, plan.nextSeq, docJson]
      );
      if (plan.pruneIds.length) {
        await c.query('DELETE FROM project_versions WHERE id = ANY($1::bigint[])', [plan.pruneIds]);
      }
    }

    // 推进工程当前 doc + version
    const nextVersion = cur.version + 1;
    await c.query(
      'UPDATE projects SET doc = $1, version = $2, updated_at = now()' +
      (newName ? ', name = $4' : '') + ' WHERE id = $3',
      newName ? [docJson, nextVersion, id, newName] : [docJson, nextVersion, id]
    );
    return { code: 200, version: nextVersion };
  });

  if (result.code === 404) return json(res, 404, { error: 'not found' });
  if (result.code === 409) return json(res, 409, { error: 'version conflict', current: result.current });
  return json(res, 200, { version: result.version });
}

async function deleteProject(res, id, userId) {
  // owner 校验 + 删除一步到位:DELETE ... WHERE owner_id 命中 0 行 → 404
  const { rowCount } = await query(
    'DELETE FROM projects WHERE id = $1 AND owner_id = $2',
    [id, userId]
  );
  if (!rowCount) return json(res, 404, { error: 'not found' });
  return json(res, 200, { ok: true }); // 级联删 project_versions(FK ON DELETE CASCADE)
}

async function renameProject(req, res, id, userId) {
  const body = await readJsonBody(req);
  if (!body) return json(res, 400, { error: 'bad request' });
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return json(res, 400, { error: 'name required' });
  const { rowCount } = await query(
    'UPDATE projects SET name = $1, updated_at = now() WHERE id = $2 AND owner_id = $3',
    [name, id, userId]
  );
  if (!rowCount) return json(res, 404, { error: 'not found' });
  return json(res, 200, { ok: true });
}

// —— 版本历史 ——

async function listVersions(res, id, userId) {
  const owned = await loadOwnedProject(id, userId);
  if (!owned) return json(res, 404, { error: 'not found' });
  const { rows } = await query(
    'SELECT seq, kind, note, created_at FROM project_versions WHERE project_id = $1 ORDER BY seq DESC',
    [id]
  );
  return json(res, 200, { versions: rows });
}

async function getVersionDoc(res, id, userId, seq) {
  const owned = await loadOwnedProject(id, userId);
  if (!owned) return json(res, 404, { error: 'not found' });
  const { rows } = await query(
    'SELECT doc FROM project_versions WHERE project_id = $1 AND seq = $2',
    [id, seq]
  );
  if (!rows[0]) return json(res, 404, { error: 'not found' });
  return json(res, 200, { doc: rows[0].doc });
}

// 手动标当前 doc 为一个 manual 版本
async function markManualVersion(req, res, id, userId) {
  const body = await readJsonBody(req);
  if (body === null) return json(res, 400, { error: 'bad request' });
  const note = typeof body.note === 'string' ? body.note : null;

  const result = await tx(async (c) => {
    const { rows } = await c.query(
      'SELECT owner_id, doc FROM projects WHERE id = $1 FOR UPDATE',
      [id]
    );
    const cur = rows[0];
    if (!cur || cur.owner_id !== userId) return { code: 404 };
    const { rows: mx } = await c.query(
      'SELECT COALESCE(MAX(seq), 0) AS m FROM project_versions WHERE project_id = $1',
      [id]
    );
    const nextSeq = Number(mx[0].m) + 1;
    await c.query(
      `INSERT INTO project_versions (project_id, seq, kind, note, doc)
       VALUES ($1, $2, 'manual', $3, $4)`,
      [id, nextSeq, note, JSON.stringify(cur.doc)]
    );
    return { code: 201, seq: nextSeq };
  });

  if (result.code === 404) return json(res, 404, { error: 'not found' });
  return json(res, 201, { seq: result.seq });
}

// 回滚到某 seq:先把当前 doc 存一条 kind=restore 备份,再把目标 doc 设为当前、version+1。
async function restoreVersion(res, id, userId, seq) {
  const result = await tx(async (c) => {
    const { rows } = await c.query(
      'SELECT owner_id, doc, version FROM projects WHERE id = $1 FOR UPDATE',
      [id]
    );
    const cur = rows[0];
    if (!cur || cur.owner_id !== userId) return { code: 404 };

    const { rows: tgt } = await c.query(
      'SELECT doc FROM project_versions WHERE project_id = $1 AND seq = $2',
      [id, seq]
    );
    if (!tgt[0]) return { code: 404 };

    const { rows: mx } = await c.query(
      'SELECT COALESCE(MAX(seq), 0) AS m FROM project_versions WHERE project_id = $1',
      [id]
    );
    const backupSeq = Number(mx[0].m) + 1;

    // 1) 回滚前自动备份当前 doc(kind=restore)
    await c.query(
      `INSERT INTO project_versions (project_id, seq, kind, note, doc)
       VALUES ($1, $2, 'restore', '回滚前自动备份', $3)`,
      [id, backupSeq, JSON.stringify(cur.doc)]
    );

    // 2) 把目标 doc 设为当前,version+1
    const nextVersion = cur.version + 1;
    await c.query(
      'UPDATE projects SET doc = $1, version = $2, updated_at = now() WHERE id = $3',
      [JSON.stringify(tgt[0].doc), nextVersion, id]
    );
    return { code: 200, version: nextVersion };
  });

  if (result.code === 404) return json(res, 404, { error: 'not found' });
  return json(res, 200, { version: result.version });
}

// 删手动版本:仅限 kind=manual(auto/restore 由滚动策略/回滚流程管)。
async function deleteManualVersion(res, id, userId, seq) {
  const owned = await loadOwnedProject(id, userId);
  if (!owned) return json(res, 404, { error: 'not found' });
  const { rows } = await query(
    'SELECT kind FROM project_versions WHERE project_id = $1 AND seq = $2',
    [id, seq]
  );
  if (!rows[0]) return json(res, 404, { error: 'not found' });
  if (rows[0].kind !== 'manual') return json(res, 400, { error: 'only manual versions can be deleted' });
  await query('DELETE FROM project_versions WHERE project_id = $1 AND seq = $2', [id, seq]);
  return json(res, 200, { ok: true });
}
