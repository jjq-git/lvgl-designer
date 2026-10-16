import type { ImageAsset } from '@lvd/schema';

const CODE_NAME_RE = /^[a-z][a-z0-9_]*$/;
const MAX_IMAGE_DIMENSION = 4096;
const MAX_IMAGE_PIXELS = 16_777_216;

export interface RgbaRaster {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface ConvertedLvglImage {
  cSource: string;
  width: number;
  height: number;
  stride: number;
  dataSize: number;
}

type DirectColorFormat = 'RGB565' | 'RGB565A8' | 'ARGB8888' | 'A8';

function validateCodeName(codeName: string, kind: string): void {
  if (!CODE_NAME_RE.test(codeName)) {
    throw new Error(`${kind} codeName 不是安全的 C 标识符：${codeName}`);
  }
}

function validateRaster(raster: RgbaRaster): void {
  const { width, height, data } = raster;
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1
    || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION
    || width * height > MAX_IMAGE_PIXELS) {
    throw new Error(`图片尺寸超出范围：${width}x${height}`);
  }
  if (data.length !== width * height * 4) {
    throw new Error(`RGBA 数据长度无效：期望 ${width * height * 4}，实际 ${data.length}`);
  }
}

function resolveStride(requested: number | undefined, minimum: number, format: DirectColorFormat): number {
  const stride = requested ?? minimum;
  if (!Number.isInteger(stride) || stride < minimum || stride > 65535) {
    throw new Error(`${format} stride 必须在 ${minimum} 到 65535 之间`);
  }
  if (format === 'RGB565A8' && stride % 2 !== 0) {
    throw new Error('RGB565A8 stride 必须为偶数');
  }
  return stride;
}

function encodeDirectColor(
  raster: RgbaRaster,
  colorFormat: DirectColorFormat,
  requestedStride?: number,
): { bytes: Uint8Array; stride: number } {
  validateRaster(raster);
  const { width, height, data } = raster;
  const bytesPerPixel = colorFormat === 'ARGB8888' ? 4
    : colorFormat === 'A8' ? 1
      : 2;
  const minimumStride = width * bytesPerPixel;
  const stride = resolveStride(requestedStride, minimumStride, colorFormat);
  const alphaStride = colorFormat === 'RGB565A8' ? stride / 2 : 0;
  if (colorFormat === 'RGB565A8' && alphaStride < width) {
    throw new Error('RGB565A8 alpha stride 小于图片宽度');
  }
  const colorSize = stride * height;
  const output = new Uint8Array(colorSize + alphaStride * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const red = data[source]!;
      const green = data[source + 1]!;
      const blue = data[source + 2]!;
      const alpha = data[source + 3]!;
      if (colorFormat === 'A8') {
        output[y * stride + x] = alpha;
      } else if (colorFormat === 'ARGB8888') {
        const destination = y * stride + x * 4;
        output[destination] = blue;
        output[destination + 1] = green;
        output[destination + 2] = red;
        output[destination + 3] = alpha;
      } else {
        const packed = ((red >> 3) << 11) | ((green >> 2) << 5) | (blue >> 3);
        const destination = y * stride + x * 2;
        output[destination] = packed & 0xff;
        output[destination + 1] = packed >> 8;
        if (colorFormat === 'RGB565A8') {
          output[colorSize + y * alphaStride + x] = alpha;
        }
      }
    }
  }
  return { bytes: output, stride };
}

function cArray(data: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < data.length; offset += 16) {
    lines.push(`    ${[...data.subarray(offset, offset + 16)]
      .map((value) => `0x${value.toString(16).padStart(2, '0')},`).join('')}`);
  }
  return lines.join('\n');
}

export function convertRgbaToLvglC(
  raster: RgbaRaster,
  codeName: string,
  colorFormat: ImageAsset['conv']['colorFormat'],
  requestedStride?: number,
): ConvertedLvglImage {
  validateCodeName(codeName, '图片');
  if (colorFormat === 'I1' || colorFormat === 'I2' || colorFormat === 'I4' || colorFormat === 'I8') {
    throw new Error(`本地 C 导出暂不支持索引色 ${colorFormat}；请改用 RGB565、RGB565A8、ARGB8888 或 A8`);
  }
  const { bytes, stride } = encodeDirectColor(raster, colorFormat, requestedStride);
  const symbol = `img_${codeName}`;
  const cSource = `/* Generated deterministically for LVGL 9.5.0. */
#include "../images.h"

#ifndef LV_ATTRIBUTE_MEM_ALIGN
#define LV_ATTRIBUTE_MEM_ALIGN
#endif
#ifndef LV_ATTRIBUTE_LARGE_CONST
#define LV_ATTRIBUTE_LARGE_CONST
#endif

static const LV_ATTRIBUTE_MEM_ALIGN LV_ATTRIBUTE_LARGE_CONST uint8_t ${symbol}_map[] = {
${cArray(bytes)}
};

const lv_image_dsc_t ${symbol} = {
    .header = {
        .magic = LV_IMAGE_HEADER_MAGIC,
        .cf = LV_COLOR_FORMAT_${colorFormat},
        .flags = 0,
        .w = ${raster.width},
        .h = ${raster.height},
        .stride = ${stride},
        .reserved_2 = 0,
    },
    .data_size = sizeof(${symbol}_map),
    .data = ${symbol}_map,
    .reserved = NULL,
};
`;
  return {
    cSource,
    width: raster.width,
    height: raster.height,
    stride,
    dataSize: bytes.length,
  };
}

export function convertLottieToLvglC(bytes: Uint8Array, codeName: string): string {
  validateCodeName(codeName, 'Lottie');
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`无法解析 Lottie JSON：${codeName}`);
  }
  if (typeof document !== 'object' || document === null
    || !Array.isArray((document as { layers?: unknown }).layers)) {
    throw new Error(`Lottie 文档必须包含 layers 数组：${codeName}`);
  }
  const symbol = `lottie_${codeName}`;
  return `/* Generated deterministically for LVGL 9.5.0. */
#include <stddef.h>
#include <stdint.h>

const uint8_t ${symbol}[] = {
${cArray(bytes)}
};
const size_t ${symbol}_size = sizeof(${symbol});
`;
}

async function decodeRaster(bytes: Uint8Array, mime: string): Promise<RgbaRaster> {
  const owned = new Uint8Array(bytes.length);
  owned.set(bytes);
  const blob = new Blob([owned.buffer], { type: mime || 'application/octet-stream' });
  let width: number;
  let height: number;
  let draw: (context: CanvasRenderingContext2D) => void;
  let close: (() => void) | undefined;

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    width = bitmap.width;
    height = bitmap.height;
    draw = (context) => context.drawImage(bitmap, 0, 0);
    close = () => bitmap.close();
  } else {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('浏览器无法解码图片'));
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
    width = image.naturalWidth;
    height = image.naturalHeight;
    draw = (context) => context.drawImage(image, 0, 0);
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('浏览器无法创建图片转换画布');
    draw(context);
    const imageData = context.getImageData(0, 0, width, height);
    return { width, height, data: imageData.data };
  } finally {
    close?.();
  }
}

export async function convertImageAssetToLvglC(
  asset: ImageAsset,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  if (asset.kind === 'lottie') return convertLottieToLvglC(bytes, asset.name);
  let raster: RgbaRaster;
  try {
    raster = await decodeRaster(bytes, mime);
  } catch (error) {
    throw new Error(`无法解码图片 ${asset.name}：${error instanceof Error ? error.message : String(error)}`);
  }
  return convertRgbaToLvglC(
    raster,
    asset.name,
    asset.conv.colorFormat,
    asset.conv.stride,
  ).cSource;
}
