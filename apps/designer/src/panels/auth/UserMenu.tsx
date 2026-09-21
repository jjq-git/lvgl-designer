/**
 * UserMenu — 工具条右侧的「当前用户」入口。
 * - 显示用户名 + 角色小徽章(管理员 = accent 色);点击展开下拉:
 *   「修改密码」/「用户管理」(仅 admin)/「退出登录」。
 * - me 为空(未登录/后端未接/401)时显示 "—",点击仅重试 fetchMe,不抛错、不白屏。
 * - 模态由 authStore.modal 驱动,容器挂在 App.tsx(见 AuthModals)。
 */
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import './auth.css';

export function UserMenu(): JSX.Element {
  const me = useAuthStore((s) => s.me);
  const loading = useAuthStore((s) => s.loading);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /* 点击外部 / Esc 关闭下拉 */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isAdmin = me?.role === 'admin';
  const label = me ? me.username : loading ? '…' : '—';

  const pick = (action: () => void): void => {
    setOpen(false);
    action();
  };

  return (
    <div className="usermenu" ref={rootRef}>
      <button
        className="usermenu-trigger"
        title={me ? `${me.username}(${isAdmin ? '管理员' : '普通用户'})` : '未获取到用户信息'}
        onClick={() => {
          // me 缺失时点击顺便重试一次拉取(后端刚接上/网络恢复的场景)
          if (!me) void useAuthStore.getState().fetchMe();
          setOpen((v) => !v);
        }}
      >
        <span className="usermenu-name">{label}</span>
        {me && (
          <span className={`role-badge ${isAdmin ? 'admin' : ''}`}>
            {isAdmin ? '管理员' : '普通'}
          </span>
        )}
        <span className="usermenu-caret">▾</span>
      </button>

      {open && (
        <div className="usermenu-pop" role="menu">
          <button
            className="usermenu-item"
            onClick={() => pick(() => useAuthStore.getState().openModal('password'))}
          >
            修改密码
          </button>
          {isAdmin && (
            <button
              className="usermenu-item"
              onClick={() => pick(() => useAuthStore.getState().openModal('admin'))}
            >
              用户管理
            </button>
          )}
          <div className="usermenu-sep" />
          <button
            className="usermenu-item danger"
            onClick={() => pick(() => void useAuthStore.getState().logout())}
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * AuthModals — 两个模态的容器,挂在 App.tsx 根部。
 * 由 authStore.modal 驱动;关闭即置 null。
 */
import { ChangePassword } from './ChangePassword';
import { AdminPanel } from './AdminPanel';

export function AuthModals(): JSX.Element | null {
  const modal = useAuthStore((s) => s.modal);
  const close = (): void => useAuthStore.getState().openModal(null);
  if (modal === 'password') return <ChangePassword onClose={close} />;
  if (modal === 'admin') return <AdminPanel onClose={close} />;
  return null;
}
