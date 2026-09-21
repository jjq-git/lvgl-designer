import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createEmptyProject } from '@lvd/schema';
import { migrateV1ToV2 } from '@lvd/schema/v2';
import { executeBuild } from './index.js';

describe('trusted build worker', () => {
  it('does not retain a dynamic eval path in the embedded FreeType runtime', () => {
    const source = readFileSync(
      new URL('../../../packages/asset-pipeline/spike/browser-bundle.mjs', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/\beval\s*\(/);
  });

  it('converts a locked v2 input and emits LVGL 9.5 C artifacts', async () => {
    const migrated = migrateV1ToV2(createEmptyProject('worker'), {
      hash: () => 'e3b0c44298fc1c149afbf4c8996fb924',
    });
    const fontBytes = readFileSync(new URL('../../../packages/asset-pipeline/spike/Montserrat-Medium.ttf', import.meta.url));
    const fontSha256 = createHash('sha256').update(fontBytes).digest('hex');
    migrated.uiProject.assets.fonts.push({
      id: 'font:demo',
      codeName: 'demo',
      file: { fileName: 'Montserrat-Medium.ttf', sha256: fontSha256, byteSize: fontBytes.byteLength },
      conv: { loader: 'bin', sizePx: 12, bpp: 1, ranges: '0x20-0x24', license: 'OFL-1.1' },
    });
    const display = migrated.displayProfile;
    const displayRef = `${display.id}@${display.revision}` as `display:${string}@${number}`;
    const controller = {
      schemaVersion: 1 as const,
      kind: 'controller-profile' as const,
      id: 'controller:worker',
      revision: 1,
      model: 'test',
      displayRef,
      frame: {
        assetRef: `asset:frame@sha256:${'0'.repeat(64)}` as `asset:${string}@sha256:${string}`,
        viewBox: { x: 0, y: 0, width: 240, height: 240 },
        screenViewport: { x: 0, y: 0, width: 240, height: 240, rotation: 0 as const },
      },
    };
    const uiRef = `${migrated.uiProject.meta.id}@${migrated.uiProject.meta.revision}` as `ui:${string}@${number}`;
    const target = {
      schemaVersion: 1 as const,
      kind: 'lvgl-build-target' as const,
      id: 'target:worker',
      revision: 1,
      uiProjectRef: uiRef,
      controllerProfileRef: 'controller:worker@1' as const,
      themeRef: `${uiRef}#theme:default` as `ui:${string}@${number}#theme:${string}`,
      firmwareProfileRef: 'firmware:worker@1' as const,
      lvglVersion: '9.5.0' as const,
    };
    const request: Parameters<typeof executeBuild>[0] = {
      protocolVersion: 1,
      inputLock: {
        uiProject: migrated.uiProject,
        actionRegistry: {},
        buildTarget: target,
        profiles: {
          display: { ref: displayRef, sha256: '0'.repeat(64), doc: display },
          controller: { ref: 'controller:worker@1', sha256: '1'.repeat(64), doc: controller },
        },
        assets: [{
          category: 'fonts', id: 'font:demo', codeName: 'demo',
          sha256: fontSha256, byteSize: fontBytes.byteLength,
          conv: { loader: 'bin', sizePx: 12, bpp: 1, ranges: '0x20-0x24', license: 'OFL-1.1' },
        }],
      },
      assetPayloads: { [fontSha256]: fontBytes.toString('base64') },
    };
    const result = await executeBuild(request);
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(result.files['ui.c']).toContain('ui_init');
    expect(result.files['fonts/demo.c']).toContain('const lv_font_t font_demo');
    expect(result.files['licenses/demo.txt']).toContain('SPDX-License-Identifier: OFL-1.1');
    expect(result.files['CMakeLists.txt']).toContain('fonts/demo.c');
    expect(JSON.parse(result.files['preview/preview-program.json']!)).toMatchObject({
      protocolVersion: 1,
      homeScreenName: expect.any(String),
    });
    expect(result.generatorManifest.lvglVersion).toBe('9.5.0');
    expect(result.generatorManifest.convertedAssets).toEqual([
      expect.objectContaining({
        id: 'font:demo', glyphCount: 5, requestedGlyphCount: 5,
        missingGlyphCount: 0, output: 'fonts/demo.c', licenseFile: 'licenses/demo.txt',
      }),
    ]);
    expect(result.generatorManifest.preview).toEqual({
      protocolVersion: 1,
      entrypoint: 'preview/index.html',
      program: 'preview/preview-program.json',
    });

    const missingLicense = structuredClone(request);
    delete missingLicense.inputLock.assets?.[0]?.conv?.license;
    const rejected = await executeBuild(missingLicense);
    expect(rejected.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'E_FONT_LICENSE_REQUIRED',
    }));
    expect(rejected.files['fonts/demo.c']).toBeUndefined();

    const missingGlyph = structuredClone(request);
    missingGlyph.inputLock.uiProject.screens[0]!.root.props.text = '\u4e2d';
    missingGlyph.inputLock.uiProject.screens[0]!.root.styles = [{
      props: { text_font: 'font:demo' },
    }];
    const uncovered = await executeBuild(missingGlyph);
    expect(uncovered.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'E_FONT_GLYPH_MISSING',
    }));
    expect(uncovered.files['fonts/demo.c']).toBeUndefined();
  });
});
