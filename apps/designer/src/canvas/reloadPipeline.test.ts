import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@lvd/schema';
import type { LvglRuntimeApi } from '@lvd/lvgl-runtime';
import { ReloadPipeline } from './reloadPipeline';
import { useProjectStore } from '../stores/projectStore';

describe('ReloadPipeline startup recovery', () => {
  const originalProject = useProjectStore.getState().project;

  afterEach(() => {
    useProjectStore.getState().loadProject(originalProject);
  });

  it('keeps listening when the initial preview reload fails', () => {
    let attempts = 0;
    const runtime = {
      setResolution: vi.fn(),
      supportsPreviewProgram: () => true,
      loadPreviewProgram: vi.fn(() => {
        attempts += 1;
        if (attempts <= 2) throw new Error('stale project is not supported');
      }),
      loadScreen: vi.fn(),
    } as unknown as LvglRuntimeApi;
    const pipeline = new ReloadPipeline(runtime);

    expect(() => pipeline.start()).not.toThrow();
    expect(attempts).toBe(2);

    useProjectStore.getState().loadProject(createEmptyProject('recovered-project'));

    expect(attempts).toBe(3);
    expect(runtime.loadScreen).toHaveBeenCalled();
    pipeline.dispose();
  });

  it('rebuilds PreviewProgram instead of calling the legacy screen reload export', () => {
    const project = createEmptyProject('preview-screen-switch');
    useProjectStore.getState().loadProject(project);
    const runtime = {
      setResolution: vi.fn(),
      supportsPreviewProgram: () => true,
      loadPreviewProgram: vi.fn(),
      loadScreen: vi.fn(),
      reloadScreen: vi.fn(() => {
        throw new Error('legacy lvd_reload_screen must not be used');
      }),
    } as unknown as LvglRuntimeApi;
    const pipeline = new ReloadPipeline(runtime);

    pipeline.loadScreenById(project.screens[0]!.id);

    expect(runtime.loadPreviewProgram).toHaveBeenCalledOnce();
    expect(runtime.reloadScreen).not.toHaveBeenCalled();
    expect(runtime.loadScreen).toHaveBeenCalledWith(project.screens[0]!.name);
  });
});
