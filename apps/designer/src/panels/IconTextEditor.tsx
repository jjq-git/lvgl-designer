import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface LvglSymbolOption {
  name: string;
  symbol: string;
  keywords: string;
}

export const LVGL_SYMBOLS: readonly LvglSymbolOption[] = [
  { name: '主页', symbol: '\uf015', keywords: 'home 首页' },
  { name: '向左', symbol: '\uf053', keywords: 'left back 返回 上一页' },
  { name: '向右', symbol: '\uf054', keywords: 'right next 下一页 前进' },
  { name: '向上', symbol: '\uf077', keywords: 'up' },
  { name: '向下', symbol: '\uf078', keywords: 'down' },
  { name: '确认', symbol: '\uf00c', keywords: 'ok check good 成功' },
  { name: '关闭', symbol: '\uf00d', keywords: 'close cancel 取消' },
  { name: '播放', symbol: '\uf04b', keywords: 'play start 开始' },
  { name: '暂停', symbol: '\uf04c', keywords: 'pause' },
  { name: '停止', symbol: '\uf04d', keywords: 'stop' },
  { name: '上一个', symbol: '\uf048', keywords: 'previous prev' },
  { name: '下一个', symbol: '\uf051', keywords: 'next' },
  { name: '电源', symbol: '\uf011', keywords: 'power off 开关' },
  { name: '设置', symbol: '\uf013', keywords: 'settings gear' },
  { name: '刷新', symbol: '\uf021', keywords: 'refresh air fan ventilation 循环 空气 风扇' },
  { name: '静音', symbol: '\uf026', keywords: 'mute dnd 勿扰' },
  { name: '中等音量', symbol: '\uf027', keywords: 'volume audio 声音' },
  { name: '高音量', symbol: '\uf028', keywords: 'volume audio 声音 boost' },
  { name: '音频', symbol: '\uf001', keywords: 'audio sound' },
  { name: '视频', symbol: '\uf008', keywords: 'video meeting camera 会议' },
  { name: '查看/专注', symbol: '\uf06e', keywords: 'eye focus view 专注' },
  { name: '电话', symbol: '\uf095', keywords: 'call phone' },
  { name: '照明/闪电', symbol: '\uf0e7', keywords: 'charge light lamp brightness 灯光' },
  { name: '水滴', symbol: '\uf043', keywords: 'tint water humidity 湿度' },
  { name: '无线网络', symbol: '\uf1eb', keywords: 'wifi network online 网络' },
  { name: '蓝牙', symbol: '\uf293', keywords: 'bluetooth' },
  { name: '通知', symbol: '\uf0f3', keywords: 'bell notification 提醒' },
  { name: '列表', symbol: '\uf00b', keywords: 'list menu' },
  { name: '菜单', symbol: '\uf0c9', keywords: 'bars menu' },
  { name: '保存', symbol: '\uf0c7', keywords: 'save' },
  { name: '编辑', symbol: '\uf304', keywords: 'edit pencil' },
  { name: '删除', symbol: '\uf2ed', keywords: 'trash delete' },
  { name: '上传', symbol: '\uf093', keywords: 'upload' },
  { name: '下载', symbol: '\uf019', keywords: 'download' },
  { name: '加号', symbol: '\uf067', keywords: 'plus add 增加' },
  { name: '减号', symbol: '\uf068', keywords: 'minus remove 减少' },
  { name: '警告', symbol: '\uf071', keywords: 'warning alert' },
  { name: '循环', symbol: '\uf079', keywords: 'loop repeat' },
];

const SYMBOL_PREVIEWS: Readonly<Record<string, string>> = {
  主页: '⌂', 向左: '←', 向右: '→', 向上: '↑', 向下: '↓', 确认: '✓', 关闭: '×',
  播放: '▶', 暂停: 'Ⅱ', 停止: '■', 上一个: '◀|', 下一个: '|▶', 电源: '⏻', 设置: '⚙',
  刷新: '↻', 静音: '🔇', 中等音量: '🔉', 高音量: '🔊', 音频: '♪', 视频: '▣',
  '查看/专注': '◉', 电话: '☎', '照明/闪电': 'ϟ', 水滴: '◇', 无线网络: ')))',
  蓝牙: 'ᛒ', 通知: '♢', 列表: '≡', 菜单: '☰', 保存: '▣', 编辑: '✎', 删除: '⌫',
  上传: '⇧', 下载: '⇩', 加号: '+', 减号: '−', 警告: '!', 循环: '↻',
};

function symbolToken(option: LvglSymbolOption): string {
  return `[图标:${option.name}]`;
}

export function formatLvglSymbolText(value: string): string {
  return LVGL_SYMBOLS.reduce(
    (text, option) => text.replaceAll(option.symbol, symbolToken(option)),
    value,
  );
}

export function parseLvglSymbolText(value: string): string {
  return LVGL_SYMBOLS.reduce(
    (text, option) => text.replaceAll(symbolToken(option), option.symbol),
    value,
  );
}

export function applyLvglSymbol(
  value: string,
  symbol: string,
  mode: 'insert' | 'replace',
  start = value.length,
  end = start,
): string {
  if (mode === 'replace') return symbol;
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  return `${value.slice(0, from)}${symbol}${value.slice(to)}`;
}

export function filterLvglSymbols(query: string): readonly LvglSymbolOption[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === '') return LVGL_SYMBOLS;
  return LVGL_SYMBOLS.filter((option) =>
    `${option.name} ${option.keywords}`.toLowerCase().includes(normalized));
}

interface PickerPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export function isScrollInsideIconPicker(
  popup: Pick<Node, 'contains'> | null,
  target: EventTarget | null,
): boolean {
  return target !== null && popup?.contains(target as Node) === true;
}

export function IconTextEditor(props: {
  ariaLabel?: string;
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'insert' | 'replace'>('insert');
  const [position, setPosition] = useState<PickerPosition>({ left: 0, top: 0, width: 320, maxHeight: 360 });
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formattedValue = formatLvglSymbolText(props.value);
  const textRef = useRef(formattedValue);
  const selectionRef = useRef({ start: formattedValue.length, end: formattedValue.length });
  const options = useMemo(() => filterLvglSymbols(query), [query]);

  const current = draft ?? formattedValue;
  textRef.current = current;

  const updatePickerPosition = useCallback((): void => {
    const root = rootRef.current;
    const popup = popupRef.current;
    if (!root || !popup) return;
    const trigger = root.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const maxHeight = Math.min(360, window.innerHeight - margin * 2);
    const height = Math.min(popup.scrollHeight, maxHeight);
    const below = trigger.bottom + gap + height <= window.innerHeight - margin;
    const top = below ? trigger.bottom + gap : Math.max(margin, trigger.top - gap - height);
    const width = Math.min(340, window.innerWidth - margin * 2);
    const left = Math.max(margin, Math.min(trigger.right - width, window.innerWidth - width - margin));
    setPosition({ left, top, width, maxHeight });
  }, []);

  const rememberSelection = (): void => {
    const input = inputRef.current;
    if (!input) return;
    selectionRef.current = {
      start: input.selectionStart ?? input.value.length,
      end: input.selectionEnd ?? input.value.length,
    };
  };
  const commit = (): void => {
    if (draft === null) return;
    props.onCommit(parseLvglSymbolText(draft));
    setDraft(null);
  };
  const openPicker = (): void => {
    rememberSelection();
    const trimmed = textRef.current.trim();
    setMode(LVGL_SYMBOLS.some((option) => trimmed === symbolToken(option)) ? 'replace' : 'insert');
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(340, window.innerWidth - 16);
      setPosition({
        left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        top: rect.bottom + 4,
        width,
        maxHeight: 360,
      });
    }
    setOpen((value) => !value);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    let animationFrame = 0;
    const schedulePositionUpdate = (): void => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(updatePickerPosition);
    };
    const onScroll = (event: Event): void => {
      if (isScrollInsideIconPicker(popupRef.current, event.target)) return;
      schedulePositionUpdate();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', schedulePositionUpdate);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', schedulePositionUpdate);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, updatePickerPosition]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePickerPosition();
  }, [open, options.length, updatePickerPosition]);

  const choose = (symbol: string): void => {
    const { start, end } = selectionRef.current;
    const option = LVGL_SYMBOLS.find((item) => item.symbol === symbol)!;
    const next = applyLvglSymbol(textRef.current, symbolToken(option), mode, start, end);
    props.onCommit(parseLvglSymbolText(next));
    setDraft(null);
    setOpen(false);
  };

  const currentSymbols = LVGL_SYMBOLS.filter((option) =>
    props.value.includes(option.symbol) || current.includes(symbolToken(option)));
  return (
    <div className="icon-text-editor" ref={rootRef}>
      <input
        ref={inputRef}
        aria-label={props.ariaLabel}
        className="ed-text"
        placeholder={props.placeholder}
        value={current}
        onChange={(event) => {
          setDraft(event.target.value);
          textRef.current = event.target.value;
        }}
        onSelect={rememberSelection}
        onClick={rememberSelection}
        onKeyUp={rememberSelection}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
      <button
        type="button"
        className="icon-text-picker-btn"
        aria-label="选择 LVGL 图标"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={currentSymbols.length > 0
          ? `已使用：${currentSymbols.map((option) => option.name).join('、')}`
          : '选择 LVGL 内置图标'}
        onMouseDown={(event) => event.preventDefault()}
        onClick={openPicker}
      >
        {currentSymbols[0] ? SYMBOL_PREVIEWS[currentSymbols[0].name] : '图标'}
      </button>
      {open && createPortal(
        <div ref={popupRef} className="lvgl-symbol-pop" role="dialog" aria-label="LVGL 图标选择器" style={position}>
          <div className="lvgl-symbol-head">
            <strong>LVGL 内置图标</strong>
            <span>保存为文本字形，导出固件可直接使用</span>
          </div>
          <input
            className="ed-text lvgl-symbol-search"
            aria-label="搜索 LVGL 图标"
            value={query}
            placeholder="搜索：主页、箭头、播放、设置…"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="lvgl-symbol-mode" role="group" aria-label="图标插入方式">
            <button type="button" className={mode === 'insert' ? 'active' : ''} onClick={() => setMode('insert')}>插入到光标</button>
            <button type="button" className={mode === 'replace' ? 'active' : ''} onClick={() => setMode('replace')}>仅使用图标</button>
          </div>
          <div className="lvgl-symbol-grid" role="listbox" aria-label="可用的 LVGL 图标">
            {options.map((option) => (
              <button
                key={option.name}
                type="button"
                role="option"
                aria-selected={false}
                aria-label={`${mode === 'replace' ? '仅使用' : '插入'}图标 ${option.name}`}
                title={`${option.name} · U+${option.symbol.codePointAt(0)!.toString(16).toUpperCase()}`}
                onClick={() => choose(option.symbol)}
              >
                <span className="lvgl-symbol-glyph">{SYMBOL_PREVIEWS[option.name] ?? '◻'}</span>
                <span>{option.name}</span>
              </button>
            ))}
            {options.length === 0 && <div className="lvgl-symbol-empty">没有匹配的图标</div>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
