import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: path.join(rootDir, 'client'),
  build: {
    outDir: path.join(rootDir, 'client/build'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.join(rootDir, 'client'),
    },
  },
  css: {
    postcss: path.join(rootDir, 'postcss.config.mjs'),
  },
  appType: 'spa',
});
