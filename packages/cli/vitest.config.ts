import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only discover tests in src/ — avoids double-running tests from dist/
    // (tsc used to emit .test.js files to dist/ which vitest would also pick up)
    include: ['src/**/*.{test,spec}.{ts,js}'],
    // Integration tests require external services (opencode binary, LLM API).
    // Run them explicitly: pnpm test -- --reporter=verbose *.integration.*
    exclude: ['src/**/*.integration.{test,spec}.{ts,js}'],
    testTimeout: 15_000,
  },
});
