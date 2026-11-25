import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { appShellManifest, collectWorkerShell, katexWoff2Only, manualChunks } from './build/vite-plugins';

const output = {
  manualChunks,
  onlyExplicitManualChunks: true,
  entryFileNames: 'assets/[name]-[hash].js',
  chunkFileNames: 'assets/[name]-[hash].js',
  assetFileNames: 'assets/[name]-[hash][extname]',
};

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

const workerShell = new Set<string>();

export default defineConfig({
  plugins: [katexWoff2Only(), tailwindcss(), svelte(), appShellManifest(workerShell)],
  build: {
    target: 'es2022',
    modulePreload: { polyfill: false },
    copyPublicDir: false,
    assetsInlineLimit: 0,
    rollupOptions: { output },
  },
  worker: {
    format: 'es',
    plugins: () => [collectWorkerShell(workerShell)],
    rollupOptions: { output },
  },
  test: { css: { include: [/\.css/] } },
  preview: {
    headers: {
      'Content-Security-Policy': contentSecurityPolicy,
      'X-Content-Type-Options': 'nosniff',
    },
  },
});
