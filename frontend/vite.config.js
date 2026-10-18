import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: process.env.BACKEND_URL || 'http://localhost:3000' } },
  },
});
