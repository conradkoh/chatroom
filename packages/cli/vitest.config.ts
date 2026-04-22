import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only discover tests in src/ — avoids double-running tests from dist/
    // (tsc used to emit .test.js files to dist/ which vitest would also pick up)
    include: ['src/**/*.{test,spec}.{ts,js}'],
  },
});
