import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildPathIndex,
  clearWorkspaceSyncStateForTests,
  createManifestFromTree,
  loadWorkspaceSyncManifest,
  saveWorkspaceSyncManifest,
  workspaceKeyFor,
  type WorkspaceSyncManifest,
} from './workspace-sync-state.js';

const { mockHome } = vi.hoisted(() => {
  const { tmpdir } = require('node:os');

  const { join } = require('node:path');
  return { mockHome: join(tmpdir(), 'chatroom-sync-state-test') };
});

vi.mock('node:os', () => ({
  homedir: () => mockHome,
}));

const SYNC_ROOT = join(mockHome, '.chatroom', 'sync-state');

describe('workspaceKeyFor', () => {
  it('returns stable 16-char hex for normalized working dir', () => {
    const expected = createHash('sha256').update('/workspace').digest('hex').slice(0, 16);
    expect(workspaceKeyFor('/workspace')).toBe(expected);
    expect(workspaceKeyFor('/workspace/')).toBe(expected);
  });
});

describe('buildPathIndex', () => {
  it('maps entry paths to file or directory types', () => {
    expect(
      buildPathIndex([
        { path: 'src', type: 'directory' },
        { path: 'src/index.ts', type: 'file', size: 10 },
      ])
    ).toEqual({
      src: 'directory',
      'src/index.ts': 'file',
    });
  });
});

describe('workspace sync manifest persistence', () => {
  beforeEach(async () => {
    await fs.rm(SYNC_ROOT, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(SYNC_ROOT, { recursive: true, force: true });
  });

  it('save/load round-trip preserves manifest fields', async () => {
    const manifest = createManifestFromTree({
      machineId: 'machine-1',
      workingDir: '/workspace',
      scanner: 'git',
      dataHash: 'abc123',
      tree: {
        entries: [
          { path: 'src', type: 'directory' },
          { path: 'src/index.ts', type: 'file' },
        ],
        scannedAt: 1_700_000_000_000,
        rootDir: '/workspace',
      },
    });

    await saveWorkspaceSyncManifest(manifest);
    const loaded = await loadWorkspaceSyncManifest('machine-1', '/workspace');

    expect(loaded).toEqual(manifest);
    expect(loaded?.version).toBe('1');
    expect(loaded?.paths).toEqual({
      src: 'directory',
      'src/index.ts': 'file',
    });
  });

  it('returns null when manifest is missing', async () => {
    const loaded = await loadWorkspaceSyncManifest('machine-missing', '/no-manifest');
    expect(loaded).toBeNull();
  });

  it('returns null when manifest is corrupted', async () => {
    const key = workspaceKeyFor('/workspace');
    const manifestDir = join(SYNC_ROOT, 'machine-bad', key);
    await fs.mkdir(manifestDir, { recursive: true });
    await fs.writeFile(join(manifestDir, 'manifest.json'), '{not json');

    const loaded = await loadWorkspaceSyncManifest('machine-bad', '/workspace');
    expect(loaded).toBeNull();
  });

  it('writes atomically via tmp then rename', async () => {
    const manifest: WorkspaceSyncManifest = {
      version: '1',
      machineId: 'machine-atomic',
      workingDir: '/workspace',
      syncGeneration: 'gen-1',
      completedAt: 1,
      scanner: 'filesystem',
      dataHash: 'hash',
      totalEntryCount: 0,
      paths: {},
    };

    await saveWorkspaceSyncManifest(manifest);

    const key = workspaceKeyFor('/workspace');
    const manifestPath = join(SYNC_ROOT, 'machine-atomic', key, 'manifest.json');
    const content = await fs.readFile(manifestPath, 'utf-8');
    expect(JSON.parse(content)).toEqual(manifest);
    await expect(fs.access(`${manifestPath}.tmp`)).rejects.toThrow();
  });

  it('clearWorkspaceSyncStateForTests removes manifest', async () => {
    const manifest = createManifestFromTree({
      machineId: 'machine-clear',
      workingDir: '/workspace',
      scanner: 'git',
      dataHash: 'hash',
      tree: { entries: [], scannedAt: 1, rootDir: '/workspace' },
    });
    await saveWorkspaceSyncManifest(manifest);
    await clearWorkspaceSyncStateForTests('machine-clear', '/workspace');
    expect(await loadWorkspaceSyncManifest('machine-clear', '/workspace')).toBeNull();
  });
});
