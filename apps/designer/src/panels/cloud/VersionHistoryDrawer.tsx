/**
 * VersionHistoryDrawer —「历史」抽屉。
 * - 时间线列出当前云工程的版本:manual(高亮+备注)/ auto(淡色)/ restore(标注)。
 * - 顶部「保存当前为版本」(填备注 → markVersion)。
 * - 每条:预览(只读加载进画布,给"退出预览"恢复) / 回滚(确认 → restoreVersion → 重载)。
 *
 * 预览实现:进入预览前快照"真实当前 doc",预览时把版本 doc loadProject 进画布(不落库、
 * 不排云同步——见 projectStore.loadProject 会 dirty=false);退出预览 loadProject 回快照。
 * 与 undo/redo 正交:退出预览恢复的是进入预览那一刻的文档。
 */
import { useEffect, useRef, useState } from 'react';
import { useProjectsStore } from '../../stores/projectsStore';
import { useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';
import * as cloud from '../../services/cloudStorage';
import type { VersionMeta } from '../../services/cloudStorage';
import {
  createStoredProjectDocument,
  loadProjectDocument,
  type StoredProjectDocument,
} from '../../services/projectPersistence';
import { formatTime } from './ProjectListModal';
import './cloud.css';

type ListState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'disabled' }
  | { kind: 'ready'; versions: VersionMeta[] };

const KIND_LABEL: Record<VersionMeta['kind'], string> = {
  manual: '手动',
  auto: '自动',
  restore: '回滚',
};

export function VersionHistoryDrawer({ onClose }: { onClose: () => void }): JSX.Element {
  const currentId = useProjectsStore((s) => s.currentId);
  const cloudEnabled = useProjectsStore((s) => s.cloudEnabled);
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'fail'; text: string } | null>(null);
  /** 正在预览的 seq(null=未预览) */
  const [previewSeq, setPreviewSeq] = useState<number | null>(null);
  /** 进入预览前的真实文档快照 */
  const snapshotRef = useRef<StoredProjectDocument | null>(null);

  const flash = (tone: 'ok' | 'fail', text: string): void => setMsg({ tone, text });

  const load = async (): Promise<void> => {
    if (!cloudEnabled) {
      setList({ kind: 'disabled' });
      return;
    }
    if (!currentId) {
      setList({ kind: 'ready', versions: [] });
      return;
    }
    setList({ kind: 'loading' });
    const r = await cloud.listVersions(currentId);
    if (r.ok) {
      // 新→旧(seq 降序)
      setList({ kind: 'ready', versions: [...r.data].sort((a, b) => b.seq - a.seq) });
    } else if (r.kind === 'disabled') {
      setList({ kind: 'disabled' });
    } else {
      setList({ kind: 'error', message: r.message });
    }
  };

  useEffect(() => {
    void load();
    // 关闭抽屉/切工程时,若还在预览则恢复
    return () => exitPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, cloudEnabled]);

  /* Esc 关闭抽屉(与 UserMenu 一致风格) */
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

  const exitPreview = (): void => {
    if (snapshotRef.current) {
      const doc = loadProjectDocument(snapshotRef.current).project;
      useProjectStore.getState().loadProject(doc);
      const home = doc.screens.find((s) => s.isHome) ?? doc.screens[0];
      if (home) useEditorStore.getState().setActiveScreen(home.id);
      snapshotRef.current = null;
    }
    setPreviewSeq(null);
  };

  const onPreview = async (seq: number): Promise<void> => {
    if (!currentId) return;
    setBusy(true);
    const r = await cloud.getVersion(currentId, seq);
    setBusy(false);
    if (!r.ok) {
      flash('fail', `预览失败:${r.message}`);
      return;
    }
    // 首次进入预览:快照真实文档
    if (!snapshotRef.current) {
      snapshotRef.current = createStoredProjectDocument(useProjectStore.getState().project);
    }
    const preview = loadProjectDocument(r.data).project;
    useProjectStore.getState().loadProject(preview);
    const home = preview.screens.find((s) => s.isHome) ?? preview.screens[0];
    if (home) useEditorStore.getState().setActiveScreen(home.id);
    setPreviewSeq(seq);
    useEditorStore.getState().setBanner(`正在预览版本 #${seq}(只读)。退出预览即恢复。`);
  };

  const onExitPreview = (): void => {
    exitPreview();
    useEditorStore.getState().setBanner(null);
  };

  const onRollback = async (seq: number): Promise<void> => {
    if (!currentId) return;
    if (!window.confirm(`确认回滚到版本 #${seq}?当前内容会被该版本覆盖(回滚本身也会记为一条历史)。`)) return;
    exitPreview();
    setBusy(true);
    const r = await cloud.restoreVersion(currentId, seq);
    if (!r.ok) {
      setBusy(false);
      flash('fail', `回滚失败:${r.message}`);
      return;
    }
    // 回滚成功 → 重载当前工程(拉云端最新 = 回滚后的内容)
    await useProjectsStore.getState().openProject(currentId);
    setBusy(false);
    useEditorStore.getState().setBanner(null);
    flash('ok', `已回滚到版本 #${seq}`);
    await load();
  };

  const onMark = async (): Promise<void> => {
    if (!currentId) return;
    const n = note.trim();
    setBusy(true);
    const r = await cloud.markVersion(currentId, n);
    setBusy(false);
    if (r.ok) {
      setNote('');
      flash('ok', `已保存为版本 #${r.data.seq}`);
      await load();
    } else {
      flash('fail', `保存版本失败:${r.message}`);
    }
  };

  const onDeleteVersion = async (seq: number): Promise<void> => {
    if (!currentId) return;
    if (!window.confirm(`删除版本 #${seq}?此操作不可撤销。`)) return;
    if (previewSeq === seq) onExitPreview();
    setBusy(true);
    const r = await cloud.deleteVersion(currentId, seq);
    setBusy(false);
    if (r.ok || r.kind === 'notFound') {
      flash('ok', `已删除版本 #${seq}`);
      await load();
    } else {
      flash('fail', `删除失败:${r.message}`);
    }
  };

  return (
    <>
      <div className="hist-drawer-mask" onClick={onClose} />
      <div className="hist-drawer" role="dialog" aria-label="版本历史">
        <div className="hist-head">
          <span>版本历史</span>
          <button className="icon-btn" title="关闭" onClick={onClose}>✕</button>
        </div>

        {cloudEnabled && currentId && (
          <div className="hist-top">
            <input
              className="ed-text"
              placeholder="备注(可选),如「配色定稿」"
              value={note}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void onMark()}
            />
            <button className="btn primary" disabled={busy} onClick={() => void onMark()}>
              保存为版本
            </button>
          </div>
        )}

        <div className="hist-body">
          {msg && (
            <div className={msg.tone === 'ok' ? 'cloud-msg-ok' : 'cloud-msg-fail'}>
              {msg.tone === 'ok' ? '✓ ' : '✗ '}{msg.text}
            </div>
          )}

          {previewSeq != null && (
            <div className="hist-preview-bar">
              <span>预览中:版本 #{previewSeq}(只读)</span>
              <button className="btn btn-sm" onClick={onExitPreview}>退出预览</button>
            </div>
          )}

          {list.kind === 'disabled' && (
            <div className="cloud-state">未启用云存储,无版本历史。工程仅保存在本地。</div>
          )}
          {!currentId && cloudEnabled && (
            <div className="cloud-state">当前工程尚未上云。请先在「我的工程」中新建或打开一个云端工程。</div>
          )}
          {list.kind === 'loading' && <div className="cloud-state">加载中…</div>}
          {list.kind === 'error' && <div className="cloud-state error">加载失败:{list.message}</div>}
          {list.kind === 'ready' && currentId && list.versions.length === 0 && (
            <div className="cloud-empty">
              还没有历史版本
              <div className="cloud-empty-hint">在上方「保存为版本」为当前状态打个快照</div>
            </div>
          )}

          {list.kind === 'ready' && list.versions.length > 0 && (
            <div className="hist-timeline">
              {list.versions.map((v) => (
                <div
                  key={v.seq}
                  className={`hist-entry ${v.kind} ${previewSeq === v.seq ? 'previewing' : ''}`}
                >
                  <div className="hist-entry-top">
                    <span className={`hist-kind ${v.kind}`}>{KIND_LABEL[v.kind]}</span>
                    <span className="hist-time">#{v.seq} · {formatTime(v.created_at)}</span>
                  </div>
                  {v.note && <p className="hist-note">{v.note}</p>}
                  {!v.note && v.kind === 'restore' && <p className="hist-note">回滚生成的快照</p>}
                  <div className="hist-entry-actions">
                    {previewSeq === v.seq ? (
                      <button className="btn btn-sm" onClick={onExitPreview}>退出预览</button>
                    ) : (
                      <button className="btn btn-sm" disabled={busy} onClick={() => void onPreview(v.seq)}>
                        预览
                      </button>
                    )}
                    <button className="btn btn-sm" disabled={busy} onClick={() => void onRollback(v.seq)}>
                      回滚到此
                    </button>
                    <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => void onDeleteVersion(v.seq)}>
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
