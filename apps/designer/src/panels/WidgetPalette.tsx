/**
 * WidgetPalette — 「大卡片 · 可视化缩影」(2026-07-04 用户选定):
 * 每项 = 上方一张该控件的真机近似缩影(WidgetThumb,纯 CSS)+ 下方中文名,像积木一眼可辨、直接拖拽。
 * 保留:搜索(中文/英文type/拼音别名)+ 最近使用 + 分类折叠(localStorage 记忆)。
 * e2e 契约保持:每项 .palette-item + data-widget;拖拽仍走 startPaletteDrag。
 */
import { useMemo, useState } from 'react';
import { paletteEntries } from '@lvd/schema';
import { componentType, type ComponentDefV2 } from '@lvd/schema/v2';
import { startPaletteDrag } from '../canvas/PointerDnd';
import { useProjectStore } from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';
import {
  componentUseCount,
  deleteUnusedComponent,
  renameComponent,
  updateComponentFromNode,
} from '../services/components';
import { WidgetThumb } from './WidgetThumb';
import './WidgetThumbs.css';

const CATEGORY_LABELS: Record<string, string> = {
  basic: '基础',
  input: '输入',
  display: '显示',
  container: '容器',
  chart: '图表',
  media: '多媒体',
};

/** 搜索别名:全拼 + 常用英文;命中 label / type / 别名 任一即显示 */
const SEARCH_ALIASES: Record<string, string> = {
  label: 'biaoqian text', button: 'anniu btn', spangroup: 'fuwenben span rich', line: 'zhexian',
  arclabel: 'huxingwenben arc text', slider: 'huatiao', switch: 'kaiguan sw', checkbox: 'fuxuankuang check',
  arc: 'huxing', dropdown: 'xialakuang select', roller: 'gunlun', textarea: 'wenbenkuang input',
  spinbox: 'shuzikuang number', buttonmatrix: 'anniujuzhen matrix', keyboard: 'jianpan kb',
  imagebutton: 'tupiananniu imgbtn', bar: 'jindutiao progress', image: 'tupian img', qrcode: 'erweima qr',
  scale: 'keduchi ruler', calendar: 'rili', table: 'biaoge', led: 'led deng', spinner: 'jiazaiquan loading',
  obj: 'mianban panel rongqi', tabview: 'biaoqianye tab', tileview: 'pingpu tile', win: 'chuangkou window',
  menu: 'caidan', msgbox: 'xiaoxikuang dialog', list: 'liebiao', chart: 'tubiao', animimage: 'donghua anim gif',
  canvas: 'huabu', lottie: 'lottie donghua',
};

const RECENT_KEY = 'lvd.palette.recent';
const COLLAPSED_KEY = 'lvd.palette.collapsed';
const RECENT_MAX = 6;

function loadJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
}

const groups = paletteEntries();
const byType = new Map(groups.flatMap((g) => g.widgets.map((w) => [w.type, w] as const)));

export function WidgetPalette(): JSX.Element {
  const project = useProjectStore((state) => state.uiProject);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>(() => loadJson(RECENT_KEY, []));
  const [collapsed, setCollapsed] = useState<string[]>(() => loadJson(COLLAPSED_KEY, []));

  const q = query.trim().toLowerCase();
  const match = (type: string, label: string): boolean =>
    q === '' || label.toLowerCase().includes(q) || type.includes(q)
    || (SEARCH_ALIASES[type] ?? '').includes(q);

  const toggleCat = (cat: string): void => {
    const next = collapsed.includes(cat) ? collapsed.filter((c) => c !== cat) : [...collapsed, cat];
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
  };

  const onDrag = (e: React.PointerEvent, type: string): void => {
    const next = [type, ...recent.filter((t) => t !== type)].slice(0, RECENT_MAX);
    setRecent(next);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    startPaletteDrag(e.nativeEvent, type);
  };

  const recentWidgets = useMemo(
    () => recent.map((t) => byType.get(t)).filter((w) => w && match(w.type, w.palette!.label)),
    [recent, q],
  );
  const visibleComponents = project.components.filter((component) => {
    const text = `${component.displayName ?? ''} ${component.codeName} ${component.root.type}`.toLowerCase();
    return q === '' || text.includes(q);
  });

  return (
    <div className="palette">
      <div className="palette-search">
        <span className="palette-search-icon">🔍</span>
        <input
          value={query}
          placeholder="搜索控件…(拼音/英文均可)"
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜索控件"
        />
        {query !== '' && (
          <button className="palette-search-clear" onClick={() => setQuery('')} aria-label="清空">×</button>
        )}
      </div>

      {q === '' && recentWidgets.length > 0 && (
        <div className="palette-group">
          <div className="palette-cat" onClick={() => toggleCat('__recent')}>
            <span className="palette-arrow">{collapsed.includes('__recent') ? '▶' : '▼'}</span>
            最近使用
          </div>
          {!collapsed.includes('__recent') && (
            <div className="palette-rows">
              {recentWidgets.map((w) => <PaletteCard key={`r-${w!.type}`} w={w!} onDrag={onDrag} />)}
            </div>
          )}
        </div>
      )}

      {visibleComponents.length > 0 && (
        <div className="palette-group">
          <div className="palette-cat" onClick={() => toggleCat('__components')}>
            <span className="palette-arrow">{collapsed.includes('__components') ? '▶' : '▼'}</span>
            可复用组件
            <span className="palette-count">{visibleComponents.length}</span>
          </div>
          {(q !== '' || !collapsed.includes('__components')) && (
            <div className="palette-rows">
              {visibleComponents.map((component) => (
                <ComponentCard key={component.id} component={component} onDrag={onDrag} />
              ))}
            </div>
          )}
        </div>
      )}

      {groups.map(({ category, widgets }) => {
        const visible = widgets.filter((w) => match(w.type, w.palette!.label));
        if (visible.length === 0) return null;
        const isCollapsed = q === '' && collapsed.includes(category); // 搜索时强制展开
        return (
          <div key={category} className="palette-group">
            <div className="palette-cat" onClick={() => toggleCat(category)}>
              <span className="palette-arrow">{isCollapsed ? '▶' : '▼'}</span>
              {CATEGORY_LABELS[category] ?? category}
              <span className="palette-count">{visible.length}</span>
            </div>
            {!isCollapsed && (
              <div className="palette-rows">
                {visible.map((w) => <PaletteCard key={w.type} w={w} onDrag={onDrag} />)}
              </div>
            )}
          </div>
        );
      })}

      {q !== '' && visibleComponents.length === 0
        && groups.every(({ widgets }) => widgets.every((w) => !match(w.type, w.palette!.label))) && (
        <div className="palette-empty">没有匹配「{query}」的控件</div>
      )}
    </div>
  );
}

function ComponentCard({ component, onDrag }: {
  component: ComponentDefV2;
  onDrag: (e: React.PointerEvent, type: string) => void;
}): JSX.Element {
  const type = componentType(component.id);
  const useCount = useProjectStore((state) => componentUseCount(state.uiProject, component.id));
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : undefined;
  return (
    <div
      className="palette-item palette-component"
      data-widget={type}
      title={`${component.displayName ?? component.codeName}（关联实例，定义修改后同步）`}
      onPointerDown={(event) => onDrag(event, type)}
    >
      <WidgetThumb type={component.root.type} />
      <span className="palette-label">{component.displayName ?? component.codeName}</span>
      <div className="palette-component-actions">
        <button
          title="重命名"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            const name = window.prompt('可复用组件名称', component.displayName ?? component.codeName);
            if (name !== null) renameComponent(component.id, name);
          }}
        >✎</button>
        <button
          title={selectedId ? '用当前选中对象更新组件定义' : '先在对象树或画布中选择一个对象'}
          disabled={!selectedId}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (!selectedId || updateComponentFromNode(component.id, selectedId)) return;
            useEditorStore.getState().setBanner('无法用当前选择更新组件定义');
          }}
        >↻</button>
        <button
          title={useCount > 0 ? `已有 ${useCount} 个实例，需先删除或解除关联` : '删除组件定义'}
          disabled={useCount > 0}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            deleteUnusedComponent(component.id);
          }}
        >×</button>
      </div>
    </div>
  );
}

/** 大卡片:上方控件缩影 + 下方中文名。保留 .palette-item + data-widget(e2e/拖拽契约)。 */
function PaletteCard({ w, onDrag }: {
  w: NonNullable<ReturnType<typeof paletteEntries>[number]['widgets'][number]>;
  onDrag: (e: React.PointerEvent, type: string) => void;
}): JSX.Element {
  return (
    <div
      className="palette-item"
      data-widget={w.type}
      title={`${w.palette!.label}(${w.xmlTag}) — 拖到画布`}
      onPointerDown={(e) => onDrag(e, w.type)}
    >
      <WidgetThumb type={w.type} />
      <span className="palette-label">{w.palette!.label}</span>
    </div>
  );
}
