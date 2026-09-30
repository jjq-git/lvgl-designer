/**
 * AiPanel — 「AI 画 UI」聊天面板(右下浮动,可收起)。
 * - 消息列表:用户/助手气泡;助手消息底部小字 "已应用 N 个操作 · 可 Ctrl+Z 撤销" 或错误
 * - 输入:Enter 发送 / Shift+Enter 换行;busy 时显示停止按钮(AbortController)
 * - 顶部:模型切换 + 设置齿轮 + 清空对话 + 收起
 * - 空态:3 个示例 prompt
 * 模型交互全部走任务 B 契约:services/ai/aiSession.runAiTurn(校验+自动修复回路在 B 内)。
 * 本组件只负责:收集上下文 → runAiTurn → recipe 经 projectStore.mutateV2 落库(一条可 undo 历史)。
 */
import { useEffect, useRef, useState } from 'react';
import type { WidgetNode } from '@lvd/schema';
import type { UiProject } from '@lvd/schema/v2';
import { findNodeById, useProjectStore } from '../../stores/projectStore';
import { useEditorStore } from '../../stores/editorStore';
import { useAiStore, type AiMessage, type AiModel } from '../../stores/aiStore';
// 任务 B 契约(集成阶段就位;签名对不上时在集成阶段修)
import { runAiTurn } from '../../services/ai/aiSession';
import { AiSettings } from './AiSettings';
import './ai-panel.css';

/** runAiTurn 期望返回形态(与任务 B 对齐的最小面) */
interface AiTurnResult {
  reply: string;
  /** 校验通过的编辑配方;null/undefined = 本轮纯问答不动画布 */
  recipe?: ((draft: UiProject) => void) | null;
  /** 历史标签摘要,如 "新建圆屏时钟" */
  summary?: string;
  /** 成功进入 recipe 的操作数 */
  opsApplied?: number;
  /** 自动修复回路(≤2 轮)后仍未通过的错误 */
  errors?: { message: string }[];
}

const EXAMPLE_PROMPTS = [
  '画一个圆屏时钟界面',
  '把选中按钮改成红色圆角',
  '加一个亮度滑条和标签',
] as const;

const MODEL_LABELS: Record<AiModel, string> = {
  'deepseek-chat': 'deepseek-chat(V3 · 快)',
  'deepseek-reasoner': 'deepseek-reasoner(R1 · 深思)',
};

export function AiPanel(): JSX.Element {
  const panelOpen = useAiStore((s) => s.panelOpen);
  return (
    <>
      {panelOpen ? <AiPanelBody /> : <AiLauncher />}
      <AiSettings />
    </>
  );
}

function AiLauncher(): JSX.Element {
  const setPanelOpen = useAiStore((s) => s.setPanelOpen);
  return (
    <button className="ai-launcher" title="AI 助手(画 UI)" onClick={() => setPanelOpen(true)}>
      AI
    </button>
  );
}

function AiPanelBody(): JSX.Element {
  const messages = useAiStore((s) => s.messages);
  const busy = useAiStore((s) => s.busy);
  const model = useAiStore((s) => s.model);
  const [input, setInput] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  /* 新消息 / 流式增量 → 滚到底 */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  /* 卸载时中断在途请求 */
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const panel = document.querySelector('.ai-panel');
      const target = event.target;
      if (!(target instanceof Node) || !panel?.contains(target)) return;
      event.preventDefault();
      useAiStore.getState().setPanelOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const send = async (raw: string): Promise<void> => {
    const text = raw.trim();
    const ai = useAiStore.getState();
    if (text === '' || ai.busy) return;
    // 本地没填 Key 也照发:代理端可能配了服务端预置 Key(DS_KEY);
    // 两边都没有时 runAiTurn 会抛 AiKeyMissingError,在错误分支里引导去设置。
    setInput('');
    ai.addMessage({ role: 'user', content: text, status: 'ok' });
    const asstId = ai.addMessage({ role: 'assistant', content: '', status: 'pending' });
    ai.setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const project = useProjectStore.getState().project;
      const uiProject = useProjectStore.getState().uiProject;
      const ed = useEditorStore.getState();
      const selId = ed.selectedIds[0];
      const selectedNode: WidgetNode | null = selId
        ? findNodeById(project, selId)?.node ?? null
        : null;
      const history = useAiStore
        .getState()
        .messages.filter((m) => m.status === 'ok' && m.id !== asstId && m.content !== '')
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = (await runAiTurn({
        userText: text,
        history,
        model: ai.model,
        temperature: ai.temperature,
        signal: ctrl.signal,
        project,
        uiProject,
        activeScreenId: ed.activeScreenId,
        selectedNode,
        onDelta: (delta: string) => useAiStore.getState().appendToMessage(asstId, delta),
      })) as AiTurnResult;

      const opsApplied = res.opsApplied ?? 0;
      if (res.recipe && opsApplied > 0) {
        const label = `AI: ${res.summary?.trim() || text.slice(0, 24)}`;
        useProjectStore.getState().mutateV2(label, res.recipe);
      }
      const errText = (res.errors ?? []).map((e) => e.message).join(';');
      useAiStore.getState().updateMessage(asstId, {
        content: res.reply || '(空回复)',
        status: errText ? 'error' : 'ok',
        opsApplied,
        error: errText || undefined,
      });
    } catch (e) {
      const err = e as { name?: string; message?: string };
      if (err?.name === 'AiKeyMissingError') {
        useAiStore.getState().setSettingsOpen(true);
        useAiStore.getState().updateMessage(asstId, {
          status: 'error',
          error: '未配置 API Key,请在设置里填入',
        });
      } else if (ctrl.signal.aborted || err?.name === 'AbortError') {
        useAiStore.getState().updateMessage(asstId, { status: 'error', error: '已停止' });
      } else {
        useAiStore.getState().updateMessage(asstId, {
          status: 'error',
          error: err?.message || String(e),
        });
      }
    } finally {
      abortRef.current = null;
      useAiStore.getState().setBusy(false);
    }
  };

  const stop = (): void => abortRef.current?.abort();

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  return (
    <div className="ai-panel">
      <AiPanelHeader busy={busy} model={model} />
      <div className="ai-msgs" ref={listRef}>
        {messages.length === 0 ? (
          <AiEmptyState onPick={(p) => void send(p)} />
        ) : (
          messages.map((m) => <AiMessageRow key={m.id} msg={m} />)
        )}
      </div>
      <SelectionHint />
      <div className="ai-inputbar">
        <textarea
          aria-label="向 AI 描述界面或修改"
          className="ai-input"
          rows={2}
          placeholder="描述你要的界面/修改…(Enter 发送,Shift+Enter 换行)"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onInputKey}
        />
        {busy ? (
          <button className="btn ai-stop" onClick={stop} title="中断本轮请求">
            停止
          </button>
        ) : (
          <button
            className="btn primary ai-send"
            disabled={input.trim() === ''}
            onClick={() => void send(input)}
          >
            发送
          </button>
        )}
      </div>
    </div>
  );
}

function AiPanelHeader({ busy, model }: { busy: boolean; model: AiModel }): JSX.Element {
  const st = useAiStore.getState();
  return (
    <div className="ai-head">
      <span className="ai-title">AI 画 UI</span>
      <select
        aria-label="AI 模型"
        className="ed-select ai-model-select"
        value={model}
        disabled={busy}
        onChange={(e) => useAiStore.getState().setModel(e.target.value as AiModel)}
        title="模型切换"
      >
        {(Object.keys(MODEL_LABELS) as AiModel[]).map((m) => (
          <option key={m} value={m}>
            {MODEL_LABELS[m]}
          </option>
        ))}
      </select>
      <span className="ai-head-spacer" />
      <button
        className="icon-btn"
        title="设置(API Key / 温度)"
        onClick={() => useAiStore.getState().setSettingsOpen(true)}
      >
        ⚙
      </button>
      <button
        className="icon-btn"
        title="清空对话"
        disabled={busy}
        onClick={() => useAiStore.getState().clearMessages()}
      >
        🗑
      </button>
      <button className="icon-btn" title="收起" onClick={() => st.setPanelOpen(false)}>
        ─
      </button>
    </div>
  );
}

function AiEmptyState({ onPick }: { onPick: (prompt: string) => void }): JSX.Element {
  const hasKey = useAiStore((s) => s.hasKey);
  return (
    <div className="ai-empty">
      <div className="ai-empty-title">用一句话描述界面,AI 直接画到画布上</div>
      {!hasKey && (
        <div className="ai-empty-nokey">
          本地未填 Key,将使用服务器预置 Key(若有);也可点右上 ⚙ 自填
        </div>
      )}
      {EXAMPLE_PROMPTS.map((p) => (
        <button key={p} className="ai-example-btn" onClick={() => onPick(p)}>
          {p}
        </button>
      ))}
    </div>
  );
}

function AiMessageRow({ msg }: { msg: AiMessage }): JSX.Element {
  const isUser = msg.role === 'user';
  return (
    <div className={`ai-msg ${isUser ? 'user' : 'assistant'}`}>
      <div className={`ai-bubble ${msg.status === 'pending' ? 'pending' : ''}`}>
        {msg.content !== '' ? msg.content : msg.status === 'pending' ? '思考中…' : ''}
      </div>
      {!isUser && msg.status === 'error' && (
        <div className="ai-meta error">{msg.error || '请求失败'}</div>
      )}
      {!isUser && msg.status === 'ok' && (msg.opsApplied ?? 0) > 0 && (
        <div className="ai-meta">已应用 {msg.opsApplied} 个操作 · 可 Ctrl+Z 撤销</div>
      )}
    </div>
  );
}

/** 输入框上方一行:当前选中节点上下文提示(模型据此理解"选中的按钮") */
function SelectionHint(): JSX.Element | null {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const project = useProjectStore((s) => s.project);
  const selId = selectedIds[0];
  if (!selId) return null;
  const hit = findNodeById(project, selId);
  if (!hit) return null;
  const label = hit.node.name ?? hit.node.displayName ?? hit.node.type;
  return (
    <div className="ai-ctx" title="AI 会带上该选中节点作为上下文">
      上下文:已选中 <b>{label}</b>({hit.node.type})
    </div>
  );
}
