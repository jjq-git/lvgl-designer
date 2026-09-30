import { describe, expect, it } from 'vitest';
import { paletteEntries } from '@lvd/schema';
import { WIDGET_ICON_TYPES } from './WidgetThumb';

describe('WidgetThumb', () => {
  it('has a dedicated semantic icon for every palette widget', () => {
    const paletteTypes = paletteEntries().flatMap((group) => group.widgets.map((widget) => widget.type));
    expect(paletteTypes.filter((type) => !WIDGET_ICON_TYPES.has(type))).toEqual([]);
  });
});
