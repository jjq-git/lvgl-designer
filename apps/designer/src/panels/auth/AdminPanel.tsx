/**
 * AdminPanel — 管理员用户管理(模态)。
 * ① 用户列表表格:用户名 / 角色 / 创建时间 / 操作
 * ② 每行操作:删除(二次确认,后端拒绝显示 error 如「不能删除最后一个管理员」)、
 *    重置密码(弹输入)、切换角色(admin↔normal)
 * ③ 顶部「新建用户」表单:用户名 / 密码 / 角色下拉
 * 所有写操作后刷新列表。空态 / 加载态 / 错误态齐备。
 *
 * 后端契约:
 *   GET    api/admin/users              → 200 {users:[{id,username,role,createdAt}]};403 非管理员
 *   POST   api/admin/users              → 201 {id,username,role};409 重复;400 {error}
 *   DELETE api/admin/users/:id          → 200;400 {error}
 *   POST   api/admin/users/:id/password → 200
 *   PATCH  api/admin/users/:id          → 200;400 {detail}
 */
import { useEffect, useState } from 'react';
import { apiUrl, useAuthStore, type UserRole } from '../../stores/authStore';
import { readError } from './ChangePassword';

interface AdminUser {
  id: string | number;
  username: string;
  role: UserRole;
  createdAt?: string;
  created_at?: string;
}

type ListState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; users: AdminUser[] };

const ROLE_LABEL: Record<UserRole, string> = { admin: '管理员', normal: '普通' };

export function AdminPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const me = useAuthStore((s) => s.me);
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  /** 顶部条:某行操作的错误/成功提示 */
  const [banner, setBanner] = useState<{ tone: 'ok' | 'fail'; text: string } | null>(null);
  /** 正在写操作的行 id(禁用该行按钮) */
  const [busyId, setBusyId] = useState<string | number | null>(null);

  const load = async (): Promise<void> => {
    setList({ kind: 'loading' });
    try {
      const res = await fetch(apiUrl('api/admin/users'), {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!res.ok) {
        setList({ kind: 'error', message: await readError(res) });
        return;
      }
      const data = (await res.json()) as { users?: (AdminUser & { role: UserRole | 'user' })[] };
      const users = Array.isArray(data.users)
        ? data.users.map((user) => ({
            ...user,
            role: user.role === 'admin' ? 'admin' as const : 'normal' as const,
            createdAt: user.createdAt ?? user.created_at,
          }))
        : [];
      setList({ kind: 'ready', users });
    } catch (e) {
      setList({ kind: 'error', message: (e as Error).message || '网络错误' });
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flash = (tone: 'ok' | 'fail', text: string): void => setBanner({ tone, text });

  /** 通用写操作:执行 → 成功刷新列表 + 提示 → 失败提示 error */
  const run = async (
    id: string | number,
    req: () => Promise<Response>,
    okText: string,
  ): Promise<boolean> => {
    setBusyId(id);
    setBanner(null);
    try {
      const res = await req();
      if (res.ok) {
        flash('ok', okText);
        await load();
        return true;
      }
      flash('fail', await readError(res));
      return false;
    } catch (e) {
      flash('fail', (e as Error).message || '网络错误');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = (u: AdminUser): void => {
    if (!window.confirm(`确认删除用户「${u.username}」?此操作不可撤销。`)) return;
    void run(
      u.id,
      () =>
        fetch(apiUrl(`api/admin/users/${encodeURIComponent(String(u.id))}`), {
          method: 'DELETE',
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
        }),
      `已删除「${u.username}」`,
    );
  };

  const onResetPassword = (u: AdminUser): void => {
    const pwd = window.prompt(`为「${u.username}」设置新密码:`);
    if (pwd == null) return; // 取消
    if (pwd.trim() === '') {
      flash('fail', '密码不能为空');
      return;
    }
    void run(
      u.id,
      () =>
        fetch(apiUrl(`api/admin/users/${encodeURIComponent(String(u.id))}/password`), {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ password: pwd }),
        }),
      `已重置「${u.username}」的密码`,
    );
  };

  const onToggleRole = (u: AdminUser): void => {
    const next: UserRole = u.role === 'admin' ? 'normal' : 'admin';
    void (async () => {
      const ok = await run(
        u.id,
        () =>
          fetch(apiUrl(`api/admin/users/${encodeURIComponent(String(u.id))}`), {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ role: next }),
          }),
        `已将「${u.username}」设为${ROLE_LABEL[next]}`,
      );
      // 改的是自己 → 同步本地角色(可能失去管理入口,靠 fetchMe 更稳但此处即时反馈)
      if (ok && me && u.username === me.username) {
        useAuthStore.getState().setMe({ ...me, role: next });
      }
    })();
  };

  const onCreated = (): void => {
    flash('ok', '用户已创建');
    void load();
  };

  return (
    <div className="auth-mask" onClick={onClose}>
      <div className="auth-modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-head">
          <span>用户管理</span>
          <button className="icon-btn" title="关闭" onClick={onClose}>✕</button>
        </div>
        <div className="auth-modal-body">
          {banner && (
            <div className={banner.tone === 'ok' ? 'auth-msg-ok' : 'auth-msg-fail'} style={{ marginBottom: 10 }}>
              {banner.tone === 'ok' ? '✓ ' : '✗ '}
              {banner.text}
            </div>
          )}

          <div className="auth-section-title">新建用户</div>
          <CreateUserForm onCreated={onCreated} onError={(m) => flash('fail', m)} />

          <div className="auth-section-title">用户列表</div>
          {list.kind === 'loading' && <div className="auth-state">加载中…</div>}
          {list.kind === 'error' && <div className="auth-state error">加载失败:{list.message}</div>}
          {list.kind === 'ready' && list.users.length === 0 && (
            <div className="auth-state">暂无用户</div>
          )}
          {list.kind === 'ready' && list.users.length > 0 && (
            <div className="auth-table-wrap">
              <table className="auth-table">
                <thead>
                  <tr>
                    <th>用户名</th>
                    <th>角色</th>
                    <th>创建时间</th>
                    <th className="col-actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {list.users.map((u) => {
                    const isSelf = me != null && u.username === me.username;
                    const rowBusy = busyId === u.id;
                    return (
                      <tr key={String(u.id)}>
                        <td>
                          <span className="auth-uname">{u.username}</span>
                          {isSelf && <span className="auth-you-tag">(你)</span>}
                        </td>
                        <td>
                          <span className={`role-badge ${u.role === 'admin' ? 'admin' : ''}`}>
                            {ROLE_LABEL[u.role]}
                          </span>
                        </td>
                        <td className="auth-time">{formatTime(u.createdAt)}</td>
                        <td className="col-actions">
                          <span className="auth-row-actions">
                            <button
                              className="btn btn-sm"
                              disabled={rowBusy}
                              onClick={() => onToggleRole(u)}
                              title={u.role === 'admin' ? '降为普通用户' : '升为管理员'}
                            >
                              {u.role === 'admin' ? '设为普通' : '设为管理员'}
                            </button>
                            <button
                              className="btn btn-sm"
                              disabled={rowBusy}
                              onClick={() => onResetPassword(u)}
                            >
                              重置密码
                            </button>
                            <button
                              className="btn btn-sm btn-danger"
                              disabled={rowBusy}
                              onClick={() => onDelete(u)}
                            >
                              删除
                            </button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateUserForm({
  onCreated,
  onError,
}: {
  onCreated: () => void;
  onError: (msg: string) => void;
}): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('normal');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (username.trim() === '' || password === '') {
      onError('请填写用户名和密码');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(apiUrl('api/admin/users'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username: username.trim(), password, role }),
      });
      if (res.status === 201 || res.ok) {
        setUsername('');
        setPassword('');
        setRole('normal');
        onCreated();
        return;
      }
      if (res.status === 409) {
        onError('用户名已存在');
        return;
      }
      onError(await readError(res));
    } catch (e) {
      onError((e as Error).message || '网络错误');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-create">
      <input
        className="ed-text"
        placeholder="用户名"
        autoComplete="off"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        className="ed-text"
        type="password"
        placeholder="密码"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
      />
      <select
        className="ed-select"
        value={role}
        onChange={(e) => setRole(e.target.value as UserRole)}
      >
        <option value="normal">普通</option>
        <option value="admin">管理员</option>
      </select>
      <button className="btn primary" disabled={busy} onClick={() => void submit()}>
        {busy ? '创建中…' : '新建用户'}
      </button>
    </div>
  );
}

/** ISO 时间 → 本地可读;解析失败原样返回;无则 "—" */
function formatTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
