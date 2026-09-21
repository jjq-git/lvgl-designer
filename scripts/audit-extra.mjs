#!/usr/bin/env node
/**
 * audit-extra.mjs — M3 自研 13 控件对账(audit-parsers.mjs 的姊妹脚本)
 *
 * 对账链:registry ↔ manifest 由 packages/schema/__tests__/manifest-parity.test.ts 保证;
 * 本脚本补另一半:manifest.json ↔ runtime/src/xml_parsers_extra/*.c 源码。
 * 逐项检查:
 *   - 每个 widget 有对应 lvd_xml_<type>.c,且 lv_xml_register_widget("<xmlTag>") 已注册
 *   - manifest 每个属性名在 .c 里有 lv_streq("<name>")(或引号字符串)分支
 *   - 每个枚举 token 字符串在 .c 里逐字出现
 *   - 每个 cSetter 在 .c 里被真实调用
 *   - children:子元素 xmlTag 全名注册,createAttrs 属性名在 .c 出现
 * 输出 scripts/out/extra-attrs-audit.json;有缺项以非零码退出。
 * 零依赖,node >= 18。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXTRA_DIR = join(ROOT, 'runtime/src/xml_parsers_extra');
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');

const manifest = JSON.parse(readFileSync(join(EXTRA_DIR, 'manifest.json'), 'utf8'));
const registryC = readFileSync(join(EXTRA_DIR, 'lvd_xml_extra.c'), 'utf8');

const problems = [];
const report = { widgets: {}, problems };

function check(cond, msg) {
  if (!cond) problems.push(msg);
  return !!cond;
}

/** 走官方 base 转换器的枚举(lv_xml_dir_to_enum 等),token 不在自研 .c 里 */
const BASE_TYPE_ENUM_PREFIXES = ['LV_DIR_'];

for (const w of manifest) {
  const cPath = join(EXTRA_DIR, `lvd_xml_${w.type}.c`);
  let src = '';
  try {
    src = readFileSync(cPath, 'utf8');
  } catch {
    problems.push(`${w.type}: 缺源文件 lvd_xml_${w.type}.c`);
    continue;
  }

  const entry = { attrs: [], enums: [], setters: [], children: [] };
  report.widgets[w.type] = entry;

  check(
    registryC.includes(`lv_xml_register_widget("${w.xmlTag}"`),
    `${w.type}: lvd_xml_extra.c 未注册 "${w.xmlTag}"`,
  );

  const allAttrs = [
    ...w.attrs.map((a) => ({ ...a, scope: w.type })),
    ...(w.children ?? []).flatMap((c) => [
      ...(c.createAttrs ?? []).map((a) => ({ ...a, scope: c.type })),
      ...c.attrs.map((a) => ({ ...a, scope: c.type })),
    ]),
  ];

  for (const a of allAttrs) {
    const ok = src.includes(`"${a.name}"`);
    entry.attrs.push({ scope: a.scope, name: a.name, inSource: ok });
    check(ok, `${a.scope}.${a.name}: 属性名未出现在 lvd_xml_${w.type}.c`);

    if (a.enum && !BASE_TYPE_ENUM_PREFIXES.includes(a.enum.cPrefix)) {
      for (const t of a.enum.tokens) {
        const tok = src.includes(`"${t}"`);
        entry.enums.push({ attr: `${a.scope}.${a.name}`, token: t, inSource: tok });
        check(tok, `${a.scope}.${a.name}: 枚举 token "${t}" 未出现在 lvd_xml_${w.type}.c`);
      }
    }
    // cSetter 被真实调用(canvas fill_bg 等直接调;聚合 setter 只查名字出现)
    const called = src.includes(`${a.cSetter}(`);
    entry.setters.push({ attr: `${a.scope}.${a.name}`, cSetter: a.cSetter, called });
    check(called, `${a.scope}.${a.name}: cSetter ${a.cSetter}() 未在 lvd_xml_${w.type}.c 调用`);
  }

  for (const c of w.children ?? []) {
    const reg = registryC.includes(`lv_xml_register_widget("${c.xmlTag}"`);
    entry.children.push({ type: c.type, xmlTag: c.xmlTag, registered: reg });
    check(reg, `${c.type}: 子元素 "${c.xmlTag}" 未全名注册`);
  }
}

check(manifest.length === 13, `manifest 应为 13 控件,实际 ${manifest.length}`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'extra-attrs-audit.json'), `${JSON.stringify(report, null, 2)}\n`);

if (problems.length > 0) {
  console.error(`audit-extra: ${problems.length} 处不一致:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`audit-extra: OK — ${manifest.length} 控件,manifest ↔ .c 对账无缺项(out/extra-attrs-audit.json)`);
