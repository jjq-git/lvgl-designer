/**
 * createMockRuntime — 接口打桩(评审 O4:不做影子树)。
 * 方法全部可调不抛;hitTest/getObjRect 返回 null;snapshot 返回 1x1。
 */
import type { LogLine, LvdRect, LvglRuntimeApi } from './types';

function make1x1ImageData(): ImageData {
  const data = new Uint8ClampedArray(4);
  const ID = (globalThis as { ImageData?: typeof ImageData }).ImageData;
  if (ID) return new ID(data, 1, 1);
  // node/vitest 无 ImageData:形状兼容的普通对象
  return { data, width: 1, height: 1, colorSpace: 'srgb' } as ImageData;
}

export function createMockRuntime(): LvglRuntimeApi {
  let running = false;
  return {
    setResolution(): void {},
    setMode(): void {},
    start(): void {
      running = true;
    },
    stop(): void {
      running = false;
    },
    destroy(): void {
      running = false;
    },
    get running(): boolean {
      return running;
    },
    tick(): number {
      return 0;
    },

    registerComponent(): void {},
    unregisterComponent(): void {},
    reloadScreen(): void {},
    loadScreen(): void {},
    updateAttrs(): void {},
    createChild(): void {},
    deleteObj(): void {},
    reloadAll(): void {},
    registerEventStub(): void {},
    supportsPreviewProgram(): boolean {
      return false;
    },
    loadPreviewProgram(): void {},

    writeFile(): void {},
    registerImage(): void {},
    dropImageCache(): void {},
    registerFontTinyTtf(): void {},

    hitTest(): string | null {
      return null;
    },
    getObjRect(): LvdRect | null {
      return null;
    },
    getObjRects(): Map<string, LvdRect> {
      return new Map();
    },
    dumpTree(): unknown {
      return null;
    },

    snapshot(): ImageData {
      return make1x1ImageData();
    },

    onLog(): () => void {
      return () => {};
    },
    onEventStub(): () => void {
      return () => {};
    },
    takeLogs(): LogLine[] {
      return [];
    },

    setManualTick(): void {},
    advanceTick(): void {},
  };
}
