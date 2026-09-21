/**
 * reloadPipeline — projectStore 订阅 → immer patch diff 分级 → LvglRuntime。
 *
 * 分级(ARCHITECTURE §3.4):
 * - L1 属性级:白名单属性(x/y/w/h/align/widget 值属性/style_* 内联/flags/states,
 *   op=add|replace 且值非空)→ runtime.updateAttrs(previewName, xmlTag, attrs)
 * - L2 控件级:M1 简化 —— 节点增删并入 L3(reloadScreen 毫秒级,肉眼无感;
 *   createChild/deleteObj 快路径留待 M2 再启用)
 * - L3 屏级:结构变更/重排/任何属性从有到无/命名样式与事件绑定变更 → reloadScreen 五步序列
 * - L4 全工程:subjects/consts/全局 styles/assets/screens 增删/屏改名/display → reloadAll
 *
 * 9.5 runtime 走 PreviewProgram 全量事务重建；旧 9.4 runtime 保留上述
 * XML 增量路径作为迁移回退。runtimeNameToNodeId/previewNameToId 存在
 * 管线内，hitTest 反查节点 id 靠它。
 */
import type { Patch } from 'immer';
import type { LvdRect, LvglRuntimeApi } from '@lvd/lvgl-runtime';
import { compilePreview } from '@lvd/preview-compiler';
import {
  REGISTRY,
  formatValueForXml,
  previewName,
  type LvProject,
  type WidgetNode,
} from '@lvd/schema';
import { emitXml } from '../services/codegen/adapter';
import { fmtStyleValue, keyMapFor, selectorSuffix } from '../services/codegen/localEmitXml';
import { findNodeById, useProjectStore } from '../stores/projectStore';
import {
  runtimeColorFormat as resolvedRuntimeColorFormat,
  useBuildTargetStore,
} from '../stores/buildTargetStore';
import { useEditorStore } from '../stores/editorStore';

/* ---------------- diff 分级 ---------------- */

type L1Change =
  | { kind: 'prop'; key: string }
  | { kind: 'flag'; key: string }
  | { kind: 'state'; key: string }
  | { kind: 'style'; key: string; groupIndex: number };

interface Delta {
  level: 0 | 1 | 3 | 4;
  displayChanged: boolean;
  /** L1:nodeId → 变更清单 */
  l1: Map<string, L1Change[]>;
  /** L3:受影响 screen id 集 */
  screens: Set<string>;
}

function classify(patches: Patch[], project: LvProject): Delta {
  const d: Delta = { level: 0, displayChanged: false, l1: new Map(), screens: new Set() };
  const raise = (lv: 1 | 3 | 4): void => {
    if (lv > d.level) d.level = lv;
  };

  for (const patch of patches) {
    const p = patch.path as (string | number)[];
    const head = p[0];
    if (head === 'meta' || head === 'codegen' || head === 'editor') continue;
    if (head === 'display') {
      d.displayChanged = true;
      raise(4);
      continue;
    }
    if (head === 'styles' || head === 'consts' || head === 'subjects' || head === 'assets'
      || head === 'translations' || head === 'components' || head === 'schemaVersion') {
      raise(4);
      continue;
    }
    if (head !== 'screens') {
      raise(4);
      continue;
    }
    // screens ...
    if (p.length <= 2) {
      raise(4); // 屏增删/整屏替换
      continue;
    }
    const si = p[1] as number;
    const screen = project.screens[si];
    if (!screen) {
      raise(4);
      continue;
    }
    const field = p[2];
    if (field === 'name') {
      raise(4); // 注册名变更,旧组件/旧屏实例需全量清理
      continue;
    }
    if (field === 'displayName' || field === 'isHome') continue;
    if (field === 'styles' || field === 'consts') {
      d.screens.add(screen.id);
      raise(3);
      continue;
    }
    if (field !== 'root') {
      raise(4);
      continue;
    }

    // 节点内路径:root(.children.<i>)* 然后 tail
    let node: WidgetNode | undefined = screen.root;
    let i = 3;
    while (i + 1 < p.length && p[i] === 'children' && typeof p[i + 1] === 'number') {
      node = node?.children[p[i + 1] as number];
      i += 2;
    }
    const tail = p.slice(i);
    const escalate3 = (): void => {
      d.screens.add(screen.id);
      raise(3);
    };

    if (!node || tail.length === 0) {
      escalate3(); // 整节点替换 / 路径失效(undo 删除等)
      continue;
    }
    if (tail[0] === 'children') {
      escalate3(); // 增删/重排(L2 并入 L3,见文件头)
      continue;
    }
    // 根节点(<view>/屏对象)的 L1 定位依赖 screen 名反查,find_by_name 自身语义未验证 → 一律 L3
    const isRoot = node === screen.root;

    const removedValue = patch.op === 'remove';
    const pushL1 = (c: L1Change): void => {
      if (isRoot) {
        escalate3();
        return;
      }
      const list = d.l1.get(node!.id) ?? [];
      list.push(c);
      d.l1.set(node!.id, list);
      raise(1);
    };

    if (tail[0] === 'props' && tail.length >= 2) {
      const key = String(tail[1]);
      const cur = node.props[key];
      if (removedValue || cur === undefined || cur === null) {
        escalate3(); // 属性从有到无 → 强制 ≥L3(update 无法还原默认值)
      } else if (keyMapFor(node.type).has(key)) {
        pushL1({ kind: 'prop', key });
      } else {
        escalate3(); // 未知键,兜底
      }
      continue;
    }
    if ((tail[0] === 'flags' || tail[0] === 'states') && tail.length === 2) {
      const key = String(tail[1]);
      const bag = tail[0] === 'flags' ? node.flags : node.states;
      const cur = (bag as Record<string, boolean | undefined> | undefined)?.[key];
      if (removedValue || cur === undefined) escalate3();
      else pushL1({ kind: tail[0] === 'flags' ? 'flag' : 'state', key });
      continue;
    }
    if (tail[0] === 'flags' || tail[0] === 'states') {
      // 整个 flags/states 对象初建(add {}or{k:v}):按 L1 发该对象现有全部键
      const bag = (tail[0] === 'flags' ? node.flags : node.states) ?? {};
      if (removedValue) {
        escalate3();
      } else {
        for (const key of Object.keys(bag)) {
          pushL1({ kind: tail[0] === 'flags' ? 'flag' : 'state', key });
        }
      }
      continue;
    }
    if (tail[0] === 'inlineStyles') {
      if (tail.length === 1) {
        escalate3();
        continue;
      }
      const gi = tail[1] as number;
      const group = node.inlineStyles[gi];
      if (!group || removedValue) {
        escalate3();
        continue;
      }
      if (tail.length === 2) {
        // 整组新建 → 发组内全部属性
        for (const key of Object.keys(group.props)) pushL1({ kind: 'style', key, groupIndex: gi });
        continue;
      }
      if (tail[2] === 'props' && tail.length >= 4) {
        const key = String(tail[3]);
        if (group.props[key] === undefined || group.props[key] === null) escalate3();
        else pushL1({ kind: 'style', key, groupIndex: gi });
        continue;
      }
      escalate3(); // selector 变更等
      continue;
    }
    // name/displayName/events/bindings/styles/cPatch/editor …
    if (tail[0] === 'displayName' || tail[0] === 'editor') continue;
    escalate3();
  }
  return d;
}

/* ---------------- 管线 ---------------- */

export class ReloadPipeline {
  readonly runtime: LvglRuntimeApi;
  /** previewName → nodeId(全部屏合并;screen 名 → 根节点 id) */
  private nameToId = new Map<string, string>();
  private registeredStubs = new Set<string>();
  private unsub: (() => void) | null = null;
  private loadedScreens = new Set<string>(); // 已注册过的 screen name

  constructor(runtime: LvglRuntimeApi) {
    this.runtime = runtime;
  }

  /** 启动:全量 reloadAll + 订阅 projectStore(ARCHITECTURE §3.4 G5 管线) */
  start(): void {
    this.reloadAllNow();
    let prevRevision = useProjectStore.getState().revision;
    this.unsub = useProjectStore.subscribe((s) => {
      if (s.revision === prevRevision) return;
      prevRevision = s.revision;
      this.onChange(s.lastPatches, s.lastChangeKind === 'load', s.project);
    });
  }

  dispose(): void {
    this.unsub?.();
    this.unsub = null;
  }

  /** DisplayProfile/BuildTargetDraft 确认变化时重建真实 framebuffer。 */
  refreshTarget(): void {
    this.reloadAllNow();
  }

  private onChange(patches: Patch[], isLoad: boolean, project: LvProject): void {
    try {
      if (isLoad || patches.length === 0) {
        this.reloadAllNow();
        return;
      }
      const d = classify(patches, project);
      if (d.level === 0) return;
      // PreviewProgram v1 guarantees transactional preflight/full rebuild.
      // Fine-grained typed patches are a later protocol extension; until then
      // every semantic change takes the safe full-program route.
      if (this.runtime.supportsPreviewProgram()) {
        this.reloadAllNow();
        return;
      }
      if (d.level === 4) {
        this.reloadAllNow(); // 分辨率变化在 reloadAllNow 内统一处理
        return;
      }
      if (d.level === 3) {
        this.reloadScreens(d.screens, project);
        // L1 与 L3 混在一次 mutate 里时,L3 重建已覆盖 L1
        this.bump();
        return;
      }
      // L1
      for (const [nodeId, changes] of d.l1) {
        this.applyL1(nodeId, changes, project);
      }
      this.bump();
    } catch (e) {
      // 兜底:任何热重载异常回落全量重载,并亮横幅
      console.error('[reloadPipeline]', e);
      useEditorStore.getState().setBanner(`热重载异常:${(e as Error).message}`);
      try {
        this.reloadAllNow();
      } catch (e2) {
        console.error('[reloadPipeline] reloadAll fallback failed', e2);
      }
    }
  }

  private applyL1(nodeId: string, changes: L1Change[], project: LvProject): void {
    const hit = findNodeById(project, nodeId);
    if (!hit) return;
    const { node } = hit;
    const km = keyMapFor(node.type);
    const attrs: Record<string, string> = {};
    // prop 变更按 registry 描述表顺序发(与 XML emit 同序):
    // 部分 apply_cb 有属性间顺序依赖(如 qrcode 必须 size 先于 data 分配缓冲)
    const changedProps = new Set(changes.filter((c) => c.kind === 'prop').map((c) => c.key));
    if (changedProps.size > 0) {
      for (const [key, spec] of km) {
        if (!changedProps.has(key)) continue;
        const v = node.props[key];
        if (v === undefined || v === null) continue;
        attrs[spec.xmlAttr] = formatValueForXml(v, { type: spec.type, enum: spec.enum });
      }
    }
    for (const c of changes) {
      if (c.kind === 'prop') {
        continue; // 已按描述表顺序统一处理
      } else if (c.kind === 'flag') {
        const v = node.flags?.[c.key as keyof NonNullable<WidgetNode['flags']>];
        if (v === undefined) continue;
        attrs[c.key] = v ? 'true' : 'false';
      } else if (c.kind === 'state') {
        const v = node.states?.[c.key as keyof NonNullable<WidgetNode['states']>];
        if (v === undefined) continue;
        attrs[c.key] = v ? 'true' : 'false';
      } else {
        const g = node.inlineStyles[c.groupIndex];
        const v = g?.props[c.key];
        if (!g || v === undefined || v === null) continue;
        attrs[`style_${c.key}${selectorSuffix(g.selector)}`] = fmtStyleValue(c.key, v);
      }
    }
    if (Object.keys(attrs).length === 0) return;
    const xmlTag = REGISTRY.get(node.type)?.xmlTag ?? 'lv_obj';
    this.runtime.updateAttrs(previewName(node), xmlTag, attrs);
  }

  private lastW = 0;
  private lastH = 0;

  /** 全量重建：优先 PreviewProgram；旧 runtime 才走 XML migration path。 */
  reloadAllNow(): void {
    const project = useProjectStore.getState().project;
    useBuildTargetStore.getState().syncProject(project);
    if (project.display.width !== this.lastW || project.display.height !== this.lastH) {
      this.lastW = project.display.width;
      this.lastH = project.display.height;
      this.runtime.setResolution(this.lastW, this.lastH);
    }
    if (this.runtime.supportsPreviewProgram()) {
      // 已确认时由 DisplayProfile 驱动真实 framebuffer；有歧义的 v1 16bpp
      // 在确认前只用 XRGB8888 编辑预览，绝不把该回退写进发布 manifest。
      const result = compilePreview(project, { runtimeColorFormat: resolvedRuntimeColorFormat() });
      if (!result.program) {
        const details = result.diagnostics
          .filter((d) => d.severity === 'error')
          .map((d) => `${d.code}: ${d.message}`)
          .join('; ');
        throw new Error(`PreviewProgram 编译失败${details ? `：${details}` : ''}`);
      }
      this.runtime.loadPreviewProgram(result.program);
      this.nameToId.clear();
      this.loadedScreens.clear();
      for (const screen of result.program.screens) {
        this.loadedScreens.add(screen.name);
        for (const [name, id] of Object.entries(result.program.runtimeNameToNodeId[screen.name] ?? {})) {
          this.nameToId.set(name, id);
        }
      }
      this.loadActive(project);
      this.bump();
      return;
    }

    const res = emitXml(project);
    this.syncEventStubs(project);
    this.runtime.reloadAll(res.globalsXml, res.screens.map((s) => ({ name: s.name, xml: s.xml })));
    this.nameToId.clear();
    this.loadedScreens.clear();
    for (const s of res.screens) {
      this.loadedScreens.add(s.name);
      for (const [n, id] of Object.entries(s.previewNameToId)) this.nameToId.set(n, id);
    }
    this.loadActive(project);
    this.bump();
  }

  private reloadScreens(screenIds: Set<string>, project: LvProject): void {
    const res = emitXml(project);
    this.syncEventStubs(project);
    const active = this.activeScreenName(project);
    let reloadedActive = false;
    for (const sid of screenIds) {
      const screen = project.screens.find((s) => s.id === sid);
      if (!screen) continue;
      const out = res.screens.find((s) => s.name === screen.name);
      if (!out) continue;
      this.runtime.reloadScreen(out.name, out.xml);
      this.loadedScreens.add(out.name);
      for (const [n, id] of Object.entries(out.previewNameToId)) this.nameToId.set(n, id);
      if (out.name === active) reloadedActive = true;
    }
    // lvd_reload_screen 会 load 被重载的屏;若重载的不是活动屏,把活动屏切回来
    if (!reloadedActive && active) {
      try {
        this.runtime.loadScreen(active);
      } catch {
        /* 活动屏可能尚未注册 */
      }
    }
  }

  /** 切屏(懒建:未注册过则走一次 reloadScreen) */
  loadScreenById(screenId: string): void {
    const project = useProjectStore.getState().project;
    const screen = project.screens.find((s) => s.id === screenId);
    if (!screen) return;
    try {
      if (!this.loadedScreens.has(screen.name)) {
        this.reloadScreens(new Set([screen.id]), project);
      }
      this.runtime.loadScreen(screen.name);
    } catch (e) {
      useEditorStore.getState().setBanner(`切屏失败:${(e as Error).message}`);
    }
    this.bump();
  }

  /** 运行态退出等场景的强制复位(评审 G8) */
  resetActiveScreen(): void {
    const project = useProjectStore.getState().project;
    if (this.runtime.supportsPreviewProgram()) {
      this.reloadAllNow();
      return;
    }
    const active = useEditorStore.getState().activeScreenId;
    const screen = project.screens.find((s) => s.id === active) ?? project.screens[0];
    if (screen) this.reloadScreens(new Set([screen.id]), project);
    this.bump();
  }

  private loadActive(project: LvProject): void {
    const name = this.activeScreenName(project);
    if (!name) return;
    try {
      this.runtime.loadScreen(name);
    } catch {
      /* reload_all 可能已自动 load,容忍(m0 T4 同款) */
    }
  }

  private activeScreenName(project: LvProject): string | null {
    const id = useEditorStore.getState().activeScreenId;
    const s = project.screens.find((x) => x.id === id) ?? project.screens[0];
    return s?.name ?? null;
  }

  private syncEventStubs(project: LvProject): void {
    const names = new Set<string>();
    const walk = (n: WidgetNode): void => {
      for (const ev of n.events) if (ev.kind === 'callback') names.add(ev.callback);
      n.children.forEach(walk);
    };
    for (const s of project.screens) walk(s.root);
    for (const n of names) {
      if (this.registeredStubs.has(n)) continue;
      try {
        this.runtime.registerEventStub(n);
        this.registeredStubs.add(n);
      } catch (e) {
        console.warn('[reloadPipeline] registerEventStub failed', n, e);
      }
    }
  }

  private bump(): void {
    useEditorStore.getState().bumpOverlay();
  }

  /* ---------------- 查询(overlay / DnD 数据源) ---------------- */

  /** 命中测试 → 节点 id(previewNameToId 反查) */
  nodeIdAt(x: number, y: number): string | null {
    const name = this.runtime.hitTest(x, y);
    if (!name) return null;
    return this.nameToId.get(name) ?? null;
  }

  nameOf(nodeId: string): string | null {
    const project = useProjectStore.getState().project;
    const hit = findNodeById(project, nodeId);
    if (!hit) return null;
    if (hit.node === hit.screen.root) return hit.screen.name;
    return previewName(hit.node);
  }

  rectOf(nodeId: string): LvdRect | null {
    const name = this.nameOf(nodeId);
    if (!name) return null;
    try {
      return this.runtime.getObjRect(name);
    } catch {
      return null;
    }
  }

  /**
   * 活动屏内全部命名子节点(不含屏根)的 rect —— 框选(marquee)数据源。
   * 走 getObjRects(新语义:返回 Map,缺失/负尺寸的键不在 map 里)。
   */
  activeScreenNodeRects(): Map<string, LvdRect> {
    const project = useProjectStore.getState().project;
    const activeId = useEditorStore.getState().activeScreenId;
    const screen = project.screens.find((s) => s.id === activeId) ?? project.screens[0];
    if (!screen) return new Map();
    const ids: string[] = [];
    const walk = (n: WidgetNode): void => {
      for (const c of n.children) {
        ids.push(c.id); // 屏根不选,只收子孙
        walk(c);
      }
    };
    walk(screen.root);
    return this.rectsOf(ids);
  }

  rectsOf(nodeIds: string[]): Map<string, LvdRect> {
    const names: string[] = [];
    const byName = new Map<string, string>();
    for (const id of nodeIds) {
      const n = this.nameOf(id);
      if (!n) continue;
      names.push(n);
      byName.set(n, id);
    }
    const out = new Map<string, LvdRect>();
    try {
      const m = this.runtime.getObjRects(names);
      for (const [n, r] of m) {
        const id = byName.get(n);
        if (id) out.set(id, r);
      }
    } catch {
      /* mock 等场景 */
    }
    return out;
  }
}

/* ---------------- 模块级单例(CanvasStage 创建,面板消费) ---------------- */

let pipeline: ReloadPipeline | null = null;

export function setPipeline(p: ReloadPipeline | null): void {
  pipeline = p;
}

export function getPipeline(): ReloadPipeline | null {
  return pipeline;
}
