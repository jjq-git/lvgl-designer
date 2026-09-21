import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  assetsInclude: ['**/*.wasm'],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'preview-host.js',
        chunkFileNames: 'preview-[name].js',
        assetFileNames: (asset) => asset.name?.endsWith('.wasm')
          ? 'lvgl_runtime.wasm'
          : 'preview-[name][extname]',
      },
    },
  },
});
