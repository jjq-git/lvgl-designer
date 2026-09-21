export function convertFont(
  input: Uint8Array,
  options: { size: number; bpp: number; format: 'lvgl' | 'bin'; name: string; range: number[] },
): Promise<string | Uint8Array>;

export function findMissingCodePoints(input: Uint8Array, codePoints: number[]): number[];

export const convert: unknown;
