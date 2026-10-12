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

function matchesNamedDisplay(
  left: NamedProjectDisplaySpec,
  right: NamedProjectDisplaySpec,
): boolean {
  return left.name.trim() === right.name.trim()
    && left.width === right.width
    && left.height === right.height
    && left.shape === right.shape;
}

/** Prefer persisted editable projects over their bundled fallback template. */
export function excludePersistedBuiltIns<T extends NamedProjectDisplaySpec>(
  builtIns: readonly T[],
  persisted: readonly NamedProjectDisplaySpec[],
): T[] {
  return builtIns.filter((builtIn) => !persisted.some((candidate) => (
    matchesNamedDisplay(builtIn, candidate)
  )));
}

/** Hide a stale local cache entry when its editable cloud project is available. */
export function excludeCloudDuplicateLocal<T extends NamedProjectDisplaySpec>(
  local: T | null,
  cloudProjects: readonly NamedProjectDisplaySpec[],
): T | null {
  if (!local) return null;
  return cloudProjects.some((cloudProject) => matchesNamedDisplay(local, cloudProject))
    ? null
    : local;
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
