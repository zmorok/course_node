import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  build: {
    outDir: process.env.WORKIFY_BUNDLE_DIR || fileURLToPath(new URL('../proxy/bundle/', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: process.env.BACKEND_URL || 'http://localhost:3000' } },
  },
});
