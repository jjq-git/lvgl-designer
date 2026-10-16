import { describe, expect, it } from 'vitest';
import { isScrollInsideAssetPicker } from './AssetPicker';

describe('AssetPicker scroll handling', () => {
  it('keeps the popup open for its own scrolling and detects outside scrolling', () => {
    const inside = { nodeType: 1 } as Node;
    const outside = { nodeType: 1 } as Node;
    const popup = { contains: (node: Node) => node === inside };

    expect(isScrollInsideAssetPicker(popup, inside)).toBe(true);
    expect(isScrollInsideAssetPicker(popup, outside)).toBe(false);
    expect(isScrollInsideAssetPicker(null, inside)).toBe(false);
    expect(isScrollInsideAssetPicker(popup, {} as EventTarget)).toBe(false);
  });
});
