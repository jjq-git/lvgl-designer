import { readFile } from 'node:fs/promises'

const [rendererPath, documentPath] = process.argv.slice(2)
if (!rendererPath || !documentPath) throw new Error('renderer and document paths are required')
const rendererSource = await readFile(rendererPath)
const renderer = await import(`data:text/javascript;base64,${rendererSource.toString('base64')}`)
const raw = JSON.parse(await readFile(documentPath, 'utf8'))
try {
  renderer.normalizeWebUiDocument(raw)
  process.stdout.write(JSON.stringify({ valid: true, errors: [] }))
} catch (error) {
  process.stdout.write(JSON.stringify({
    valid: false,
    errors: Array.isArray(error?.issues)
      ? error.issues
      : [{ path: '(root)', code: 'target_validator_failed', message: error?.message || String(error) }]
  }))
}
