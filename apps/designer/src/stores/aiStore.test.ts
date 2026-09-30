import { describe, expect, it } from 'vitest';
import { useAiStore } from './aiStore';

describe('aiStore', () => {
  it('shows the AI panel by default', () => {
    expect(useAiStore.getState().panelOpen).toBe(true);
  });
});
