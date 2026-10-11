import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveOutboxDbPath } from './outbox-db-path.js';
import type { WorkspaceStateUnit } from './workspace-state-outbox-schema.js';
import {
  createWorkspaceStateOutboxRegistry,
  decodeWorkspaceStateKey,
  encodeWorkspaceStateKey,
  type WorkspaceStateKind,
  type WorkspaceStateOutboxRegistry,
  type WorkspaceStateSendResult,
} from './workspace-state-outbox.js';

const INTERVALS: Record<WorkspaceStateKind, number> = {
  head: 0,
  worktree: 3_000,
  upstream: 3_000,
  remotes: 3_000,
  pullRequests: 3_000,
  checks: 3_000,
  recentCommits: 3_000,
  commands: 3_000,
};
const HEAD: WorkspaceStateUnit = { kind: 'head', status: 'not_found' };
const WORKTREE: WorkspaceStateUnit = {
  kind: 'worktree',
  isDirty: true,
  diffStat: { filesChanged: 1, insertions: 2, deletions: 3 },
};

/** Each test gets its own machine id because outbox databases live under the real home directory. */
const machineIds: string[] = [];
function freshMachineId(): string {
  const machineId = `test-workspace-state-${Date.now()}-${Math.random()}`;
  machineIds.push(machineId);
  return machineId;
}

function createRegistry(
  machineId: string,
  send: (unit: WorkspaceStateUnit) => Promise<WorkspaceStateSendResult>,
  logger = { error: vi.fn() }
): WorkspaceStateOutboxRegistry {
  return createWorkspaceStateOutboxRegistry(machineId, () => send, {
    minIntervalMsByKind: INTERVALS,
    retryDelayMs: 10,
    maxRetryDelayMs: 100,
    logger,
  });
}

afterEach(() => {
  vi.useRealTimers();
  for (const machineId of machineIds.splice(0)) {
    rmSync(dirname(resolveOutboxDbPath(machineId, 'workspace-state')), {
      recursive: true,
      force: true,
    });
  }
});

describe('workspace-state outbox key codec', () => {
  it.each([
    ['/workspace', 'head'],
    ['/path with "quotes", commas and ]brackets', 'worktree'],
    ['', 'commands'],
  ] as const)('round-trips %j and %s', (workingDir, kind) => {
    expect(decodeWorkspaceStateKey(encodeWorkspaceStateKey(workingDir, kind))).toEqual({
      workingDir,
      kind,
    });
  });

  it('keeps the same working directory with different kinds on different keys', () => {
    expect(encodeWorkspaceStateKey('/ws', 'head')).not.toBe(
      encodeWorkspaceStateKey('/ws', 'worktree')
    );
  });
});

describe('workspace-state outbox throttling', () => {
  it('resolves the minimum interval per unit kind', async () => {
    vi.useFakeTimers();
    const machineId = freshMachineId();
    const send = vi.fn(async (): Promise<WorkspaceStateSendResult> => ({ applied: true }));
    const registry = createRegistry(machineId, send);

    // head has a 0ms interval, so back-to-back heads are delivered without waiting.
    const head1 = registry.enqueueAndWait(encodeWorkspaceStateKey('/ws', 'head'), HEAD);
    await vi.advanceTimersByTimeAsync(0);
    await expect(head1).resolves.toEqual({ applied: true });
    const head2 = registry.enqueueAndWait(encodeWorkspaceStateKey('/ws', 'head'), HEAD);
    await vi.advanceTimersByTimeAsync(0);
    await expect(head2).resolves.toEqual({ applied: true });
    expect(send).toHaveBeenCalledTimes(2);

    // worktree waits the full 3000ms between deliveries.
    const worktreeKey = encodeWorkspaceStateKey('/ws', 'worktree');
    const worktree1 = registry.enqueueAndWait(worktreeKey, WORKTREE);
    await vi.advanceTimersByTimeAsync(0);
    await expect(worktree1).resolves.toEqual({ applied: true });
    const worktree2 = registry.enqueueAndWait(worktreeKey, WORKTREE);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await expect(worktree2).resolves.toEqual({ applied: true });
    expect(send).toHaveBeenCalledTimes(4);

    await registry.stopAll();
  });
});

describe('workspace-state outbox durability', () => {
  it('recovers a pending unit after the registry is recreated on the same machine', async () => {
    const machineId = freshMachineId();
    const unit: WorkspaceStateUnit = { kind: 'upstream', commitsAhead: 2, commitsBehind: 0 };
    const key = encodeWorkspaceStateKey('/ws', 'upstream');

    // Never resolves, so the unit stays pending when the registry is stopped.
    const first = createRegistry(machineId, () => new Promise<WorkspaceStateSendResult>(() => {}));
    await first.enqueue(key, unit);
    await first.stopAll();

    const send = vi.fn(async (): Promise<WorkspaceStateSendResult> => ({ applied: true }));
    const second = createRegistry(machineId, send);
    await second.flushNow();

    expect(send).toHaveBeenCalledExactlyOnceWith(unit);
    await second.stopAll();
  });

  it.each([
    'ArgumentValidationError: Value does not match validator',
    'Too many commands (max 500)',
  ])('quarantines a permanently rejected unit (%s) instead of retrying it', async (message) => {
    const machineId = freshMachineId();
    const logger = { error: vi.fn() };
    const key = encodeWorkspaceStateKey('/ws', 'commands');
    const rejected = vi.fn(async (): Promise<WorkspaceStateSendResult> => {
      throw new Error(message);
    });
    const first = createRegistry(machineId, rejected, logger);

    await expect(first.enqueueAndWait(key, { kind: 'commands', commands: [] })).rejects.toThrow(
      message
    );
    await first.stopAll();
    expect(rejected).toHaveBeenCalledOnce();

    const db = new DatabaseSync(resolveOutboxDbPath(machineId, 'workspace-state'));
    expect(db.prepare('SELECT COUNT(*) AS n FROM coalescing_outbox_entries').get()).toEqual({
      n: 0,
    });
    expect(
      db
        .prepare(
          'SELECT delivery_key AS key, last_error AS error FROM coalescing_outbox_quarantine'
        )
        .all()
    ).toEqual([{ key, error: `Error: ${message}` }]);
    db.close();

    const send = vi.fn(async (): Promise<WorkspaceStateSendResult> => ({ applied: true }));
    const second = createRegistry(machineId, send, logger);
    await second.flushNow();
    expect(send).not.toHaveBeenCalled();
    await second.stopAll();
  });
});
