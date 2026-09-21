/**
 * 版本化 / 迁移框架(docs/design/01 §2)。
 * schemaVersion 为整数,只前进;v1 是当前版本,MIGRATIONS 暂空。
 */
import { SCHEMA_VERSION, type LvProject } from './project.js';
import { validateProject, type ValidationResult } from './validate.js';

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectFormatError';
  }
}

export class ProjectTooNewError extends Error {
  readonly fileVersion: number;
  constructor(fileVersion: number) {
    super(`工程 schemaVersion=${fileVersion} 高于本 App 支持的 ${SCHEMA_VERSION},请升级 App`);
    this.name = 'ProjectTooNewError';
    this.fileVersion = fileVersion;
  }
}

export class ProjectValidationError extends Error {
  readonly result: ValidationResult;
  constructor(result: ValidationResult) {
    super(`工程校验失败:${result.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    this.name = 'ProjectValidationError';
    this.result = result;
  }
}

export interface Migration {
  from: number;                       // to = from + 1
  migrate(doc: unknown): unknown;
}

/** 迁移链:index i 对应 from=i+1(即 MIGRATIONS[0] 是 v1→v2) */
export const MIGRATIONS: Migration[] = [];

/**
 * 读入(可能是旧版本的)工程 JSON:拒绝过新 → 逐级迁移 → 校验。
 * 校验的 warnings 不阻断(返回值上可再取),errors 抛 ProjectValidationError。
 */
export function loadProjectJson(raw: unknown): { project: LvProject; validation: ValidationResult } {
  if (typeof raw !== 'object' || raw === null) {
    throw new ProjectFormatError('工程文件不是 JSON 对象');
  }
  const v = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new ProjectFormatError('缺少整数 schemaVersion');
  }
  if (v > SCHEMA_VERSION) throw new ProjectTooNewError(v);
  if (v < 1) throw new ProjectFormatError(`非法 schemaVersion:${v}`);

  let doc: unknown = raw;
  for (let i = v; i < SCHEMA_VERSION; i++) {
    const m = MIGRATIONS[i - 1];
    if (!m || m.from !== i) {
      throw new ProjectFormatError(`缺少 v${i}→v${i + 1} 迁移`);
    }
    doc = m.migrate(doc);
    (doc as { schemaVersion: number }).schemaVersion = i + 1;
  }

  const validation = validateProject(doc);
  if (!validation.valid) throw new ProjectValidationError(validation);
  return { project: doc as LvProject, validation };
}
