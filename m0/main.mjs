/**
 * m0/main.mjs — 测试台页面驱动。
 * 暴露 window.runM0(): Promise<results>;完成后置 window.__M0_DONE__ / __M0_RESULTS__。
 */
import { ALL_TESTS, runAllTests } from './tests.mjs';

const canvas = document.getElementById('lvgl-canvas');
const tbody = document.querySelector('#results tbody');
const summary = document.getElementById('summary');
const btn = document.getElementById('run-btn');

function ensureRow(id) {
  let tr = document.getElementById('row-' + id);
  if (!tr) {
    tr = document.createElement('tr');
    tr.id = 'row-' + id;
    tr.innerHTML = '<td></td><td></td><td></td><td></td><td class="detail"></td>';
    tbody.appendChild(tr);
  }
  return tr;
}

function renderRow(r) {
  const tr = ensureRow(r.id);
  const tds = tr.children;
  tds[0].textContent = r.id;
  tds[1].textContent = r.name;
  tds[2].textContent = r.pass ? 'PASS' : 'FAIL';
  tds[2].className = r.pass ? 'pass' : 'fail';
  tds[3].textContent = String(r.ms);
  tds[4].textContent = r.detail;
}

// 预建空表
for (const t of ALL_TESTS) {
  const tr = ensureRow(t.id);
  tr.children[0].textContent = t.id;
  tr.children[1].textContent = t.name;
  tr.children[2].textContent = '…';
}

let runP = null;

window.runM0 = function runM0() {
  if (runP) return runP; // 幂等:重复调用复用同一次运行
  window.__M0_DONE__ = false;
  window.__M0_RESULTS__ = null;
  btn.disabled = true;
  summary.textContent = 'running…';
  runP = (async () => {
    let results;
    try {
      results = await runAllTests(canvas, renderRow);
    } catch (e) {
      // runAllTests 内部已兜异常,这里防万一(如 wasm 加载失败)
      results = [{
        id: 'FATAL', name: 'runAllTests', pass: false, ms: 0,
        detail: String(e && (e.stack || e.message) || e),
      }];
      renderRow(results[0]);
    }
    const passed = results.filter(r => r.pass).length;
    summary.textContent = `${passed}/${results.length} passed`;
    summary.style.color = passed === results.length ? '#4ade80' : '#f87171';
    window.__M0_RESULTS__ = results;
    window.__M0_DONE__ = true;
    btn.disabled = false;
    runP = null;
    return results;
  })();
  return runP;
};

btn.addEventListener('click', () => window.runM0());
