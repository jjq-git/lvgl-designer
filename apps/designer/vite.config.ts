import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
  // 相对 base:同一份构建既能挂根路径(本机 :8318)也能挂子路径(腾讯云 /lvgl/)
  base: './',
  plugins: [react()],
  // WASM 运行时不能被 esbuild 预打包(内部 import.meta.url 定位 .wasm 会被破坏)
  optimizeDeps: {
    exclude: ['@lvd/lvgl-runtime'],
  },
  assetsInclude: ['**/*.wasm'],
  server: {
    proxy: {
      '/api': env.LVD_API_TARGET || 'http://127.0.0.1:8001',
    },
  },
  };
});
