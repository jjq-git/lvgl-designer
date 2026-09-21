/**
 * 工厂:createEmptyProject / createNode。
 */
import {
  SCHEMA_VERSION,
  type LvProject, type PropValue, type ScreenDef, type WidgetNode,
} from './project.js';
import { newUuid } from './ids.js';
import { REGISTRY } from './widgets/index.js';

export const APP_VERSION = '0.1.0';

function emptyNode(type: string): WidgetNode {
  return {
    id: newUuid(),
    type,
    props: {},
    styles: [],
    inlineStyles: [],
    events: [],
    bindings: [],
    children: [],
  };
}

/**
 * 新建 widget 节点:props 以 registry defaultSize 预填 width/height
 * (数值/'content'/'n%' 均为合法 Size)。
 */
export function createNode(type: string): WidgetNode {
  const spec = REGISTRY.get(type);
  if (!spec) throw new Error(`未知 widget 类型:${type}`);
  const node = emptyNode(type);
  if (spec.defaultSize) {
    node.props['width'] = spec.defaultSize.w as PropValue;
    node.props['height'] = spec.defaultSize.h as PropValue;
  }
  return node;
}

function createScreen(name: string): ScreenDef {
  const root = emptyNode('obj');
  return {
    id: newUuid(),
    name,
    isHome: true,
    styles: [],
    consts: [],
    root,
  };
}

/**
 * 空工程:240x240 圆屏默认(GC9A01 场景),16bpp,单屏 main。
 */
export function createEmptyProject(name = 'untitled'): LvProject {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      name,
      lvglVersion: '9.4',
      appVersion: APP_VERSION,
      createdAt: now,
      modifiedAt: now,
    },
    display: { width: 240, height: 240, shape: 'round', colorDepth: 16, dpi: 130 },
    screens: [createScreen('main')],
    components: [],
    styles: [],
    consts: [],
    subjects: [],
    assets: { fonts: [], images: [] },
    translations: null,
    codegen: { outputDirName: 'ui', exportXml: false, userIncludes: [] },
  };
}
