import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.join(__dirname, '..'), '');
  const apiPort = env['PORT'] ?? process.env['PORT'] ?? '8080';

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: '../dist/client',
      emptyOutDir: true,
    },
  };
});
