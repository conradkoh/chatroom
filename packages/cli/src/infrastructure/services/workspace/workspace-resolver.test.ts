/**
 * Workspace Resolver — Tests
 */

import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test, beforeEach, afterEach } from 'vitest';

import { resolveSubWorkspaces } from './workspace-resolver.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'workspace-resolver-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function createPackageJson(dir: string, pkg: Record<string, unknown>) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
}

// ─── pnpm Workspaces ────────────────────────────────────────────────────────

describe('pnpm workspaces', () => {
  test('resolves packages from pnpm-workspace.yaml with glob patterns', async () => {
    // Root
    await createPackageJson(testDir, { name: 'root' });
    await writeFile(
      join(testDir, 'pnpm-workspace.yaml'),
      "packages:\n  - 'apps/*'\n  - 'packages/*'\n"
    );

    // Sub-packages
    await createPackageJson(join(testDir, 'apps/webapp'), {
      name: '@workspace/webapp',
      scripts: { dev: 'next dev', build: 'next build' },
    });
    await createPackageJson(join(testDir, 'packages/cli'), {
      name: 'my-cli',
      scripts: { build: 'tsc', test: 'vitest' },
    });

    const packages = await resolveSubWorkspaces(testDir, 'pnpm');

    expect(packages).toHaveLength(2);

    const webapp = packages.find((p) => p.name === '@workspace/webapp');
    expect(webapp).toBeDefined();
    expect(webapp!.scripts).toEqual({ dev: 'next dev', build: 'next build' });

    const cli = packages.find((p) => p.name === 'my-cli');
    expect(cli).toBeDefined();
    expect(cli!.scripts).toEqual({ build: 'tsc', test: 'vitest' });
  });

  test('returns empty if no pnpm-workspace.yaml exists', async () => {
    await createPackageJson(testDir, { name: 'root' });
    const packages = await resolveSubWorkspaces(testDir, 'pnpm');
    expect(packages).toHaveLength(0);
  });

  test('falls back to package.json workspaces for pnpm', async () => {
    await createPackageJson(testDir, {
      name: 'root',
      workspaces: ['libs/*'],
    });
    await createPackageJson(join(testDir, 'libs/utils'), {
      name: 'utils',
      scripts: { test: 'jest' },
    });

    const packages = await resolveSubWorkspaces(testDir, 'pnpm');
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe('utils');
  });
});

// ─── yarn/npm/bun Workspaces ────────────────────────────────────────────────

describe('yarn/npm/bun workspaces', () => {
  test('resolves from package.json workspaces array', async () => {
    await createPackageJson(testDir, {
      name: 'root',
      workspaces: ['packages/*'],
    });
    await createPackageJson(join(testDir, 'packages/core'), {
      name: '@my/core',
      scripts: { build: 'rollup' },
    });

    for (const pm of ['yarn', 'npm', 'bun'] as const) {
      const packages = await resolveSubWorkspaces(testDir, pm);
      expect(packages).toHaveLength(1);
      expect(packages[0].name).toBe('@my/core');
    }
  });

  test('resolves from package.json workspaces.packages object format', async () => {
    await createPackageJson(testDir, {
      name: 'root',
      workspaces: { packages: ['modules/*'] },
    });
    await createPackageJson(join(testDir, 'modules/auth'), {
      name: 'auth-module',
      scripts: { dev: 'tsx watch' },
    });

    const packages = await resolveSubWorkspaces(testDir, 'yarn');
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe('auth-module');
  });

  test('returns empty if no workspaces field', async () => {
    await createPackageJson(testDir, { name: 'root' });
    const packages = await resolveSubWorkspaces(testDir, 'npm');
    expect(packages).toHaveLength(0);
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe('edge cases', () => {
  test('handles literal paths (not globs)', async () => {
    await createPackageJson(testDir, {
      name: 'root',
      workspaces: ['tools/my-tool'],
    });
    await createPackageJson(join(testDir, 'tools/my-tool'), {
      name: 'my-tool',
      scripts: { start: 'node index.js' },
    });

    const packages = await resolveSubWorkspaces(testDir, 'npm');
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe('my-tool');
  });

  test('uses directory name if package.json has no name field', async () => {
    await createPackageJson(testDir, {
      name: 'root',
      workspaces: ['packages/*'],
    });
    await createPackageJson(join(testDir, 'packages/unnamed'), {
      scripts: { build: 'tsc' },
    });

    const packages = await resolveSubWorkspaces(testDir, 'npm');
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe('unnamed');
  });

  test('skips directories without package.json', async () => {
    await createPackageJson(testDir, {
      name: 'root',
      workspaces: ['packages/*'],
    });
    await mkdir(join(testDir, 'packages/no-pkg'), { recursive: true });
    await createPackageJson(join(testDir, 'packages/has-pkg'), {
      name: 'has-pkg',
    });

    const packages = await resolveSubWorkspaces(testDir, 'npm');
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe('has-pkg');
  });

  test('deduplicates directories from overlapping patterns', async () => {
    await createPackageJson(testDir, {
      name: 'root',
      workspaces: ['packages/*', 'packages/core'],
    });
    await createPackageJson(join(testDir, 'packages/core'), {
      name: 'core',
    });

    const packages = await resolveSubWorkspaces(testDir, 'npm');
    expect(packages).toHaveLength(1);
  });
});
