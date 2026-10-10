import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@lvd/schema';
import { useProjectStore } from './projectStore';
import { useProjectsStore } from './projectsStore';
import { createNewStoredProjectDocument } from '../services/projectPersistence';
import * as cloud from '../services/cloudStorage';
import { deleteCloudCache, saveNow } from '../services/storage';
import { primeProjectAssets, resyncAssets } from '../services/assets';

vi.mock('../services/cloudStorage', () => ({
  probeCloudEnabled: vi.fn(),
  listProjects: vi.fn(),
  getProject: vi.fn(),
  saveProject: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  renameProject: vi.fn(),
}));

vi.mock('../services/storage', () => ({
  cacheCloudProject: vi.fn(async () => undefined),
  deleteCloudCache: vi.fn(async () => undefined),
  listPendingCloud: vi.fn(async () => []),
  markCloudSynced: vi.fn(async () => undefined),
  readCloudCache: vi.fn(async () => null),
  saveNow: vi.fn(async (_project, expectedRevision?: number) => {
    useProjectStore.getState().markSaved(expectedRevision);
  }),
}));

vi.mock('../services/assets', () => ({
  primeProjectAssets: vi.fn(async () => undefined),
  resyncAssets: vi.fn(async () => undefined),
  syncProjectAssetsToCloud: vi.fn(async () => undefined),
}));

const cloudMock = vi.mocked(cloud);

function resetStores(): void {
  const oldProject = createEmptyProject('old');
  useProjectStore.getState().loadProject(oldProject);
  useProjectsStore.setState({
    list: [],
    currentId: 'old-id',
    currentName: 'old',
    currentVersion: 3,
    syncState: 'synced',
    cloudEnabled: true,
    cloudSyncPaused: false,
    conflictCurrent: null,
    listLoading: false,
    listError: null,
    panel: null,
  });
}

describe('projectsStore switching and preview safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
  });

  it('initializes cloud state with a single project-list request', async () => {
    const updatedAt = new Date().toISOString();
    cloudMock.listProjects.mockResolvedValue({
      ok: true,
      data: [{ id: 'cloud-id', name: 'cloud', version: 1, updated_at: updatedAt }],
    });

    await useProjectsStore.getState().init();

    expect(cloudMock.listProjects).toHaveBeenCalledTimes(1);
    expect(cloudMock.probeCloudEnabled).not.toHaveBeenCalled();
    expect(useProjectsStore.getState()).toMatchObject({
      cloudEnabled: true,
      listLoading: false,
      list: [{ id: 'cloud-id', name: 'cloud', version: 1, updated_at: updatedAt }],
    });
  });

  it('saves the dirty current project before loading another cloud project', async () => {
    useProjectStore.getState().mutateV2('edit old', (draft) => {
      draft.meta.name = 'old edited';
    });
    const next = createNewStoredProjectDocument(createEmptyProject('next'));
    cloudMock.saveProject.mockResolvedValue({ ok: true, data: { version: 4 } });
    cloudMock.getProject.mockResolvedValue({
      ok: true,
      data: { id: 'next-id', name: 'next', doc: next, version: 1, updated_at: new Date().toISOString() },
    });

    await useProjectsStore.getState().openProject('next-id');

    expect(cloudMock.saveProject).toHaveBeenCalledTimes(1);
    expect(cloudMock.saveProject.mock.calls[0]?.[0]).toBe('old-id');
    expect(cloudMock.getProject).toHaveBeenCalledWith('next-id');
    expect(primeProjectAssets).toHaveBeenCalledTimes(1);
    expect(resyncAssets).toHaveBeenCalledTimes(1);
    expect(useProjectsStore.getState().currentId).toBe('next-id');
  });

  it('reopens the current project to fetch a newer cloud version', async () => {
    const updated = createNewStoredProjectDocument(createEmptyProject('updated current'));
    cloudMock.getProject.mockResolvedValue({
      ok: true,
      data: {
        id: 'old-id',
        name: 'updated current',
        doc: updated,
        version: 4,
        updated_at: new Date().toISOString(),
      },
    });

    await useProjectsStore.getState().openProject('old-id');

    expect(cloudMock.getProject).toHaveBeenCalledWith('old-id');
    expect(useProjectsStore.getState()).toMatchObject({
      currentId: 'old-id',
      currentName: 'updated current',
      currentVersion: 4,
    });
    expect(useProjectStore.getState().project.meta.name).toBe('updated current');
  });

  it('opens the saved local UI without retaining the previous cloud identity', async () => {
    const local = createEmptyProject('local UI');
    local.display = { ...local.display, width: 284, height: 76, shape: 'rect' };

    await useProjectsStore.getState().openLocalProject(local);

    expect(useProjectsStore.getState()).toMatchObject({
      currentId: null,
      currentName: 'local UI',
      currentVersion: 0,
    });
    expect(useProjectStore.getState().project.meta.name).toBe('local UI');
    expect(vi.mocked(saveNow)).toHaveBeenCalledTimes(1);
    expect(primeProjectAssets).toHaveBeenCalledTimes(1);
    expect(resyncAssets).toHaveBeenCalledTimes(1);
  });

  it('creates a project with the screen and controller chosen in the new-project form', async () => {
    const updatedAt = new Date().toISOString();
    cloudMock.createProject.mockResolvedValue({
      ok: true,
      data: { id: 'configured-id', name: 'configured', version: 1 },
    });
    cloudMock.listProjects.mockResolvedValue({
      ok: true,
      data: [{ id: 'configured-id', name: 'configured', version: 1, updated_at: updatedAt }],
    });

    await useProjectsStore.getState().newProject('configured', {
      display: { width: 240, height: 240, shape: 'round' },
      controllerPreset: 'screen-only',
    });

    const stored = cloudMock.createProject.mock.calls[0]?.[1];
    if (!stored || !('displayProfile' in stored)) throw new Error('expected a v2 project snapshot');
    expect(stored?.displayProfile.logicalSize).toEqual({ width: 240, height: 240 });
    expect(stored?.displayProfile.shape).toBe('round');
    expect(stored?.controllerProfile?.model).toBe('SCREEN-ONLY');
    expect(useProjectStore.getState().project.display).toMatchObject({
      width: 240, height: 240, shape: 'round',
    });
    expect(useProjectsStore.getState()).toMatchObject({
      currentId: 'configured-id', currentName: 'configured', currentVersion: 1,
    });
  });

  it('blocks manual cloud saves while a history version is being previewed', async () => {
    useProjectStore.getState().mutateV2('preview-only edit', (draft) => {
      draft.meta.name = 'must not sync';
    });
    useProjectsStore.getState().setCloudSyncPaused(true);

    await useProjectsStore.getState().saveCurrent();

    expect(cloudMock.saveProject).not.toHaveBeenCalled();
    expect(useProjectStore.getState().dirty).toBe(true);
  });

  it('writes the current project locally before synchronizing it to the cloud', async () => {
    useProjectStore.getState().mutateV2('manual save', (draft) => {
      draft.meta.name = 'manually saved';
    });
    cloudMock.saveProject.mockResolvedValue({ ok: true, data: { version: 4 } });

    await useProjectsStore.getState().saveCurrent();

    expect(vi.mocked(saveNow)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveNow).mock.calls[0]?.[2]).toBe('cloud:old-id');
    expect(cloudMock.saveProject).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().dirty).toBe(false);
  });

  it('does not pretend an offline cloud deletion succeeded', async () => {
    useProjectsStore.setState({
      list: [{ id: 'old-id', name: 'old', version: 3, updated_at: new Date().toISOString() }],
    });
    cloudMock.deleteProject.mockResolvedValue({
      ok: false, kind: 'offline', message: 'offline', status: 0,
    });

    const deleted = await useProjectsStore.getState().deleteProject('old-id');

    expect(deleted).toBe(false);
    expect(vi.mocked(deleteCloudCache)).not.toHaveBeenCalled();
    expect(useProjectsStore.getState().list).toHaveLength(1);
    expect(useProjectsStore.getState().currentId).toBe('old-id');
  });
});
