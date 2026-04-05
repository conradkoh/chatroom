/**
 * Command Discovery — Tests
 *
 * Tests monorepo command generation across all package managers.
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  discoverCommands,
  detectPackageManager,
  getFilteredScriptCommand,
  getFilteredTurboCommand,
  getTurboRunPrefix,
  getScriptRunPrefix,
} from './command-discovery.js';

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'command-discovery-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function createPackageJson(dir: string, pkg: Record<string, unknown>) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
}

// ─── Package Manager Detection ──────────────────────────────────────────────

describe('detectPackageManager', () => {
  test('detects pnpm from pnpm-lock.yaml', async () => {
    await createPackageJson(testDir, { name: 'root' });
    await writeFile(join(testDir, 'pnpm-lock.yaml'), '');
    expect(await detectPackageManager(testDir)).toBe('pnpm');
  });

  test('detects yarn from yarn.lock', async () => {
    await createPackageJson(testDir, { name: 'root' });
    await writeFile(join(testDir, 'yarn.lock'), '');
    expect(await detectPackageManager(testDir)).toBe('yarn');
  });

  test('detects bun from bun.lockb', async () => {
    await createPackageJson(testDir, { name: 'root' });
    await writeFile(join(testDir, 'bun.lockb'), '');
    expect(await detectPackageManager(testDir)).toBe('bun');
  });

  test('detects npm from package-lock.json', async () => {
    await createPackageJson(testDir, { name: 'root' });
    await writeFile(join(testDir, 'package-lock.json'), '{}');
    expect(await detectPackageManager(testDir)).toBe('npm');
  });

  test('defaults to npm when no lockfile found', async () => {
    await createPackageJson(testDir, { name: 'root' });
    expect(await detectPackageManager(testDir)).toBe('npm');
  });

  test('pnpm has priority over yarn', async () => {
    await createPackageJson(testDir, { name: 'root' });
    await writeFile(join(testDir, 'pnpm-lock.yaml'), '');
    await writeFile(join(testDir, 'yarn.lock'), '');
    expect(await detectPackageManager(testDir)).toBe('pnpm');
  });
});

// ─── Command Prefix Helpers ─────────────────────────────────────────────────

describe('command prefixes', () => {
  test('getScriptRunPrefix returns correct prefixes', () => {
    expect(getScriptRunPrefix('pnpm')).toBe('pnpm run');
    expect(getScriptRunPrefix('yarn')).toBe('yarn run');
    expect(getScriptRunPrefix('bun')).toBe('bun run');
    expect(getScriptRunPrefix('npm')).toBe('npm run');
  });

  test('getTurboRunPrefix returns correct prefixes', () => {
    expect(getTurboRunPrefix('pnpm')).toBe('pnpm turbo run');
    expect(getTurboRunPrefix('yarn')).toBe('yarn turbo run');
    expect(getTurboRunPrefix('bun')).toBe('bun turbo run');
    expect(getTurboRunPrefix('npm')).toBe('npx turbo run');
  });

  test('getFilteredScriptCommand for all PMs', () => {
    expect(getFilteredScriptCommand('pnpm', 'my-pkg', 'build')).toBe('pnpm --filter my-pkg run build');
    expect(getFilteredScriptCommand('yarn', 'my-pkg', 'build')).toBe('yarn workspace my-pkg run build');
    expect(getFilteredScriptCommand('bun', 'my-pkg', 'build')).toBe('bun --filter my-pkg run build');
    expect(getFilteredScriptCommand('npm', 'my-pkg', 'build')).toBe('npm --workspace=my-pkg run build');
  });

  test('getFilteredTurboCommand for all PMs', () => {
    expect(getFilteredTurboCommand('pnpm', 'my-pkg', 'build')).toBe('pnpm turbo run build --filter=my-pkg');
    expect(getFilteredTurboCommand('yarn', 'my-pkg', 'build')).toBe('yarn turbo run build --filter=my-pkg');
    expect(getFilteredTurboCommand('bun', 'my-pkg', 'build')).toBe('bun turbo run build --filter=my-pkg');
    expect(getFilteredTurboCommand('npm', 'my-pkg', 'build')).toBe('npx turbo run build --filter=my-pkg');
  });
});

// ─── Full Discovery (monorepo) ──────────────────────────────────────────────

describe('discoverCommands — monorepo', () => {
  test('discovers root + turbo + per-package commands in pnpm monorepo', async () => {
    // Create lockfile
    await writeFile(join(testDir, 'pnpm-lock.yaml'), '');

    // Root package.json
    await createPackageJson(testDir, {
      name: 'root',
      scripts: { test: 'turbo run test', dev: 'turbo run dev' },
    });

    // Turbo config
    await writeFile(
      join(testDir, 'turbo.json'),
      JSON.stringify({ tasks: { build: {}, typecheck: {} } })
    );

    // pnpm-workspace.yaml
    await writeFile(
      join(testDir, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/*'\n"
    );

    // Sub-package
    await createPackageJson(join(testDir, 'packages/cli'), {
      name: 'my-cli',
      scripts: { build: 'tsc', test: 'vitest' },
    });

    const commands = await discoverCommands(testDir);

    // Root scripts
    expect(commands).toContainEqual({
      name: 'pnpm: test',
      script: 'pnpm run test',
      source: 'package.json', workspace: '.',
    });

    // Root turbo tasks
    expect(commands).toContainEqual({
      name: 'turbo: build',
      script: 'pnpm turbo run build',
      source: 'turbo.json', workspace: '.',
    });

    // Filtered turbo tasks
    expect(commands).toContainEqual({
      name: 'turbo: build (my-cli)',
      script: 'pnpm turbo run build --filter=my-cli',
      source: 'turbo.json', workspace: 'packages/cli',
    });

    // Per-package script commands
    expect(commands).toContainEqual({
      name: 'my-cli: build',
      script: 'pnpm --filter my-cli run build',
      source: 'package.json', workspace: 'packages/cli',
    });
    expect(commands).toContainEqual({
      name: 'my-cli: test',
      script: 'pnpm --filter my-cli run test',
      source: 'package.json', workspace: 'packages/cli',
    });
  });

  test('discovers commands in yarn monorepo', async () => {
    await writeFile(join(testDir, 'yarn.lock'), '');
    await createPackageJson(testDir, {
      name: 'root',
      workspaces: ['apps/*'],
      scripts: { lint: 'eslint .' },
    });
    await writeFile(
      join(testDir, 'turbo.json'),
      JSON.stringify({ tasks: { build: {} } })
    );
    await createPackageJson(join(testDir, 'apps/web'), {
      name: '@my/web',
      scripts: { dev: 'next dev' },
    });

    const commands = await discoverCommands(testDir);

    // Root
    expect(commands).toContainEqual({
      name: 'yarn: lint',
      script: 'yarn run lint',
      source: 'package.json', workspace: '.',
    });

    // Turbo filtered
    expect(commands).toContainEqual({
      name: 'turbo: build (@my/web)',
      script: 'yarn turbo run build --filter=@my/web',
      source: 'turbo.json', workspace: 'apps/web',
    });

    // Per-package
    expect(commands).toContainEqual({
      name: '@my/web: dev',
      script: 'yarn workspace @my/web run dev',
      source: 'package.json', workspace: 'apps/web',
    });
  });

  test('works with no workspace packages (single-package project)', async () => {
    await writeFile(join(testDir, 'package-lock.json'), '{}');
    await createPackageJson(testDir, {
      name: 'single-app',
      scripts: { start: 'node index.js' },
    });

    const commands = await discoverCommands(testDir);

    expect(commands).toContainEqual({
      name: 'npm: start',
      script: 'npm run start',
      source: 'package.json', workspace: '.',
    });

    // No workspace-specific commands
    const filtered = commands.filter((c) => c.name.includes('('));
    expect(filtered).toHaveLength(0);
  });
});
