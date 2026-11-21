import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'bun:test';
import ts from 'typescript';

type TurboConfig = { tasks: Record<string, { passThroughEnv?: string[] }> };

/** turbo.json is JSONC. The TypeScript config parser accepts comments and trailing commas. */
function readTurboConfig(): TurboConfig {
  const path = resolve(import.meta.dir, '..', 'turbo.json');
  const { config, error } = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'));
  if (error) {
    throw new Error(
      `turbo.json is not valid JSONC: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`
    );
  }
  return config as TurboConfig;
}

const turboConfig = readTurboConfig();

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

  it('parses turbo.json with its comments', () => {
    expect(turboConfig.tasks['@workspace/backend#dev']).toBeDefined();
  });
});
