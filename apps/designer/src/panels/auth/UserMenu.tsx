/**
 * UserMenu — 工具条右侧的「当前用户」入口。
 * - 显示用户名 + 角色小徽章;下拉只保留平台个人中心和退出登录。
 * - me 为空(未登录/后端未接/401)时显示 "—",点击仅重试 fetchMe,不抛错、不白屏。
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
          <a
            className="usermenu-item"
            href="/account"
            onClick={() => setOpen(false)}
          >
            个人中心
          </a>
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
