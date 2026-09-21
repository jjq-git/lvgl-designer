#!/usr/bin/env node
/**
 * audit-lvgl-version-diff.mjs — 阶段 0 D2 的可复现审计(audit-parsers/audit-extra 的姊妹脚本)
 *
 * 回答一个问题:把 vendor/lvgl 从版本 A 换成版本 B,runtime 会有哪些符号失去定义?
 *
 * 做法:
 *   1. 从 codeload 下载两个 tag 的源码 tarball(缓存到 scripts/out/lvgl-cache/)
 *   2. 抽取各自 src/**\/*.h 中的全部 lv_* 函数与 _t 类型符号
 *   3. 抽取 runtime/src/{bridge*.c,xml_parsers_extra/*.c} 实际引用的 lv_* 符号
 *   4. 求差集:在 A 存在、在 B 缺失、且 runtime 用到的 = 迁移必须处理的面
 *   5. 按 13 个自研 parser 逐个拆分,区分「XML 宿主符号」与「widget/核心符号」
 *
 * 用法:
 *   node scripts/audit-lvgl-version-diff.mjs                 # 默认 v9.4.0 -> v9.5.0
 *   node scripts/audit-lvgl-version-diff.mjs v9.4.0 v9.5.0
 *
 * 输出 scripts/out/lvgl-version-diff.json。runtime 存在无法解析的符号时以非零码退出。
 * 零依赖(用系统 curl + tar),node >= 18。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = join(HERE, 'out');
const CACHE = join(OUT_DIR, 'lvgl-cache');

const FROM = process.argv[2] ?? 'v9.4.0';
const TO = process.argv[3] ?? 'v9.5.0';

/* XML 宿主符号的判据:LVGL 的 XML 引擎前缀 + 其对外暴露的 processor 类型 */
const XML_HOST = /^(lv_xml_|lv_widget_processor_t$)/;

/* ---------- 取源码 ---------- */

function fetchTag(tag) {
  const dir = join(CACHE, tag);
  if (existsSync(join(dir, 'src'))) return dir;
  mkdirSync(dir, { recursive: true });
  /* 全程用相对路径 + cwd:Windows 上 GNU tar 会把 "F:\..." 当成 host:path 远程规格 */
  const opts = { cwd: CACHE, stdio: 'inherit' };
  if (!existsSync(join(CACHE, `${tag}.tar.gz`))) {
    console.error(`[fetch] ${tag} ...`);
    execFileSync('curl', ['-sSL', '--fail', '-m', '600', '-o', `${tag}.tar.gz`,
      `https://codeload.github.com/lvgl/lvgl/tar.gz/refs/tags/${tag}`], opts);
  }
  console.error(`[extract] ${tag} ...`);
  /* tarball 根目录是 lvgl-<tag 去掉前导 v>;--strip-components=1 抹掉它 */
  const inner = `lvgl-${tag.replace(/^v/, '')}`;
  execFileSync('tar', ['xzf', `${tag}.tar.gz`, '-C', tag, '--strip-components=1',
    `${inner}/src`, `${inner}/lv_version.h`], opts);
  return dir;
}

/* ---------- 符号抽取 ---------- */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.h')) out.push(p);
  }
  return out;
}

/** 版本目录 -> 该版本对外可见的 lv_* 符号集合 */
function apiSymbols(root) {
  const set = new Set();
  for (const f of walk(join(root, 'src'))) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\blv_[a-z0-9_]+\s*\(/g)) set.add(m[0].replace(/\s*\($/, ''));
    for (const m of text.matchAll(/\blv_[a-z0-9_]+_t\b/g)) set.add(m[0]);
  }
  return set;
}

/** 源文件 -> 其中引用的 lv_* 符号集合 */
function usedSymbols(file) {
  const set = new Set();
  for (const m of readFileSync(file, 'utf8').matchAll(/\blv_[a-z0-9_]+/g)) set.add(m[0]);
  return set;
}

/* ---------- 主流程 ---------- */

const fromDir = fetchTag(FROM);
const toDir = fetchTag(TO);
const apiFrom = apiSymbols(fromDir);
const apiTo = apiSymbols(toDir);

const extraDir = join(ROOT, 'runtime/src/xml_parsers_extra');
const bridgeDir = join(ROOT, 'runtime/src');

const sources = [
  ...readdirSync(bridgeDir).filter((f) => /^bridge.*\.c$/.test(f)).map((f) => ({ unit: f, path: join(bridgeDir, f) })),
  ...readdirSync(extraDir).filter((f) => f.endsWith('.c')).map((f) => ({ unit: f, path: join(extraDir, f) })),
];

const report = {
  from: FROM, to: TO,
  apiCount: { [FROM]: apiFrom.size, [TO]: apiTo.size },
  /** 在 from 有定义、to 无定义、且 runtime 用到 —— 迁移必须处理 */
  breaking: { xmlHost: [], other: [] },
  units: {},
};

const allUsed = new Set();
for (const { unit, path } of sources) {
  const used = usedSymbols(path);
  const known = [...used].filter((s) => apiFrom.has(s));      // 能在 from 里解析到的才算 LVGL 符号
  const missing = known.filter((s) => !apiTo.has(s));
  report.units[unit] = {
    usedTotal: used.size,
    xmlHost: known.filter((s) => XML_HOST.test(s)).length,
    widgetCore: known.filter((s) => !XML_HOST.test(s)).length,
    missingXmlHost: missing.filter((s) => XML_HOST.test(s)).sort(),
    missingOther: missing.filter((s) => !XML_HOST.test(s)).sort(),
  };
  for (const s of known) allUsed.add(s);
}

for (const s of [...allUsed].sort()) {
  if (apiTo.has(s)) continue;
  (XML_HOST.test(s) ? report.breaking.xmlHost : report.breaking.other).push(s);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'lvgl-version-diff.json'), JSON.stringify(report, null, 2));

/* 供 packages/schema 的 registry↔LVGL API 对账测试消费(它不能自己下载 tarball)。
 * 与 registry-parity.test.ts 读 parser-attrs.json 是同一套约定。 */
writeFileSync(join(OUT_DIR, 'lvgl-symbols.json'), JSON.stringify({
  [FROM]: [...apiFrom].sort(),
  [TO]: [...apiTo].sort(),
}, null, 0));

/* ---------- 人读摘要 ---------- */

const { xmlHost, other } = report.breaking;
console.log(`\n${FROM} -> ${TO}`);
console.log(`  头文件符号数: ${apiFrom.size} -> ${apiTo.size}`);
console.log(`  runtime 引用且可解析的 LVGL 符号: ${allUsed.size}`);
console.log(`  ${TO} 中缺失 — XML 宿主: ${xmlHost.length}`);
console.log(`  ${TO} 中缺失 — 其他(widget/核心): ${other.length}`);
if (other.length) {
  console.log('\n  ⚠ 非 XML 的破坏性变更(需逐个人工处理):');
  for (const s of other) console.log(`      ${s}`);
}
console.log('\n  按编译单元:');
for (const [unit, u] of Object.entries(report.units)) {
  const flag = u.missingOther.length ? ' ⚠' : '';
  console.log(`    ${unit.padEnd(26)} XML宿主=${String(u.xmlHost).padStart(2)} widget/核心=${String(u.widgetCore).padStart(3)}`
    + ` 缺失(XML)=${String(u.missingXmlHost.length).padStart(2)} 缺失(其他)=${u.missingOther.length}${flag}`);
}
console.log(`\n  → ${join('scripts/out', 'lvgl-version-diff.json')}`);

/* 非 XML 的缺失才是意外情况:XML 引擎在 9.5 被整体移除是已知且已记录的事实
 * (docs/lvgl-version-baseline.md §2.2),不应让审计失败;其他缺失必须有人看。 */
process.exit(other.length ? 1 : 0);
