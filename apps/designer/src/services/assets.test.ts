import { describe, expect, it } from 'vitest';
import { sha256Hex, sha256HexPortable } from './assets';

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
