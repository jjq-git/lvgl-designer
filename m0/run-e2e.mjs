/**
 * m0/run-e2e.mjs — playwright 驱动 M0 测试台(集成阶段运行,本阶段不跑)。
 * 用法:node m0/run-e2e.mjs   (需先 npm i playwright 并装 chromium)
 * 产物:m0/artifacts/{results.json, page.png, canvas.png, console.log}
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const M0_DIR = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(M0_DIR, 'artifacts');
const URL_ = 'http://localhost:8317/m0/index.html';
mkdirSync(ART, { recursive: true });

const consoleLines = [];
const log = (tag, msg) => consoleLines.push(`[${new Date().toISOString()}] [${tag}] ${msg}`);

// 1. 起静态服务器
const server = spawn(process.execPath, [path.join(M0_DIR, 'server.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', d => log('server', String(d).trim()));
server.stderr.on('data', d => log('server-err', String(d).trim()));

async function waitPort(url, timeoutMs = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server not up: ' + url);
}

let browser, exitCode = 1;
try {
  await waitPort(URL_);
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  page.on('console', m => log(`console.${m.type()}`, m.text()));
  page.on('pageerror', e => log('pageerror', e.stack || String(e)));
  page.on('requestfailed', r => log('requestfailed', `${r.url()} ${r.failure()?.errorText}`));

  await page.goto(URL_, { waitUntil: 'load' });
  await page.evaluate(() => { window.runM0().catch(e => console.error('runM0 rejected:', e)); });
  await page.waitForFunction('window.__M0_DONE__ === true', null, { timeout: 300000 });
  const results = await page.evaluate('window.__M0_RESULTS__');

  writeFileSync(path.join(ART, 'results.json'), JSON.stringify(results, null, 2));
  await page.screenshot({ path: path.join(ART, 'page.png'), fullPage: true });
  await page.locator('#lvgl-canvas').screenshot({ path: path.join(ART, 'canvas.png') });

  const passed = results.filter(r => r.pass).length;
  console.log(`M0: ${passed}/${results.length} passed`);
  for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'} ${r.id} ${r.name} (${r.ms}ms)${r.pass ? '' : ' — ' + r.detail}`);
  exitCode = passed === results.length ? 0 : 1;
} catch (e) {
  log('e2e-fatal', e.stack || String(e));
  console.error('e2e fatal:', e);
} finally {
  writeFileSync(path.join(ART, 'console.log'), consoleLines.join('\n') + '\n');
  try { await browser?.close(); } catch { /* noop */ }
  server.kill();
}
process.exit(exitCode);
