/**
 * AiSettings — AI 面板设置弹层。
 * - API Key(password 输入,只写 localStorage['lvd.ds.key'],不上传、不进代码;
 *   已保存时不回显明文,只显示占位提示)
 * - 温度滑条(0~2,持久化)
 * - 测试连接:经任务 B 的 deepseekClient.chatComplete 发一条最小请求,报 通/不通
 */
import { useState } from 'react';
import { useAiStore } from '../../stores/aiStore';
// 任务 B 契约(集成阶段就位;类型对不上集成阶段修)
import { chatComplete } from '../../services/ai/deepseekClient';
import { useDialogFocus } from '../useDialogFocus';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok' }
  | { kind: 'fail'; message: string };

export function AiSettings(): JSX.Element | null {
  const open = useAiStore((s) => s.settingsOpen);
  if (!open) return null;
  return <AiSettingsDialog />;
}

function AiSettingsDialog(): JSX.Element {
  const hasKey = useAiStore((s) => s.hasKey);
  const temperature = useAiStore((s) => s.temperature);
  const model = useAiStore((s) => s.model);
  const [keyDraft, setKeyDraft] = useState('');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  const close = (): void => useAiStore.getState().setSettingsOpen(false);
  const dialogRef = useDialogFocus<HTMLDivElement>(close, test.kind !== 'testing');

  const saveKey = (): void => {
    const k = keyDraft.trim();
    if (k === '') return;
    useAiStore.getState().setKey(k);
    setKeyDraft('');
    setTest({ kind: 'idle' });
  };

  const clearKey = (): void => {
    useAiStore.getState().clearKey();
    setKeyDraft('');
    setTest({ kind: 'idle' });
  };

  const runTest = async (): Promise<void> => {
    // 输入框有未保存的新 Key → 先落 localStorage 再测(测试即保存)
    if (keyDraft.trim() !== '') saveKey();
    setTest({ kind: 'testing' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      // 最小请求:1 条短消息,温度 0;通 = 鉴权/代理/网络全链路 OK
      await chatComplete({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'ping' }],
        temperature: 0,
        signal: ctrl.signal,
      });
      setTest({ kind: 'ok' });
    } catch (e) {
      const err = e as { name?: string; message?: string };
      setTest({
        kind: 'fail',
        message: ctrl.signal.aborted ? '超时(15s)' : err?.message || String(e),
      });
    } finally {
      clearTimeout(timer);
    }
  };

  return (
    <div className="ai-modal-mask" onClick={test.kind !== 'testing' ? close : undefined} role="presentation">
      <div
        ref={dialogRef}
        className="ai-modal"
        role="dialog"
        aria-modal="true"
        aria-label="AI 设置"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ai-modal-head">
          <span>AI 设置</span>
          <button className="icon-btn" title="关闭" onClick={close}>
            ✕
          </button>
        </div>

        <div className="ai-form">
          <div className="ai-form-row">
            <label>API Key</label>
            <input
              aria-label="DeepSeek API Key"
              className="ed-text"
              type="password"
              name="deepseek-api-key"
              autoComplete="new-password"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              placeholder={hasKey ? '已保存(输入新 Key 可替换)' : 'sk-…'}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveKey()}
            />
            <button className="btn" disabled={keyDraft.trim() === ''} onClick={saveKey}>
              保存
            </button>
            {hasKey && (
              <button className="btn ai-danger-btn" title="删除本机保存的 Key" onClick={clearKey}>
                清除
              </button>
            )}
          </div>
          <div className="ai-note">
            个人 Key 仅存本机浏览器(localStorage),不进工程文件；未填写时使用服务器预置 Key。
            请求统一经服务器代理转发到 DeepSeek。
          </div>

          <div className="ai-form-row">
            <label>温度</label>
            <input
              aria-label="温度"
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(e) => useAiStore.getState().setTemperature(Number(e.target.value))}
            />
            <span className="ai-temp-val">{temperature.toFixed(1)}</span>
          </div>
          <div className="ai-note">低 = 稳定听话,高 = 发散有创意;画 UI 建议 1.0 以下。</div>

          <div className="ai-form-row">
            <label>连接</label>
            <button className="btn" disabled={test.kind === 'testing'} onClick={() => void runTest()}>
              {test.kind === 'testing' ? '测试中…' : '测试连接'}
            </button>
            {test.kind === 'ok' && <span className="ai-test-ok">✓ 连接正常</span>}
            {test.kind === 'fail' && <span className="ai-test-fail">✗ {test.message}</span>}
          </div>
          <div className="ai-note">
            当前对话模型:{model}(测试固定用 deepseek-chat；优先测试个人 Key，否则测试服务器 Key)
          </div>
        </div>
      </div>
    </div>
  );
}
