import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/sitePublication.ts',
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      output: { entryFileNames: 'lvgl-site-publication-worker.mjs', inlineDynamicImports: true },
    },
  },
  ssr: { noExternal: true },
});
