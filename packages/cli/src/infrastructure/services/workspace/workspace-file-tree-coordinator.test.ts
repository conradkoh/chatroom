import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildPendingDeltas,
  startWorkspaceFileTreeCoordinator,
} from './workspace-file-tree-coordinator.js';
import { clearWorkspaceSyncStateForTests } from './workspace-sync-state.js';

async function waitFor(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for filesystem event');
    await new Promise((resolve) => setTimeout(resolve, 25));
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
});
