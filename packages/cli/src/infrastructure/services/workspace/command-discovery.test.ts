/**
 * Command Discovery — Tests
 *
 * Tests monorepo command generation across all package managers.
 */

import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test, beforeEach, afterEach } from 'vitest';

import { discoverCommands } from './command-discovery.js';

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
    await writeFile(join(testDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");

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
      source: 'package.json',
      subWorkspace: { type: 'npm', path: '.', name: 'root' },
    });

    // Root turbo tasks
    expect(commands).toContainEqual({
      name: 'turbo: build',
      script: 'pnpm turbo run build',
      source: 'turbo.json',
      subWorkspace: { type: 'npm', path: '.', name: 'root' },
    });

    // Filtered turbo tasks
    expect(commands).toContainEqual({
      name: 'turbo: build (my-cli)',
      script: 'pnpm turbo run build --filter=my-cli',
      source: 'turbo.json',
      subWorkspace: { type: 'npm', path: 'packages/cli', name: 'my-cli' },
    });

    // Per-package script commands
    expect(commands).toContainEqual({
      name: 'my-cli: build',
      script: 'pnpm --filter my-cli run build',
      source: 'package.json',
      subWorkspace: { type: 'npm', path: 'packages/cli', name: 'my-cli' },
    });
    expect(commands).toContainEqual({
      name: 'my-cli: test',
      script: 'pnpm --filter my-cli run test',
      source: 'package.json',
      subWorkspace: { type: 'npm', path: 'packages/cli', name: 'my-cli' },
    });
  });

  test('discovers commands in yarn monorepo', async () => {
    await writeFile(join(testDir, 'yarn.lock'), '');
    await createPackageJson(testDir, {
      name: 'root',
      workspaces: ['apps/*'],
      scripts: { lint: 'eslint .' },
    });
    await writeFile(join(testDir, 'turbo.json'), JSON.stringify({ tasks: { build: {} } }));
    await createPackageJson(join(testDir, 'apps/web'), {
      name: '@my/web',
      scripts: { dev: 'next dev' },
    });

    const commands = await discoverCommands(testDir);

    // Root
    expect(commands).toContainEqual({
      name: 'yarn: lint',
      script: 'yarn run lint',
      source: 'package.json',
      subWorkspace: { type: 'npm', path: '.', name: 'root' },
    });

    // Turbo filtered
    expect(commands).toContainEqual({
      name: 'turbo: build (@my/web)',
      script: 'yarn turbo run build --filter=@my/web',
      source: 'turbo.json',
      subWorkspace: { type: 'npm', path: 'apps/web', name: '@my/web' },
    });

    // Per-package
    expect(commands).toContainEqual({
      name: '@my/web: dev',
      script: 'yarn workspace @my/web run dev',
      source: 'package.json',
      subWorkspace: { type: 'npm', path: 'apps/web', name: '@my/web' },
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
      source: 'package.json',
      subWorkspace: { type: 'npm', path: '.', name: 'single-app' },
    });

    // No workspace-specific commands
    const filtered = commands.filter((c) => c.name.includes('('));
    expect(filtered).toHaveLength(0);
  });

  test('discovers deno.json tasks', async () => {
    await writeFile(
      join(testDir, 'deno.json'),
      JSON.stringify({
        name: 'my-deno-app',
        tasks: { dev: 'deno run --watch main.ts', test: 'deno test' },
      })
    );

    const commands = await discoverCommands(testDir);

    expect(commands).toContainEqual({
      name: 'deno: dev',
      script: 'deno task dev',
      source: 'deno.json',
      subWorkspace: { type: 'deno', path: '.', name: 'my-deno-app' },
    });
    expect(commands).toContainEqual({
      name: 'deno: test',
      script: 'deno task test',
      source: 'deno.json',
      subWorkspace: { type: 'deno', path: '.', name: 'my-deno-app' },
    });
  });

  test('discovers turbo tasks when turbo.json is JSONC (comments + trailing commas)', async () => {
    // Regression: a // comment in turbo.json used to make JSON.parse throw,
    // silently hiding every turbo task from the process manager.
    await writeFile(join(testDir, 'pnpm-lock.yaml'), '');
    await createPackageJson(testDir, { name: 'root', scripts: { dev: 'turbo run dev' } });

    const jsoncTurbo = `{
  // The schema URL contains // inside a string and must be preserved.
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {},
    /* block comment */
    "typecheck": {},
    "test": {}, // trailing comma below
  }
}`;
    await writeFile(join(testDir, 'turbo.json'), jsoncTurbo);

    const commands = await discoverCommands(testDir);

    expect(commands).toContainEqual({
      name: 'turbo: build',
      script: 'pnpm turbo run build',
      source: 'turbo.json',
      subWorkspace: { type: 'npm', path: '.', name: 'root' },
    });
    expect(commands).toContainEqual({
      name: 'turbo: typecheck',
      script: 'pnpm turbo run typecheck',
      source: 'turbo.json',
      subWorkspace: { type: 'npm', path: '.', name: 'root' },
    });
    expect(commands.filter((c) => c.source === 'turbo.json')).toHaveLength(3);
  });
});
