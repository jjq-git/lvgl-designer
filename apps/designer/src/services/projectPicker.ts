import { isProjectSnapshotV2 } from '@lvd/schema/v2';
import type { StoredProjectDocument } from './projectPersistence';

export interface ProjectDisplaySpec {
  width: number;
  height: number;
  shape: 'round' | 'rect';
}
/** Read the project-level display without loading the document into the editor. */
export function storedProjectDisplay(document: StoredProjectDocument): ProjectDisplaySpec {
  if (isProjectSnapshotV2(document)) {
    return {
      width: document.displayProfile.logicalSize.width,
      height: document.displayProfile.logicalSize.height,
      shape: document.displayProfile.shape,
    };
  }
  return {
    width: document.display.width,
    height: document.display.height,
    shape: document.display.shape,
  };
}
