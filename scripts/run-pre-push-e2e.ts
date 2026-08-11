#!/usr/bin/env bun
// fallow-ignore-file unused-file

import { fileURLToPath } from 'node:url';

import { resolveE2eSuiteTag, type E2eSuiteTag } from './resolve-e2e-suite';

const WEBAPP_ROOT = fileURLToPath(new URL('../apps/webapp/', import.meta.url));
const PLAYWRIGHT_CONFIG = 'tests/e2e/playwright.config.ts';

export type SpawnSyncFn = typeof Bun.spawnSync;

/** Build argv for a tagged Playwright run (pure — testable without subprocess). */
export function playwrightArgs(tag: E2eSuiteTag): string[] {
  return [
    'pnpm',
    'exec',
    'playwright',
    'test',
    `--config=${PLAYWRIGHT_CONFIG}`,
    '--grep',
    tag,
    '--pass-with-no-tests',
  ];
}

/** Run pre-push e2e with injectable spawn for unit tests. */
export function runPrePushE2eWithSpawn(
  remoteName: string | undefined,
  remoteUrl: string | undefined,
  spawnSync: SpawnSyncFn = Bun.spawnSync
): number {
  const tag = resolveE2eSuiteTag(remoteUrl);
  const label = remoteName ?? 'unknown';
  console.log(`[pre-push] e2e: remote "${label}" → running suite ${tag}`);

  const proc = spawnSync(playwrightArgs(tag), {
    cwd: WEBAPP_ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return proc.exitCode ?? 1;
}

export function runPrePushE2e(
  remoteName: string | undefined,
  remoteUrl: string | undefined
): number {
  return runPrePushE2eWithSpawn(remoteName, remoteUrl);
}

if (import.meta.main) {
  process.exit(runPrePushE2e(process.argv[2], process.argv[3]));
}
