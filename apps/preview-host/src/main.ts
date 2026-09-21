import { LvglRuntime } from '@lvd/lvgl-runtime';
import type { PreviewProgram } from '@lvd/preview-compiler';
import './style.css';


const canvasElement = document.querySelector<HTMLCanvasElement>('#preview');
const statusElement = document.querySelector<HTMLParagraphElement>('#status');

if (!canvasElement || !statusElement) throw new Error('preview host document is incomplete');
const canvas = canvasElement;
const status = statusElement;

function extension(fileName: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  return match?.[1]?.toLowerCase() ?? 'bin';
}

async function bytes(sha256: string): Promise<Uint8Array> {
  const response = await fetch(`./assets/${encodeURIComponent(sha256)}`);
  if (!response.ok) throw new Error(`preview asset ${sha256} returned HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function boot(): Promise<void> {
  const response = await fetch('./preview-program.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`PreviewProgram returned HTTP ${response.status}`);
  const program = await response.json() as PreviewProgram;
  canvas.width = program.display.width;
  canvas.height = program.display.height;

  const runtime = await LvglRuntime.create(canvas, program.display.width, program.display.height);
  for (const image of program.globals.images) {
    const payload = await bytes(image.file.sha256);
    const name = `${image.name}.${extension(image.file.fileName)}`;
    runtime.writeFile(`/assets/${name}`, payload);
    runtime.registerImage(image.name, `A:assets/${name}`);
  }
  for (const font of program.globals.fonts) {
    if (font.loader !== 'tiny_ttf') continue;
    runtime.registerFontTinyTtf(font.name, await bytes(font.file.sha256), font.sizePx ?? 16);
  }
  runtime.loadPreviewProgram(program);
  runtime.setMode('play');
  runtime.start();
  status.textContent = `Build Preview · LVGL 9.5 · ${program.display.width}×${program.display.height}`;
}

void boot().catch((error: unknown) => {
  status.classList.add('error');
  status.textContent = `预览加载失败：${error instanceof Error ? error.message : String(error)}`;
});
