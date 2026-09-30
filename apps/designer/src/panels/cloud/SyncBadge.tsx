/**
 * SyncBadge — 工具条上的云同步状态徽章。
 * synced ✓ / saving … / offline(有未同步改动) / conflict(冲突)。
 * 点击:synced/offline → 立即保存;conflict → 强制保存(覆盖云端)。
 * cloudEnabled=false 时显示"仅本地",不可点。
 */
import { useProjectsStore, type SyncState } from '../../stores/projectsStore';
import './cloud.css';

const LABEL: Record<SyncState, { text: string; cls: string }> = {
  synced: { text: '已同步', cls: 'synced' },
  saving: { text: '保存中…', cls: 'saving' },
  offline: { text: '离线', cls: 'offline' },
  conflict: { text: '冲突', cls: 'conflict' },
};

function SyncIcon({ state }: { state: SyncState | 'local' | 'paused' }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 18a4 4 0 0 1-.5-8A6.5 6.5 0 0 1 18 9a4.5 4.5 0 0 1 0 9Z" />
      {state === 'synced' && <path d="m9 14 2 2 4-4" />}
      {state === 'saving' && <path d="M9 14h.01M12 14h.01M15 14h.01" />}
      {state === 'offline' && <path d="M7 7l10 12" />}
      {state === 'conflict' && <path d="M12 11v4M12 18h.01" />}
      {state === 'local' && <path d="M8 14h8" />}
      {state === 'paused' && <path d="M10 12v5M14 12v5" />}
    </svg>
  );
}

export function SyncBadge(): JSX.Element | null {
  const cloudEnabled = useProjectsStore((s) => s.cloudEnabled);
  const syncState = useProjectsStore((s) => s.syncState);
  const currentId = useProjectsStore((s) => s.currentId);
  const cloudSyncPaused = useProjectsStore((s) => s.cloudSyncPaused);

  if (!cloudEnabled) {
    return (
      <span
        className="sync-badge sync-icon-badge local"
        role="status"
        aria-label="仅本地"
        title="该实例未启用云存储,工程仅保存在本地浏览器"
      >
        <SyncIcon state="local" />
      </span>
    );
  }
  if (!currentId) {
    return (
      <span
        className="sync-badge sync-icon-badge local"
        role="status"
        aria-label="当前工程未上云"
        title="当前工程未上云;可在「我的工程」中新建或上传"
      >
        <SyncIcon state="local" />
      </span>
    );
  }

  const l = LABEL[syncState];
  const onClick = (): void => {
    if (syncState === 'saving') return;
    // 冲突 → 强制覆盖云端;其它 → 普通立即保存
    void useProjectsStore.getState().saveCurrent(syncState === 'conflict');
  };
  const title =
    syncState === 'conflict'
      ? '版本冲突:点击强制保存,用本地覆盖云端'
      : syncState === 'offline'
        ? '有未同步的本地改动,点击立即重试保存到云'
        : syncState === 'saving'
          ? '正在保存到云…'
          : '已同步到云,点击可手动保存';

  return (
    <button
      className={`sync-badge sync-icon-badge ${cloudSyncPaused ? 'local' : l.cls}`}
      onClick={onClick}
      disabled={syncState === 'saving' || cloudSyncPaused}
      aria-label={cloudSyncPaused ? '预览历史版本，云同步已暂停' : l.text}
      title={cloudSyncPaused ? '正在预览历史版本，已暂停云同步' : title}
    >
      <SyncIcon state={cloudSyncPaused ? 'paused' : syncState} />
    </button>
  );
}
