/**
 * SyncBadge — 工具条上的云同步状态徽章。
 * synced ✓ / saving … / offline(有未同步改动) / conflict(冲突)。
 * 点击:synced/offline → 立即保存;conflict → 强制保存(覆盖云端)。
 * cloudEnabled=false 时显示"仅本地",不可点。
 */
import { useProjectsStore, type SyncState } from '../../stores/projectsStore';
import './cloud.css';

const LABEL: Record<SyncState, { dot: string; text: string; cls: string }> = {
  synced: { dot: '●', text: '已同步', cls: 'synced' },
  saving: { dot: '●', text: '保存中…', cls: 'saving' },
  offline: { dot: '●', text: '离线', cls: 'offline' },
  conflict: { dot: '●', text: '冲突', cls: 'conflict' },
};

export function SyncBadge(): JSX.Element | null {
  const cloudEnabled = useProjectsStore((s) => s.cloudEnabled);
  const syncState = useProjectsStore((s) => s.syncState);
  const currentId = useProjectsStore((s) => s.currentId);
  const cloudSyncPaused = useProjectsStore((s) => s.cloudSyncPaused);

  if (!cloudEnabled) {
    return (
      <span className="sync-badge local" title="该实例未启用云存储,工程仅保存在本地浏览器">
        <span className="sync-dot">●</span> 仅本地
      </span>
    );
  }
  if (!currentId) {
    return (
      <span className="sync-badge local" title="当前工程未上云;可在「我的工程」中新建或上传">
        <span className="sync-dot">●</span> 未上云
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
      className={`sync-badge ${cloudSyncPaused ? 'local' : l.cls}`}
      onClick={onClick}
      disabled={syncState === 'saving' || cloudSyncPaused}
      title={cloudSyncPaused ? '正在预览历史版本，已暂停云同步' : title}
    >
      <span className="sync-dot">{cloudSyncPaused ? '●' : syncState === 'synced' ? '✓' : l.dot}</span>{' '}
      {cloudSyncPaused ? '预览中' : l.text}
      {!cloudSyncPaused && syncState === 'conflict' && <span>· 强制保存</span>}
    </button>
  );
}
