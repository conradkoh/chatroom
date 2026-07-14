import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverGitWorkspaceHierarchy } from './git-workspace-hierarchy.js';
import { createWorkspaceChangeSource } from './workspace-change-source.js';
import { runGit } from '../../git/run-command.js';

const mocks = vi.hoisted(() => ({ close: vi.fn(async () => undefined) }));
let emitter: EventEmitter;

vi.mock('chokidar', () => ({
  watch: vi.fn(() => {
    emitter = new EventEmitter();
    Object.assign(emitter, { close: mocks.close });
    return emitter;
  }),
}));

describe('git-workspace-hierarchy', () => {
  it('discoverGitWorkspaceHierarchy resolves to null for non-existent path', async () => {
    await expect(discoverGitWorkspaceHierarchy('/any/path')).resolves.toBeNull();
  });
});

describe('workspace-change-source', () => {
  beforeEach(() => {
    mocks.close.mockClear();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it('returns mode fs and a source with ready and stop', async () => {
    const result = await createWorkspaceChangeSource({
      workingDir: '/workspace',
      onEvents: vi.fn(),
    });

    expect(result.mode).toBe('fs');
    expect(result.source).toHaveProperty('ready');
    expect(result.source).toHaveProperty('stop');
    expect(typeof result.source.stop).toBe('function');

    emitter.emit('ready');

    await expect(result.source.ready).resolves.toBeUndefined();
    // ready resolves but we also need to advance timers for ready microtasks
    await vi.waitFor(() => {});

    await result.source.stop();
    expect(mocks.close).toHaveBeenCalled();
  });

  it('stop resolves without throw', async () => {
    const result = await createWorkspaceChangeSource({
      workingDir: '/workspace',
      onEvents: vi.fn(),
    });

    emitter.emit('ready');
    // wait for ready to resolve
    await vi.waitFor(() => {});

    await expect(result.source.stop()).resolves.toBeUndefined();
  });

  it('returns mode git for a real git repo', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'ws-change-source-test-'));
    try {
      const git = (...args: string[]) => runGit(args, tmpDir);
      await git('init');
      await git('config', 'user.email', 'test@test.com');
      await git('config', 'user.name', 'Test');
      await writeFile(path.join(tmpDir, 'README.md'), 'hello');
      await git('add', '-A');
      await git('commit', '-m', 'init');

      const result = await createWorkspaceChangeSource({
        workingDir: tmpDir,
        onEvents: vi.fn(),
      });

      expect(result.mode).toBe('git');
      expect(result.source).toHaveProperty('ready');
      expect(result.source).toHaveProperty('stop');

      await result.source.ready;
      await result.source.stop();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 10_000);
});
