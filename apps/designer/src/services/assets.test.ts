import { describe, expect, it } from 'vitest';
import {
  materialSymbolCodeName,
  materialSymbolSvgUrl,
  searchMaterialSymbols,
  sha256Hex,
  sha256HexPortable,
} from './assets';

describe('asset SHA-256', () => {
  it('matches the standard SHA-256 vectors without Web Crypto', () => {
    expect(sha256HexPortable(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256HexPortable(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('uses the same result through the public async helper', async () => {
    expect(await sha256Hex(new TextEncoder().encode('WF3'))).toBe(
      '9e0741200ac5fa9839efd997e45c89883ed3a4a3030f872186a886c3361f660e',
    );
  });
});

describe('Material Symbols catalogue', () => {
  it('creates stable C-safe derivative names and API URLs', () => {
    expect(materialSymbolCodeName('wifi_off', 32)).toBe('ic_wifi_off_32');
    expect(materialSymbolCodeName('3d_rotation', 24)).toBe('ic_3d_rotation_24');
    expect(materialSymbolSvgUrl('wifi_off')).toBe('/api/lvgl/icon-library/material-symbols/wifi_off.svg');
  });

  it('searches through the authenticated same-origin adapter', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/api/lvgl/icon-library/material-symbols?query=wifi&limit=12&offset=4');
      return new Response(JSON.stringify({
        source: 'material-symbols', sourcePage: 'http://icons/', license: 'Apache-2.0',
        icons: ['wifi', 'wifi_off'], total: 6, offset: 4, hasMore: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      await expect(searchMaterialSymbols('wifi', 12, 4)).resolves.toMatchObject({
        icons: ['wifi', 'wifi_off'], total: 6, offset: 4, hasMore: false,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
