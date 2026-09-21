import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasPermission, useAuthStore } from './authStore';


describe('authStore effective permissions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useAuthStore.setState({ me: null, loading: true, fetched: false, modal: null });
  });

  it('reads the nested /api/auth/me envelope and exposes effective permissions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      user: {
        id: 7,
        username: 'operator',
        display_name: 'Operator',
        role: 'user',
        permissions: ['tool.lvgl.use', 'tool.lvgl.build'],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await useAuthStore.getState().fetchMe();
    const user = useAuthStore.getState().me;
    expect(user).toEqual({
      id: 7, username: 'operator', displayName: 'Operator', role: 'normal',
      permissions: ['tool.lvgl.use', 'tool.lvgl.build'],
    });
    expect(hasPermission(user, 'tool.lvgl.build')).toBe(true);
    expect(hasPermission(user, 'tool.lvgl.publish')).toBe(false);
  });
});
