import { describe, expect, it } from 'vitest';
import { emitC94, emitC95, normalizeProject, emitC95FromIr } from '../index.js';
import { caseTargets, caseWidgetsAll } from './cases.js';

const lockedTarget = {
  schemaVersion: 1 as const,
  kind: 'lvgl-build-target' as const,
  id: 'target:test',
  revision: 4,
  uiProjectRef: 'ui:test@2' as const,
  controllerProfileRef: 'controller:screen-only@3' as const,
  themeRef: 'ui:test@2#theme:default' as const,
  lvglVersion: '9.5.0' as const,
};
const lockedDisplayRef = 'display:240x320-rgb565@5' as const;

describe('LVGL 9.5 C emitter', () => {
  it('复用同一份中立 IR，只改变目标版本元数据', () => {
    const project = caseTargets();
    const c94 = emitC94(project);
    const c95 = emitC95(project, { colorFormat: 'RGB565' });

    const sourcePaths = c94.files
      .map((f) => f.path)
      .filter((p) => p.endsWith('.c') || p.endsWith('.h'));
    for (const path of sourcePaths) {
      expect(c95.files.find((f) => f.path === path)?.content)
        .toBe(c94.files.find((f) => f.path === path)?.content);
    }

    const normalized = normalizeProject(project);
    expect(emitC95FromIr(normalized.ir, normalized.diagnostics, { colorFormat: 'RGB565' }).files)
      .toEqual(c95.files);
  });

  it('精确钉死 9.5.0，不在生成说明中残留 9.4 或版本范围', () => {
    const files = emitC95(caseTargets(), { colorFormat: 'RGB565' }).files;
    const req = files.find((f) => f.path === 'REQUIREMENTS.txt')!.content;
    const integration = files.find((f) => f.path === 'INTEGRATION.md')!.content;

    expect(req).toContain('LVGL 9.5.0');
    expect(integration).toContain('LVGL 9.5.0');
    expect(integration).toContain('lvgl/lvgl@9.5.0');
    expect(`${req}\n${integration}`).not.toContain('9.4');
    expect(integration).not.toContain('lvgl/lvgl@^');
  });

  it('强制生成可追溯 manifest：版本、目标、lv_conf、资源哈希和未实现 Action', () => {
    const project = caseWidgetsAll();
    project.screens[0]!.root.children[0]!.events.push({
      kind: 'callback', trigger: 'clicked', callback: 'on_ok',
    });
    const files = emitC95(project, {
      target: 'cmake', colorFormat: 'RGB565',
      buildTarget: lockedTarget, displayProfileRef: lockedDisplayRef,
    }).files;
    const manifestFile = files.find((f) => f.path === 'build-manifest.json');
    expect(manifestFile).toBeDefined();
    const manifest = JSON.parse(manifestFile!.content) as Record<string, any>;

    expect(manifest.lvglVersion).toBe('9.5.0');
    expect(manifest.target).toBe('cmake');
    expect(manifest.display).toEqual({ width: 240, height: 320, colorFormat: 'RGB565' });
    expect(manifest.profiles).toEqual({
      buildTarget: { id: 'target:test', revision: 4 },
      uiProjectRef: 'ui:test@2',
      controllerProfileRef: 'controller:screen-only@3',
      displayProfileRef: 'display:240x320-rgb565@5',
      themeRef: 'ui:test@2#theme:default',
    });
    expect(manifest.lvConf.widgets).toContain('LV_USE_SLIDER');
    expect(manifest.assets.images).toContainEqual({
      name: 'logo', sha256: '0'.repeat(64), byteSize: 128, colorFormat: 'ARGB8888',
    });
    expect(manifest.unimplementedActions).toContain('on_ok');
  });

  it('9.4 兼容入口不改变原有文件集', () => {
    expect(emitC94(caseTargets()).files.some((f) => f.path === 'build-manifest.json')).toBe(false);
  });

  it('16bpp 发布必须确认 RGB565 字节序，且拒绝与 colorDepth 不匹配的格式', () => {
    const project = caseTargets();
    expect(emitC95(project).diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'E_COLOR_FORMAT_CONFIRM_REQUIRED',
    }));
    expect(emitC95(project, { colorFormat: 'XRGB8888' }).diagnostics)
      .toContainEqual(expect.objectContaining({
        severity: 'error', code: 'E_COLOR_FORMAT_DEPTH_MISMATCH',
      }));
    const swapped = emitC95(project, { colorFormat: 'RGB565_SWAPPED' });
    expect(swapped.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const manifest = JSON.parse(
      swapped.files.find((f) => f.path === 'build-manifest.json')!.content,
    ) as { display: { colorFormat: string } };
    expect(manifest.display.colorFormat).toBe('RGB565_SWAPPED');
  });

  it('24/32bpp 在未显式覆盖时确定性写入 RGB888/XRGB8888', () => {
    for (const [depth, expected] of [[24, 'RGB888'], [32, 'XRGB8888']] as const) {
      const project = caseTargets();
      project.display.colorDepth = depth;
      const result = emitC95(project);
      expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      const manifest = JSON.parse(
        result.files.find((f) => f.path === 'build-manifest.json')!.content,
      ) as { display: { colorFormat: string } };
      expect(manifest.display.colorFormat).toBe(expected);
    }
  });

  it('拒绝 BuildTarget 版本错配或缺失 DisplayProfile revision 锁', () => {
    const project = caseTargets();
    const wrongVersion = emitC95(project, {
      colorFormat: 'RGB565',
      buildTarget: { ...lockedTarget, lvglVersion: '9.4.0' },
      displayProfileRef: lockedDisplayRef,
    });
    expect(wrongVersion.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_BUILD_TARGET_VERSION_MISMATCH', severity: 'error',
    }));

    const missingDisplay = emitC95(project, {
      colorFormat: 'RGB565', buildTarget: lockedTarget,
    });
    expect(missingDisplay.diagnostics).toContainEqual(expect.objectContaining({
      code: 'E_DISPLAY_PROFILE_REF_REQUIRED', severity: 'error',
    }));
  });

  it('9.5 普通发布阻断 v1 cPatch，且绝不把片段写入 C 产物', () => {
    const project = caseTargets();
    project.screens[0]!.root.children[0]!.cPatch = {
      post: 'dangerous_call($obj);',
    };

    const c95 = emitC95(project);
    expect(c95.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'E_CPATCH_FORBIDDEN',
      nodeId: project.screens[0]!.root.children[0]!.id,
    }));
    expect(c95.files.filter((f) => f.path.endsWith('.c')).map((f) => f.content).join('\n'))
      .not.toContain('dangerous_call');

    // 旧入口只用于受信任的 9.4 存量工程，保持历史行为。
    expect(emitC94(project).files.filter((f) => f.path.endsWith('.c')).map((f) => f.content).join('\n'))
      .toContain('dangerous_call');
  });
});
