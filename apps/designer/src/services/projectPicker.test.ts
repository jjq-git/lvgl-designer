import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '@lvd/schema';
import { createNewStoredProjectDocument } from './projectPersistence';
import { storedProjectDisplay } from './projectPicker';

describe('projectPicker', () => {
  it('reads a legacy project display without opening it', () => {
    const project = createEmptyProject('legacy');
    project.display.width = 1080;
    project.display.height = 720;
    project.display.shape = 'rect';

    expect(storedProjectDisplay(project)).toEqual({ width: 1080, height: 720, shape: 'rect' });
  });

  it('reads a v2 snapshot display without opening it', () => {
    const project = createEmptyProject('snapshot');
    project.display.width = 240;
    project.display.height = 240;
    project.display.shape = 'round';

    expect(storedProjectDisplay(createNewStoredProjectDocument(project)))
      .toEqual({ width: 240, height: 240, shape: 'round' });
  });
});
