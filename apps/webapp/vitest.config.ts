import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    css: true,
    maxWorkers: 4,
    testTimeout: 15_000,
    exclude: [
      'tests/e2e/**',
      'tests/e2e/specs/**',
      'tests/e2e/fixtures/**',
      'tests/e2e/pages/**',
      'node_modules/**',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
