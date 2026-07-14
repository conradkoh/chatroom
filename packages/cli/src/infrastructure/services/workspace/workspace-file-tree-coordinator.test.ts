import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildPendingDeltas,
  startWorkspaceFileTreeCoordinator,
} from './workspace-file-tree-coordinator.js';
import { clearWorkspaceSyncStateForTests } from './workspace-sync-state.js';
import { runGit } from '../../git/run-command.js';

async function waitFor(predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for filesystem event');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function initGitRepo(dir: string, files: Record<string, string> = {}): Promise<void> {
  const git = (...args: string[]) => runGit(args, dir);
  await git('init');
  await git('config', 'user.email', 'test@test.com');
  await git('config', 'user.name', 'Test');
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(dirname(full), { recursive: true }).catch(() => {});
    await writeFile(full, content);
  }
  if (Object.keys(files).length > 0) {
    await git('add', '-A');
    await git('commit', '-m', 'init');
  }
}

describe('workspace-file-tree-coordinator', () => {
  let rootDir = '';
  const machineId = `coordinator-test-${process.pid}`;

  afterEach(async () => {
    if (rootDir) {
      await clearWorkspaceSyncStateForTests(machineId, rootDir);
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('splits large reconciliation diffs into bounded delta batches', () => {
    const next = Object.fromEntries(
      Array.from({ length: 205 }, (_, index) => [`file-${index}.ts`, 'file' as const])
    );

    const deltas = buildPendingDeltas({}, next);

    expect(deltas).toHaveLength(3);
    expect(deltas.map((delta) => delta.added.length)).toEqual([100, 100, 5]);
  });

  it('checkpoints once, then sends only filesystem deltas', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'file-tree-coordinator-'));
    await writeFile(join(rootDir, 'existing.ts'), 'export {}');
    const checkpoints = vi.fn(async () => ({ revision: 1 }));
    const deltas = vi.fn(async () => ({ status: 'applied' as const, revision: 2 }));

    const coordinator = await startWorkspaceFileTreeCoordinator({
      machineId,
      workingDir: rootDir,
      onCheckpoint: checkpoints,
      onDelta: deltas,
    });

    expect(checkpoints).toHaveBeenCalledTimes(1);
    expect(coordinator.getTree().entries).toContainEqual({ path: 'existing.ts', type: 'file' });

    await writeFile(join(rootDir, 'added.ts'), 'export const added = true');
    await waitFor(() => deltas.mock.calls.length > 0);

    expect(deltas).toHaveBeenCalledWith(
      expect.objectContaining({
        added: expect.arrayContaining([{ path: 'added.ts', type: 'file' }]),
        removed: [],
      }),
      1
    );
    await coordinator.stop();
  });

  it('uses a warm persisted cache without another checkpoint or walk-triggering request', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'file-tree-coordinator-warm-'));
    await writeFile(join(rootDir, 'cached.ts'), 'cached');

    const first = await startWorkspaceFileTreeCoordinator({
      machineId,
      workingDir: rootDir,
      onCheckpoint: async () => ({ revision: 1 }),
      onDelta: async () => ({ status: 'applied', revision: 2 }),
    });
    await first.stop();

    const checkpoint = vi.fn(async () => ({ revision: 1 }));
    const second = await startWorkspaceFileTreeCoordinator({
      machineId,
      workingDir: rootDir,
      onCheckpoint: checkpoint,
      onDelta: async () => ({ status: 'applied', revision: 2 }),
    });

    expect(checkpoint).not.toHaveBeenCalled();
    expect(second.getTree().entries).toContainEqual({ path: 'cached.ts', type: 'file' });
    await second.stop();
  });

  it('does not emit paths ignored by nested .gitignore files', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'file-tree-coordinator-ignore-'));
    await mkdir(join(rootDir, 'packages'), { recursive: true });
    await writeFile(join(rootDir, 'packages', '.gitignore'), '*.tmp\n');
    const deltas = vi.fn(async () => ({ status: 'applied' as const, revision: 2 }));

    const coordinator = await startWorkspaceFileTreeCoordinator({
      machineId,
      workingDir: rootDir,
      onCheckpoint: async () => ({ revision: 1 }),
      onDelta: deltas,
    });
    await writeFile(join(rootDir, 'packages', 'ignored.tmp'), 'ignored');
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(deltas).not.toHaveBeenCalled();
    await coordinator.stop();
  });

  it('stops the watcher and schedules reconcile when EMFILE occurs', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'file-tree-coordinator-emfile-'));
    await writeFile(join(rootDir, 'seed.ts'), 'seed');

    let capturedOnError: ((error: unknown) => void) | undefined;
    const watcherStop = vi.fn(async () => undefined);
    const watcherModule = await import('./workspace-fs-watcher.js');
    const createWatcherSpy = vi
      .spyOn(watcherModule, 'createWorkspaceFsWatcher')
      .mockImplementation((options) => {
        capturedOnError = options.onError;
        return {
          ready: Promise.resolve(),
          stop: watcherStop,
        };
      });

    const onError = vi.fn();
    const coordinator = await startWorkspaceFileTreeCoordinator({
      machineId,
      workingDir: rootDir,
      reconcileIntervalMs: 60_000,
      onCheckpoint: async () => ({ revision: 1 }),
      onDelta: async () => ({ status: 'applied', revision: 2 }),
      onError,
    });

    capturedOnError?.(new Error('EMFILE: too many open files, watch'));
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalled();
    expect(watcherStop).toHaveBeenCalled();
    await coordinator.stop();
    createWatcherSpy.mockRestore();
  });

  it('sends deltas for new files in a git workspace via porcelain polling', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'file-tree-coordinator-git-'));
    await initGitRepo(rootDir, { 'README.md': 'hello' });
    const deltas = vi.fn(async () => ({ status: 'applied' as const, revision: 2 }));
    const coordinator = await startWorkspaceFileTreeCoordinator({
      machineId,
      workingDir: rootDir,
      changeSourcePollIntervalMs: 100,
      onCheckpoint: async () => ({ revision: 1 }),
      onDelta: deltas,
    });
    await writeFile(join(rootDir, 'added.ts'), 'export {}');
    await waitFor(() => deltas.mock.calls.length > 0, 5_000);
    expect(deltas).toHaveBeenCalledWith(
      expect.objectContaining({
        added: expect.arrayContaining([{ path: 'added.ts', type: 'file' }]),
      }),
      1
    );
    await coordinator.stop();
  }, 15_000);

  it('removes untracked file from tree when deleted via git clean in git mode', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'file-tree-coordinator-git-clean-'));
    await initGitRepo(rootDir, { 'tracked.ts': 'x' });
    const deltas = vi.fn(async () => ({ status: 'applied' as const, revision: 2 }));
    const coordinator = await startWorkspaceFileTreeCoordinator({
      machineId,
      workingDir: rootDir,
      changeSourcePollIntervalMs: 200,
      onCheckpoint: async () => ({ revision: 1 }),
      onDelta: deltas,
    });
    await writeFile(join(rootDir, 'dirty.txt'), 'temp');
    await waitFor(() => coordinator.getTree().entries.some((e) => e.path === 'dirty.txt'), 5_000);
    const git = (...args: string[]) => runGit(args, rootDir);
    await git('clean', '-f', 'dirty.txt');
    await waitFor(
      () => coordinator.getTree().entries.find((e) => e.path === 'dirty.txt') === undefined,
      5_000
    );
    expect(deltas).toHaveBeenCalledWith(
      expect.objectContaining({
        removed: expect.arrayContaining(['dirty.txt']),
      }),
      expect.any(Number)
    );
    await coordinator.stop();
  }, 15_000);

  it('degrades to fs watcher after persistent git poll failures', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'file-tree-coordinator-degrade-'));
    await initGitRepo(rootDir, { 'seed.ts': 'seed' });

    const runGitModule = await import('../../git/run-command.js');
    const runGitSpy = vi.spyOn(runGitModule, 'runGit').mockResolvedValue({
      error: Object.assign(new Error('git unavailable'), { code: 1 }),
    } as never);

    const fsWatcherModule = await import('./workspace-fs-watcher.js');
    const createFsSpy = vi.spyOn(fsWatcherModule, 'createWorkspaceFsWatcher');

    const coordinator = await startWorkspaceFileTreeCoordinator({
      machineId,
      workingDir: rootDir,
      changeSourcePollIntervalMs: 100,
      onCheckpoint: async () => ({ revision: 1 }),
      onDelta: async () => ({ status: 'applied' as const, revision: 2 }),
    });

    await waitFor(() => createFsSpy.mock.calls.length >= 1, 6_000);

    runGitSpy.mockRestore();
    createFsSpy.mockRestore();

    await coordinator.stop();
  }, 15_000);

  it('removes untracked file from tree when deleted via rm in git mode', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'file-tree-coordinator-git-rm-'));
    await initGitRepo(rootDir, { 'README.md': 'hello' });
    const deltas = vi.fn(async () => ({ status: 'applied' as const, revision: 2 }));
    const coordinator = await startWorkspaceFileTreeCoordinator({
      machineId,
      workingDir: rootDir,
      changeSourcePollIntervalMs: 100,
      onCheckpoint: async () => ({ revision: 1 }),
      onDelta: deltas,
    });
    await writeFile(join(rootDir, 'temp.md'), 'temp');
    await waitFor(() => coordinator.getTree().entries.some((e) => e.path === 'temp.md'), 5_000);
    await unlink(join(rootDir, 'temp.md'));
    await waitFor(
      () => coordinator.getTree().entries.find((e) => e.path === 'temp.md') === undefined,
      5_000
    );
    expect(deltas).toHaveBeenCalledWith(
      expect.objectContaining({
        removed: expect.arrayContaining(['temp.md']),
      }),
      expect.any(Number)
    );
    await coordinator.stop();
  }, 15_000);

  it('syncs pre-existing untracked files on warm restart in git mode', async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'file-tree-coordinator-git-warm-'));
    await initGitRepo(rootDir, { 'README.md': 'hello' });

    const first = await startWorkspaceFileTreeCoordinator({
      machineId,
      workingDir: rootDir,
      changeSourcePollIntervalMs: 100,
      onCheckpoint: async () => ({ revision: 1 }),
      onDelta: async () => ({ status: 'applied', revision: 2 }),
    });
    await first.stop();

    await writeFile(join(rootDir, 'orphan.ts'), 'orphan');

    const deltas = vi.fn(async () => ({ status: 'applied' as const, revision: 3 }));
    const second = await startWorkspaceFileTreeCoordinator({
      machineId,
      workingDir: rootDir,
      changeSourcePollIntervalMs: 100,
      onCheckpoint: async () => ({ revision: 1 }),
      onDelta: deltas,
    });

    await waitFor(() => deltas.mock.calls.length > 0, 5_000);
    expect(deltas).toHaveBeenCalledWith(
      expect.objectContaining({
        added: expect.arrayContaining([{ path: 'orphan.ts', type: 'file' }]),
      }),
      expect.any(Number)
    );
    expect(second.getTree().entries).toContainEqual({ path: 'orphan.ts', type: 'file' });
    await second.stop();
  }, 15_000);
});
