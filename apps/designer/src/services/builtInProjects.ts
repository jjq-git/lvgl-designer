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

export async function ensureBuiltInProjectAssets(
  document: StoredProjectDocument,
): Promise<void> {
  if (typeof window === 'undefined') return;
  const fontFile = isProjectSnapshotV2(document)
    ? document.uiProject.assets.fonts.find((font) => font.file.fileName === 'NotoSansSC-WF3.ttf')?.file
    : (document as LvProject).assets.fonts.find(
        (font) => font.file.fileName === 'NotoSansSC-WF3.ttf',
      )?.file;
  if (!fontFile || await getAssetBytes(fontFile.sha256)) return;

  const { default: fontUrl } = await import(
    '../../../../examples/wf3-firmware/assets/NotoSansSC-WF3.ttf?url'
  );
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
];

export function findBuiltInProject(id: string): BuiltInProjectDescriptor | undefined {
  return BUILT_IN_PROJECTS.find((project) => project.id === id);
}

/** Replace only the short-lived generated WF3 draft that used unrelated generic icons. */
export function isLegacyWf3NavigationProject(project: LvProject): boolean {
  const isTaggedExample = project.editor?.example === 'wf3-firmware-import';
  if (
    (!isTaggedExample && project.meta.name !== 'WF3 固件界面 · 284×76')
    || project.display.width !== 284
    || project.display.height !== 76
    || project.display.shape !== 'rect'
    || project.screens.length !== 46
  ) return false;
  const home = project.screens.find((screen) =>
    screen.name === 'wf3_home' || screen.isHome === true);
  if (!home) return false;
  const directNames = new Set(home.root.children.map((node) => node.name));
  const titleBar = home.root.children.find((node) => node.name === 'wf3_home_titlebar');
  const title = titleBar?.children[0]?.props.text;
  const hasCurrentMenu = directNames.has('wf3_home_menu_0')
    && directNames.has('wf3_home_menu_5')
    && title === '功能菜单';
  if (hasCurrentMenu) return false;
  return title === 'UART'
    || [...directNames].some((name) => name?.startsWith('wf3_home_nav_'));
}
