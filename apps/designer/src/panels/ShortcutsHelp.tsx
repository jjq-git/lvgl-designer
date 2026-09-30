/**
 * ShortcutsHelp — 快捷键帮助浮层(轻量模态)。
 * 入口:工具条「?」按钮 / F1 / Shift+? 切换;Esc 或点遮罩关闭。
 * 复用现有 CSS 变量(--bg-panel / --hairline / --shadow-menu 等),不引外部依赖。
 */
import { useDialogFocus } from './useDialogFocus';

interface Row {
  keys: string[];
  desc: string;
}

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: '编辑',
    rows: [
      { keys: ['Ctrl', 'Z'], desc: '撤销' },
      { keys: ['Ctrl', 'Y'], desc: '重做(或 Ctrl+Shift+Z)' },
      { keys: ['Ctrl', 'C'], desc: '复制选中控件' },
      { keys: ['Ctrl', 'V'], desc: '粘贴(偏移 +10,可跨屏)' },
      { keys: ['Ctrl', 'D'], desc: '就地复刻选中控件' },
      { keys: ['Del'], desc: '删除选中控件' },
      { keys: ['方向键'], desc: '微移选中控件' },
      { keys: ['Shift', '方向键'], desc: '移动选中控件 10 像素' },
      { keys: ['Ctrl/⌘', '方向键'], desc: '调整单个选中控件的宽高' },
    ],
  },
  {
    title: '对象树',
    rows: [
      { keys: ['←/→'], desc: '收起 / 展开节点' },
      { keys: ['Alt', '↑/↓'], desc: '同级重排节点' },
      { keys: ['Shift', 'F10'], desc: '打开节点操作菜单' },
    ],
  },
  {
    title: '画布',
    rows: [
      { keys: ['空格', '拖动'], desc: '平移画布' },
      { keys: ['Ctrl', '滚轮'], desc: '缩放画布' },
      { keys: ['Shift', '点选'], desc: '多选 / 切换选中' },
    ],
  },
  {
    title: '通用',
    rows: [
      { keys: ['Esc'], desc: '关闭弹层 / 菜单' },
      { keys: ['F1'], desc: '打开 / 关闭本帮助' },
      { keys: ['Shift', '?'], desc: '打开 / 关闭本帮助' },
    ],
  },
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }): JSX.Element {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);

  return (
    <div className="help-mask" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-label="快捷键帮助"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-head">
          <span>快捷键</span>
          <button className="icon-btn" title="关闭" onClick={onClose}>✕</button>
        </div>
        <div className="help-body">
          {SECTIONS.map((sec) => (
            <div className="help-section" key={sec.title}>
              <div className="help-section-title">{sec.title}</div>
              {sec.rows.map((r) => (
                <div className="help-row" key={`${r.keys.join('+')}:${r.desc}`}>
                  <span className="help-keys">
                    {r.keys.map((k, i) => (
                      <span key={i}>
                        {i > 0 && <span className="help-plus">+</span>}
                        <kbd className="help-kbd">{k}</kbd>
                      </span>
                    ))}
                  </span>
                  <span className="help-desc">{r.desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .help-mask {
          position: fixed; inset: 0; z-index: 9700;
          background: rgba(0, 0, 0, 0.28);
          -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
          display: flex; align-items: center; justify-content: center; padding: 24px;
        }
        .help-modal {
          width: min(460px, 100%); max-height: min(82vh, 640px);
          display: flex; flex-direction: column;
          background: var(--bg-panel); color: var(--fg);
          border-radius: var(--radius-l); box-shadow: var(--shadow-menu); overflow: hidden;
        }
        .help-head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 18px; border-bottom: 1px solid var(--hairline);
          font-weight: 600; font-size: 15px;
        }
        .help-body { padding: 8px 18px 18px; overflow: auto; }
        .help-section { margin-top: 12px; }
        .help-section-title {
          font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase;
          color: var(--fg-secondary); margin-bottom: 6px;
        }
        .help-row {
          display: flex; align-items: center; gap: 12px;
          padding: 5px 0; font-size: 13px;
        }
        .help-keys { flex: 0 0 150px; display: inline-flex; align-items: center; flex-wrap: wrap; gap: 2px; }
        .help-plus { color: var(--fg-hint); margin: 0 3px; }
        .help-kbd {
          display: inline-block; min-width: 18px; text-align: center;
          padding: 2px 7px; font-size: 11px; font-family: inherit;
          background: var(--bg-inset); border: 1px solid var(--hairline-strong);
          border-radius: var(--radius-s); box-shadow: var(--shadow-1);
          color: var(--fg);
        }
        .help-desc { color: var(--fg); }
      `}</style>
    </div>
  );
}
