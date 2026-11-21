import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';

const turboConfig = JSON.parse(
  readFileSync(resolve(import.meta.dir, '..', 'turbo.json'), 'utf8')
) as { tasks: Record<string, { passThroughEnv?: string[] }> };

/** Names read from the process environment by services/backend dev (scripts/start-convex-dev.ts and its imports). */
const DEV_WRAPPER_ENV_NAMES = [
  'SKIP_DEV_MIGRATIONS',
  'CONVEX_DEPLOY_KEY',
  'CONVEX_DEPLOYMENT',
  'CONVEX_URL',
  'VITE_CONVEX_URL',
];

describe('turbo.json backend dev task', () => {
  it('passes every env name the dev wrapper reads through turbo', () => {
    const passThrough = turboConfig.tasks['@workspace/backend#dev']?.passThroughEnv ?? [];
    for (const name of DEV_WRAPPER_ENV_NAMES) {
      expect(passThrough).toContain(name);
    }
  });
});
