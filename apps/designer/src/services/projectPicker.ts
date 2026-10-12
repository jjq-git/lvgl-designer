import { isProjectSnapshotV2 } from '@lvd/schema/v2';
import type { StoredProjectDocument } from './projectPersistence';

export interface ProjectDisplaySpec {
  width: number;
  height: number;
  shape: 'round' | 'rect';
}

export interface NamedProjectDisplaySpec extends ProjectDisplaySpec {
  name: string;
}

/** Prefer persisted editable projects over their bundled fallback template. */
export function excludePersistedBuiltIns<T extends NamedProjectDisplaySpec>(
  builtIns: readonly T[],
  persisted: readonly NamedProjectDisplaySpec[],
): T[] {
  return builtIns.filter((builtIn) => !persisted.some((candidate) => (
    builtIn.name.trim() === candidate.name.trim()
    && builtIn.width === candidate.width
    && builtIn.height === candidate.height
    && builtIn.shape === candidate.shape
  )));
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
