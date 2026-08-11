import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

import { resolveE2eSuiteTag, runCli } from './resolve-e2e-suite';
import { TEMPLATE_REPO_URL } from './template-repo';
import { TAG_DOWNSTREAM, TAG_UPSTREAM } from '../apps/webapp/tests/e2e/support/tags';

describe('resolveE2eSuiteTag', () => {
  it('returns TAG_UPSTREAM for template HTTPS and SSH URLs', () => {
    expect(resolveE2eSuiteTag('https://github.com/conradkoh/next-convex-starter-app')).toBe(
      TAG_UPSTREAM
    );
    expect(resolveE2eSuiteTag('https://github.com/conradkoh/next-convex-starter-app.git')).toBe(
      TAG_UPSTREAM
    );
    expect(resolveE2eSuiteTag('git@github.com:conradkoh/next-convex-starter-app.git')).toBe(
      TAG_UPSTREAM
    );
    expect(resolveE2eSuiteTag('ssh://git@github.com/conradkoh/next-convex-starter-app.git')).toBe(
      TAG_UPSTREAM
    );
  });

  it('returns TAG_DOWNSTREAM for fork, lookalike-host, empty, null, and malformed URLs', () => {
    expect(resolveE2eSuiteTag('https://github.com/someone-else/next-convex-starter-app.git')).toBe(
      TAG_DOWNSTREAM
    );
    expect(resolveE2eSuiteTag('https://evilgithub.com/conradkoh/next-convex-starter-app.git')).toBe(
      TAG_DOWNSTREAM
    );
    expect(resolveE2eSuiteTag('https://github.com/conradkoh/next-convex-starter-app/extra')).toBe(
      TAG_DOWNSTREAM
    );
    expect(resolveE2eSuiteTag('')).toBe(TAG_DOWNSTREAM);
    expect(resolveE2eSuiteTag(null)).toBe(TAG_DOWNSTREAM);
    expect(resolveE2eSuiteTag(undefined)).toBe(TAG_DOWNSTREAM);
    expect(resolveE2eSuiteTag('not-a-url')).toBe(TAG_DOWNSTREAM);
  });
});

describe('runCli', () => {
  it('logs and returns 0 for template URL', () => {
    expect(runCli('origin', TEMPLATE_REPO_URL)).toBe(0);
  });

  it('logs and returns 0 for fork URL', () => {
    expect(runCli('origin', 'https://github.com/someone-else/next-convex-starter-app.git')).toBe(0);
  });
});

describe('CLI entrypoint', () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));

  it('prints tag line for template URL', () => {
    const proc = Bun.spawnSync(
      ['bun', 'scripts/resolve-e2e-suite.ts', 'origin', TEMPLATE_REPO_URL],
      { cwd: repoRoot }
    );
    expect(proc.exitCode).toBe(0);
    const lines = proc.stdout.toString().trim().split('\n');
    expect(lines.at(-1)).toBe(TAG_UPSTREAM);
  });

  it('prints @downstream for fork URL', () => {
    const proc = Bun.spawnSync(
      [
        'bun',
        'scripts/resolve-e2e-suite.ts',
        'origin',
        'https://github.com/someone-else/next-convex-starter-app.git',
      ],
      { cwd: repoRoot }
    );
    expect(proc.exitCode).toBe(0);
    const lines = proc.stdout.toString().trim().split('\n');
    expect(lines.at(-1)).toBe(TAG_DOWNSTREAM);
  });
});
