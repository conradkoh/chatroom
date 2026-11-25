import { defineConfig, devices } from '@playwright/test';

import { getWebappBaseUrl, getWebappPort } from './support/env';

const port = getWebappPort();
const baseURL = getWebappBaseUrl();

console.log(`[e2e] Using port ${port} (baseURL: ${baseURL})`);

/**
 * Playwright configuration for e2e tests.
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './specs',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit-markdown',
      testMatch: /specs\/upstream\/markdown-editor\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    // CI starts the self-hosted Convex backend separately, so only start Next.js here.
    command: process.env.CI ? 'pnpm --filter @workspace/webapp dev' : 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    cwd: '../../..', // repo root — turbo starts webapp + Convex
    timeout: 120_000,
    // turbo runs each dev task in its own process group, so Playwright's default
    // SIGKILL of the shell group leaves an orphaned `next dev` holding the port.
    // SIGTERM lets turbo forward shutdown to its child tasks and exit cleanly.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    env: {
      PORT: port,
    },
  },
});
