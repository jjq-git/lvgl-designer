/**
 * ProjectListModal —「我的工程」模态。
 * - 顶部「新建工程」(填名)。
 * - 云端工程列表:{name, 更新时间},点击打开;每行重命名 / 删除(二次确认)。
 * - 空态引导新建。
 * - 底部:把本地 IndexedDB 里的老工程「上传到云」(迁移入口)。
 * cloudEnabled=false 时给"仅本地"提示,仍可看到本地工程但不提供云操作。
 */
import { useEffect, useState } from 'react';
import { useProjectsStore } from '../../stores/projectsStore';
import { useProjectStore } from '../../stores/projectStore';
import { renameProject as cloudRenameProject } from '../../services/cloudStorage';
import { loadLastProject } from '../../services/storage';
import type { LvProject } from '@lvd/schema';
import './cloud.css';

export function ProjectListModal({ onClose }: { onClose: () => void }): JSX.Element {
  const cloudEnabled = useProjectsStore((s) => s.cloudEnabled);
  const list = useProjectsStore((s) => s.list);
  const currentId = useProjectsStore((s) => s.currentId);
  const listLoading = useProjectsStore((s) => s.listLoading);
  const listError = useProjectsStore((s) => s.listError);

  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'fail' | 'info'; text: string } | null>(null);
  /** 本地"最近工程"缓存(迁移用),null=无 / undefined=未探测 */
  const [localProj, setLocalProj] = useState<LvProject | null | undefined>(undefined);

  useEffect(() => {
    if (cloudEnabled) void useProjectsStore.getState().refreshList();
    void loadLastProject().then((p) => setLocalProj(p));
  }, [cloudEnabled]);

  /* Esc 关闭模态(与 UserMenu 一致风格) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const flash = (tone: 'ok' | 'fail' | 'info', text: string): void => setMsg({ tone, text });

  const onCreate = async (): Promise<void> => {
    const name = newName.trim();
    if (name === '') {
      flash('fail', '请填写工程名');
      return;
    }
    const previousProjectId = useProjectStore.getState().uiProject.meta.id;
    setBusy(true);
    await useProjectsStore.getState().newProject(name);
    setBusy(false);
    if (useProjectStore.getState().uiProject.meta.id !== previousProjectId) {
      setNewName('');
      onClose();
    } else {
      flash('fail', '新建工程失败，请检查网络或服务状态');
    }
  };

  const onOpen = async (id: string): Promise<void> => {
    setBusy(true);
    await useProjectsStore.getState().openProject(id);
    setBusy(false);
    if (useProjectsStore.getState().currentId === id) onClose();
    else flash('fail', '工程未能打开，请检查网络或本地缓存');
  };

  const onRename = async (id: string, oldName: string): Promise<void> => {
    const name = window.prompt('重命名工程:', oldName);
    if (name == null) return;
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === oldName) return;
    if (id === currentId) {
      await useProjectsStore.getState().renameCurrent(trimmed);
    } else {
      // 非当前工程:直接调云端 rename + 刷新
      const r = await cloudRenameProject(id, trimmed);
      if (!r.ok) {
        flash('fail', `重命名失败:${r.message}`);
        return;
      }
      await useProjectsStore.getState().refreshList();
    }
    flash('ok', '已重命名');
  };

  const onDelete = async (id: string, name: string): Promise<void> => {
    if (!window.confirm(`确认删除工程「${name}」?此操作不可撤销(含其云端版本历史)。`)) return;
    setBusy(true);
    const deleted = await useProjectsStore.getState().deleteProject(id);
    setBusy(false);
    flash(deleted ? 'ok' : 'fail', deleted ? `已删除「${name}」` : `未能删除「${name}」`);
  };

  const onUploadLocal = async (): Promise<void> => {
    if (!localProj) return;
    const suggested = localProj.meta.name || 'untitled';
    const name = window.prompt('上传本地工程到云,工程名:', suggested);
    if (name == null) return;
    const trimmed = name.trim() || suggested;
    setBusy(true);
    const r = await useProjectsStore.getState().uploadLocal(trimmed, localProj);
    setBusy(false);
    if (r.ok) flash('ok', `已上传「${trimmed}」到云`);
    else flash('fail', `上传失败:${r.message}`);
  };

  return (
    <div className="cloud-mask" onClick={onClose}>
      <div className="cloud-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cloud-modal-head">
          <span>我的工程</span>
          <button className="icon-btn" title="关闭" onClick={onClose}>✕</button>
        </div>
        <div className="cloud-modal-body">
          {msg && (
            <div className={`cloud-msg-${msg.tone}`}>
              {msg.tone === 'ok' ? '✓ ' : msg.tone === 'fail' ? '✗ ' : ''}
              {msg.text}
            </div>
          )}
          {!cloudEnabled && (
            <div className="cloud-msg-info">
              该实例未启用云存储,工程仅保存在本地浏览器。可继续本地编辑与「打开/保存」文件。
            </div>
          )}

          {cloudEnabled && (
            <>
              <div className="cloud-new-row">
                <input
                  className="ed-text"
                  placeholder="新工程名"
                  value={newName}
                  disabled={busy}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void onCreate()}
                />
                <button className="btn primary" disabled={busy || newName.trim() === ''} onClick={() => void onCreate()}>
                  新建工程
                </button>
              </div>

              <div className="cloud-section-title">云端工程</div>
              {listLoading && <div className="cloud-state">加载中…</div>}
              {listError && <div className="cloud-state error">{listError}</div>}
              {!listLoading && list.length === 0 && (
                <div className="cloud-empty">
                  还没有云端工程
                  <div className="cloud-empty-hint">在上方填名新建你的第一个工程</div>
                </div>
              )}
              {list.length > 0 && (
                <div className="cloud-list">
                  {list.map((p) => (
                    <div
                      key={p.id}
                      className={`cloud-item ${p.id === currentId ? 'current' : ''}`}
                      onClick={() => !busy && void onOpen(p.id)}
                    >
                      <div className="cloud-item-main">
                        <span className="cloud-item-name">{p.name}</span>
                        <span className="cloud-item-sub">
                          更新于 {formatTime(p.updated_at)} · v{p.version}
                        </span>
                      </div>
                      {p.id === currentId && <span className="cloud-current-tag">当前</span>}
                      <div className="cloud-item-actions" onClick={(e) => e.stopPropagation()}>
                        <button className="btn btn-sm" disabled={busy} onClick={() => void onRename(p.id, p.name)}>
                          重命名
                        </button>
                        <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => void onDelete(p.id, p.name)}>
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {localProj && (
                <div className="cloud-migrate">
                  <div className="cloud-section-title">迁移本地工程</div>
                  <div className="cloud-migrate-row">
                    <div className="cloud-item-main">
                      <span className="cloud-item-name">{localProj.meta.name || 'untitled'}(本地)</span>
                      <span className="cloud-item-sub">浏览器里最近编辑的本地工程,可一键上传到云</span>
                    </div>
                    <button className="btn" disabled={busy} onClick={() => void onUploadLocal()}>
                      上传到云
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** ISO → 本地可读;失败原样;无则 "—" */
export function formatTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
