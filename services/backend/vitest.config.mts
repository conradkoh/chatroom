import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    maxWorkers: 4,
    server: { deps: { inline: ['convex-test'] } },
    setupFiles: ['./tests/setup.ts'],
    // Turbo already runs packages in parallel; cap in-package file workers to
    // reduce convex-test contention and 5s timeout flakes on pre-push.
    maxWorkers: 4,
    testTimeout: 15_000,
  },
});
