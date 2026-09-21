import { describe, expect, it } from 'vitest';
import { createMockRuntime } from './mock';

describe('createMockRuntime', () => {
  it('all contract methods callable without throwing', () => {
    const rt = createMockRuntime();
    rt.setResolution(240, 240);
    rt.setMode('design');
    rt.registerComponent('c', '<component/>');
    rt.unregisterComponent('c');
    rt.reloadScreen('main', '<screen/>');
    rt.loadScreen('main');
    rt.updateAttrs('a', 'lv_label', { text: 'hi' });
    rt.createChild(null, 'lv_button', {});
    rt.deleteObj('a');
    rt.reloadAll('<globals/>', [{ name: 'main', xml: '<screen/>' }]);
    rt.registerEventStub('cb');
    expect(rt.supportsPreviewProgram()).toBe(false);
    rt.loadPreviewProgram({
      protocolVersion: 1,
      display: { width: 1, height: 1, colorFormat: 'XRGB8888' },
      globals: { consts: [], styles: [], subjects: [], fonts: [], images: [] },
      screens: [], homeScreenName: 'main', runtimeNameToNodeId: {},
    });
    rt.writeFile('/assets/x.png', new Uint8Array(1));
    rt.registerImage('x.png', new Uint8Array(1));
    rt.dropImageCache('A:assets/x.png');
    rt.registerFontTinyTtf('f', new Uint8Array(1), 16);
    rt.setManualTick(true);
    rt.advanceTick(16);
    expect(rt.tick()).toBe(0);
    rt.destroy();
  });

  it('hitTest / getObjRect return null, getObjRects empty, snapshot 1x1', () => {
    const rt = createMockRuntime();
    expect(rt.hitTest(0, 0)).toBeNull();
    expect(rt.getObjRect('a')).toBeNull();
    expect(rt.getObjRects(['a', 'b']).size).toBe(0);
    const img = rt.snapshot();
    expect(img.width).toBe(1);
    expect(img.height).toBe(1);
    expect(img.data.length).toBe(4);
  });

  it('start/stop track running; onLog/onEventStub return unsubscribers', () => {
    const rt = createMockRuntime();
    expect(rt.running).toBe(false);
    rt.start();
    expect(rt.running).toBe(true);
    rt.stop();
    expect(rt.running).toBe(false);
    expect(typeof rt.onLog(() => {})).toBe('function');
    expect(typeof rt.onEventStub(() => {})).toBe('function');
    expect(rt.takeLogs()).toEqual([]);
  });
});
