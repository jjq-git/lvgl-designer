import { describe, expect, it } from 'vitest';
import { LvglError } from './errors';

describe('LvglError', () => {
  it('aggregates log lines into message tail', () => {
    const e = new LvglError('reloadScreen(main) rc=1', [
      { level: 2, msg: 'xml parse error line 3' },
      { level: 3, msg: 'no processor found' },
    ]);
    expect(e.name).toBe('LvglError');
    expect(e.message).toBe(
      'reloadScreen(main) rc=1\n  [lv:2] xml parse error line 3\n  [lv:3] no processor found',
    );
    expect(e.logLines).toHaveLength(2);
    expect(e).toBeInstanceOf(Error);
  });

  it('plain message when no log lines', () => {
    const e = new LvglError('boom');
    expect(e.message).toBe('boom');
    expect(e.logLines).toEqual([]);
  });
});
