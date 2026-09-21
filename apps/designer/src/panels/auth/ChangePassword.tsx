/**
 * ChangePassword — 修改自己密码的模态。
 * 旧密码 / 新密码 / 确认新密码 → POST api/auth/password {oldPassword,newPassword}。
 * 成功提示;失败显示后端 {error}(400/401)。
 */
import { useState } from 'react';
import { apiUrl } from '../../stores/authStore';

type Submit =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok' }
  | { kind: 'fail'; message: string };

export function ChangePassword({ onClose }: { onClose: () => void }): JSX.Element {
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState<Submit>({ kind: 'idle' });

  const localError = (): string | null => {
    if (oldPassword === '' || newPassword === '') return '请填写旧密码和新密码';
    if (newPassword !== confirm) return '两次输入的新密码不一致';
    return null;
  };

  const submit = async (): Promise<void> => {
    const le = localError();
    if (le) {
      setState({ kind: 'fail', message: le });
      return;
    }
    setState({ kind: 'busy' });
    try {
      const res = await fetch(apiUrl('api/auth/password'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      if (res.ok) {
        setState({ kind: 'ok' });
        setOld('');
        setNew('');
        setConfirm('');
        return;
      }
      const msg = await readError(res);
      setState({ kind: 'fail', message: msg });
    } catch (e) {
      setState({ kind: 'fail', message: (e as Error).message || '网络错误' });
    }
  };

  const busy = state.kind === 'busy';

  return (
    <div className="auth-mask" onClick={onClose}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-head">
          <span>修改密码</span>
          <button className="icon-btn" title="关闭" onClick={onClose}>✕</button>
        </div>
        <div className="auth-modal-body">
          <div className="auth-form-row">
            <label>旧密码</label>
            <input
              className="ed-text"
              type="password"
              autoComplete="current-password"
              value={oldPassword}
              onChange={(e) => setOld(e.target.value)}
            />
          </div>
          <div className="auth-form-row">
            <label>新密码</label>
            <input
              className="ed-text"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
            />
          </div>
          <div className="auth-form-row">
            <label>确认新密码</label>
            <input
              className="ed-text"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
          </div>

          <div className="auth-actions">
            <span className="auth-inline-msg">
              {state.kind === 'ok' && <span className="auth-msg-ok">✓ 密码已修改</span>}
              {state.kind === 'fail' && <span className="auth-msg-fail">✗ {state.message}</span>}
            </span>
            <button className="btn" onClick={onClose}>
              {state.kind === 'ok' ? '关闭' : '取消'}
            </button>
            <button className="btn primary" disabled={busy} onClick={() => void submit()}>
              {busy ? '提交中…' : '确认修改'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 兼容 Designer 旧服务的 {error} 和 FastAPI 的 {detail}。 */
export async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown; detail?: unknown };
    if (data && typeof data.error === 'string' && data.error.trim() !== '') return data.error;
    if (data && typeof data.detail === 'string' && data.detail.trim() !== '') return data.detail;
  } catch {
    /* 非 JSON */
  }
  return `请求失败(HTTP ${res.status})`;
}
