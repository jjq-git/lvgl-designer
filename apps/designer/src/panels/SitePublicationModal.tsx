import { useEffect, useMemo, useState } from 'react';
import {
  getSiteTargetState,
  getSitePublication,
  listSitePublications,
  prepareSitePublication,
  publishSitePublication,
  rollbackSitePublication,
  sitePublicationThumbnailUrl,
  sitePublicationPreviewUrl,
  type SitePublication,
  type SiteTargetState,
} from '../services/sitePublications';
import { useProjectsStore } from '../stores/projectsStore';

function frameLabel(frame: SiteTargetState['frames'][number]): string {
  const resolution = frame.resolution ? `${frame.resolution.width}×${frame.resolution.height}` : '分辨率待登记';
  return `${frame.model} · ${resolution}`;
}

const deliveryStatusLabel: Record<string, string> = {
  not_started: '等待中',
  submitted: '已提交',
  rolled_back: '已回滚',
  running: '进行中',
  succeeded: '已完成',
  failed: '失败',
  skipped: '已跳过',
};

function stageLabel(status: string): string {
  return deliveryStatusLabel[status] ?? status;
}

export function SitePublicationModal({ onClose }: { onClose: () => void }): JSX.Element {
  const projectId = useProjectsStore((state) => state.currentId);
  const projectName = useProjectsStore((state) => state.currentName);
  const [target, setTarget] = useState<SiteTargetState | null>(null);
  const [mode, setMode] = useState<'new' | 'update'>('new');
  const [demoId, setDemoId] = useState('');
  const [frameId, setFrameId] = useState('');
  const [name, setName] = useState(projectName || '未命名 UI');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [visibilityTouched, setVisibilityTouched] = useState(false);
  const [prepared, setPrepared] = useState<SitePublication | null>(null);
  const [publications, setPublications] = useState<SitePublication[]>([]);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState<'loading' | 'preparing' | 'publishing' | 'rolling-back' | 'refreshing' | null>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getSiteTargetState(), projectId ? listSitePublications(projectId) : Promise.resolve([])])
      .then(([value, history]) => {
        setTarget(value);
        setFrameId(value.frames[0]?.id ?? '');
        setPublications(history);
        setBusy(null);
      }).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setBusy(null);
      });
  }, [projectId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape' && busy === null) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  useEffect(() => {
    if (!prepared || !['git_committed', 'rolled_back'].includes(prepared.status)
      || ['deployed', 'deployment_partial', 'deployment_failed'].includes(prepared.deploymentStatus ?? '')) return;
    let cancelled = false;
    const poll = (): void => {
      void getSitePublication(prepared.id).then((value) => {
        if (!cancelled) setPrepared(value);
      }).catch(() => { /* 下一轮继续查询，手动刷新仍可显示错误 */ });
    };
    const timer = window.setInterval(poll, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [prepared?.id, prepared?.status, prepared?.deploymentStatus]);

  const selectedDemo = useMemo(
    () => target?.demos.find((item) => item.id === demoId) ?? null,
    [demoId, target],
  );

  const selectDemo = (id: string): void => {
    setDemoId(id);
    const demo = target?.demos.find((item) => item.id === id);
    if (!demo) return;
    setFrameId(demo.frameId);
    setName(demo.name);
    setDescription(demo.description);
    setIsPublic(demo.isPublic);
    setVisibilityTouched(false);
    setPrepared(null);
    setRequestId(crypto.randomUUID());
  };

  const resetRequest = (): void => {
    setPrepared(null);
    setRequestId(crypto.randomUUID());
  };

  const prepare = async (): Promise<void> => {
    if (!projectId) { setError('请先把工程保存到“我的工程”'); return; }
    if (!frameId || name.trim() === '') { setError('请选择设备型号并填写 Demo 名称'); return; }
    if (mode === 'update' && !selectedDemo) { setError('请选择要更新的 Demo UUID'); return; }
    setBusy('preparing');
    setError(null);
    try {
      await useProjectsStore.getState().saveCurrent();
      if (useProjectsStore.getState().syncState !== 'synced') {
        throw new Error('工程尚未成功同步到云端，不能锁定发布版本');
      }
      const result = await prepareSitePublication({
        requestId,
        projectId,
        frameId,
        name: name.trim(),
        description: description.trim(),
        ...(mode === 'update' ? { demoId } : {}),
        ...((mode === 'new' || visibilityTouched) ? { isPublic } : {}),
      });
      setPrepared(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const refresh = async (publicationId: string): Promise<void> => {
    setBusy('refreshing');
    setError(null);
    try {
      setPrepared(await getSitePublication(publicationId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const publish = async (): Promise<void> => {
    if (!prepared || !window.confirm('确认把已准备且锁定的产物提交到目标 Git 分支？')) return;
    setBusy('publishing');
    setError(null);
    try {
      setPrepared(await publishSitePublication(prepared.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const rollback = async (): Promise<void> => {
    if (!prepared || !window.confirm('确认创建补偿提交，只撤销这次发布的清单和资源？')) return;
    setBusy('rolling-back');
    setError(null);
    try {
      setPrepared(await rollbackSitePublication(prepared.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const immutable = prepared !== null;
  return (
    <div className="site-publish-mask" onClick={busy === null ? onClose : undefined} role="presentation">
      <section className="site-publish-modal" role="dialog" aria-label="发布到 ui.podsc.com" onClick={(event) => event.stopPropagation()}>
        <header><div><strong>发布到 ui.podsc.com</strong><small>生成 UI、缩略图并更新目标清单；设备外框保持只读</small></div><button className="icon-btn" disabled={busy !== null} onClick={onClose}>✕</button></header>
        <div className="site-publish-body">
          {!projectId && <p className="site-publish-error">当前是本地工程，请先在“我的工程”中创建或上传云端工程。</p>}
          {error && <p className="site-publish-error" role="alert">{error}</p>}
          {busy === 'loading' && <p>正在读取目标分支的 frame 清单…</p>}
          {target && !immutable && <>
            <div className="site-publish-tabs">
              <button className={mode === 'new' ? 'active' : ''} onClick={() => { setMode('new'); setDemoId(''); setIsPublic(false); setVisibilityTouched(false); resetRequest(); }}>新增 Demo</button>
              <button className={mode === 'update' ? 'active' : ''} onClick={() => { setMode('update'); resetRequest(); }}>更新已发布 Demo</button>
            </div>
            {mode === 'update' && <label>Demo UUID<select value={demoId} onChange={(event) => selectDemo(event.target.value)}><option value="">请选择（显式绑定）</option>{target.demos.map((demo) => <option key={demo.id} value={demo.id}>{demo.name} · {demo.id}</option>)}</select></label>}
            <label>设备型号<select value={frameId} disabled={mode === 'update' && selectedDemo !== null} onChange={(event) => { setFrameId(event.target.value); resetRequest(); }}>{target.frames.map((frame) => <option key={frame.id} value={frame.id}>{frameLabel(frame)}</option>)}</select></label>
            <label>Demo 名称<input value={name} maxLength={160} onChange={(event) => { setName(event.target.value); resetRequest(); }} /></label>
            <label>说明（可选）<textarea value={description} maxLength={1000} rows={3} onChange={(event) => { setDescription(event.target.value); resetRequest(); }} /></label>
            <label className="site-publish-check"><input type="checkbox" checked={isPublic} onChange={(event) => { setIsPublic(event.target.checked); setVisibilityTouched(true); resetRequest(); }} />首页展示 <small>关闭只是不在首页列出，不代表私密访问</small></label>
            <p className="site-publish-note">目标：{target.branch} @ {target.targetCommit.slice(0, 12)}。准备时会锁定当前云端版本，并以后端生成结果为准。</p>
            {publications.some((item) => ['preparing', 'prepared', 'publishing', 'conflict', 'git_committed', 'rollback_failed'].includes(item.status)) && <div className="site-publish-history"><strong>恢复发布任务</strong>{publications.filter((item) => ['preparing', 'prepared', 'publishing', 'conflict', 'git_committed', 'rollback_failed'].includes(item.status)).slice(0, 8).map((item) => <button key={item.id} className="btn" onClick={() => void refresh(item.id)}>{item.name} · {item.status} · {item.demoId.slice(0, 8)}</button>)}</div>}
          </>}
          {prepared && <div className="site-publish-result">
            {prepared.status !== 'preparing' && <div className="site-publish-previews"><div><strong>可交互目标预览</strong>{prepared.interactivePreviewAvailable ? <iframe src={sitePublicationPreviewUrl(prepared.id)} title="目标 Renderer 可交互预览" sandbox="allow-scripts" /> : <p className="site-publish-warning">旧任务没有保存目标 Renderer，请重新准备后查看交互预览。</p>}</div><div><strong>发布缩略图</strong><div className="site-publish-preview"><img src={sitePublicationThumbnailUrl(prepared.id)} alt="目标 Renderer 生成的 UI 缩略图" /></div></div></div>}
            <dl><div><dt>Demo UUID</dt><dd>{prepared.demoId}</dd></div><div><dt>锁定版本</dt><dd>云端 v{prepared.sourceProjectVersion} / 快照 #{prepared.sourceSnapshotSeq}</dd></div><div><dt>文档哈希</dt><dd>{prepared.documentSha256?.slice(0, 20)}…</dd></div><div><dt>状态</dt><dd>{prepared.status}</dd></div>{prepared.commitSha && <div><dt>Commit</dt><dd>{prepared.commitSha}</dd></div>}</dl>
            {prepared.diagnostics?.map((item) => <p className="site-publish-warning" key={`${item.code}:${item.path}`}>{item.message}</p>)}
            {prepared.diffStat && <pre>{prepared.diffStat}</pre>}
            {prepared.manifestChange && <details open><summary>清单记录差异</summary><div className="site-publish-manifest-diff"><div><strong>发布前</strong><pre>{JSON.stringify(prepared.manifestChange.before, null, 2)}</pre></div><div><strong>发布后</strong><pre>{JSON.stringify(prepared.manifestChange.after, null, 2)}</pre></div></div></details>}
            {prepared.changedPaths && <details><summary>允许写入的文件（{prepared.changedPaths.length}）</summary><pre>{prepared.changedPaths.join('\n')}</pre></details>}
            {prepared.delivery && <dl><div><dt>Git</dt><dd>{stageLabel(prepared.delivery.git.status)}</dd></div><div><dt>静态上传</dt><dd>{stageLabel(prepared.delivery.staticUpload.status)}{prepared.delivery.staticUpload.detail && ` · ${prepared.delivery.staticUpload.detail}`}</dd></div><div><dt>旧页删除</dt><dd>{stageLabel(prepared.delivery.stalePageDeletion.status)}{prepared.delivery.stalePageDeletion.detail && ` · ${prepared.delivery.stalePageDeletion.detail}`}</dd></div><div><dt>CDN 刷新</dt><dd>{stageLabel(prepared.delivery.cdnRefresh.status)}{prepared.delivery.cdnRefresh.detail && ` · ${prepared.delivery.cdnRefresh.detail}`}</dd></div></dl>}
            {prepared.status === 'git_committed' && prepared.deploymentStatus === 'deployed' && <p className="site-publish-success">网站已完成 OSS 上传、旧页清理和 CDN 刷新。{prepared.previewUrl && <> 访问链接：<a href={prepared.previewUrl} target="_blank" rel="noreferrer">{prepared.previewUrl}</a></>}</p>}
            {prepared.status === 'git_committed' && prepared.deploymentStatus === 'deployment_failed' && <p className="site-publish-error">Git 已提交，但网站部署失败。请查看上方失败阶段或目标仓库 Actions 日志。</p>}
            {prepared.status === 'git_committed' && prepared.deploymentStatus === 'deployment_partial' && <p className="site-publish-warning">静态文件已上传，但 CDN 刷新被跳过；当前不能确认所有访问节点已经更新。</p>}
            {prepared.status === 'git_committed' && !['deployed', 'deployment_failed', 'deployment_partial'].includes(prepared.deploymentStatus ?? '') && <p className="site-publish-note">Git 已提交，正在等待目标仓库完成部署。窗口会自动刷新状态。</p>}
            {prepared.status === 'rolled_back' && prepared.deploymentStatus === 'deployed' && <p className="site-publish-success">补偿提交已部署完成：{prepared.rollbackCommitSha}</p>}
            {prepared.status === 'rolled_back' && prepared.deploymentStatus === 'deployment_failed' && <p className="site-publish-error">补偿提交已创建，但目标站回退部署失败。请查看上方失败阶段或目标仓库 Actions 日志。</p>}
            {prepared.status === 'rolled_back' && prepared.deploymentStatus === 'deployment_partial' && <p className="site-publish-warning">补偿文件已上传，但 CDN 刷新被跳过；当前不能确认所有访问节点已经回退。</p>}
            {prepared.status === 'rolled_back' && !['deployed', 'deployment_failed', 'deployment_partial'].includes(prepared.deploymentStatus ?? '') && <p className="site-publish-note">已创建补偿提交，正在等待目标站完成回退部署：{prepared.rollbackCommitSha}</p>}
          </div>}
        </div>
        <footer><button className="btn" disabled={busy !== null} onClick={onClose}>关闭</button>{immutable && <button className="btn" disabled={busy !== null} onClick={resetRequest}>返回新发布</button>}{!immutable && <button className="btn primary" disabled={busy !== null || !projectId} onClick={() => void prepare()}>{busy === 'preparing' ? '准备中…' : '准备并检查'}</button>}{prepared?.status === 'preparing' && <button className="btn primary" disabled={busy !== null} onClick={() => void refresh(prepared.id)}>{busy === 'refreshing' ? '刷新中…' : '刷新准备状态'}</button>}{prepared && ['prepared', 'publishing', 'conflict'].includes(prepared.status) && <button className="btn primary" disabled={busy !== null} onClick={() => void publish()}>{busy === 'publishing' ? '提交中…' : '发布到 Git'}</button>}{prepared && ['git_committed', 'rolled_back'].includes(prepared.status) && <button className="btn" disabled={busy !== null} onClick={() => void refresh(prepared.id)}>{busy === 'refreshing' ? '刷新中…' : '刷新部署状态'}</button>}{prepared?.status === 'git_committed' && <button className="btn" disabled={busy !== null} onClick={() => void rollback()}>{busy === 'rolling-back' ? '回滚中…' : '创建补偿回滚'}</button>}</footer>
      </section>
      <style>{`
        .site-publish-mask{position:fixed;inset:0;z-index:9750;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(2px)}
        .site-publish-modal{width:min(720px,100%);max-height:88vh;display:flex;flex-direction:column;background:var(--bg-panel);color:var(--fg);border-radius:var(--radius-l);box-shadow:var(--shadow-menu);overflow:hidden}
        .site-publish-modal header,.site-publish-modal footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 18px;border-bottom:1px solid var(--hairline)}
        .site-publish-modal header div{display:flex;flex-direction:column;gap:3px}.site-publish-modal header small,.site-publish-note,.site-publish-check small{color:var(--fg-secondary)}
        .site-publish-body{padding:18px;overflow:auto;display:grid;gap:14px}.site-publish-body label{display:grid;gap:6px;font-size:13px}.site-publish-body input,.site-publish-body select,.site-publish-body textarea{width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--hairline-strong);border-radius:var(--radius-s);background:var(--bg-inset);color:var(--fg);font:inherit}
        .site-publish-tabs{display:flex;gap:8px}.site-publish-tabs button{padding:7px 12px;border:1px solid var(--hairline);border-radius:999px;background:var(--bg-inset)}.site-publish-tabs button.active{background:var(--accent);color:#fff}
        .site-publish-check{grid-template-columns:auto 1fr auto!important;align-items:center}.site-publish-check input{width:auto}.site-publish-error{color:#b42318}.site-publish-warning{color:#946200}.site-publish-success{color:#067647}.site-publish-note{margin:0;font-size:12px}
        .site-publish-result{display:grid;gap:12px}.site-publish-preview{max-height:260px;display:flex;justify-content:center;background:repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 50%/16px 16px;border:1px solid var(--hairline);overflow:hidden}.site-publish-preview img{max-width:100%;max-height:260px;object-fit:contain}
        .site-publish-previews,.site-publish-manifest-diff{display:grid;grid-template-columns:1fr 1fr;gap:12px}.site-publish-previews>div{display:grid;gap:6px}.site-publish-previews iframe{width:100%;height:260px;border:1px solid var(--hairline);background:#f4f5f7}.site-publish-manifest-diff pre{max-height:260px;overflow:auto}.site-publish-history{display:grid;gap:6px;padding:10px;border:1px solid var(--hairline);border-radius:var(--radius-s)}.site-publish-history .btn{text-align:left}
        .site-publish-result dl{display:grid;gap:6px;margin:0}.site-publish-result dl div{display:grid;grid-template-columns:110px 1fr;gap:8px}.site-publish-result dt{color:var(--fg-secondary)}.site-publish-result dd{margin:0;overflow-wrap:anywhere}.site-publish-result pre{white-space:pre-wrap;background:var(--bg-inset);padding:10px;border-radius:var(--radius-s)}
        .site-publish-modal footer{justify-content:flex-end;border-top:1px solid var(--hairline);border-bottom:0}
      `}</style>
    </div>
  );
}
