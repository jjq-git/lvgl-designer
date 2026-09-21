/** dist/ 预构建产物的模块声明(wasm 产物不重编,只声明类型) */

declare module '*lvgl_runtime.mjs' {
  import type { LvglModuleFactory } from './types';
  const createLvglRuntime: LvglModuleFactory;
  export default createLvglRuntime;
}

declare module '*.wasm?url' {
  const url: string;
  export default url;
}
