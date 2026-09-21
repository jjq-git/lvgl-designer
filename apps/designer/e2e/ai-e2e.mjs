/**
 * AI 面板集成 e2e(打线上 http://localhost:8318,playwright route mock DeepSeek)。
 * 运行:node e2e/ai-e2e.mjs
 * 截图 → e2e/artifacts-ai/。
 * 场景:
 *   A1 开面板(悬浮钮)          A2 发送 → mock ops 应用(气泡/meta/对象树/画布像素)
 *   A3 Ctrl+Z 撤销               A4 设置弹层(温度持久化 + 测试连接走 mock)
 *   A5 错误路径(坏 JSON → 气泡报错、工程无变化)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const artDir = join(here, 'artifacts-ai');
mkdirSync(artDir, { recursive: true });
const BASE = 'http://localhost:8318';

/* ---------------- mock:DeepSeek 非流式响应(chatComplete 解析 choices[0].message.content) */
const CANNED_OPS = [
  {
    op: 'add', parent: null,
    node: { type: 'slider', name: 'ai_slider', props: { x: 45, y: 150, width: 150 }, inlineStyles: [] },
  },
  {
    op: 'add', parent: null,
    node: { type: 'label', name: 'ai_label', props: { y: 60, align: 'top_mid', text: '亮度' } },
  },
];
const CANNED_REPLY = '已添加亮度滑条和标签';
const dsWrap = (contentObj) => JSON.stringify({
  id: 'chatcmpl-mock', object: 'chat.completion', created: Math.floor(Date.now() / 1000),
  model: 'deepseek-chat',
  choices: [{
    index: 0,
    message: { role: 'assistant', content: JSON.stringify(contentObj) },
    finish_reason: 'stop',
  }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});

const results = [];
const errsMain = [];      // 正常场景 console/page error
const errsBadJson = [];   // 坏 JSON 场景(有意触发,单列)
let phase = 'main';
const assert = (cond, msg) => {
  if (!cond) throw new Error(`断言失败:${msg}`);
  results.push(msg);
};
const step = (name) => results.push(`--- ${name} ---`);

let browser = null;
try {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pushErr = (m) => (phase === 'badjson' ? errsBadJson : errsMain).push(m);
  page.on('pageerror', (e) => pushErr(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') pushErr(`console.error: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());

  let mockHits = 0;
  await page.route('**/api/deepseek/chat', async (route) => {
    mockHits++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: dsWrap({ reply: CANNED_REPLY, ops: CANNED_OPS }),
    });
  });

  /* ---------- 启动:清 IndexedDB + 设 key → 重载 ---------- */
  step('A0 环境:清 IndexedDB + 设 localStorage key');
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.rt-badge.rt-wasm', { timeout: 30000 });
  await page.evaluate(async () => {
    localStorage.setItem('lvd.ds.key', 'test-key');
    const dbs = (await indexedDB.databases?.()) ?? [{ name: 'lvgl-designer' }];
    await Promise.all(dbs.map((d) => new Promise((res) => {
      const req = indexedDB.deleteDatabase(d.name);
      req.onsuccess = req.onerror = req.onblocked = () => res();
    })));
  });
  await page.reload();
  await page.waitForSelector('.rt-badge.rt-wasm', { timeout: 30000 });
  await page.waitForTimeout(800);
  results.push('A0 页面就绪(wasm runtime 徽章出现)');

  const model = () => page.evaluate(() => {
    const st = window.__lvd.projectStore.getState();
    const scr = st.project.screens.find((s) => s.id === window.__lvd.editorStore.getState().activeScreenId)
      ?? st.project.screens[0];
    return {
      undoDepth: st.past?.length ?? null,
      children: scr.root.children.map((c) => ({ type: c.type, name: c.name ?? null, props: c.props })),
    };
  });
  const canvas = page.locator('#lvgl-canvas');
  const shot = async (name) => writeFileSync(join(artDir, name), await page.screenshot());

  /* ---------- A1 开面板 ---------- */
  step('A1 悬浮钮开 AI 面板');
  assert(await page.locator('.ai-launcher').count() === 1, 'A1 右下角 AI 悬浮钮存在');
  await page.locator('.ai-launcher').click();
  await page.waitForSelector('.ai-panel', { timeout: 5000 });
  assert(await page.locator('.ai-empty .ai-example-btn').count() === 3, 'A1 空态 3 个示例 prompt');
  assert(await page.locator('.ai-empty-nokey').count() === 0, 'A1 已配 key → 无"未配置 Key"提示');
  await shot('ai-panel-open.png');

  /* ---------- A2 发送 → 应用 2 ops ---------- */
  step('A2 发送"加一个亮度滑条" → mock ops 应用');
  let m = await model();
  assert(m.children.length === 0, `A2 前置:新工程画布 0 子节点(实际 ${m.children.length})`);
  const shotBefore = await canvas.screenshot();

  await page.locator('.ai-input').fill('加一个亮度滑条');
  await page.locator('.ai-send').click();
  await page.waitForSelector(`.ai-msg.assistant .ai-bubble:has-text("${CANNED_REPLY}")`, { timeout: 10000 });
  assert(true, `A2 助手气泡出现 reply:"${CANNED_REPLY}"`);
  const meta = await page.locator('.ai-msg.assistant .ai-meta').innerText();
  assert(meta.includes('已应用 2 个操作'), `A2 meta 提示已应用 2 个操作(实际:"${meta}")`);
  assert(mockHits === 1, `A2 mock 恰好被调 1 次(一把过,无修复轮;实际 ${mockHits})`);

  m = await model();
  const slider = m.children.find((c) => c.name === 'ai_slider');
  const label = m.children.find((c) => c.name === 'ai_label');
  assert(
    m.children.length === 2 && slider?.type === 'slider' && label?.type === 'label',
    `A2 模型 2 节点:${m.children.map((c) => `${c.type}:${c.name}`).join(', ')}`,
  );
  assert(
    slider.props.x === 45 && slider.props.y === 150 && slider.props.width === 150,
    `A2 ai_slider props 落地 x=45,y=150,width=150`,
  );
  assert(
    label.props.text === '亮度' && label.props.align === 'top_mid',
    `A2 ai_label props 落地 text=亮度,align=top_mid`,
  );
  assert(
    await page.locator('.tree-row', { hasText: 'ai_slider' }).count() === 1 &&
      await page.locator('.tree-row', { hasText: 'ai_label' }).count() === 1,
    'A2 对象树出现 ai_slider / ai_label',
  );
  await page.waitForTimeout(600); // 画布热重载收敛
  const shotAfter = await canvas.screenshot();
  assert(Buffer.compare(shotBefore, shotAfter) !== 0, 'A2 画布 snapshot 像素变化');
  await shot('ai-applied.png');

  /* ---------- A3 Ctrl+Z 撤销 ---------- */
  step('A3 Ctrl+Z 撤销 AI 操作');
  await page.locator('.panel-title', { hasText: '对象树' }).click(); // 焦点移出输入框
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  m = await model();
  assert(
    m.children.length === 0,
    `A3 undo 后两控件消失(children=${m.children.length})`,
  );
  assert(
    await page.locator('.tree-row', { hasText: 'ai_slider' }).count() === 0 &&
      await page.locator('.tree-row', { hasText: 'ai_label' }).count() === 0,
    'A3 对象树不再有 ai_slider / ai_label',
  );

  /* ---------- A4 设置弹层 ---------- */
  step('A4 设置弹层(温度 + 测试连接)');
  await page.locator('.ai-head .icon-btn[title^="设置"]').click();
  await page.waitForSelector('.ai-modal', { timeout: 5000 });
  await page.locator('.ai-modal input[type="range"]').evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '0.7');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const tempVal = await page.locator('.ai-temp-val').innerText();
  const tempLs = await page.evaluate(() => localStorage.getItem('lvd.ds.temperature'));
  assert(tempVal === '0.7' && tempLs === '0.7', `A4 温度改 0.7 并持久化(UI=${tempVal}, ls=${tempLs})`);

  const hitsBeforeTest = mockHits;
  await page.locator('.ai-modal button', { hasText: '测试连接' }).click();
  await page.waitForSelector('.ai-test-ok', { timeout: 10000 });
  assert(mockHits === hitsBeforeTest + 1, 'A4 测试连接走 mock 返回"✓ 连接正常"');
  await shot('ai-settings.png');
  await page.locator('.ai-modal-head .icon-btn[title="关闭"]').click();
  await page.waitForTimeout(200);
  assert(await page.locator('.ai-modal').count() === 0, 'A4 设置弹层关闭');

  /* ---------- A5 错误路径:坏 JSON ---------- */
  step('A5 mock 改坏 JSON → 气泡报错、工程无变化');
  phase = 'badjson';
  await page.unroute('**/api/deepseek/chat');
  await page.route('**/api/deepseek/chat', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'this is {{ not json' }),
  );
  const beforeErr = await model();
  await page.locator('.ai-input').fill('再加一个按钮');
  await page.locator('.ai-send').click();
  await page.waitForSelector('.ai-meta.error', { timeout: 10000 });
  const errText = await page.locator('.ai-meta.error').innerText();
  assert(errText.length > 0, `A5 气泡显示错误:"${errText.slice(0, 80)}"`);
  m = await model();
  assert(
    m.children.length === beforeErr.children.length,
    `A5 工程无变化(children 仍 ${m.children.length})`,
  );
  await shot('ai-error.png');
  phase = 'main';

  /* ---------- 收尾:console error 统计 ---------- */
  if (errsMain.length > 0) {
    throw new Error(`正常场景收集到 ${errsMain.length} 条页面错误:${errsMain.slice(0, 5).join(' | ')}`);
  }
  results.push('全程(正常场景)0 条 pageerror/console.error');
  results.push(
    errsBadJson.length > 0
      ? `坏 JSON 场景有意错误日志 ${errsBadJson.length} 条(允许,单列):${errsBadJson.slice(0, 3).join(' | ')}`
      : '坏 JSON 场景 0 条错误日志',
  );

  await browser.close();
  console.log('AI-E2E PASS');
  for (const r of results) console.log(' -', r);
} catch (e) {
  console.error(`AI-E2E FAIL: ${e.message}`);
  for (const r of results) console.log(' [ok]', r);
  if (errsMain.length) console.log(' errsMain:', errsMain.join(' | '));
  if (errsBadJson.length) console.log(' errsBadJson:', errsBadJson.join(' | '));
  try {
    if (browser) {
      for (const pg of (await browser.contexts()).flatMap((c) => c.pages())) {
        writeFileSync(join(artDir, 'FAIL-page.png'), await pg.screenshot());
        break;
      }
    }
  } catch { /* ignore */ }
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
}
