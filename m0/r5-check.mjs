// R5 销账:chromium 里跑 font-conv 浏览器 bundle(test.html 走 m0/server.mjs)
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn(process.execPath, ['/home/rie/lvgl-web-designer/m0/server.mjs'], { stdio: 'ignore' });
const URL_ = 'http://localhost:8317/packages/asset-pipeline/spike/test.html';
const t0 = Date.now();
while (Date.now() - t0 < 10000) {
  try { const r = await fetch(URL_); if (r.ok) break; } catch { /* retry */ }
  await new Promise(r => setTimeout(r, 200));
}
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.error('pageerror:', e.message));
await page.goto(URL_, { waitUntil: 'load' });
await page.waitForFunction(() => {
  const t = document.getElementById('result')?.textContent || '';
  return t && !t.includes('running');
}, null, { timeout: 60000 });
console.log('R5 result:', await page.locator('#result').textContent());
await browser.close();
server.kill();
