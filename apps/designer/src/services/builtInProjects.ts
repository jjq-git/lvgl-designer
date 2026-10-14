import { isProjectSnapshotV2 } from '@lvd/schema/v2';
import type { LvProject } from '@lvd/schema';
import { getAssetBytes, putAssetBytes, sha256Hex } from './assets';
import type { StoredProjectDocument } from './projectPersistence';

export interface BuiltInProjectDescriptor {
  id: string;
  name: string;
  width: number;
  height: number;
  shape: 'rect' | 'round';
  load(): Promise<StoredProjectDocument>;
}

export const WF3_BUILT_IN_REVISION = 9;

export async function ensureBuiltInProjectAssets(
  document: StoredProjectDocument,
): Promise<void> {
  if (typeof window === 'undefined') return;
  const fonts = isProjectSnapshotV2(document)
    ? document.uiProject.assets.fonts
    : (document as LvProject).assets.fonts;
  const fontFiles = fonts
    .map((font) => font.file)
    .filter((file, index, files) => (
      (file.fileName === 'NotoSansSC-WF3.ttf'
        || file.fileName === 'MaterialSymbolsOutlined-WF3-32.ttf'
        || file.fileName === 'MaterialSymbolsOutlined-WF3-36.ttf')
      && files.findIndex((candidate) => candidate.sha256 === file.sha256) === index
    ));

  for (const fontFile of fontFiles) {
    if (await getAssetBytes(fontFile.sha256)) continue;
    let fontUrl: string;
    if (fontFile.fileName === 'NotoSansSC-WF3.ttf') {
      fontUrl = (await import(
        '../../../../examples/wf3-firmware/assets/NotoSansSC-WF3.ttf?url'
      )).default;
    } else if (fontFile.fileName === 'MaterialSymbolsOutlined-WF3-32.ttf') {
      fontUrl = (await import(
        '../../../../examples/wf3-firmware/assets/MaterialSymbolsOutlined-WF3-32.ttf?url'
      )).default;
    } else {
      fontUrl = (await import(
        '../../../../examples/wf3-firmware/assets/MaterialSymbolsOutlined-WF3-36.ttf?url'
      )).default;
    }
    const response = await fetch(fontUrl);
    if (!response.ok) throw new Error(`WF3 内置字体加载失败：HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const actualSha = await sha256Hex(new Uint8Array(bytes));
    if (actualSha !== fontFile.sha256) throw new Error('WF3 内置字体校验失败');
    await putAssetBytes(fontFile.sha256, {
      bytes,
      mime: 'font/ttf',
      fileName: fontFile.fileName,
    });
  }
}

export const BUILT_IN_PROJECTS: readonly BuiltInProjectDescriptor[] = [
  {
    id: 'builtin:wf3-firmware-284x76',
    name: 'WF3 固件界面 · 284×76',
    width: 284,
    height: 76,
    shape: 'rect',
    async load() {
      const module = await import(
        '../../../../examples/wf3-firmware/WF3-284x76-firmware-ui.lvproj.json'
      );
      const document = module.default as StoredProjectDocument;
      return document;
    },
  },
  {
    id: 'builtin:wf2d-8620-quiet-focus',
    name: 'WF2D-8620 静音舱 · 专注计时',
    width: 240,
    height: 240,
    shape: 'round',
    async load() {
      const module = await import(
        '../../../../examples/quiet-pod-six-themes/WF2D-8620-quiet-focus.lvproj.json'
      );
      return module.default as StoredProjectDocument;
    },
  },
  {
    id: 'builtin:wf2d-8630-quiet-acoustics',
    name: 'WF2D-8630 静音舱 · 声学降噪',
    width: 480,
    height: 480,
    shape: 'rect',
    async load() {
      const module = await import(
        '../../../../examples/quiet-pod-six-themes/WF2D-8630-quiet-acoustics.lvproj.json'
      );
      return module.default as StoredProjectDocument;
    },
  },
  {
    id: 'builtin:wf2d-1050-quiet-lighting',
    name: 'WF2D-1050 静音舱 · 灯光场景',
    width: 1024,
    height: 600,
    shape: 'rect',
    async load() {
      const module = await import(
        '../../../../examples/quiet-pod-six-themes/WF2D-1050-quiet-lighting.lvproj.json'
      );
      return module.default as StoredProjectDocument;
    },
  },
  {
    id: 'builtin:wf2d-1040-quiet-air',
    name: 'WF2D-1040 静音舱 · 空气质量',
    width: 1080,
    height: 720,
    shape: 'rect',
    async load() {
      const module = await import(
        '../../../../examples/quiet-pod-six-themes/WF2D-1040-quiet-air.lvproj.json'
      );
      return module.default as StoredProjectDocument;
    },
  },
  {
    id: 'builtin:wf2d-1030-quiet-booking',
    name: 'WF2D-1030 静音舱 · 舱位预约',
    width: 1440,
    height: 720,
    shape: 'rect',
    async load() {
      const module = await import(
        '../../../../examples/quiet-pod-six-themes/WF2D-1030-quiet-booking.lvproj.json'
      );
      return module.default as StoredProjectDocument;
    },
  },
  {
    id: 'builtin:wf3-284x76-quiet-dnd',
    name: 'WF3-284x76 静音舱 · 一键静音',
    width: 284,
    height: 76,
    shape: 'rect',
    async load() {
      const module = await import(
        '../../../../examples/quiet-pod-six-themes/WF3-284x76-quiet-dnd.lvproj.json'
      );
      return module.default as StoredProjectDocument;
    },
  },
  {
    id: 'builtin:wf2d-1030-climate-control',
    name: 'WF2D-1030 Climate Control',
    width: 1440,
    height: 720,
    shape: 'rect',
    async load() {
      const module = await import(
        '../../../../examples/climate-control/WF2D-1030-climate-control.lvproj.json'
      );
      return module.default as StoredProjectDocument;
    },
  },
  {
    id: 'builtin:wf2d-1050-air-comfort',
    name: 'WF2D-1050 Air & Comfort',
    width: 1024,
    height: 600,
    shape: 'rect',
    async load() {
      const module = await import(
        '../../../../examples/air-comfort/WF2D-1050-air-comfort.lvproj.json'
      );
      return module.default as StoredProjectDocument;
    },
  },
  {
    id: 'builtin:wf2d-8630-room-climate',
    name: 'WF2D-8630 Room Climate',
    width: 480,
    height: 480,
    shape: 'rect',
    async load() {
      const module = await import(
        '../../../../examples/air-comfort/WF2D-8630-room-climate.lvproj.json'
      );
      return module.default as StoredProjectDocument;
    },
  },
];

export function findBuiltInProject(id: string): BuiltInProjectDescriptor | undefined {
  return BUILT_IN_PROJECTS.find((project) => project.id === id);
}

/** Replace cached WF3 drafts until they match the current bundled UI and fonts. */
export function isLegacyWf3NavigationProject(project: LvProject): boolean {
  const isTaggedExample = project.editor?.example === 'wf3-firmware-import';
  if (
    (!isTaggedExample && project.meta.name !== 'WF3 固件界面 · 284×76')
    || project.display.width !== 284
    || project.display.height !== 76
    || project.display.shape !== 'rect'
    || project.screens.length !== 46
  ) return false;
  const builtInRevision = project.editor?.builtInRevision;
  if (
    typeof builtInRevision !== 'number'
    || builtInRevision < WF3_BUILT_IN_REVISION
  ) return true;
  const home = project.screens.find((screen) =>
    screen.name === 'wf3_home' || screen.isHome === true);
  if (!home) return false;
  const directNames = new Set(home.root.children.map((node) => node.name));
  const hasCarouselNavigation = directNames.has('wf3_home_carousel_previous')
    && directNames.has('wf3_home_carousel_next')
    && [...directNames].some((name) => name?.startsWith('wf3_home_carousel_0_'));
  if (hasCarouselNavigation) return false;
  const titleBar = home.root.children.find((node) => node.name === 'wf3_home_titlebar');
  const title = titleBar?.children[0]?.props.text;
  const hasReferenceNavigation = directNames.has('wf3_home_reference_nav_0')
    && directNames.has('wf3_home_reference_nav_6')
    && title === 'UART';
  if (hasReferenceNavigation) return false;
  return title === 'UART'
    || title === '功能菜单'
    || [...directNames].some((name) => (
      name?.startsWith('wf3_home_nav_')
      || name?.startsWith('wf3_home_menu_')
    ));
}
