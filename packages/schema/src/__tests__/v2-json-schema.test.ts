/**
 * JSON Schema 生成 + 漂移检查(方案 §10.1「JSON Schema 由单一模型生成,不手写维护第二份结构定义」)。
 *
 * 生成物落在 packages/schema/schema/,由 src/v2/schemas.ts 的 zod 模型经 z.toJSONSchema() 产出。
 * 用 toMatchFileSnapshot 而不是单独的生成脚本,是因为它同时做两件事:
 *   - `pnpm test`     → zod 模型改了但 JSON Schema 没重生成 → 测试失败(漂移检查)
 *   - `pnpm test -u`  → 重新生成
 * 这样生成物永远不会和模型脱节,也不需要额外依赖或 TS 运行器。
 */
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';
import { describe, expect, it } from 'vitest';
import { JSON_SCHEMA_TARGETS } from '../v2/schemas.js';
import { migrateV1ToV2 } from '../v2/migrate.js';
import { validateUiProjectV2 } from '../v2/validate.js';
import type { LvProject } from '../project.js';
import { readFileSync } from 'node:fs';

const out = (name: string): string =>
  fileURLToPath(new URL(`../../schema/${name}`, import.meta.url));

describe('JSON Schema 生成', () => {
  for (const [fileName, model] of Object.entries(JSON_SCHEMA_TARGETS)) {
    it(`${fileName} 与 zod 模型一致`, async () => {
      const json = z.toJSONSchema(model, { io: 'input' });
      await expect(`${JSON.stringify(json, null, 2)}\n`).toMatchFileSnapshot(out(fileName));
    });
  }

  it('生成的 ui.schema.json 是 draft 2020-12 且递归节点用 $ref', () => {
    const json = z.toJSONSchema(JSON_SCHEMA_TARGETS['ui.schema.json'], { io: 'input' }) as Record<string, unknown>;
    expect(json.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    // WidgetNode.children 递归 —— 必须是引用而不是无限展开
    expect(JSON.stringify(json)).toContain('$ref');
  });

  it('ui.schema.json 关闭 additionalProperties —— 未知字段是结构错误,不是静默保留', () => {
    const json = z.toJSONSchema(JSON_SCHEMA_TARGETS['ui.schema.json'], { io: 'input' }) as Record<string, unknown>;
    expect(json.additionalProperties).toBe(false);
  });
});

describe('v2 示例工程 fixture', () => {
  it('由 v1 fixture 迁移得到,且自身通过 v2 校验', async () => {
    const v1 = JSON.parse(readFileSync(
      fileURLToPath(new URL('../../schema/fixtures/v1-migration-input.json', import.meta.url)), 'utf8',
    )) as LvProject;
    const r = migrateV1ToV2(v1, { hash: () => 'e3b0c44298fc1c149afbf4c8996fb924' });

    const bundle = {
      _comment: '由 v1-migration-input.json 经 migrateV1ToV2 生成。改动请改迁移器或 v1 fixture,'
        + '然后 `pnpm --filter @lvd/schema test -u` 重新生成,不要手改本文件。',
      uiProject: r.uiProject,
      displayProfile: r.displayProfile,
      buildTargetDraft: r.buildTargetDraft,
      trustedExtension: r.trustedExtension,
      notes: r.notes,
    };

    expect(validateUiProjectV2(r.uiProject, {
      actions: { 'custom.on_light_long_press': { id: 'custom.on_light_long_press', params: [] } },
    }).errors).toEqual([]);

    await expect(`${JSON.stringify(bundle, null, 2)}\n`)
      .toMatchFileSnapshot(out('fixtures/v2-migrated-from-v1.json'));
  });
});
