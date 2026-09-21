/**
 * Record<string,string> / string[] → C char** 打包(design/02 §3.2)。
 * 布局:指针表 (N+2)*4 字节,N 个 char* + 双 NULL 结尾
 * (多留一个 slot 兼容 C 侧成对判空写法,见 m0 BRIDGE_ASSUMPTIONS #10)。
 */
import { LvglError } from './errors';
import type { AllocModule } from './types';

export interface PackedStrArray {
  /** char** 指针(传给桥函数) */
  table: number;
  /** 释放全部串 + 指针表 */
  free(): void;
}

/** 扁平字符串数组 → NULL 结尾 char** */
export function packStrArray(mod: AllocModule, list: readonly string[]): PackedStrArray {
  const ptrs = list.map((s) => mod.stringToNewUTF8(String(s)));
  const table = mod._malloc((ptrs.length + 2) * 4);
  const base = table >> 2;
  for (let i = 0; i < ptrs.length; i++) mod.HEAP32[base + i] = ptrs[i]!;
  mod.HEAP32[base + ptrs.length] = 0;
  mod.HEAP32[base + ptrs.length + 1] = 0;
  return {
    table,
    free: () => {
      for (const p of ptrs) mod._free(p);
      mod._free(table);
    },
  };
}

/**
 * Record<string,string> → k,v 交替 char**。
 * attrs 不得含 'name' 键(design/02 §5.3 不变式 3:name 是身份,不走属性通道)。
 */
export function packAttrs(mod: AllocModule, attrs: Record<string, string>): PackedStrArray {
  const flat: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'name') throw new LvglError('attrs must not contain "name" key');
    flat.push(k, String(v));
  }
  return packStrArray(mod, flat);
}
