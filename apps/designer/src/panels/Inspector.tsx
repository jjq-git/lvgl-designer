/**
 * Inspector — registry 驱动的属性/样式检查器。
 * - 属性页:布局/内容/值/行为分组(OBJ_BASE + widget 专有)、flags/states 开关组
 * - 内容/子项:ChildSpec 驱动的结构子元素编辑器(chart 系列/tabview 页签/table 单元格/
 *   msgbox·list·win·menu·tileview 子项…),table 走专用网格编辑
 * - imageRef → 素材选择器(缩略图);animimage.srcs → 帧序列多选
 * - 样式页:STYLE_PROPS m1Inspector 子集,state/part 选择器(part 按 widget parts)
 * - 值=default 灰显;改动即 mutate(coalesceKey 800ms 合并);清除=删属性 → 管线自动走 L3 复位
 */
import { useMemo, useState } from 'react';
import {
  M1_INSPECTOR_STYLE_KEYS,
  M1_TEXT_FONTS,
  OBJ_BASE,
  REGISTRY,
  STATE_TOKENS,
  STYLE_PROPS,
  checkCName,
  findChildSpec,
  newUuid,
  type ChildSpec,
  type PropSpec,
  type Selector,
  type StateToken,
  type StylePropType,
  type StylePropSpec,
  type WidgetSpec,
} from '@lvd/schema';
import {
  isTokenRef,
  tokenAssignableTo,
  type LocalStyleGroup,
  type PropValueV2,
  type WidgetNodeV2,
} from '@lvd/schema/v2';
import {
  findNodeByIdV2,
  namesInScreenV2,
  useProjectStore,
} from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';
import { AssetMultiPicker, AssetPicker } from './AssetPicker';

const GROUP_ORDER: { key: PropSpec['ui']['group']; label: string }[] = [
  { key: 'geometry', label: '布局' },
  { key: 'content', label: '内容' },
  { key: 'value', label: '值' },
  { key: 'behavior', label: '行为' },
];

export function Inspector(): JSX.Element {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const project = useProjectStore((s) => s.uiProject);
  const [tab, setTab] = useState<'props' | 'style'>('props');

  if (selectedIds.length === 0) {
    return <div className="inspector empty">未选中对象</div>;
  }
  if (selectedIds.length > 1) {
    return <div className="inspector empty">已选中 {selectedIds.length} 个对象(多选编辑二期)</div>;
  }
  const hit = findNodeByIdV2(project, selectedIds[0]!);
  if (!hit) return <div className="inspector empty">节点不存在</div>;

  return (
    <div className="inspector">
      <div className="tabs">
        <button className={tab === 'props' ? 'active' : ''} onClick={() => setTab('props')}>属性</button>
        <button className={tab === 'style' ? 'active' : ''} onClick={() => setTab('style')}>样式</button>
      </div>
      {tab === 'props' ? <PropsTab node={hit.node} isRoot={hit.node === hit.screen.root} /> : <StyleTab node={hit.node} />}
    </div>
  );
}

/* ================= 属性页 ================= */

function mutateProp(nodeId: string, key: string, value: PropValueV2 | undefined, label: string): void {
  useProjectStore.getState().mutateV2(
    label,
    (draft) => {
      const hit = findNodeByIdV2(draft, nodeId);
      if (!hit) return;
      if (value === undefined) delete hit.node.props[key];
      else hit.node.props[key] = value;
    },
    // 清除(重置默认)不参与合并:set 与 clear 是两条独立历史,否则 undo 语义混乱
    value === undefined ? {} : { coalesceKey: `prop:${nodeId}:${key}` },
  );
}

function PropsTab({ node, isRoot }: { node: WidgetNodeV2; isRoot: boolean }): JSX.Element {
  const spec = REGISTRY.get(node.type);
  const childInfo = useMemo(() => (spec ? undefined : findChildSpec(node.type)), [spec, node.type]);
  const cs = childInfo?.child;

  const allProps = useMemo(() => {
    if (spec) return [...OBJ_BASE.props, ...spec.props];
    if (cs) {
      const own = [...(cs.createProps ?? []), ...cs.props];
      return cs.isObj ? [...own, ...OBJ_BASE.props] : own;
    }
    return [...OBJ_BASE.props];
  }, [spec, cs]);

  const showObjExtras = spec !== undefined || (cs?.isObj ?? false);

  return (
    <div className="insp-body">
      {!isRoot && showObjExtras && <NameRow node={node} />}
      {cs && (
        <div className="insp-note">
          结构子元素 <code>{node.type}</code>(属于 {childInfo!.parent.palette?.label ?? childInfo!.parent.type})
        </div>
      )}
      {GROUP_ORDER.map(({ key, label }) => {
        const props = allProps.filter((p) => p.ui.group === key);
        if (props.length === 0) return null;
        return (
          <section key={key} className="insp-group">
            <div className="panel-subtitle">{label}</div>
            {props.map((p) => (
              <PropRowEditor key={p.key} node={node} spec={p} />
            ))}
          </section>
        );
      })}
      {spec && spec.children && spec.children.length > 0 && <ChildrenSection node={node} spec={spec} />}
      {showObjExtras && <FlagsSection node={node} kind="flags" title="标志 (flags)" keys={OBJ_BASE.flags} />}
      {showObjExtras && <FlagsSection node={node} kind="states" title="状态 (states)" keys={OBJ_BASE.states} />}
    </div>
  );
}

function NameRow({ node }: { node: WidgetNodeV2 }): JSX.Element {
  const [val, setVal] = useState<string | null>(null);
  const commit = (): void => {
    if (val === null) return;
    const name = val.trim();
    setVal(null);
    if (name === (node.codeName ?? '')) return;
    const st = useProjectStore.getState();
    if (name === '') {
      st.mutateV2('清除名称', (draft) => {
        const h = findNodeByIdV2(draft, node.id);
        if (h) delete h.node.codeName;
      });
      return;
    }
    const err = checkCName(name);
    if (err) {
      useEditorStore.getState().setBanner(`名称非法:${err.message}`);
      return;
    }
    st.mutateV2('重命名', (draft) => {
      const h = findNodeByIdV2(draft, node.id);
      if (!h) return;
      const used = namesInScreenV2(h.screen);
      used.delete(node.codeName ?? '');
      if (used.has(name)) {
        return;
      }
      h.node.codeName = name;
    });
  };
  return (
    <div className="prop-row">
      <label>名称</label>
      <input
        className="ed-text"
        placeholder="(匿名)"
        value={val ?? node.codeName ?? ''}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </div>
  );
}

function PropRowEditor({ node, spec }: { node: WidgetNodeV2; spec: PropSpec }): JSX.Element {
  const value = node.props[spec.key];
  const isSet = value !== undefined && value !== null;
  const onChange = (v: PropValueV2 | undefined): void =>
    mutateProp(node.id, spec.key, v, `改 ${spec.ui.label}`);

  return (
    <div className={`prop-row ${isSet ? '' : 'unset'}`}>
      <label title={spec.key}>
        {spec.ui.label}
        {spec.channel === 'c-only' && (
          <span className="badge-conly" title="XML parser 未实现:预览画布不生效,仅进导出 C 代码">仅C</span>
        )}
      </label>
      <ValueEditor
        node={node}
        propKey={spec.key}
        type={spec.type}
        tokens={spec.enum?.tokens}
        min={spec.min}
        max={spec.max}
        value={value}
        defaultValue={spec.default}
        onChange={onChange}
      />
      {isSet && (
        <button className="icon-btn" title="重置为默认" onClick={() => onChange(undefined)}>↺</button>
      )}
    </div>
  );
}

function FlagsSection(props: {
  node: WidgetNodeV2;
  kind: 'flags' | 'states';
  title: string;
  keys: readonly string[];
}): JSX.Element {
  const { node, kind, title, keys } = props;
  const [open, setOpen] = useState(false);
  const bag = (kind === 'flags' ? node.flags : node.states) ?? {};
  const setCount = Object.keys(bag).length;

  const setFlag = (key: string, v: boolean | undefined): void => {
    useProjectStore.getState().mutateV2(
      `改 ${key}`,
      (draft) => {
        const h = findNodeByIdV2(draft, node.id);
        if (!h) return;
        const target = kind === 'flags'
          ? (h.node.flags ??= {})
          : (h.node.states ??= {});
        const rec = target as Record<string, boolean | undefined>;
        if (v === undefined) delete rec[key];
        else rec[key] = v;
      },
      v === undefined ? {} : { coalesceKey: `${kind}:${node.id}:${key}` },
    );
  };

  return (
    <section className="insp-group">
      <div className="panel-subtitle clickable" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {title}{setCount > 0 ? `(已设 ${setCount})` : ''}
      </div>
      {open && (
        <div className="flags-grid">
          {keys.map((k) => {
            const v = (bag as Record<string, boolean | undefined>)[k];
            return (
              <label key={k} className={`flag-item ${v === undefined ? 'unset' : ''}`} title={k}>
                <input
                  type="checkbox"
                  checked={v === true}
                  onChange={(e) => setFlag(k, e.target.checked)}
                />
                <span>{k}</span>
                {v !== undefined && (
                  <button className="icon-btn" title="清除(回默认)" onClick={(e) => {
                    e.preventDefault();
                    setFlag(k, undefined);
                  }}>↺</button>
                )}
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ================= 内容/子项(ChildSpec 驱动) ================= */

const CHILD_LABELS: Record<string, string> = {
  'chart-series': '系列',
  'chart-cursor': '游标',
  'chart-axis': '轴范围',
  'tabview-tab': '页签',
  'table-column': '列宽',
  'table-cell': '单元格',
  'spangroup-span': '文本段',
  'msgbox-button': '底栏按钮',
  'list-text': '列表文本',
  'list-button': '列表按钮',
  'menu-page': '菜单页',
  'win-button': '标题栏按钮',
  'tileview-tile': '平铺页',
  'calendar-header_arrow': '箭头页头',
  'calendar-header_dropdown': '下拉页头',
};

function childLabel(type: string): string {
  return CHILD_LABELS[type] ?? type.split('-').slice(1).join('-');
}

/** 新建结构子元素节点:createProps 预填 default;必填 string 给占位文本 */
function makeChildNode(cs: ChildSpec, ordinal: number): WidgetNodeV2 {
  const props: Record<string, PropValueV2> = {};
  for (const cp of cs.createProps ?? []) {
    if (cp.default !== undefined) props[cp.key] = cp.default;
    else if (!cp.optional) props[cp.key] = cp.type === 'string' ? `${childLabel(cs.type)} ${ordinal}` : 0;
  }
  return {
    id: newUuid(), type: cs.type, props,
    styleRefs: [], styles: [], events: [], bindings: [], children: [],
  };
}

function ChildrenSection({ node, spec }: { node: WidgetNodeV2; spec: WidgetSpec }): JSX.Element {
  const addable = (spec.children ?? []).filter((c) => c.kind !== 'getter');
  const childTypes = new Set((spec.children ?? []).map((c) => c.type));
  const instances = node.children.filter((c) => childTypes.has(c.type));

  const addChild = (cs: ChildSpec): void => {
    const ordinal = node.children.filter((c) => c.type === cs.type).length + 1;
    const child = makeChildNode(cs, ordinal);
    useProjectStore.getState().mutateV2(`添加 ${childLabel(cs.type)}`, (draft) => {
      const h = findNodeByIdV2(draft, node.id);
      if (!h) return;
      h.node.children.push(child);
    });
  };

  const removeChild = (id: string): void => {
    useProjectStore.getState().mutateV2('删除子项', (draft) => {
      const h = findNodeByIdV2(draft, node.id);
      if (!h) return;
      h.node.children = h.node.children.filter((c) => c.id !== id);
    });
  };

  return (
    <section className="insp-group">
      <div className="panel-subtitle">内容/子项</div>
      {node.type === 'table' && <TableGridEditor node={node} />}
      <div className="child-add-row">
        {addable.map((cs) => (
          <button key={cs.type} className="btn btn-sm" data-add-child={cs.type} onClick={() => addChild(cs)}>
            + {childLabel(cs.type)}
          </button>
        ))}
      </div>
      {instances.map((child) => (
        <ChildItem
          key={child.id}
          parent={node}
          child={child}
          cs={(spec.children ?? []).find((c) => c.type === child.type)!}
          onRemove={() => removeChild(child.id)}
        />
      ))}
      {instances.length === 0 && node.type !== 'table' && (
        <div className="insp-note">尚无子项。{addable.length ? '点上方按钮添加。' : ''}</div>
      )}
    </section>
  );
}

function ChildItem(props: {
  parent: WidgetNodeV2;
  child: WidgetNodeV2;
  cs: ChildSpec;
  onRemove: () => void;
}): JSX.Element {
  const { parent, child, cs, onRemove } = props;
  const [open, setOpen] = useState(true);
  const rows = [...(cs.createProps ?? []), ...cs.props];
  const idx = parent.children.filter((c) => c.type === child.type).indexOf(child);

  const setActiveTab = (): void => {
    // tabview:激活 = tabview.active 序号(按 tab 在兄弟中的次序)
    const tabIdx = parent.children.filter((c) => c.type === 'tabview-tab').indexOf(child);
    mutateProp(parent.id, 'active', tabIdx, '切换激活页签');
  };

  return (
    <div className="child-item" data-child-type={child.type}>
      <div className="child-head">
        <span className="clickable" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} {childLabel(child.type)} #{idx + 1}
        </span>
        {child.type === 'tabview-tab' && (
          <button
            className={`icon-btn ${parent.props['active'] === parent.children.filter((c) => c.type === 'tabview-tab').indexOf(child) ? 'active' : ''}`}
            title="设为当前页"
            onClick={setActiveTab}
          >◉</button>
        )}
        <button className="icon-btn" title="删除" onClick={onRemove}>✕</button>
      </div>
      {open && (
        <div className="child-body">
          {rows.map((p) => (
            <PropRowEditor key={p.key} node={child} spec={p} />
          ))}
          {cs.acceptsWidgetChildren && (
            <div className="insp-note">容器:可从组件面板拖控件进画布上的该区域,或在对象树中查看。</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- table 专用网格编辑 ---------------- */

function TableGridEditor({ node }: { node: WidgetNodeV2 }): JSX.Element {
  const rows = typeof node.props['row_count'] === 'number' ? (node.props['row_count'] as number) : 1;
  const cols = typeof node.props['column_count'] === 'number' ? (node.props['column_count'] as number) : 1;
  const shownRows = Math.min(rows, 16);
  const shownCols = Math.min(cols, 8);

  const cellValue = (r: number, c: number): string => {
    const cell = node.children.find(
      (x) => x.type === 'table-cell' && x.props['row'] === r && x.props['column'] === c,
    );
    const v = cell?.props['value'];
    return typeof v === 'string' ? v : '';
  };

  const setCell = (r: number, c: number, text: string): void => {
    useProjectStore.getState().mutateV2(`表格 (${r},${c})`, (draft) => {
      const h = findNodeByIdV2(draft, node.id);
      if (!h) return;
      const idx = h.node.children.findIndex(
        (x) => x.type === 'table-cell' && x.props['row'] === r && x.props['column'] === c,
      );
      if (text === '') {
        if (idx >= 0) h.node.children.splice(idx, 1);
        return;
      }
      if (idx >= 0) {
        h.node.children[idx]!.props['value'] = text;
      } else {
        h.node.children.push({
          id: newUuid(), type: 'table-cell',
          props: { row: r, column: c, value: text },
          styleRefs: [], styles: [], events: [], bindings: [], children: [],
        });
      }
    });
  };

  return (
    <div className="table-grid" data-table-grid>
      <div className="insp-note">单元格内容(行×列 = 值属性里的 行数×列数;空 = 删该格)</div>
      {Array.from({ length: shownRows }, (_, r) => (
        <div key={r} className="table-grid-row">
          {Array.from({ length: shownCols }, (_, c) => (
            <TableCellInput key={c} r={r} c={c} value={cellValue(r, c)} onCommit={(t) => setCell(r, c, t)} />
          ))}
        </div>
      ))}
      {(rows > shownRows || cols > shownCols) && (
        <div className="insp-note">仅显示前 {shownRows}×{shownCols},更大表格待批量单元格编辑/导入功能。</div>
      )}
    </div>
  );
}

function TableCellInput(props: { r: number; c: number; value: string; onCommit: (t: string) => void }): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    props.onCommit(draft);
    setDraft(null);
  };
  return (
    <input
      className="ed-text table-cell-input"
      data-cell={`${props.r}-${props.c}`}
      placeholder={`${props.r},${props.c}`}
      value={draft ?? props.value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

/* ================= 样式页 ================= */

function normSelector(state: StateToken, part: string): Selector | undefined {
  const states = state !== 'default' ? [state] : undefined;
  const p = part !== 'main' ? (part as Selector['part']) : undefined;
  if (!states && !p) return undefined;
  const sel: Selector = {};
  if (states) sel.states = states;
  if (p) sel.part = p;
  return sel;
}

function sameSelector(a: Selector | undefined, b: Selector | undefined): boolean {
  const sa = (a?.states ?? []).filter((s) => s !== 'default');
  const sb = (b?.states ?? []).filter((s) => s !== 'default');
  const pa = a?.part ?? 'main';
  const pb = b?.part ?? 'main';
  return pa === pb && sa.length === sb.length && sa.every((x) => sb.includes(x));
}

function StyleTab({ node }: { node: WidgetNodeV2 }): JSX.Element {
  const spec = REGISTRY.get(node.type);
  const [state, setState] = useState<StateToken>('default');
  const [part, setPart] = useState<string>('main');
  const parts = spec?.parts ?? ['main'];
  const selector = normSelector(state, part);
  const group: LocalStyleGroup | undefined = node.styles.find((g) => sameSelector(g.selector, selector));

  const setStyleProp = (key: string, v: PropValueV2 | undefined): void => {
    useProjectStore.getState().mutateV2(
      `改样式 ${key}`,
      (draft) => {
        const hit = findNodeByIdV2(draft, node.id);
        if (!hit) return;
        let g = hit.node.styles.find((x) => sameSelector(x.selector, selector));
        if (v === undefined) {
          if (!g) return;
          delete g.props[key];
          if (Object.keys(g.props).length === 0) {
            hit.node.styles = hit.node.styles.filter((x) => x !== g);
          }
          return;
        }
        if (!g) {
          g = (selector ? { selector, props: {} } : { props: {} }) as LocalStyleGroup;
          hit.node.styles.push(g);
        }
        g.props[key] = v;
      },
      v === undefined ? {} : { coalesceKey: `style:${node.id}:${state}:${part}:${key}` },
    );
  };

  return (
    <div className="insp-body">
      <div className="prop-row">
        <label>状态</label>
        <select className="ed-select" value={state} onChange={(e) => setState(e.target.value as StateToken)}>
          {STATE_TOKENS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="prop-row">
        <label>部件</label>
        <select className="ed-select" value={part} onChange={(e) => setPart(e.target.value)}>
          {parts.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="panel-subtitle">内联样式(style_*)</div>
      {M1_INSPECTOR_STYLE_KEYS.map((key) => {
        const sp = STYLE_PROPS[key];
        if (!sp) return null;
        return (
          <StyleRow
            key={key}
            spec={sp}
            value={group?.props[key]}
            onChange={(v) => setStyleProp(key, v)}
          />
        );
      })}
    </div>
  );
}

function StyleRow(props: {
  spec: StylePropSpec;
  value: PropValueV2 | undefined;
  onChange: (v: PropValueV2 | undefined) => void;
}): JSX.Element {
  const { spec, value, onChange } = props;
  const isSet = value !== undefined && value !== null;
  return (
    <div className={`prop-row ${isSet ? '' : 'unset'}`}>
      <label title={`style_${spec.key}`}>{spec.key}</label>
      <ValueEditor
        type={spec.type === 'fontRef' ? 'fontRef' : spec.type}
        tokens={spec.type === 'fontRef' ? M1_TEXT_FONTS : spec.enum?.tokens}
        value={value}
        onChange={onChange}
      />
      {isSet && <button className="icon-btn" title="清除" onClick={() => onChange(undefined)}>↺</button>}
    </div>
  );
}

/* ================= 列表类值的文本互转 ================= */

function intListToText(v: PropValueV2 | undefined): string {
  return Array.isArray(v) ? v.map(String).join(' ') : '';
}

function textToIntList(t: string): number[] | undefined {
  const nums = t.split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
  return nums.length ? nums.map((n) => Math.round(n)) : undefined;
}

function pointListToText(v: PropValueV2 | undefined): string {
  if (!Array.isArray(v)) return '';
  const pairs: string[] = [];
  for (let i = 0; i + 1 < v.length; i += 2) pairs.push(`${String(v[i])},${String(v[i + 1])}`);
  return pairs.join(' ');
}

function textToPointList(t: string): number[] | undefined {
  const flat: number[] = [];
  for (const pair of t.split(/\s+/).filter(Boolean)) {
    const [x, y] = pair.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) flat.push(Math.round(x!), Math.round(y!));
  }
  return flat.length >= 4 ? flat : undefined;
}

/** buttonmatrix map:string[](含 '\n' 换行 token)↔ 文本(每行一排,'|' 分隔同排按钮) */
function mapToText(v: PropValueV2 | undefined): string {
  if (!Array.isArray(v)) return '';
  const lines: string[][] = [[]];
  for (const tok of v as string[]) {
    if (tok === '\n') lines.push([]);
    else lines[lines.length - 1]!.push(String(tok));
  }
  return lines.map((l) => l.join(' | ')).join('\n');
}

function textToMap(t: string): string[] | undefined {
  const rows = t
    .split('\n')
    .map((line) => line.split('|').map((s) => s.trim()).filter(Boolean))
    .filter((r) => r.length > 0);
  if (rows.length === 0) return undefined;
  const out: string[] = [];
  rows.forEach((r, i) => {
    if (i > 0) out.push('\n');
    out.push(...r);
  });
  return out;
}

function strListToText(v: PropValueV2 | undefined): string {
  return Array.isArray(v) ? (v as string[]).join(' ') : '';
}

function textToStrList(t: string): string[] | undefined {
  const toks = t.split(/\s+/).filter(Boolean);
  return toks.length ? toks : undefined;
}

/* ================= 通用值编辑器 ================= */

function ValueEditor(props: {
  type: string;
  tokens?: readonly string[];
  min?: number;
  max?: number;
  value: PropValueV2 | undefined;
  defaultValue?: PropValueV2;
  onChange: (v: PropValueV2 | undefined) => void;
  /** 上下文节点(imageRef 判定 lottie / animimage 帧序列) */
  node?: WidgetNodeV2;
  propKey?: string;
}): JSX.Element {
  const { type, tokens, min, max, value, defaultValue, onChange, node, propKey } = props;
  const ph = defaultValue !== undefined ? String(defaultValue) : '';
  const themes = useProjectStore((state) => state.uiProject.themes);
  const themeTokens = useMemo(() => {
    const tokenTargetTypes = new Set<StylePropType>([
      'size', 'int', 'color', 'opa', 'fontRef', 'imageRef',
    ]);
    if (!tokenTargetTypes.has(type as StylePropType)) return [];
    return themes
      .flatMap((theme) => theme.tokens)
      .filter((token) => tokenAssignableTo(token.type, type as StylePropType));
  }, [themes, type]);
  if (isTokenRef(value)) {
    const token = themeTokens.find((item) => item.id === value.$token);
    return (
      <span className="ed-size" title={`Theme Token: ${value.$token}`}>
        <select
          className="ed-select"
          value={value.$token}
          onChange={(event) => onChange({ $token: event.target.value })}
        >
          {themeTokens.map((item) => (
            <option key={item.id} value={item.id}>{item.id}</option>
          ))}
        </select>
        <button
          className="icon-btn"
          title="解除 Token，转为当前字面值"
          onClick={() => onChange(token?.value ?? undefined)}
        >链</button>
      </span>
    );
  }

  switch (type) {
    case 'size':
      return <SizeEditor value={value} placeholder={ph} onChange={onChange} />;
    case 'int':
      return (
        <input
          className="ed-num"
          type="number"
          min={min}
          max={max}
          placeholder={ph}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'opa':
      return (
        <input
          className="ed-num"
          type="number"
          min={0}
          max={255}
          placeholder={ph || '255'}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'bool':
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case 'enum':
    case 'fontRef':
      return (
        <select
          className="ed-select"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        >
          <option value="">{ph ? `(默认 ${ph})` : '(未设置)'}</option>
          {(tokens ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      );
    case 'imageRef':
      return (
        <AssetPicker
          value={typeof value === 'string' ? value : undefined}
          accept={node?.type === 'lottie' && propKey === 'src' ? 'lottie' : 'image'}
          onChange={onChange}
        />
      );
    case 'stringList':
      // animimage.srcs = imageRef 帧序列 → 素材多选;其它 stringList 走空格分隔文本
      if (node?.type === 'animimage' && propKey === 'srcs') {
        return (
          <AssetMultiPicker
            value={Array.isArray(value) ? (value as string[]) : undefined}
            onChange={onChange}
          />
        );
      }
      return (
        <TextCommitEditor
          value={strListToText(value)}
          placeholder="a b c"
          onCommit={(t) => onChange(textToStrList(t))}
        />
      );
    case 'intList':
      return (
        <TextCommitEditor
          value={intListToText(value)}
          placeholder="10 20 30"
          onCommit={(t) => onChange(textToIntList(t))}
        />
      );
    case 'pointList':
      return (
        <TextCommitEditor
          value={pointListToText(value)}
          placeholder="0,80 60,10 120,60"
          onCommit={(t) => onChange(textToPointList(t))}
        />
      );
    case 'stringQuotedList':
      return (
        <TextAreaCommitEditor
          value={mapToText(value)}
          placeholder={'按钮1 | 按钮2\n按钮3(换行=新一排)'}
          onCommit={(t) => onChange(textToMap(t))}
        />
      );
    case 'orFlags':
      return (
        <TextCommitEditor
          value={strListToText(value)}
          placeholder="width_2|checked none …(每按钮一组,'|' 位或)"
          onCommit={(t) => onChange(textToStrList(t))}
        />
      );
    case 'color': {
      const hex = typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
      return (
        <span className="ed-color">
          <input
            type="color"
            value={hex}
            onChange={(e) => onChange(e.target.value)}
          />
          <input
            className="ed-text"
            placeholder={ph || '#RRGGBB'}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') onChange(undefined);
              else if (/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/.test(v)) onChange(v);
            }}
          />
        </span>
      );
    }
    default:
      // string / subject / styleRef / 其它 → 文本
      return (
        <TextCommitEditor
          value={typeof value === 'string' ? value : value !== undefined ? String(value) : ''}
          placeholder={ph}
          onCommit={(v) => onChange(v === '' ? undefined : v)}
        />
      );
  }
}

/** 文本:失焦/回车提交(避免每键触发重载抖动) */
function TextCommitEditor(props: {
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    props.onCommit(draft);
    setDraft(null);
  };
  return (
    <input
      className="ed-text"
      placeholder={props.placeholder}
      value={draft ?? props.value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

/** 多行文本:失焦/Ctrl+Enter 提交(buttonmatrix map 等) */
function TextAreaCommitEditor(props: {
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    props.onCommit(draft);
    setDraft(null);
  };
  return (
    <textarea
      className="ed-textarea"
      rows={3}
      placeholder={props.placeholder}
      value={draft ?? props.value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && commit()}
    />
  );
}

/** size:px / % / content 三态(lv_xml_to_size 语义) */
function SizeEditor(props: {
  value: PropValueV2 | undefined;
  placeholder?: string;
  onChange: (v: PropValueV2 | undefined) => void;
}): JSX.Element {
  const { value, onChange } = props;
  const mode: 'px' | '%' | 'content' | 'unset' =
    value === undefined || value === null
      ? 'unset'
      : value === 'content'
        ? 'content'
        : typeof value === 'string' && value.endsWith('%')
          ? '%'
          : 'px';
  const num =
    typeof value === 'number' ? value : typeof value === 'string' && value.endsWith('%') ? parseInt(value, 10) : '';

  const setMode = (m: string): void => {
    if (m === 'unset') onChange(undefined);
    else if (m === 'content') onChange('content');
    else if (m === '%') onChange(`${typeof num === 'number' ? num : 100}%`);
    else onChange(typeof num === 'number' ? num : 0);
  };

  return (
    <span className="ed-size">
      {mode !== 'content' && (
        <input
          className="ed-num"
          type="number"
          placeholder={props.placeholder}
          value={num}
          onChange={(e) => {
            if (e.target.value === '') {
              onChange(undefined);
              return;
            }
            const n = Number(e.target.value);
            onChange(mode === '%' ? `${n}%` : n);
          }}
        />
      )}
      <select className="ed-select ed-size-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="unset">—</option>
        <option value="px">px</option>
        <option value="%">%</option>
        <option value="content">content</option>
      </select>
    </span>
  );
}
