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
  SCREEN_INTERACTION,
  STATE_TOKENS,
  STYLE_PROPS,
  checkCName,
  findChildSpec,
  getWidgetInteraction,
  newUuid,
  type BindableProp,
  type ChildSpec,
  type CmpOp,
  type CompanionSpec,
  type ObjFlagKey,
  type ObjStateKey,
  type PropSpec,
  type Selector,
  type StateToken,
  type StylePropType,
  type StylePropSpec,
  type WidgetSpec,
} from '@lvd/schema';
import {
  BUILTIN_ACTIONS,
  componentForNode,
  isTokenRef,
  tokenAssignableTo,
  type ActionParamSpec,
  type ActionSpec,
  type BindingV2,
  type ComponentApiPropV2,
  type LocalStyleGroup,
  type PropValueV2,
  type SubjectDefV2,
  type UiEvent,
  type WidgetNodeV2,
} from '@lvd/schema/v2';
import {
  findNodeByIdV2,
  namesInScreenV2,
  useProjectStore,
} from '../stores/projectStore';
import { useEditorStore } from '../stores/editorStore';
import { useBuildTargetStore } from '../stores/buildTargetStore';
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
  const [tab, setTab] = useState<'props' | 'style' | 'interaction'>('props');

  if (selectedIds.length === 0) {
    return <div className="inspector empty">未选中对象</div>;
  }
  if (selectedIds.length > 1) {
    return <div className="inspector empty">已选中 {selectedIds.length} 个对象(多选编辑二期)</div>;
  }
  const hit = findNodeByIdV2(project, selectedIds[0]!);
  if (!hit) return <div className="inspector empty">节点不存在</div>;
  const interaction = interactionCapabilities(hit.node, hit.node === hit.screen.root);
  const activeTab = tab === 'interaction' && !interaction.visible ? 'props' : tab;

  return (
    <div className="inspector">
      <div className="tabs">
        <button className={activeTab === 'props' ? 'active' : ''} onClick={() => setTab('props')}>属性</button>
        <button className={activeTab === 'style' ? 'active' : ''} onClick={() => setTab('style')}>样式</button>
        {interaction.visible && (
          <button className={activeTab === 'interaction' ? 'active' : ''} onClick={() => setTab('interaction')}>交互</button>
        )}
      </div>
      {activeTab === 'props' && <PropsTab node={hit.node} isRoot={hit.node === hit.screen.root} />}
      {activeTab === 'style' && <StyleTab node={hit.node} />}
      {activeTab === 'interaction' && <InteractionTab node={hit.node} capabilities={interaction} />}
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
  const project = useProjectStore((state) => state.uiProject);
  const component = componentForNode(project, node);
  const effectiveType = component?.root.type ?? node.type;
  const spec = REGISTRY.get(effectiveType);
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
      {component && (
        <div className="insp-note">
          关联组件：{component.displayName ?? component.codeName}。此处修改的是当前实例覆盖值。
        </div>
      )}
      {!isRoot && showObjExtras && <NameRow node={node} />}
      {component && component.api.length > 0 && (
        <ComponentApiSection node={node} api={component.api} />
      )}
      {cs && (
        <div className="insp-note">
          结构子元素 <code>{node.type}</code>(属于 {childInfo!.parent.palette?.label ?? childInfo!.parent.type})
        </div>
      )}
      {node.type === 'button' && (
        <section className="insp-group">
          <div className="panel-subtitle">内容</div>
          <ButtonTextRow node={node} />
        </section>
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
      {!component && spec?.children && spec.children.length > 0 && <ChildrenSection node={node} spec={spec} />}
      {showObjExtras && <FlagsSection node={node} kind="flags" title="标志 (flags)" keys={OBJ_BASE.flags} />}
      {showObjExtras && <FlagsSection node={node} kind="states" title="状态 (states)" keys={OBJ_BASE.states} />}
    </div>
  );
}

const COMPONENT_API_TYPE_LABELS: Record<ComponentApiPropV2['type'], string> = {
  int: '整数', float: '小数', bool: '开关', string: '文本', color: '颜色', size: '尺寸', imageRef: '图片',
};

function ComponentApiSection({ node, api }: { node: WidgetNodeV2; api: ComponentApiPropV2[] }): JSX.Element {
  return (
    <section className="insp-group">
      <div className="panel-subtitle">组件参数</div>
      {api.map((prop) => {
        const value = node.props[prop.name];
        return (
          <div key={prop.name} className={`prop-row ${value === undefined ? 'unset' : ''}`}>
            <label title={`${prop.name} · ${COMPONENT_API_TYPE_LABELS[prop.type]}`}>{prop.name}</label>
            <ValueEditor
              node={node}
              propKey={prop.name}
              type={prop.type}
              value={value}
              defaultValue={prop.default}
              onChange={(next) => mutateProp(node.id, prop.name, next, `改组件参数 ${prop.name}`)}
            />
            {value !== undefined && (
              <button className="icon-btn" title="恢复组件默认值" onClick={() => mutateProp(
                node.id, prop.name, undefined, `重置组件参数 ${prop.name}`,
              )}>↺</button>
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * LVGL button 本身没有 text 属性，标准做法是在内部放一个 label。
 * 检查器把这层结构细节收起来：用户直接编辑“按钮文字”，首次输入时自动创建
 * 居中的 label；已有直接 label 时则原位更新，保留它的样式和其它属性。
 */
function ButtonTextRow({ node }: { node: WidgetNodeV2 }): JSX.Element {
  const label = node.children.find((child) => child.type === 'label');
  const value = label ? String(label.props.text ?? 'Text') : '';

  const setText = (text: string): void => {
    if (!label && text === '') return;
    useProjectStore.getState().mutateV2(
      '改按钮文字',
      (draft) => {
        const hit = findNodeByIdV2(draft, node.id);
        if (!hit) return;
        let textNode = hit.node.children.find((child) => child.type === 'label');
        if (!textNode) {
          textNode = {
            id: newUuid(),
            type: 'label',
            props: { text, align: 'center' },
            styleRefs: [],
            styles: [],
            events: [],
            bindings: [],
            children: [],
          };
          hit.node.children.push(textNode);
        } else {
          textNode.props.text = text;
        }
      },
      { coalesceKey: `button-text:${node.id}` },
    );
  };

  return (
    <div className="prop-row">
      <label title="内部自动创建或更新居中的 Label">按钮文字</label>
      <input
        className="ed-text"
        value={value}
        placeholder="输入文字（自动创建标签）"
        onChange={(event) => setText(event.target.value)}
      />
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
    <>
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
      {(spec.companions ?? []).map((companion) => (
        <CompanionRow key={companion.key} node={node} parent={spec} companion={companion} />
      ))}
    </>
  );
}

const COMPANION_LABELS: Record<string, string> = {
  value_animated: '当前值动画',
  start_value_animated: '起始值动画',
  selected_animated: '切换动画',
  options_mode: '选项模式',
  bind_text_fmt: '绑定格式',
};

function CompanionRow(props: { node: WidgetNodeV2; parent: PropSpec; companion: CompanionSpec }): JSX.Element {
  const { node, parent, companion } = props;
  const value = node.props[companion.key];
  const isSet = value !== undefined && value !== null;
  const label = COMPANION_LABELS[companion.key] ?? `${parent.ui.label}选项`;
  const onChange = (next: PropValueV2 | undefined): void =>
    mutateProp(node.id, companion.key, next, `改 ${label}`);
  return (
    <div className={`prop-row companion-row ${isSet ? '' : 'unset'}`}>
      <label title={companion.xmlAttr}>{label}</label>
      <ValueEditor
        node={node}
        propKey={companion.key}
        type={companion.type}
        tokens={companion.enum?.tokens}
        value={value}
        onChange={onChange}
      />
      {isSet && <button className="icon-btn" title="重置为默认" onClick={() => onChange(undefined)}>↺</button>}
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

/* ================= 交互:数据源 / 事件 / 绑定 ================= */

const EVENT_LABELS: Record<string, string> = {
  clicked: '点击',
  pressed: '按下',
  pressing: '持续按下',
  press_lost: '按压移出',
  released: '释放',
  short_clicked: '短按',
  double_clicked: '双击',
  long_pressed: '长按',
  value_changed: '值改变',
  insert: '输入前',
  scroll_begin: '开始滚动',
  scroll: '滚动中',
  scroll_end: '结束滚动',
  focused: '获得焦点',
  defocused: '失去焦点',
  ready: '完成',
  cancel: '取消',
  screen_load_start: '屏幕开始加载',
  screen_loaded: '屏幕已加载',
  screen_unload_start: '屏幕开始卸载',
  screen_unloaded: '屏幕已卸载',
  resolution_changed: '分辨率改变',
};

const ACTION_PARAM_LABELS: Record<string, string> = {
  screen: '目标屏幕',
  subject: '数据源',
  value: '值',
  anim: '切换动画',
  duration: '动画时长',
  delay: '延迟',
  step: '步长',
  min: '下限',
  max: '上限',
  rollover: '循环',
  userData: '附加数据',
};

const BINDABLE_LABELS: Record<BindableProp, string> = {
  value: '值',
  checked: '选中状态',
  text: '文本',
  src: '素材',
  min_value: '最小值',
  max_value: '最大值',
};

interface InteractionCapabilities {
  visible: boolean;
  events: readonly string[];
  bindings: boolean;
  subjects: boolean;
}

function interactionCapabilities(node: WidgetNodeV2, isRoot: boolean): InteractionCapabilities {
  const project = useProjectStore.getState().uiProject;
  const effectiveType = componentForNode(project, node)?.root.type ?? node.type;
  const interaction = isRoot ? SCREEN_INTERACTION : getWidgetInteraction(effectiveType);
  const events = [...interaction.events];
  // 老工程或高级能力产生的事件必须继续可见、可编辑。
  for (const event of node.events) if (!events.includes(event.on)) events.push(event.on);
  const bindings = !isRoot
    && ((REGISTRY.get(effectiveType)?.bindableProps.length ?? 0) > 0 || node.bindings.length > 0);
  const subjects = interaction.usesSubjects === true || subjectProps(node).length > 0;
  return { visible: events.length > 0 || bindings || subjects, events, bindings, subjects };
}

function InteractionTab(props: { node: WidgetNodeV2; capabilities: InteractionCapabilities }): JSX.Element {
  const { node, capabilities } = props;
  return (
    <div className="insp-body interaction-tab">
      <SubjectSection />
      <ActionRegistrySection />
      {capabilities.events.length > 0 && <EventSection node={node} triggers={capabilities.events} />}
      {capabilities.bindings && <BindingSection node={node} />}
    </div>
  );
}

function visitNodes(nodes: WidgetNodeV2[], visit: (node: WidgetNodeV2) => void): void {
  for (const node of nodes) {
    visit(node);
    visitNodes(node.children, visit);
  }
}

function subjectProps(node: WidgetNodeV2): PropSpec[] {
  const project = useProjectStore.getState().uiProject;
  const effectiveType = componentForNode(project, node)?.root.type ?? node.type;
  const widget = REGISTRY.get(effectiveType);
  const child = widget ? undefined : findChildSpec(effectiveType)?.child;
  const props = widget?.props ?? [...(child?.createProps ?? []), ...(child?.props ?? [])];
  return props.filter((prop) => prop.type === 'subject');
}

function subjectUseCount(subject: SubjectDefV2): number {
  const project = useProjectStore.getState().uiProject;
  let count = 0;
  visitNodes([
    ...project.screens.map((screen) => screen.root),
    ...project.components.map((component) => component.root),
  ], (node) => {
    count += node.bindings.filter((binding) => binding.subject === subject.id).length;
    count += node.events.filter((event) => event.args?.['subject'] === subject.id).length;
    count += subjectProps(node).filter((prop) => node.props[prop.key] === subject.codeName).length;
  });
  return count;
}

function actionUseCount(actionId: string): number {
  const project = useProjectStore.getState().uiProject;
  let count = 0;
  visitNodes([
    ...project.screens.map((screen) => screen.root),
    ...project.components.map((component) => component.root),
  ], (node) => {
    count += node.events.filter((event) => event.action === actionId).length;
  });
  return count;
}

function ActionRegistrySection(): JSX.Element {
  const registry = useBuildTargetStore((state) => state.actionRegistry);
  const customActions = useMemo(
    () => Object.values(registry)
      .filter((action) => action.id.startsWith('custom.'))
      .sort((a, b) => a.id.localeCompare(b.id)),
    [registry],
  );
  const [open, setOpen] = useState(false);
  const [codeName, setCodeName] = useState('');
  const [displayName, setDisplayName] = useState('');

  const addAction = (): void => {
    const suffix = codeName.trim().toLowerCase();
    const id = `custom.${suffix}`;
    if (!/^[a-z][a-z0-9_]*$/.test(suffix)) {
      useEditorStore.getState().setBanner('业务动作代码名只能使用小写字母、数字和下划线，并以字母开头');
      return;
    }
    if (registry[id]) {
      useEditorStore.getState().setBanner(`业务动作 ${id} 已存在`);
      return;
    }
    useProjectStore.getState().mutateActionRegistry('新建业务动作', (draft) => {
      draft[id] = {
        id,
        displayName: displayName.trim() || suffix,
        description: '导出为设备端 LVGL 事件回调；业务逻辑在 actions.c 中实现。',
        params: [{ name: 'userData', type: 'string' }],
      };
    });
    setCodeName('');
    setDisplayName('');
    setOpen(true);
  };

  return (
    <section className="insp-group" data-section="action-registry">
      <div className="panel-subtitle interaction-title">
        <span className="clickable" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} 设备业务动作{customActions.length > 0 ? ` (${customActions.length})` : ''}
        </span>
      </div>
      {open && (
        <>
          <div className="insp-note">
            事件触发后调用主机固件中的同名 C 回调；预览态只记录触发，不执行设备业务。
          </div>
          <div className="action-create-row">
            <input
              className="ed-text"
              value={codeName}
              placeholder="代码名，例如 wifi_scan"
              onChange={(event) => setCodeName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && addAction()}
            />
            <input
              className="ed-text"
              value={displayName}
              placeholder="显示名称（可选）"
              onChange={(event) => setDisplayName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && addAction()}
            />
            <button className="btn btn-sm" disabled={codeName.trim() === ''} onClick={addAction}>+ 新建</button>
          </div>
          {customActions.map((action) => (
            <ActionRegistryItem key={action.id} action={action} />
          ))}
          {customActions.length === 0 && <div className="insp-note">暂无业务动作。</div>}
        </>
      )}
    </section>
  );
}

function ActionRegistryItem({ action }: { action: ActionSpec }): JSX.Element {
  const used = actionUseCount(action.id);
  const callbackName = action.id.slice('custom.'.length);
  const updateDisplayName = (value: string): void => {
    useProjectStore.getState().mutateActionRegistry('改业务动作显示名称', (draft) => {
      const current = draft[action.id];
      if (!current) return;
      if (value.trim() === '') delete current.displayName;
      else current.displayName = value.trim();
    });
  };
  const remove = (): void => {
    if (used > 0) {
      useEditorStore.getState().setBanner(`业务动作 ${action.id} 正被 ${used} 个事件使用，请先解除引用`);
      return;
    }
    useProjectStore.getState().mutateActionRegistry('删除业务动作', (draft) => {
      delete draft[action.id];
    });
  };
  return (
    <div className="child-item action-registry-item" data-action-id={action.id}>
      <div className="child-head">
        <span>{action.displayName || callbackName}</span>
        <button className="icon-btn" title={used > 0 ? `正被 ${used} 个事件使用` : '删除未使用的业务动作'} onClick={remove}>✕</button>
      </div>
      <div className="child-body">
        <div className="prop-row">
          <label>回调函数</label>
          <code>{callbackName}</code>
        </div>
        <div className="prop-row">
          <label>显示名称</label>
          <TextCommitEditor value={action.displayName ?? ''} placeholder={callbackName} onCommit={updateDisplayName} />
        </div>
        <div className="insp-note">导出声明：<code>void {callbackName}(lv_event_t * e);</code></div>
      </div>
    </div>
  );
}

function SubjectSection(): JSX.Element {
  const subjects = useProjectStore((state) => state.uiProject.subjects);
  const [open, setOpen] = useState(false);

  const addSubject = (): void => {
    useProjectStore.getState().mutateV2('新建数据源', (draft) => {
      const used = new Set(draft.subjects.map((subject) => subject.codeName));
      let ordinal = draft.subjects.length + 1;
      while (used.has(`subject_${ordinal}`)) ordinal += 1;
      draft.subjects.push({
        id: newUuid(),
        codeName: `subject_${ordinal}`,
        displayName: `数据源 ${ordinal}`,
        type: 'int',
        initial: 0,
      });
    });
    setOpen(true);
  };

  return (
    <section className="insp-group">
      <div className="panel-subtitle interaction-title">
        <span className="clickable" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} 工程数据源{subjects.length > 0 ? ` (${subjects.length})` : ''}
        </span>
        <button className="btn btn-sm" onClick={addSubject}>+ 新建</button>
      </div>
      {open && (
        <>
          <div className="insp-note">用于组件值、文本、状态的动态绑定，也可由事件修改。</div>
          {subjects.map((subject) => <SubjectItem key={subject.id} subject={subject} />)}
          {subjects.length === 0 && <div className="insp-note">暂无数据源。</div>}
        </>
      )}
    </section>
  );
}

function SubjectItem({ subject }: { subject: SubjectDefV2 }): JSX.Element {
  const update = (label: string, apply: (current: SubjectDefV2) => void): void => {
    useProjectStore.getState().mutateV2(label, (draft) => {
      const current = draft.subjects.find((item) => item.id === subject.id);
      if (current) apply(current);
    });
  };

  const rename = (nextValue: string): void => {
    const next = nextValue.trim();
    if (next === subject.codeName || next === '') return;
    const error = checkCName(next);
    const project = useProjectStore.getState().uiProject;
    if (error || project.subjects.some((item) => item.id !== subject.id && item.codeName === next)) {
      useEditorStore.getState().setBanner(error ? `数据源名称非法:${error.message}` : `数据源名称 ${next} 已存在`);
      return;
    }
    useProjectStore.getState().mutateV2('重命名数据源', (draft) => {
      const current = draft.subjects.find((item) => item.id === subject.id);
      if (!current) return;
      const previous = current.codeName;
      current.codeName = next;
      visitNodes([
        ...draft.screens.map((screen) => screen.root),
        ...draft.components.map((component) => component.root),
      ], (node) => {
        for (const prop of subjectProps(node)) {
          if (node.props[prop.key] === previous) node.props[prop.key] = next;
        }
      });
    });
  };

  const changeType = (type: SubjectDefV2['type']): void => {
    useProjectStore.getState().mutateV2('改数据源类型', (draft) => {
      const index = draft.subjects.findIndex((item) => item.id === subject.id);
      if (index < 0) return;
      const common = {
        id: subject.id,
        codeName: subject.codeName,
        ...(subject.displayName === undefined ? {} : { displayName: subject.displayName }),
      };
      draft.subjects[index] = type === 'string'
        ? { ...common, type, initial: '' }
        : type === 'color'
          ? { ...common, type, initial: '#000000' }
          : { ...common, type, initial: 0 };
    });
  };

  const remove = (): void => {
    const used = subjectUseCount(subject);
    if (used > 0) {
      useEditorStore.getState().setBanner(`数据源 ${subject.codeName} 正被 ${used} 处引用，请先解除绑定`);
      return;
    }
    useProjectStore.getState().mutateV2('删除数据源', (draft) => {
      draft.subjects = draft.subjects.filter((item) => item.id !== subject.id);
    });
  };

  return (
    <div className="child-item subject-item" data-subject-id={subject.id}>
      <div className="child-head">
        <span>{subject.displayName || subject.codeName}</span>
        <button className="icon-btn" title="删除未使用的数据源" onClick={remove}>✕</button>
      </div>
      <div className="child-body">
        <div className="prop-row">
          <label>代码名</label>
          <TextCommitEditor value={subject.codeName} onCommit={rename} />
        </div>
        <div className="prop-row">
          <label>显示名称</label>
          <TextCommitEditor value={subject.displayName ?? ''} placeholder={subject.codeName} onCommit={(value) => update('改数据源显示名称', (current) => {
            if (value.trim() === '') delete current.displayName;
            else current.displayName = value.trim();
          })} />
        </div>
        <div className="prop-row">
          <label>类型</label>
          <select className="ed-select" value={subject.type} onChange={(event) => changeType(event.target.value as SubjectDefV2['type'])}>
            <option value="int">整数</option>
            <option value="float">小数</option>
            <option value="string">文本</option>
            <option value="color">颜色</option>
          </select>
        </div>
        <div className="prop-row">
          <label>初始值</label>
          {subject.type === 'string' && (
            <TextCommitEditor value={subject.initial} onCommit={(value) => update('改数据源初始值', (current) => {
              if (current.type === 'string') current.initial = value;
            })} />
          )}
          {subject.type === 'color' && (
            <ValueEditor type="color" value={subject.initial} onChange={(value) => update('改数据源初始值', (current) => {
              if (current.type === 'color' && typeof value === 'string') current.initial = value;
            })} />
          )}
          {(subject.type === 'int' || subject.type === 'float') && (
            <input className="ed-num" type="number" value={subject.initial} onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) update('改数据源初始值', (current) => {
                if (current.type === 'int' || current.type === 'float') current.initial = value;
              });
            }} />
          )}
        </div>
        {(subject.type === 'int' || subject.type === 'float') && (
          <>
            <div className="prop-row unset">
              <label>最小值</label>
              <input className="ed-num" type="number" value={subject.min ?? ''} placeholder="不限制" onChange={(event) => {
                const raw = event.target.value;
                update('改数据源最小值', (current) => {
                  if (current.type !== 'int' && current.type !== 'float') return;
                  if (raw === '') delete current.min;
                  else current.min = Number(raw);
                });
              }} />
            </div>
            <div className="prop-row unset">
              <label>最大值</label>
              <input className="ed-num" type="number" value={subject.max ?? ''} placeholder="不限制" onChange={(event) => {
                const raw = event.target.value;
                update('改数据源最大值', (current) => {
                  if (current.type !== 'int' && current.type !== 'float') return;
                  if (raw === '') delete current.max;
                  else current.max = Number(raw);
                });
              }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function defaultActionArgs(spec: ActionSpec): UiEvent['args'] | undefined {
  const project = useProjectStore.getState().uiProject;
  const args: NonNullable<UiEvent['args']> = {};
  for (const param of spec.params) {
    let value = param.default;
    if (value === undefined && param.required) {
      if (param.type === 'screenRef') value = project.screens[0]?.id;
      else if (param.type === 'subjectRef') value = project.subjects[0]?.id;
      else if (param.type === 'bool') value = false;
      else if (param.type === 'int' || param.type === 'float') value = param.min ?? 0;
      else if (param.type === 'color') value = '#000000';
      else value = '';
    }
    if (value !== undefined) args[param.name] = value;
  }
  return Object.keys(args).length > 0 ? args : undefined;
}

function EventSection({ node, triggers }: { node: WidgetNodeV2; triggers: readonly string[] }): JSX.Element {
  const customActions = useBuildTargetStore((state) => state.actionRegistry);
  const actions = useMemo(() => ({ ...BUILTIN_ACTIONS, ...customActions }), [customActions]);
  const actionList = Object.values(actions)
    .filter((action) => action.id !== 'screen.back')
    .sort((a, b) => a.id.localeCompare(b.id));

  const update = (index: number, next: UiEvent): void => {
    useProjectStore.getState().mutateV2('改事件', (draft) => {
      const hit = findNodeByIdV2(draft, node.id);
      if (hit?.node.events[index]) hit.node.events[index] = next;
    });
  };
  const add = (): void => {
    const spec = actions['screen.open'] ?? actionList[0];
    if (!spec) return;
    useProjectStore.getState().mutateV2('添加事件', (draft) => {
      const hit = findNodeByIdV2(draft, node.id);
      hit?.node.events.push({ on: triggers[0] ?? 'clicked', action: spec.id, args: defaultActionArgs(spec) });
    });
  };
  const remove = (index: number): void => {
    useProjectStore.getState().mutateV2('删除事件', (draft) => {
      const hit = findNodeByIdV2(draft, node.id);
      hit?.node.events.splice(index, 1);
    });
  };

  return (
    <section className="insp-group">
      <div className="panel-subtitle interaction-title">
        <span>事件 ({node.events.length})</span>
        <button className="btn btn-sm" onClick={add}>+ 添加</button>
      </div>
      <div className="insp-note">这里只列出该组件常用的触发时机；动作和参数会按类型联动。</div>
      {node.events.map((event, index) => {
        const spec = actions[event.action];
        return (
          <div className="child-item" key={`${index}:${event.on}:${event.action}`} data-event-index={index}>
            <div className="child-head">
              <span>{EVENT_LABELS[event.on] ?? event.on} → {spec?.displayName ?? event.action}</span>
              <button className="icon-btn" title="删除事件" onClick={() => remove(index)}>✕</button>
            </div>
            <div className="child-body">
              <div className="prop-row">
                <label>触发时机</label>
                <select className="ed-select" value={event.on} onChange={(e) => update(index, { ...event, on: e.target.value })}>
                  {triggers.map((token) => (
                    <option key={token} value={token}>{EVENT_LABELS[token] ? `${EVENT_LABELS[token]} (${token})` : token}</option>
                  ))}
                </select>
              </div>
              <div className="prop-row">
                <label>执行动作</label>
                <select className="ed-select" value={event.action} onChange={(e) => {
                  const nextSpec = actions[e.target.value];
                  if (nextSpec) update(index, { on: event.on, action: nextSpec.id, args: defaultActionArgs(nextSpec) });
                }}>
                  {!spec && <option value={event.action}>{event.action}（已失效）</option>}
                  {event.action === 'screen.back' && (
                    <option value="screen.back">返回上一屏（旧工程，请改为打开指定屏幕）</option>
                  )}
                  {actionList.map((action) => {
                    const needsSubject = action.params.some((param) => param.required && param.type === 'subjectRef');
                    const unavailable = needsSubject && useProjectStore.getState().uiProject.subjects.length === 0;
                    return (
                      <option key={action.id} value={action.id} disabled={unavailable}>
                        {action.displayName ?? action.id}{unavailable ? '（需先新建数据源）' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              {spec?.params.map((param) => (
                <ActionArgRow key={param.name} param={param} value={event.args?.[param.name]} onChange={(value) => {
                  const args = { ...(event.args ?? {}) };
                  if (value === undefined) delete args[param.name];
                  else args[param.name] = value;
                  update(index, { ...event, args: Object.keys(args).length > 0 ? args : undefined });
                }} />
              ))}
            </div>
          </div>
        );
      })}
      {node.events.length === 0 && <div className="insp-note">尚未设置事件。</div>}
    </section>
  );
}

type ActionArgValue = NonNullable<UiEvent['args']>[string];

function ActionArgRow(props: {
  param: ActionParamSpec;
  value: ActionArgValue | undefined;
  onChange: (value: ActionArgValue | undefined) => void;
}): JSX.Element {
  const { param, value, onChange } = props;
  const project = useProjectStore((state) => state.uiProject);
  let editor: JSX.Element;
  if (param.enum) {
    editor = (
      <select className="ed-select" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">(未设置)</option>
        {param.enum.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    );
  } else if (param.type === 'screenRef') {
    editor = (
      <select className="ed-select" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">(请选择)</option>
        {project.screens.map((screen) => <option key={screen.id} value={screen.id}>{screen.displayName || screen.codeName}</option>)}
      </select>
    );
  } else if (param.type === 'subjectRef') {
    editor = (
      <select className="ed-select" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{project.subjects.length === 0 ? '(请先新建数据源)' : '(请选择)'}</option>
        {project.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.displayName || subject.codeName}</option>)}
      </select>
    );
  } else if (param.type === 'bool') {
    editor = <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
  } else if (param.type === 'int' || param.type === 'float') {
    editor = (
      <input className="ed-num" type="number" min={param.min} max={param.max} value={typeof value === 'number' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
    );
  } else if (param.type === 'color') {
    editor = <ValueEditor type="color" value={value as PropValueV2 | undefined} onChange={(next) => onChange(next as ActionArgValue | undefined)} />;
  } else {
    editor = <TextCommitEditor value={typeof value === 'string' ? value : ''} onCommit={(next) => onChange(next || undefined)} />;
  }
  return (
    <div className={`prop-row ${value === undefined ? 'unset' : ''}`}>
      <label title={param.name}>{ACTION_PARAM_LABELS[param.name] ?? param.name}{param.required ? ' *' : ''}</label>
      {editor}
      {value !== undefined && !param.required && <button className="icon-btn" title="清除" onClick={() => onChange(undefined)}>↺</button>}
    </div>
  );
}

const CMP_OP_LABELS: Record<CmpOp, string> = {
  eq: '等于', not_eq: '不等于', gt: '大于', ge: '大于等于', lt: '小于', le: '小于等于',
};

function BindingSection({ node }: { node: WidgetNodeV2 }): JSX.Element {
  const project = useProjectStore((state) => state.uiProject);
  const effectiveType = componentForNode(project, node)?.root.type ?? node.type;
  const spec = REGISTRY.get(effectiveType);
  const screenStyles = findNodeByIdV2(project, node.id)?.screen.styles ?? [];
  const styles = [...project.styles, ...screenStyles]
    .filter((style, index, list) => list.findIndex((item) => item.id === style.id) === index);
  const usedDescriptors = new Set(node.bindings.map((binding) => binding.kind === 'prop'
    ? `prop:${binding.prop}`
    : binding.kind === 'flag'
      ? `flag:${binding.flag}`
      : binding.kind === 'state'
        ? `state:${binding.state}`
        : `style:${binding.styleId}`));

  const add = (descriptor: string): void => {
    if (descriptor === '') return;
    const [kind, target] = descriptor.split(':');
    const firstSubject = project.subjects.find((subject) => subjectMatchesDescriptor(subject, kind!, target!));
    if (!firstSubject) {
      useEditorStore.getState().setBanner(`没有与“${bindingDescriptorLabel(kind!, target!)}”兼容的数据源`);
      return;
    }
    let binding: BindingV2 | undefined;
    if (kind === 'prop') binding = { kind, prop: target as BindableProp, subject: firstSubject.id };
    else if (kind === 'flag') binding = { kind, flag: target as ObjFlagKey, op: 'eq', subject: firstSubject.id, refValue: 1 };
    else if (kind === 'state') binding = { kind, state: target as ObjStateKey, op: 'eq', subject: firstSubject.id, refValue: 1 };
    else if (kind === 'style') binding = { kind, styleId: target!, subject: firstSubject.id, refValue: 1 };
    if (!binding) return;
    useProjectStore.getState().mutateV2('添加绑定', (draft) => {
      findNodeByIdV2(draft, node.id)?.node.bindings.push(binding!);
    });
  };

  const update = (index: number, binding: BindingV2): void => {
    useProjectStore.getState().mutateV2('改绑定', (draft) => {
      const hit = findNodeByIdV2(draft, node.id);
      if (hit?.node.bindings[index]) hit.node.bindings[index] = binding;
    });
  };
  const remove = (index: number): void => {
    useProjectStore.getState().mutateV2('删除绑定', (draft) => {
      findNodeByIdV2(draft, node.id)?.node.bindings.splice(index, 1);
    });
  };

  return (
    <section className="insp-group">
      <div className="panel-subtitle">数据绑定 ({node.bindings.length})</div>
      <div className="binding-add-row">
        <select className="ed-select" defaultValue="" disabled={project.subjects.length === 0} onChange={(e) => {
          add(e.target.value);
          e.target.value = '';
        }}>
          <option value="">{project.subjects.length > 0 ? '+ 新增绑定…' : '请先新建数据源'}</option>
          {(spec?.bindableProps ?? []).map((prop) => (
            <option key={prop} value={`prop:${prop}`}
              disabled={usedDescriptors.has(`prop:${prop}`) || !project.subjects.some((subject) => subjectMatchesDescriptor(subject, 'prop', prop))}>
              属性 · {BINDABLE_LABELS[prop]}{!project.subjects.some((subject) => subjectMatchesDescriptor(subject, 'prop', prop)) ? `（需${bindingTypeHint('prop', prop)}数据源）` : ''}
            </option>
          ))}
          {OBJ_BASE.flags.map((flag) => (
            <option key={`flag:${flag}`} value={`flag:${flag}`}
              disabled={usedDescriptors.has(`flag:${flag}`) || !project.subjects.some((subject) => subjectMatchesDescriptor(subject, 'flag', flag))}>
              标志 · {flag}{!project.subjects.some((subject) => subjectMatchesDescriptor(subject, 'flag', flag)) ? '（需整数数据源）' : ''}
            </option>
          ))}
          {OBJ_BASE.states.map((state) => (
            <option key={`state:${state}`} value={`state:${state}`}
              disabled={usedDescriptors.has(`state:${state}`) || !project.subjects.some((subject) => subjectMatchesDescriptor(subject, 'state', state))}>
              状态 · {state}{!project.subjects.some((subject) => subjectMatchesDescriptor(subject, 'state', state)) ? '（需整数数据源）' : ''}
            </option>
          ))}
          {styles.map((style) => (
            <option key={`style:${style.id}`} value={`style:${style.id}`}
              disabled={!project.subjects.some((subject) => subjectMatchesDescriptor(subject, 'style', style.id))}>
              样式 · {style.displayName || style.codeName || style.id}{!project.subjects.some((subject) => subjectMatchesDescriptor(subject, 'style', style.id)) ? '（需整数数据源）' : ''}
            </option>
          ))}
        </select>
      </div>
      {node.bindings.map((binding, index) => (
        <BindingItem key={`${index}:${binding.kind}`} binding={binding} subjects={project.subjects}
          styles={styles} parts={spec?.parts ?? ['main']}
          onChange={(next) => update(index, next)} onRemove={() => remove(index)} />
      ))}
      {node.bindings.length === 0 && <div className="insp-note">可把组件属性、显示标志或状态连接到数据源。</div>}
    </section>
  );
}

function bindingTypeHint(kind: string, target: string): string {
  if (kind !== 'prop' || target === 'checked') return '整数';
  if (target === 'text') return '整数、浮点或文本';
  return '整数或浮点';
}

function bindingDescriptorLabel(kind: string, target: string): string {
  if (kind === 'prop') return `属性 · ${BINDABLE_LABELS[target as BindableProp] ?? target}`;
  if (kind === 'style') return '命名样式';
  return `${kind === 'flag' ? '标志' : '状态'} · ${target}`;
}

function subjectMatchesDescriptor(subject: SubjectDefV2, kind: string, target: string): boolean {
  if (kind !== 'prop') return subject.type === 'int';
  if (target === 'checked') return subject.type === 'int';
  if (target === 'text') return subject.type === 'int' || subject.type === 'float' || subject.type === 'string';
  return subject.type === 'int' || subject.type === 'float';
}

function BindingItem(props: {
  binding: BindingV2;
  subjects: SubjectDefV2[];
  styles: { id: string; codeName?: string; displayName?: string }[];
  parts: readonly string[];
  onChange: (binding: BindingV2) => void;
  onRemove: () => void;
}): JSX.Element {
  const { binding, subjects, styles, parts, onChange, onRemove } = props;
  const style = binding.kind === 'style' ? styles.find((item) => item.id === binding.styleId) : undefined;
  const target = binding.kind === 'prop' ? BINDABLE_LABELS[binding.prop]
    : binding.kind === 'flag' ? `标志 · ${binding.flag}`
      : binding.kind === 'state' ? `状态 · ${binding.state}`
        : `样式 · ${style?.displayName || style?.codeName || binding.styleId}`;
  const missing = !subjects.some((subject) => subject.id === binding.subject);
  const incompatible = subjects.some((subject) => subject.id === binding.subject
    && !subjectMatchesDescriptor(subject, binding.kind, binding.kind === 'prop' ? binding.prop : ''));
  return (
    <div className="child-item" data-binding-kind={binding.kind}>
      <div className="child-head">
        <span>{target}</span>
        <button className="icon-btn" title="删除绑定" onClick={onRemove}>✕</button>
      </div>
      <div className="child-body">
        <div className="prop-row">
          <label>数据源</label>
          <select className="ed-select" value={binding.subject} onChange={(e) => onChange({ ...binding, subject: e.target.value })}>
            {missing && <option value={binding.subject}>{binding.subject}（已失效）</option>}
            {subjects.map((subject) => {
              const compatible = subjectMatchesDescriptor(subject, binding.kind, binding.kind === 'prop' ? binding.prop : '');
              return <option key={subject.id} value={subject.id} disabled={!compatible}>{subject.displayName || subject.codeName} · {subject.type}{compatible ? '' : '（类型不兼容）'}</option>;
            })}
          </select>
        </div>
        {incompatible && <div className="insp-note warning">当前数据源类型不兼容，请更换后再导出。</div>}
        {(binding.kind === 'flag' || binding.kind === 'state') && (
          <>
            <div className="prop-row">
              <label>条件</label>
              <select className="ed-select" value={binding.op} onChange={(e) => onChange({ ...binding, op: e.target.value as CmpOp })}>
                {(Object.keys(CMP_OP_LABELS) as CmpOp[]).map((op) => <option key={op} value={op}>{CMP_OP_LABELS[op]}</option>)}
              </select>
            </div>
            <div className="prop-row">
              <label>比较值</label>
              <input className="ed-num" type="number" value={binding.refValue} onChange={(e) => onChange({ ...binding, refValue: Number(e.target.value) })} />
            </div>
          </>
        )}
        {binding.kind === 'prop' && binding.prop === 'text' && (
          <div className="prop-row">
            <label>格式</label>
            <TextCommitEditor value={binding.fmt ?? ''} placeholder="%s" onCommit={(fmt) => onChange({ ...binding, fmt: fmt || undefined })} />
          </div>
        )}
        {binding.kind === 'style' && (
          <>
            <div className="prop-row">
              <label>应用部件</label>
              <select className="ed-select" value={binding.selector?.part ?? 'main'} onChange={(e) => onChange({
                ...binding,
                selector: normSelector(binding.selector?.states?.[0] ?? 'default', e.target.value),
              })}>
                {parts.map((part) => <option key={part} value={part}>{part}</option>)}
              </select>
            </div>
            <div className="prop-row">
              <label>组件状态</label>
              <select className="ed-select" value={binding.selector?.states?.[0] ?? 'default'} onChange={(e) => onChange({
                ...binding,
                selector: normSelector(e.target.value as StateToken, binding.selector?.part ?? 'main'),
              })}>
                {STATE_TOKENS.map((state) => <option key={state} value={state}>{state}</option>)}
              </select>
            </div>
          </>
        )}
      </div>
    </div>
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

function namedStyleUseCount(styleId: string): number {
  const project = useProjectStore.getState().uiProject;
  let count = 0;
  visitNodes([
    ...project.screens.map((screen) => screen.root),
    ...project.components.map((component) => component.root),
  ], (node) => {
    count += node.styleRefs.filter((usage) => usage.styleId === styleId).length;
    count += node.bindings.filter((binding) => binding.kind === 'style' && binding.styleId === styleId).length;
  });
  return count;
}

function StyleTab({ node }: { node: WidgetNodeV2 }): JSX.Element {
  const uiProject = useProjectStore((state) => state.uiProject);
  const component = componentForNode(uiProject, node);
  const effectiveType = component?.root.type ?? node.type;
  const spec = REGISTRY.get(effectiveType);
  const fonts = useProjectStore((s) => s.project.assets.fonts);
  const fontTokens = useMemo(
    () => [
      ...M1_TEXT_FONTS,
      ...fonts.map((font) => font.name).filter((name) => !M1_TEXT_FONTS.includes(name)),
    ],
    [fonts],
  );
  const [state, setState] = useState<StateToken>('default');
  const [part, setPart] = useState<string>('main');
  const [styleTarget, setStyleTarget] = useState<string>('local');
  const parts = spec?.parts ?? ['main'];
  const selector = normSelector(state, part);
  const group: LocalStyleGroup | undefined = node.styles.find((g) => sameSelector(g.selector, selector));
  const screenStyles = findNodeByIdV2(uiProject, node.id)?.screen.styles ?? [];
  const namedStyles = [...uiProject.styles, ...screenStyles]
    .filter((style, index, list) => list.findIndex((item) => item.id === style.id) === index);
  const namedTarget = styleTarget === 'local'
    ? undefined
    : namedStyles.find((style) => style.id === styleTarget);
  const styleValues = namedTarget?.props ?? group?.props;
  const appliedAtSelector = (styleId: string): boolean => node.styleRefs.some(
    (usage) => usage.styleId === styleId && sameSelector(usage.selector, selector),
  );

  const setStyleProp = (key: string, v: PropValueV2 | undefined): void => {
    useProjectStore.getState().mutateV2(
      `改样式 ${key}`,
      (draft) => {
        if (namedTarget) {
          const current = draft.styles.find((style) => style.id === namedTarget.id)
            ?? draft.screens.flatMap((screen) => screen.styles).find((style) => style.id === namedTarget.id);
          if (!current) return;
          if (v === undefined) delete current.props[key];
          else current.props[key] = v;
          return;
        }
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
      v === undefined ? {} : {
        coalesceKey: namedTarget
          ? `named-style:${namedTarget.id}:${key}`
          : `style:${node.id}:${state}:${part}:${key}`,
      },
    );
  };

  const extractNamedStyle = (): void => {
    if (!group || Object.keys(group.props).length === 0) return;
    // Immer recipe 里的 current 是 Proxy，不能直接 structuredClone；在进入事务前复制普通状态值。
    const extractedProps = structuredClone(group.props);
    const allCodeNames = new Set(namedStyles.map((style) => style.codeName).filter(Boolean));
    let ordinal = namedStyles.length + 1;
    while (allCodeNames.has(`style_${ordinal}`)) ordinal += 1;
    const id = newUuid();
    useProjectStore.getState().mutateV2('提取复用样式', (draft) => {
      const hit = findNodeByIdV2(draft, node.id);
      if (!hit) return;
      const current = hit.node.styles.find((item) => sameSelector(item.selector, selector));
      if (!current || Object.keys(current.props).length === 0) return;
      draft.styles.push({
        id, codeName: `style_${ordinal}`, displayName: `复用样式 ${ordinal}`,
        props: extractedProps,
      });
      hit.node.styles = hit.node.styles.filter((item) => item !== current);
      hit.node.styleRefs.push(selector ? { styleId: id, selector } : { styleId: id });
    });
    setStyleTarget(id);
  };

  const applyNamedStyle = (): void => {
    if (!namedTarget || appliedAtSelector(namedTarget.id)) return;
    useProjectStore.getState().mutateV2('应用复用样式', (draft) => {
      const hit = findNodeByIdV2(draft, node.id);
      if (hit) hit.node.styleRefs.push(selector
        ? { styleId: namedTarget.id, selector }
        : { styleId: namedTarget.id });
    });
  };

  const removeStyleUsage = (index: number): void => {
    useProjectStore.getState().mutateV2('解除复用样式', (draft) => {
      findNodeByIdV2(draft, node.id)?.node.styleRefs.splice(index, 1);
    });
  };

  const deleteNamedStyle = (): void => {
    if (!namedTarget) return;
    const uses = namedStyleUseCount(namedTarget.id);
    if (uses > 0) {
      useEditorStore.getState().setBanner(`复用样式正被 ${uses} 处使用，请先解除应用或绑定`);
      return;
    }
    if (!uiProject.styles.some((style) => style.id === namedTarget.id)) {
      useEditorStore.getState().setBanner('屏幕局部命名样式暂不在此处删除');
      return;
    }
    useProjectStore.getState().mutateV2('删除复用样式', (draft) => {
      draft.styles = draft.styles.filter((style) => style.id !== namedTarget.id);
    });
    setStyleTarget('local');
  };

  return (
    <div className="insp-body">
      {component && (
        <div className="insp-note">
          关联组件：{component.displayName ?? component.codeName}。此处修改的是当前实例覆盖值。
        </div>
      )}
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
      <section className="insp-group named-style-section">
        <div className="panel-subtitle">复用样式</div>
        <div className="prop-row">
          <label>编辑目标</label>
          <select className="ed-select" value={namedTarget?.id ?? 'local'} onChange={(e) => setStyleTarget(e.target.value)}>
            <option value="local">当前组件局部样式</option>
            {namedStyles.map((style) => (
              <option key={style.id} value={style.id}>{style.displayName || style.codeName || style.id}</option>
            ))}
          </select>
        </div>
        <div className="named-style-actions">
          <button className="btn btn-sm" disabled={!group || Object.keys(group.props).length === 0}
            onClick={extractNamedStyle}>提取当前样式</button>
          <button className="btn btn-sm" disabled={!namedTarget || appliedAtSelector(namedTarget.id)}
            onClick={applyNamedStyle}>应用到当前状态/部件</button>
          <button className="btn btn-sm" disabled={!namedTarget} onClick={deleteNamedStyle}>删除样式</button>
        </div>
        {node.styleRefs.map((usage, index) => {
          const style = namedStyles.find((item) => item.id === usage.styleId);
          const usagePart = usage.selector?.part ?? 'main';
          const usageStates = (usage.selector?.states ?? []).filter((item) => item !== 'default').join('|') || 'default';
          return (
            <div className="named-style-usage" key={`${usage.styleId}:${index}`}>
              <span>{style?.displayName || style?.codeName || `${usage.styleId}（已失效）`} · {usagePart}/{usageStates}</span>
              <button className="icon-btn" title="解除复用样式" onClick={() => removeStyleUsage(index)}>✕</button>
            </div>
          );
        })}
        {namedStyles.length === 0 && <div className="insp-note">先设置局部样式，再点击“提取当前样式”即可复用和动态绑定。</div>}
      </section>
      <div className="panel-subtitle">{namedTarget ? `命名样式 · ${namedTarget.displayName || namedTarget.codeName || namedTarget.id}` : '局部样式(style_*)'}</div>
      {M1_INSPECTOR_STYLE_KEYS.map((key) => {
        const sp = STYLE_PROPS[key];
        if (!sp) return null;
        return (
          <StyleRow
            key={key}
            spec={sp}
            fontTokens={fontTokens}
            value={styleValues?.[key]}
            onChange={(v) => setStyleProp(key, v)}
          />
        );
      })}
    </div>
  );
}

function StyleRow(props: {
  spec: StylePropSpec;
  fontTokens: readonly string[];
  value: PropValueV2 | undefined;
  onChange: (v: PropValueV2 | undefined) => void;
}): JSX.Element {
  const { spec, fontTokens, value, onChange } = props;
  const isSet = value !== undefined && value !== null;
  return (
    <div className={`prop-row ${isSet ? '' : 'unset'}`}>
      <label title={`style_${spec.key}`}>{spec.key}</label>
      <ValueEditor
        type={spec.type === 'fontRef' ? 'fontRef' : spec.type}
        tokens={spec.type === 'fontRef' ? fontTokens : spec.enum?.tokens}
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
  const uiProject = useProjectStore((state) => state.uiProject);
  const themes = uiProject.themes;
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
    case 'float':
      return (
        <input
          className="ed-num"
          type="number"
          step="any"
          min={min}
          max={max}
          placeholder={ph}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'subject': {
      const current = typeof value === 'string' ? value : '';
      return (
        <select
          className="ed-select"
          value={current}
          onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
          title={uiProject.subjects.length === 0 ? '请先在“交互”页新建数据源' : undefined}
        >
          <option value="">{uiProject.subjects.length === 0 ? '(暂无数据源)' : '(未绑定)'}</option>
          {current !== '' && !uiProject.subjects.some((subject) => subject.codeName === current) && (
            <option value={current}>{current}（已失效）</option>
          )}
          {uiProject.subjects.map((subject) => (
            <option key={subject.id} value={subject.codeName}>
              {subject.displayName || subject.codeName} · {subject.type}
            </option>
          ))}
        </select>
      );
    }
    case 'styleRef': {
      const current = typeof value === 'string' ? value : '';
      const screenStyles = node ? findNodeByIdV2(uiProject, node.id)?.screen.styles ?? [] : [];
      const styles = [...uiProject.styles, ...screenStyles]
        .filter((style, index, list) => list.findIndex((item) => item.id === style.id) === index);
      return (
        <select
          className="ed-select"
          value={current}
          onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
        >
          <option value="">{styles.length === 0 ? '(暂无命名样式)' : '(未设置)'}</option>
          {current !== '' && !styles.some((style) => style.codeName === current) && (
            <option value={current}>{current}（已失效）</option>
          )}
          {styles.map((style) => (
            <option key={style.id} value={style.codeName ?? ''} disabled={style.codeName === undefined}>
              {style.displayName || style.codeName || style.id}
            </option>
          ))}
        </select>
      );
    }
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
