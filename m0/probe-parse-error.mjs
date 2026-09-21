// 清单项3补充探针:坏 XML → reloadScreen 报错,日志钩子应带行号信息
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn(process.execPath, ['/home/rie/lvgl-web-designer/m0/server.mjs'], { stdio: 'ignore' });
const URL_ = 'http://localhost:8317/m0/index.html';
const t0 = Date.now();
while (Date.now() - t0 < 10000) {
  try { const r = await fetch(URL_); if (r.ok) break; } catch { /* retry */ }
  await new Promise(r => setTimeout(r, 200));
}
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(URL_, { waitUntil: 'load' });
const out = await page.evaluate(async () => {
  const { LvglRuntime } = await import('/m0/runtime-wrapper.mjs');
  const rt = await LvglRuntime.create(document.getElementById('lvgl-canvas'), 240, 240);
  try {
    // 未闭合标签 + 未知属性,故意坏
    rt.reloadScreen('bad', '<screen><view><lv_label text="x"</view></screen>');
    return { threw: false };
  } catch (e) {
    return { threw: true, message: String(e.message) };
  } finally { rt.destroy(); }
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.kill();
