/**
 * promptBuilder:AI 画 UI 的 system prompt(目标 ~3k tokens 内)。
 * registry 说明从 REGISTRY/OBJ_BASE/STYLE_PROPS 程序化生成,永不与 schema 脱节。
 */
import {
  ALL_WIDGETS, M1_INSPECTOR_STYLE_KEYS, M1_TEXT_FONTS, OBJ_BASE, STYLE_PROPS,
  type LvProject, type PropSpec, type ScreenDef, type WidgetNode,
} from '@lvd/schema';
import type { NodeSpec } from './opsSchema.js';

/* ------------------------------------------------------------ registry 文档 */

function propBrief(p: PropSpec): string {
  if (p.type === 'enum' && p.enum) return `${p.key}∈(${p.enum.tokens.join('|')})`;
  return `${p.key}:${p.type}`;
}

/** 每 widget 一行:type(中文名) 专有props… [子] */
export function buildWidgetLines(): string[] {
  return ALL_WIDGETS.map((w) => {
    const props = w.props
      .filter((p) => p.channel !== 'c-only')     // 画布不生效的省掉
      .map(propBrief)
      .join(' ');
    const label = w.palette?.label ?? '';
    const kids = w.acceptsWidgetChildren ? ' [可含子控件]' : '';
    return `- ${w.type}(${label})${props ? ' ' + props : ''}${kids}`;
  });
}

export function buildRegistryDoc(): string {
  const objProps = OBJ_BASE.props.map(propBrief).join(' ');
  const styleLines = M1_INSPECTOR_STYLE_KEYS.map((key) => {
    const s = STYLE_PROPS[key];
    if (!s) return key;
    return s.type === 'enum' && s.enum ? `${key}∈(${s.enum.tokens.join('|')})` : `${key}:${s.type}`;
  }).join(' ');
  return [
    '可用 widget(type(中文名) 专有props;[可含子控件]=children 可放任意 widget):',
    ...buildWidgetLines(),
    '',
    `全部 widget 通用属性(props 里直接写):${objProps}`,
    "类型说明:size=整数px|'content'|'50%';opa=0-255|'n%';color='#RRGGBB';bool=true/false;pointList=[x1,y1,x2,y2,…]",
    `通用 flags(布尔,写在 flags 里):${OBJ_BASE.flags.join('|')}`,
    `通用 states(布尔,写在 states 里):${OBJ_BASE.states.join('|')}`,
    '',
    `常用样式键(写在 inlineStyles[].props 里):${styleLines}`,
    `text_font 可选值:${M1_TEXT_FONTS[0]}…${M1_TEXT_FONTS[M1_TEXT_FONTS.length - 1]}(montserrat_8..48 偶数号,仅英文数字字形)`,
    "selector 语法:inlineStyles 元素可带 selector:{states?:['pressed'|'checked'|'focused'|'disabled'…], part?:'main'|'indicator'|'knob'|'scrollbar'|'selected'|'items'|'cursor'},省略=默认状态主部件",
  ].join('\n');
}

/* ------------------------------------------------------------ ops 协议文档 */

const OPS_PROTOCOL = [
  '你必须只输出一个 JSON 对象(不要 markdown 围栏、不要解释文字),格式:',
  '{"reply":"给用户的一句中文说明","ops":[…]}',
  'ops 为编辑操作数组(纯聊天可为空数组),四种操作:',
  '{"op":"replace_screen","root":NodeSpec} —— 整屏重画,root.type 必须是 "obj"',
  '{"op":"add","parent":"父控件name"|null,"node":NodeSpec} —— parent=null 表示加到屏根',
  '{"op":"update","target":"控件name","props"?:{…},"inlineStyles"?:[…],"flags"?:{…},"states"?:{…}}',
  '{"op":"remove","target":"控件name"}',
  'NodeSpec={"type":"…","name"?:"…","props"?:{…},"inlineStyles"?:[{"selector"?:{…},"props":{…}}],"flags"?:{…},"states"?:{…},"children"?:[NodeSpec…]}(不要写 id)',
  '',
  '示例1(加一个标题和滑条):',
  '{"reply":"已添加标题和亮度滑条","ops":[{"op":"add","parent":null,"node":{"type":"label","name":"title_label","props":{"text":"亮度","align":"top_mid","y":28}}},{"op":"add","parent":null,"node":{"type":"slider","name":"brightness_slider","props":{"width":160,"height":14,"align":"center","value":60},"inlineStyles":[{"selector":{"part":"knob"},"props":{"bg_color":"#3b82f6"}}]}}]}',
  '示例2(改值+删控件):',
  '{"reply":"滑条改为 80,删除了旧标签","ops":[{"op":"update","target":"brightness_slider","props":{"value":80}},{"op":"remove","target":"old_label"}]}',
].join('\n');

/* ------------------------------------------------------------ 当前屏精简 */

/** WidgetNode → 精简 NodeSpec(去 id/editor/events/bindings/空字段) */
export function compactNode(node: WidgetNode): NodeSpec {
  const out: NodeSpec = { type: node.type };
  if (node.name) out.name = node.name;
  if (Object.keys(node.props).length > 0) out.props = node.props;
  const flags = node.flags && Object.keys(node.flags).length > 0 ? node.flags : undefined;
  if (flags) out.flags = flags as Record<string, boolean>;
  const states = node.states && Object.keys(node.states).length > 0 ? node.states : undefined;
  if (states) out.states = states as Record<string, boolean>;
  if (node.inlineStyles.length > 0) out.inlineStyles = node.inlineStyles;
  if (node.children.length > 0) out.children = node.children.map(compactNode);
  return out;
}

function screenSection(project: LvProject, screen: ScreenDef): string {
  const d = project.display;
  const shape = d.shape === 'round' ? '圆形' : '矩形';
  return [
    `当前屏幕:${d.width}x${d.height} ${shape}屏,screen name=${screen.name}`,
    `当前屏内容(精简 JSON,name 可作 update/remove/add.parent 的目标):`,
    JSON.stringify(compactNode(screen.root)),
  ].join('\n');
}

/* ---------------------------------------------------------------- 规则 */

function rulesSection(project: LvProject): string {
  const d = project.display;
  const rules = [
    `1. 坐标/尺寸不得越界:屏幕 ${d.width}x${d.height},x/y 配合 align 使用,内容留边距`,
    '2. 文字用 label(中文直接写在 text 里;中文不要设 text_font,内置 montserrat 只有英文数字字形)',
    '3. name 用蛇形小写英文(^[a-z][a-z0-9_]*$,不以 lv_/ui_ 开头),同屏不重名',
    '4. 改现有控件用 update/remove 引用其 name;只有用户要全新界面才 replace_screen',
    '5. 未列出的 widget 类型/属性/样式键一律不要用',
  ];
  if (d.shape === 'round') {
    rules.push(`6. 圆屏:四角被裁掉,重要内容放内切圆内(中心 ${d.width / 2},${d.height / 2},半径 ${Math.min(d.width, d.height) / 2}),避免贴边贴角`);
  }
  return ['硬性规则:', ...rules].join('\n');
}

/* ---------------------------------------------------------------- 入口 */

/**
 * 组 system prompt:角色 + registry + ops 协议 + 当前屏 + 选中节点 + 规则。
 */
export function buildSystemPrompt(
  project: LvProject,
  activeScreenId: string,
  selectedNode?: WidgetNode | null,
): string {
  const screen = project.screens.find((s) => s.id === activeScreenId) ?? project.screens[0];
  const parts: string[] = [
    '你是嵌入式 LVGL 9.5.0 UI 设计助手,在一个可视化设计器里通过结构化编辑操作(ops)帮用户画界面。'
    + '当前编辑态使用 LVGL 9.5.0 PreviewProgram/WASM;只生成受支持的结构化 ops,'
    + '不得生成 XML、cPatch 或任意 C;'
    + '你的输出会被程序解析:必须是严格 JSON,任何解释都放在 reply 字段里。',
    '',
    buildRegistryDoc(),
    '',
    OPS_PROTOCOL,
    '',
  ];
  if (screen) parts.push(screenSection(project, screen), '');
  if (selectedNode) {
    parts.push(
      `用户当前选中的控件:type=${selectedNode.type}${selectedNode.name ? `,name=${selectedNode.name}` : '(未命名,无法用 ops 引用,如需修改让用户先命名或按位置重画)'}。用户说"这个/它"即指此控件。`,
      '',
    );
  }
  parts.push(rulesSection(project));
  return parts.join('\n');
}

/* ------------------------------------------------------------ token 估算 */

/**
 * 粗估 token 数(DeepSeek 官方经验:1 汉字≈0.6 token,1 英文字符≈0.3 token)。
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[　-鿿豈-﫿＀-￯]/.test(ch)) cjk++;
    else other++;
  }
  return Math.ceil(cjk * 0.6 + other * 0.3);
}
