import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function buildProvenance() {
  return {
    name: 'lvd-build-provenance',
    closeBundle() {
      const pnpmVersion = '9.15.9';
      const pnpmUserAgent = process.env.npm_config_user_agent ?? '';
      if (!pnpmUserAgent.startsWith(`pnpm/${pnpmVersion} `)) {
        throw new Error(`expected pnpm/${pnpmVersion}, got ${pnpmUserAgent || 'unknown'}`);
      }
      const root = resolve(import.meta.dirname, '../..');
      const worker = resolve(import.meta.dirname, 'dist/lvgl-build-worker.mjs');
      const lockfile = resolve(root, 'pnpm-lock.yaml');
      const pnpmEntrypoint = process.env.npm_execpath;
      if (!pnpmEntrypoint) throw new Error('npm_execpath is required to attest pnpm');
      const manifest = {
        formatVersion: 1,
        node: { version: process.version, path: process.execPath, sha256: sha256(process.execPath) },
        pnpm: {
          version: pnpmVersion,
          userAgent: pnpmUserAgent,
          path: pnpmEntrypoint,
          sha256: sha256(pnpmEntrypoint),
          lockfile: 'pnpm-lock.yaml',
          lockfileSha256: sha256(lockfile),
        },
        worker: { path: 'lvgl-build-worker.mjs', sha256: sha256(worker) },
      };
      writeFileSync(
        resolve(import.meta.dirname, 'dist/build-provenance.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
      );
    },
  };
}

export default defineConfig({
  plugins: [buildProvenance()],
  build: {
    ssr: 'src/index.ts',
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: 'lvgl-build-worker.mjs', inlineDynamicImports: true },
    },
  },
  ssr: { noExternal: true },
});
