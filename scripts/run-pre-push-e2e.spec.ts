import { describe, expect, it } from 'bun:test';

import { playwrightArgs, runPrePushE2eWithSpawn } from './run-pre-push-e2e';
import { TEMPLATE_REPO_URL } from './template-repo';
import { TAG_DOWNSTREAM, TAG_UPSTREAM } from '../apps/webapp/tests/e2e/support/tags';

describe('playwrightArgs', () => {
  it('builds exact argv for upstream', () => {
    expect(playwrightArgs(TAG_UPSTREAM)).toEqual([
      'pnpm',
      'exec',
      'playwright',
      'test',
      '--config=tests/e2e/playwright.config.ts',
      '--grep',
      TAG_UPSTREAM,
      '--pass-with-no-tests',
    ]);
  });

  it('builds exact argv for downstream', () => {
    expect(playwrightArgs(TAG_DOWNSTREAM)).toEqual([
      'pnpm',
      'exec',
      'playwright',
      'test',
      '--config=tests/e2e/playwright.config.ts',
      '--grep',
      TAG_DOWNSTREAM,
      '--pass-with-no-tests',
    ]);
  });
});

describe('runPrePushE2eWithSpawn (exit propagation)', () => {
  it('propagates exit 0 unchanged', () => {
    const spawnSync = () => ({
      exitCode: 0,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      success: true,
    });
    expect(
      runPrePushE2eWithSpawn('origin', TEMPLATE_REPO_URL, spawnSync as typeof Bun.spawnSync)
    ).toBe(0);
  });

  it('propagates exit 1 unchanged (test failure or no tests found)', () => {
    const spawnSync = () => ({
      exitCode: 1,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      success: false,
    });
    expect(
      runPrePushE2eWithSpawn(
        'origin',
        'https://github.com/someone-else/next-convex-starter-app.git',
        spawnSync as typeof Bun.spawnSync
      )
    ).toBe(1);
  });

  it('propagates exit 2 unchanged (config/browser errors)', () => {
    const spawnSync = () => ({
      exitCode: 2,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      success: false,
    });
    expect(
      runPrePushE2eWithSpawn('origin', TEMPLATE_REPO_URL, spawnSync as typeof Bun.spawnSync)
    ).toBe(2);
  });

  it('uses TAG_UPSTREAM in argv for template URL', () => {
    let capturedArgv: string[] = [];
    const spawnSync = (argv: string[]) => {
      capturedArgv = [...argv];
      return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), success: true };
    };
    runPrePushE2eWithSpawn('origin', TEMPLATE_REPO_URL, spawnSync as typeof Bun.spawnSync);
    expect(capturedArgv).toEqual(playwrightArgs(TAG_UPSTREAM));
  });

  it('uses TAG_DOWNSTREAM in argv for fork URL', () => {
    let capturedArgv: string[] = [];
    const spawnSync = (argv: string[]) => {
      capturedArgv = [...argv];
      return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), success: true };
    };
    runPrePushE2eWithSpawn(
      'origin',
      'https://github.com/someone-else/next-convex-starter-app.git',
      spawnSync as typeof Bun.spawnSync
    );
    expect(capturedArgv).toEqual(playwrightArgs(TAG_DOWNSTREAM));
  });
});

describe('pre-push hook contract', () => {
  it('always invokes runner unconditionally; no skip branch', async () => {
    const hook = await Bun.file(new URL('../.husky/pre-push', import.meta.url)).text();
    expect(hook).toContain('bun scripts/run-pre-push-e2e.ts "$1" "$2"');
    expect(hook).not.toContain('should-run-e2e');
    expect(hook).not.toContain('Skipping e2e');
    expect(hook).not.toMatch(/if bun scripts\/run-pre-push-e2e\.ts.*then/s);
    // test/test:scripts/typecheck stay unconditional
    expect(hook).toContain('pnpm run test');
    expect(hook).toContain('bun run test:scripts');
    expect(hook).toContain('pnpm run typecheck');
  });
});
