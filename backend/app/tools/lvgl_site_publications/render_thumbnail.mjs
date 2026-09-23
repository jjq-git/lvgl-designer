import http from 'node:http'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { chromium } from 'playwright'

const [siteRootArg, documentPath, outputPath, widthArg, heightArg, shape] = process.argv.slice(2)
if (!siteRootArg || !documentPath || !outputPath) throw new Error('site root, document and output are required')
const siteRoot = resolve(siteRootArg)
const uiDocument = JSON.parse(await readFile(documentPath, 'utf8'))
const width = Number(widthArg)
const height = Number(heightArg)
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) {
  throw new Error('invalid logical size')
}

const mime = path => ({ '.js': 'text/javascript', '.css': 'text/css' }[extname(path)] || 'application/octet-stream')
const pageHtml = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/assets/styles.css">
<style>html,body{margin:0;width:${width}px;height:${height}px;background:transparent;overflow:hidden}*{animation-play-state:paused!important;transition:none!important}#root{width:${width}px;height:${height}px}</style>
</head><body><div id="root"></div><script type="module">
import { createWebUiRenderer } from '/assets/renderer.js';
const doc=await (await fetch('/document.json')).json();
const renderer=createWebUiRenderer(document.querySelector('#root'),doc,{interactive:false,deviceFrames:[]});
renderer.actualSize(); await document.fonts.ready; await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); window.__thumbnailReady=true;
</script></body></html>`

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === '/' || request.url === '/render.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end(pageHtml)
      return
    }
    if (request.url === '/document.json') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify(uiDocument))
      return
    }
    const relative = decodeURIComponent((request.url || '').replace(/^\//, ''))
    const target = resolve(siteRoot, relative)
    if (!target.startsWith(`${siteRoot}${sep}`)) throw new Error('path traversal')
    const content = await readFile(target)
    response.writeHead(200, { 'Content-Type': mime(target), 'Cache-Control': 'no-store' })
    response.end(content)
  } catch {
    if (!response.headersSent) response.writeHead(404)
    response.end('not found')
  }
})
await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady))
const address = server.address()
const configuredBrowser = process.env.LVGL_PODSC_CHROMIUM_PATH
const systemChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const executablePath = configuredBrowser || (process.platform === 'win32' && existsSync(systemChrome) ? systemChrome : undefined)
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  await page.addInitScript(() => {
    const fixedTime = Date.UTC(2024, 0, 1, 0, 0, 0)
    const NativeDate = Date
    class FixedDate extends NativeDate {
      constructor (...args) { super(...(args.length ? args : [fixedTime])) }
      static now () { return fixedTime }
    }
    globalThis.Date = FixedDate
  })
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1' && Number(url.port) === address.port) await route.continue()
    else await route.abort('blockedbyclient')
  })
  await page.goto(`http://127.0.0.1:${address.port}/render.html`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__thumbnailReady === true)
  const surface = page.locator('.web-ui-screen__surface')
  await surface.waitFor({ state: 'visible' })
  await surface.evaluate((element, round) => {
    element.style.boxShadow = 'none'
    element.style.filter = 'none'
    element.style.outline = 'none'
    if (round) {
      element.style.borderRadius = '50%'
      element.style.overflow = 'hidden'
      element.style.clipPath = 'circle(50% at 50% 50%)'
    }
  }, shape === 'round')
  const bytes = await surface.screenshot({ type: 'png', omitBackground: true, animations: 'disabled' })
  await writeFile(outputPath, bytes)
} finally {
  await browser.close()
  await new Promise(resolveClose => server.close(resolveClose))
}
