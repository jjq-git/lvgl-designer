import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';


const dist = resolve(new URL('../dist', import.meta.url).pathname.replace(/^\/(.:)/, '$1'));
const program = {
  protocolVersion: 1,
  display: { width: 120, height: 80, colorFormat: 'XRGB8888' },
  globals: { consts: [], styles: [], subjects: [], fonts: [], images: [] },
  screens: [{
    id: 'screen:main', name: 'main', consts: [], styles: [],
    root: {
      id: 'node:root', type: 'obj', runtimeName: 'main', named: true,
      kind: 'widget', useObjBase: false, createProps: {}, props: {},
      flags: [], states: [], inlineStyles: [], styleUses: [], bindings: [], events: [],
      children: [{
        id: 'node:label', type: 'label', runtimeName: 'hello', named: true,
        kind: 'widget', useObjBase: false, createProps: {}, props: { text: 'Sealed Preview' },
        flags: [], states: [], inlineStyles: [], styleUses: [], bindings: [], events: [], children: [],
      }],
    },
  }],
  homeScreenName: 'main',
  runtimeNameToNodeId: { main: { main: 'node:root', hello: 'node:label' } },
};

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (pathname === '/preview-program.json') {
      response.setHeader('Content-Type', mime['.json']);
      response.end(JSON.stringify(program));
      return;
    }
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = resolve(dist, relative);
    if (!file.startsWith(`${dist}${sep}`)) throw new Error('path escaped dist');
    response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
    if (relative === 'index.html') {
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'",
      );
    }
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end('not found');
  }
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('preview smoke server did not bind');
const systemChrome = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => candidate && existsSync(candidate));
const browser = await chromium.launch({ headless: true, ...(systemChrome ? { executablePath: systemChrome } : {}) });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#status')?.textContent?.startsWith('Build Preview'));
  const result = await page.evaluate(() => ({
    status: document.querySelector('#status')?.textContent,
    width: document.querySelector('canvas')?.width,
    height: document.querySelector('canvas')?.height,
  }));
  if (errors.length) throw new Error(errors.join('\n'));
  if (result.width !== 120 || result.height !== 80) throw new Error(`unexpected canvas: ${JSON.stringify(result)}`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await browser.close();
  server.close();
}
