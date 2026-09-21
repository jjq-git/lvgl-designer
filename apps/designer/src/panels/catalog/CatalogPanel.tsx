import { useEffect, useMemo, useState } from 'react';
import type { BuildTarget, ThemeRevision } from '@lvd/schema/v2';
import {
  listBuilds,
  listCatalog,
  publishCatalogDocument,
  queueBuild,
  resolveBuildTargetProfiles,
  transitionBuild,
  type CatalogDocument,
  type CatalogRecord,
  type PlatformBuild,
} from '../../services/catalog';
import { hasPermission, useAuthStore } from '../../stores/authStore';
import { useBuildTargetStore } from '../../stores/buildTargetStore';
import { useEditorStore } from '../../stores/editorStore';
import './catalog.css';

type EditorKind = CatalogDocument['kind'];

const KIND_LABELS: Record<EditorKind, string> = {
  'display-profile': 'Display Profile',
  'controller-profile': 'Controller Profile',
  'input-profile': 'Input Profile',
  'firmware-profile': 'Firmware Profile',
  'lvgl-theme': 'Theme',
  'lvgl-build-target': 'BuildTarget',
};

function currentDraft(kind: EditorKind): CatalogDocument {
  const state = useBuildTargetStore.getState();
  if (kind === 'display-profile') return state.displayProfile;
  if (kind === 'controller-profile' && state.controllerProfile) return state.controllerProfile;
  if (kind === 'lvgl-build-target') return {
    ...state.buildTargetDraft,
    controllerProfileRef: state.buildTargetDraft.controllerProfileRef
      ?? 'controller:replace-me@1',
  } as BuildTarget;
  if (kind === 'lvgl-theme') {
    const source = state.uiProject.themes[0];
    return {
      schemaVersion: 1,
      kind: 'lvgl-theme',
      id: 'theme:default',
      revision: 1,
      displayName: source?.displayName ?? 'Default Theme',
      tokens: source?.tokens ?? [],
    } satisfies ThemeRevision;
  }
  if (kind === 'input-profile') return {
    schemaVersion: 1, kind, id: 'input:new-input', revision: 1,
    displayName: 'New Input', rawSize: { width: 4096, height: 4096 },
  };
  if (kind === 'firmware-profile') return {
    schemaVersion: 1, kind, id: 'firmware:new-target', revision: 1,
    displayName: 'New Firmware Target', target: 'esp32s3', uiAbiVersion: '1.0.0',
    capabilityRevision: 1, supportedWidgets: [], supportedSubjects: [], supportedActions: [],
  };
  return {
    schemaVersion: 1, kind: 'controller-profile', id: 'controller:new-controller', revision: 1,
    model: 'NEW-CONTROLLER', displayName: 'New Controller',
    displayRef: `${state.displayProfile.id}@${state.displayProfile.revision}` as `display:${string}@${number}`,
    frame: {
      assetRef: 'asset:controller/frame.svg@sha256:12345678',
      viewBox: { x: 0, y: 0, width: 1, height: 1 },
      screenViewport: { x: 0, y: 0, width: 1, height: 1, rotation: 0 },
    },
  };
}

function formatJson(doc: CatalogDocument): string {
  return JSON.stringify(doc, null, 2);
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function CatalogPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const me = useAuthStore((state) => state.me);
  const canManage = hasPermission(me, 'tool.lvgl.profile.manage');
  const canBuild = hasPermission(me, 'tool.lvgl.build');
  const canPublish = hasPermission(me, 'tool.lvgl.publish');
  const [kind, setKind] = useState<EditorKind>('display-profile');
  const [draft, setDraft] = useState(() => formatJson(currentDraft('display-profile')));
  const [records, setRecords] = useState<CatalogRecord[]>([]);
  const [targets, setTargets] = useState<CatalogRecord<BuildTarget>[]>([]);
  const [builds, setBuilds] = useState<PlatformBuild[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = async (): Promise<void> => {
    setBusy(true);
    try {
      const [catalog, buildList] = await Promise.all([listCatalog(), listBuilds()]);
      setRecords([...catalog.profiles, ...catalog.themes]);
      setTargets(catalog.buildTargets);
      setBuilds(buildList);
      setMessage(null);
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const grouped = useMemo(() => {
    const groups = new Map<string, CatalogRecord[]>();
    for (const record of records) {
      const items = groups.get(record.kind) ?? [];
      items.push(record);
      groups.set(record.kind, items);
    }
    return [...groups.entries()];
  }, [records]);

  const resetDraft = (nextKind = kind): void => {
    setKind(nextKind);
    setDraft(formatJson(currentDraft(nextKind)));
    setMessage(null);
  };

  const publish = async (): Promise<void> => {
    if (!canManage) return;
    let doc: CatalogDocument;
    try {
      doc = JSON.parse(draft) as CatalogDocument;
    } catch (error) {
      setMessage({ ok: false, text: `JSON 解析失败: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    if (doc.kind !== kind) {
      setMessage({ ok: false, text: `当前类型是 ${kind}，JSON kind 是 ${String(doc.kind)}` });
      return;
    }
    setBusy(true);
    try {
      const result = await publishCatalogDocument(doc);
      setMessage({ ok: true, text: `已保存 ${result.id}@${result.revision}` });
      await refresh();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const applyTarget = async (record: CatalogRecord<BuildTarget>): Promise<void> => {
    setBusy(true);
    try {
      const resolved = await resolveBuildTargetProfiles(record.doc);
      const issues = useBuildTargetStore.getState().selectCatalogTarget(
        record.doc, resolved.display, resolved.controller, resolved.theme,
      );
      if (issues.length) throw new Error(issues.map((issue) => issue.message).join('; '));
      useEditorStore.getState().setBanner(`已应用 ${record.id}@${record.revision}`);
      setMessage({ ok: true, text: '目标已应用到当前工程预览与导出上下文' });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const startBuild = async (record: CatalogRecord<BuildTarget>): Promise<void> => {
    setBusy(true);
    try {
      const build = await queueBuild(record.doc);
      setMessage({ ok: true, text: `Build ${build.id} 已排队` });
      await refresh();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const changeBuild = async (build: PlatformBuild, action: 'approve' | 'publish' | 'rollback'): Promise<void> => {
    setBusy(true);
    try {
      await transitionBuild(build.id, action);
      setMessage({ ok: true, text: `${build.id}: ${action} 成功` });
      await refresh();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="catalog-mask" onClick={onClose}>
      <div className="catalog-modal" role="dialog" aria-label="目标与构建管理" onClick={(event) => event.stopPropagation()}>
        <div className="catalog-head">
          <div>
            <strong>目标与构建管理</strong>
            <div className="catalog-permissions">
              Profile {canManage ? '可写' : '只读'} · Build {canBuild ? '可创建' : '不可创建'} · 发布 {canPublish ? '可操作' : '只读'}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        {message && <div className={`catalog-message ${message.ok ? 'ok' : 'fail'}`}>{message.text}</div>}
        <div className="catalog-body">
          <section className="catalog-section">
            <div className="catalog-section-title">不可变 Catalog revision</div>
            {grouped.length === 0 && <div className="catalog-empty">{busy ? '加载中…' : '暂无 Profile 或 Theme'}</div>}
            {grouped.map(([group, items]) => (
              <div key={group} className="catalog-group">
                <div className="catalog-group-name">{group}</div>
                {items.map((record) => (
                  <button key={`${record.id}@${record.revision}`} className="catalog-record" onClick={() => {
                    setKind(record.kind as EditorKind);
                    setDraft(formatJson(record.doc));
                  }}>
                    <span>{record.doc.displayName ?? record.id}</span>
                    <code>{record.id}@{record.revision}</code>
                  </button>
                ))}
              </div>
            ))}
          </section>

          <section className="catalog-section catalog-editor">
            <div className="catalog-editor-toolbar">
              <select className="ed-select" value={kind} onChange={(event) => resetDraft(event.target.value as EditorKind)}>
                {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <button className="btn" onClick={() => resetDraft()}>载入当前草稿</button>
              <button className="btn primary" disabled={!canManage || busy} onClick={() => void publish()}>
                发布新 revision
              </button>
            </div>
            <textarea className="catalog-json" spellCheck={false} value={draft} onChange={(event) => setDraft(event.target.value)} />
            {!canManage && <div className="catalog-hint">缺少 tool.lvgl.profile.manage，仅可查看。</div>}
          </section>

          <section className="catalog-section">
            <div className="catalog-section-title">BuildTarget</div>
            {targets.length === 0 && <div className="catalog-empty">暂无 BuildTarget</div>}
            {targets.map((record) => (
              <div className="catalog-target" key={`${record.id}@${record.revision}`}>
                <div><strong>{record.doc.displayName ?? record.id}</strong><code>{record.id}@{record.revision}</code></div>
                <button className="btn btn-sm" disabled={busy} onClick={() => void applyTarget(record)}>应用</button>
                <button className="btn btn-sm primary" disabled={!canBuild || busy} onClick={() => void startBuild(record)}>构建</button>
              </div>
            ))}
          </section>

          <section className="catalog-section">
            <div className="catalog-section-title">最近 Build</div>
            {builds.length === 0 && <div className="catalog-empty">暂无 Build</div>}
            {builds.slice(0, 20).map((build) => (
              <div className="catalog-target" key={build.id}>
                <div><strong>{build.state}</strong><code>{build.id} · {formatTime(build.updatedAt)}</code></div>
                {build.state === 'succeeded' && <button className="btn btn-sm" disabled={!canPublish || busy} onClick={() => void changeBuild(build, 'approve')}>批准</button>}
                {build.state === 'approved' && <button className="btn btn-sm primary" disabled={!canPublish || busy} onClick={() => void changeBuild(build, 'publish')}>发布</button>}
                {build.state === 'published' && <button className="btn btn-sm btn-danger" disabled={!canPublish || busy} onClick={() => void changeBuild(build, 'rollback')}>回滚</button>}
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
