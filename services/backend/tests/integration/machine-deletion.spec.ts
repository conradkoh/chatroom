/**
 * Machine deletion — Integration Tests
 *
 * Covers the tombstone-first delete contract end to end through public Convex
 * functions: guards, idempotency, authority revocation, cascade orphan-freedom,
 * budgeted batching, the sweeper, and the system-initiated path.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { MACHINE_PURGE_MAX_RESTARTS, MACHINE_PURGE_STALE_AFTER_MS } from '../../config/reliability';
import { api, internal } from '../../convex/_generated/api';
import type { Id, TableNames } from '../../convex/_generated/dataModel';
import { startMachineDeletion } from '../../src/domain/usecase/machine/delete-machine';
import {
  MACHINE_SCOPED_TABLES,
  purgeMachineBatch,
  type PurgeKey,
} from '../../src/domain/usecase/machine/machine-scoped-tables';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../helpers/integration';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function registerMachine(sessionId: SessionId, machineId: string): Promise<void> {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode'],
  });
}

async function registerWorkspace(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  workingDir: string
): Promise<Id<'chatroom_workspaces'>> {
  return t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'builder',
  });
}

async function userIdFor(sessionId: string): Promise<Id<'users'>> {
  return t.run(async (ctx) => {
    const session = await ctx.db
      .query('sessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
      .first();
    if (!session) throw new Error(`No session for ${sessionId}`);
    return session.userId;
  });
}

async function latestTombstone(machineId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chatroom_machineDeletions')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .order('desc')
      .first()
  );
}

async function machineRow(machineId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .first()
  );
}

async function workspacesFor(machineId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_machine', (q) => q.eq('machineId', machineId))
      .collect()
  );
}

/** Rows remaining for a machine in one registry table. */
async function countForTable(table: TableNames, key: PurgeKey): Promise<number> {
  const entry = MACHINE_SCOPED_TABLES.find((candidate) => candidate.table === table);
  if (!entry) throw new Error(`No registry entry for ${table}`);
  return t.run(async (ctx) => (await entry.take(ctx, key, 1_000)).length);
}

/**
 * Seed one row in a representative spread of machine-keyed tables, including the
 * satellite tables of a command run. Returns nothing: assertions read by index.
 */
async function seedMachineGraph(
  machineId: string,
  userId: Id<'users'>,
  chatroomId: Id<'chatroom_rooms'>,
  workingDir: string
): Promise<void> {
  await t.run(async (ctx) => {
    const now = Date.now();

    await ctx.db.insert('chatroom_machineCommandInbox', {
      machineId,
      command: { type: 'daemon.ping' },
      createdAt: now,
      deadline: now + 60_000,
      attemptCount: 0,
      status: 'pending',
    });

    await ctx.db.insert('chatroom_agentDesiredConfigs', {
      teamRoleKey: 'team_test#role_builder',
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: 'opencode',
      model: 'opencode/test',
      workingDir,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert('chatroom_agentRoleStatusReadModel', {
      chatroomId,
      role: 'builder',
      roleKind: 'persistent',
      status: 'waiting',
      machineId,
      workingDir,
      projectedAt: now,
    });

    await ctx.db.insert('chatroom_agentRestartMetrics', {
      machineId,
      role: 'builder',
      chatroomId,
      workingDir,
      model: 'opencode/test',
      hourBucket: 0,
      count: 1,
    });

    await ctx.db.insert('chatroom_workspaceGitState', { machineId, workingDir, updatedAt: now });
    await ctx.db.insert('chatroom_workspaceGitHead', {
      machineId,
      workingDir,
      status: 'available',
      branch: 'main',
      updatedAt: now,
    });

    await ctx.db.insert('chatroom_workspaceFileTreeShardV3', {
      machineId,
      workingDir,
      shardId: '__root__',
      syncGeneration: 'gen-1',
      data: { compression: 'gzip', content: 'H4sI' },
      dataHash: 'hash',
      scannedAt: now,
      entryCount: 1,
    });

    await ctx.db.insert('chatroom_workspaceDirListingV2', {
      machineId,
      workingDir,
      dirPath: '',
      data: { compression: 'gzip', content: 'H4sI' },
      dataHash: 'hash',
      scannedAt: now,
      truncated: false,
      totalCount: 1,
    });

    await ctx.db.insert('chatroom_searchConfigFavorites', {
      userId,
      machineId,
      favorites: [],
      updatedAt: now,
    });
    await ctx.db.insert('chatroom_machineConfigFavorites', {
      userId,
      machineId,
      teamRoleKey: 'team_test#role_builder',
      favorites: [],
      updatedAt: now,
    });

    await ctx.db.insert('chatroom_folderPickerRequests', {
      userId,
      machineId,
      status: 'pending',
      createdAt: now,
    });
    await ctx.db.insert('chatroom_gitCloneRequests', {
      userId,
      machineId,
      repoUrl: 'https://example.com/repo.git',
      targetPath: '/work/clone',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });

    const runId = await ctx.db.insert('chatroom_commandRunsV2', {
      machineId,
      workingDir,
      commandName: 'dev',
      script: 'bun dev',
      status: 'completed',
      startedAt: now,
      requestedBy: userId,
    });
    await ctx.db.insert('chatroom_commandOutputV2', {
      runId,
      compression: 'gzip',
      content: 'H4sI',
      chunkIndex: 0,
      timestamp: now,
    });
    await ctx.db.insert('chatroom_commandRunTailsV2', {
      runId,
      machineId,
      compression: 'gzip',
      content: 'H4sI',
      byteLength: 4,
      totalBytesWritten: 4,
      updatedAt: now,
      lineCount: 1,
    });

    await ctx.db.insert('chatroom_connectionCloseRequests', {
      chatroomId,
      role: 'builder',
      connectionId: `${machineId}-connection`,
      machineId,
      reason: 'test',
      createdAt: now,
      expiresAt: now + 60_000,
    });
    await ctx.db.insert('chatroom_machineObservedWorkspaceViews', {
      machineId,
      chatroomId,
      lastObservedAt: now,
      workingDirs: [workingDir],
    });
    await ctx.db.insert('chatroom_machineFileTreeReleaseHeads', {
      machineId,
      revision: 1,
      updatedAt: now,
    });
  });
}

/** Seed one completed ledger request and two chunk rows for a machine. */
async function seedLedgerSnapshot(userId: Id<'users'>, machineId: string): Promise<void> {
  await t.run(async (ctx) => {
    const now = Date.now();
    const requestId = await ctx.db.insert('chatroom_repositoryLedgerRequests', {
      userId,
      machineId,
      rescan: false,
      status: 'completed',
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      expiresAt: now + 10 * 60_000,
    });
    for (const chunkIndex of [0, 1]) {
      await ctx.db.insert('chatroom_repositoryLedgerChunks', {
        requestId,
        machineId,
        chunkIndex,
        entries: [],
      });
    }
  });
}

async function drainScheduler(): Promise<void> {
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── 1. Auth / guards ─────────────────────────────────────────────────────────

describe('machines.deleteMachine guards', () => {
  test('rejects a non-owner and leaves machine, workspace and tombstones untouched', async () => {
    const { sessionId: ownerSessionId } = await createTestSession('md-guard-owner');
    const { sessionId: otherSessionId } = await createTestSession('md-guard-other');
    const machineId = 'machine-md-guard-owner';

    await registerMachine(ownerSessionId, machineId);
    const chatroomId = await createDuoTeamChatroom(ownerSessionId);
    const workspaceId = await registerWorkspace(
      ownerSessionId,
      chatroomId,
      machineId,
      '/work/guarded'
    );

    await expect(
      t.mutation(api.machines.deleteMachine, { sessionId: otherSessionId, machineId })
    ).rejects.toMatchObject({ data: { code: 'NOT_AUTHORIZED_MACHINE' } });

    expect(await machineRow(machineId)).not.toBeNull();
    const workspaces = await workspacesFor(machineId);
    expect(workspaces.map((workspace) => workspace._id)).toEqual([workspaceId]);
    expect(workspaces[0]?.removedAt).toBeUndefined();
    expect(await latestTombstone(machineId)).toBeNull();
  });

  test('rejects an online machine without changing anything', async () => {
    const { sessionId } = await createTestSession('md-guard-online');
    const machineId = 'machine-md-guard-online';
    await registerMachineWithDaemon(sessionId, machineId);

    await expect(
      t.mutation(api.machines.deleteMachine, { sessionId, machineId })
    ).rejects.toMatchObject({ data: { code: 'MACHINE_ONLINE' } });

    expect(await machineRow(machineId)).not.toBeNull();
    expect(await latestTombstone(machineId)).toBeNull();
  });

  test('rejects an unknown machine with MACHINE_NOT_FOUND', async () => {
    const { sessionId } = await createTestSession('md-guard-missing');

    await expect(
      t.mutation(api.machines.deleteMachine, { sessionId, machineId: 'machine-md-missing' })
    ).rejects.toMatchObject({ data: { code: 'MACHINE_NOT_FOUND' } });

    expect(await latestTombstone('machine-md-missing')).toBeNull();
  });
});

// ─── 2. Happy path + idempotency ─────────────────────────────────────────────

describe('machines.deleteMachine happy path', () => {
  test('detaches active workspaces, preserves chatrooms and is idempotent', async () => {
    const { sessionId } = await createTestSession('md-happy');
    const { sessionId: otherSessionId } = await createTestSession('md-happy-other');
    const machineId = 'machine-md-happy';

    await registerMachine(sessionId, machineId);
    const chatroomA = await createDuoTeamChatroom(sessionId);
    const chatroomB = await createDuoTeamChatroom(sessionId);
    await registerWorkspace(sessionId, chatroomA, machineId, '/work/a');
    await registerWorkspace(sessionId, chatroomA, machineId, '/work/b');
    await registerWorkspace(sessionId, chatroomB, machineId, '/work/c');

    const result = await t.mutation(api.machines.deleteMachine, { sessionId, machineId });

    expect(result).toEqual({
      status: 'deleted',
      purgeComplete: true,
      detachedWorkspaceCount: 3,
      affectedChatroomCount: 2,
    });

    const machines = await t.query(api.machines.getUserMachines, { sessionId });
    expect(machines.machines).toEqual([]);
    expect(await machineRow(machineId)).toBeNull();

    const workspaces = await workspacesFor(machineId);
    expect(workspaces).toHaveLength(3);
    expect(workspaces.every((workspace) => workspace.removedAt !== undefined)).toBe(true);

    for (const chatroomId of [chatroomA, chatroomB]) {
      const chatroom = await t.run(async (ctx) => ctx.db.get('chatroom_rooms', chatroomId));
      expect(chatroom).not.toBeNull();
    }

    const tombstone = await latestTombstone(machineId);
    expect(tombstone?.status).toBe('completed');

    await expect(t.mutation(api.machines.deleteMachine, { sessionId, machineId })).resolves.toEqual(
      { status: 'already_deleted' }
    );

    await expect(
      t.mutation(api.machines.deleteMachine, { sessionId: otherSessionId, machineId })
    ).rejects.toMatchObject({ data: { code: 'MACHINE_NOT_FOUND' } });
  });

  test('end-to-end: blocked while online, succeeds after markDaemonOffline and purges ≥10 tables', async () => {
    const { sessionId } = await createTestSession('md-e2e');
    const machineId = 'machine-md-e2e';

    await registerMachineWithDaemon(sessionId, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await registerWorkspace(sessionId, chatroomId, machineId, '/work/e2e');
    const userId = await userIdFor(sessionId);
    await seedMachineGraph(machineId, userId, chatroomId, '/work/e2e');

    await expect(
      t.mutation(api.machines.deleteMachine, { sessionId, machineId })
    ).rejects.toMatchObject({ data: { code: 'MACHINE_ONLINE' } });
    expect(await machineRow(machineId)).not.toBeNull();

    await t.mutation(api.machines.markDaemonOffline, { sessionId, machineId });
    const result = await t.mutation(api.machines.deleteMachine, { sessionId, machineId });
    expect(result).toEqual({
      status: 'deleted',
      purgeComplete: true,
      detachedWorkspaceCount: 1,
      affectedChatroomCount: 1,
    });
    await drainScheduler();

    const tombstone = await latestTombstone(machineId);
    expect(tombstone?.status).toBe('completed');

    const machines = await t.query(api.machines.getUserMachines, { sessionId });
    expect(machines.machines).toEqual([]);

    const chatroom = await t.run(async (ctx) => ctx.db.get('chatroom_rooms', chatroomId));
    expect(chatroom).not.toBeNull();

    const key: PurgeKey = { machineId, userId };
    for (const table of [
      'chatroom_machineCommandInbox',
      'chatroom_agentDesiredConfigs',
      'chatroom_agentRoleStatusReadModel',
      'chatroom_workspaceGitState',
      'chatroom_workspaceGitHead',
      'chatroom_workspaceFileTreeShardV3',
      'chatroom_workspaceDirListingV2',
      'chatroom_searchConfigFavorites',
      'chatroom_machineConfigFavorites',
      'chatroom_folderPickerRequests',
      'chatroom_gitCloneRequests',
      'chatroom_commandRunsV2',
      'chatroom_machineObservedWorkspaceViews',
    ] as const) {
      expect(await countForTable(table, key), table).toBe(0);
    }
  });
});

// ─── 3. Tombstone-first authority revocation ────────────────────────────────

describe('tombstone-first ordering', () => {
  test('revokes daemon authority and blocks re-registration while purging', async () => {
    const { sessionId } = await createTestSession('md-tombstone');
    const machineId = 'machine-md-tombstone';

    await registerMachine(sessionId, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const workspaceId = await registerWorkspace(
      sessionId,
      chatroomId,
      machineId,
      '/work/tombstone'
    );

    await t.mutation(api.machines.deleteMachine, { sessionId, machineId });

    await expect(
      t.mutation(api.machines.daemonHeartbeat, { sessionId, machineId })
    ).rejects.toMatchObject({ data: { code: 'NOT_AUTHORIZED_MACHINE' } });
    await expect(
      t.mutation(api.machines.markDaemonOnline, { sessionId, machineId })
    ).rejects.toMatchObject({ data: { code: 'NOT_AUTHORIZED_MACHINE' } });
    await expect(
      t.mutation(api.daemon.machineCommandInbox.claimNext, { sessionId, machineId })
    ).rejects.toMatchObject({ data: { code: 'NOT_AUTHORIZED_MACHINE' } });

    // Force the chain back to 'purging' to prove the register guard.
    const tombstone = await latestTombstone(machineId);
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_machineDeletions', tombstone!._id, { status: 'purging' });
    });

    await expect(
      t.mutation(api.machines.register, {
        sessionId,
        machineId,
        hostname: 'test-host',
        os: 'darwin',
        availableHarnesses: ['opencode'],
      })
    ).rejects.toMatchObject({ data: { code: 'MACHINE_DELETION_IN_PROGRESS' } });

    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_machineDeletions', tombstone!._id, { status: 'completed' });
    });

    const registered = await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
    });
    expect(registered.isNew).toBe(true);

    const machines = await t.query(api.machines.getUserMachines, { sessionId });
    expect(machines.machines.map((machine) => machine.machineId)).toEqual([machineId]);
    expect(machines.machines[0]?.alias).toBeUndefined();

    // Previous workspaces are not restored: the row is still soft-detached.
    const workspaces = await workspacesFor(machineId);
    expect(workspaces.map((workspace) => workspace._id)).toEqual([workspaceId]);
    expect(workspaces[0]?.removedAt).toBeDefined();
  });
});

// ─── 4. Cascade orphan-freedom ──────────────────────────────────────────────

describe('cascade purge', () => {
  test('purges every registry table for the machine and leaves other machines untouched', async () => {
    const { sessionId } = await createTestSession('md-cascade');
    const { sessionId: controlSessionId } = await createTestSession('md-cascade-control');
    const { sessionId: otherUserSessionId } = await createTestSession('md-cascade-other-user');

    const machineId = 'machine-md-cascade';
    const controlMachineId = 'machine-md-cascade-control';

    const userId = await userIdFor(sessionId);
    const controlUserId = await userIdFor(controlSessionId);
    const otherUserId = await userIdFor(otherUserSessionId);

    await registerMachine(sessionId, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const workspaceId = await registerWorkspace(sessionId, chatroomId, machineId, '/work/cascade');
    await t.mutation(api.workspaces.setPrimaryWorkspaceForChatroom, {
      sessionId,
      chatroomId,
      workspaceId,
    });

    const controlChatroom = await createDuoTeamChatroom(controlSessionId);
    await seedMachineGraph(machineId, userId, chatroomId, '/work/cascade');
    await seedMachineGraph(controlMachineId, controlUserId, controlChatroom, '/work/control');

    // Favorites are user+machine scoped: both cross-scope control rows must survive.
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_searchConfigFavorites', {
        userId,
        machineId: controlMachineId,
        favorites: [],
        updatedAt: Date.now(),
      });
      await ctx.db.insert('chatroom_searchConfigFavorites', {
        userId: otherUserId,
        machineId,
        favorites: [],
        updatedAt: Date.now(),
      });
    });

    // Prove the seeded graph is real before deleting (a vacuous zero-count would hide nothing).
    const targetKey: PurgeKey = { machineId, userId };
    expect(await countForTable('chatroom_machineCommandInbox', targetKey)).toBeGreaterThanOrEqual(
      1
    );
    expect(await countForTable('chatroom_workspaceFileTreeShardV3', targetKey)).toBe(1);
    expect(await countForTable('chatroom_commandRunsV2', targetKey)).toBe(1);

    const result = await t.mutation(api.machines.deleteMachine, { sessionId, machineId });
    expect(result).toMatchObject({ status: 'deleted' });
    await drainScheduler();

    for (const entry of MACHINE_SCOPED_TABLES) {
      if (entry.table === 'chatroom_machines') continue;
      expect(await countForTable(entry.table, targetKey), entry.table).toBe(0);
    }

    // Workspaces survive, soft-detached, and the primary pointer is gone.
    const workspaces = await workspacesFor(machineId);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.removedAt).toBeDefined();
    const primary = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_primaryWorkspaces')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first()
    );
    expect(primary).toBeNull();

    // Chatrooms are preserved.
    expect(await t.run(async (ctx) => ctx.db.get('chatroom_rooms', chatroomId))).not.toBeNull();

    // Control machine rows are untouched.
    const controlKey: PurgeKey = { machineId: controlMachineId, userId: controlUserId };
    expect(await countForTable('chatroom_machineCommandInbox', controlKey)).toBe(1);
    expect(await countForTable('chatroom_folderPickerRequests', controlKey)).toBe(1);
    expect(await countForTable('chatroom_commandRunsV2', controlKey)).toBe(1);
    expect(await countForTable('chatroom_searchConfigFavorites', controlKey)).toBe(1);

    // Cross-scope favorites survive.
    expect(await countForTable('chatroom_searchConfigFavorites', targetKey)).toBe(0);
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query('chatroom_searchConfigFavorites')
          .withIndex('by_user_machine', (q) =>
            q.eq('userId', otherUserId).eq('machineId', machineId)
          )
          .first()
      )
    ).not.toBeNull();

    const tombstone = await latestTombstone(machineId);
    expect(tombstone?.status).toBe('completed');
  });
});

// ─── 5. Batching ────────────────────────────────────────────────────────────

describe('batched purge', () => {
  test('purges more than one batch and completes the tombstone', async () => {
    const { sessionId } = await createTestSession('md-batch');
    const machineId = 'machine-md-batch';
    await registerMachine(sessionId, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId);

    for (let i = 0; i < 10; i++) {
      await registerWorkspace(sessionId, chatroomId, machineId, `/work/batch-${i}`);
    }
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 700; i++) {
        await ctx.db.insert('chatroom_machineCommandInbox', {
          machineId,
          command: { type: 'daemon.ping' },
          createdAt: now,
          deadline: now + 60_000,
          attemptCount: 0,
          status: 'pending',
        });
      }
    });

    const result = await t.mutation(api.machines.deleteMachine, { sessionId, machineId });
    expect(result).toMatchObject({ status: 'deleted', purgeComplete: false });

    const inFlight = await latestTombstone(machineId);
    expect(inFlight?.status).toBe('purging');
    expect(inFlight?.batchCount).toBe(1);

    await drainScheduler();

    const completed = await latestTombstone(machineId);
    expect(completed?.status).toBe('completed');
    expect(completed?.batchCount).toBeGreaterThan(1);
    expect(
      await countForTable('chatroom_machineCommandInbox', { machineId, userId: completed!.userId })
    ).toBe(0);
    expect(await workspacesFor(machineId)).toHaveLength(10);
    expect(
      (await workspacesFor(machineId)).every((workspace) => workspace.removedAt !== undefined)
    ).toBe(true);
  });

  test('purgeMachineBatch with a small budget deletes at most that budget', async () => {
    const { sessionId } = await createTestSession('md-budget');
    const userId = await userIdFor(sessionId);
    const machineId = 'machine-md-budget';

    const deleted = await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 20; i++) {
        await ctx.db.insert('chatroom_folderPickerRequests', {
          userId,
          machineId,
          status: 'pending',
          createdAt: now,
        });
      }
      const result = await purgeMachineBatch(ctx, { machineId, userId }, 10);
      return result.deleted;
    });

    expect(deleted).toBe(10);
  });

  test('large-row tables purge at most 10 rows per batch at the default budget', async () => {
    const { sessionId } = await createTestSession('md-large-cap');
    const userId = await userIdFor(sessionId);
    const machineId = 'machine-md-large-cap';

    const { first, second, remainingAfterFirst, remainingAfterSecond } = await t.run(
      async (ctx) => {
        // Parent request lives on a DIFFERENT machine. The request descriptor (cost 1)
        // runs before the chunk descriptor, so a same-machine parent would spend budget
        // and change the expected per-batch count.
        const requestId = await ctx.db.insert('chatroom_repositoryLedgerRequests', {
          userId,
          machineId: 'machine-md-large-cap-parent',
          rescan: false,
          status: 'completed',
          createdAt: 1,
          updatedAt: 1,
          expiresAt: 1,
        });
        for (let i = 0; i < 20; i++) {
          await ctx.db.insert('chatroom_repositoryLedgerChunks', {
            requestId,
            machineId,
            chunkIndex: i,
            entries: [],
          });
        }
        const countLeft = async () =>
          (
            await ctx.db
              .query('chatroom_repositoryLedgerChunks')
              .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
              .collect()
          ).length;

        const first = await purgeMachineBatch(ctx, { machineId, userId });
        const remainingAfterFirst = await countLeft();
        const second = await purgeMachineBatch(ctx, { machineId, userId });
        const remainingAfterSecond = await countLeft();
        return { first, second, remainingAfterFirst, remainingAfterSecond };
      }
    );

    expect(first).toMatchObject({ deleted: 10, drained: false });
    expect(remainingAfterFirst).toBe(10);
    expect(second).toMatchObject({ deleted: 10, drained: false });
    expect(remainingAfterSecond).toBe(0);
  });

  test('a command run with 120 output chunks drains over three batches with no orphan chunks or tail', async () => {
    const { sessionId } = await createTestSession('md-run-chunks');
    const userId = await userIdFor(sessionId);
    const machineId = 'machine-md-run-chunks';
    const key: PurgeKey = { machineId, userId };

    const runId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert('chatroom_commandRunsV2', {
        machineId,
        workingDir: '/work/run-chunks',
        commandName: 'dev',
        script: 'bun dev',
        status: 'completed',
        startedAt: now,
        requestedBy: userId,
      });
      await ctx.db.insert('chatroom_commandRunTailsV2', {
        runId: id,
        machineId,
        compression: 'gzip',
        content: 'H4sI',
        byteLength: 4,
        totalBytesWritten: 4,
        updatedAt: now,
        lineCount: 1,
      });
      for (let i = 0; i < 120; i++) {
        await ctx.db.insert('chatroom_commandOutputV2', {
          runId: id,
          compression: 'gzip',
          content: 'H4sI',
          chunkIndex: i,
          timestamp: now,
        });
      }
      return id;
    });

    const chunkCount = () =>
      t.run(
        async (ctx) =>
          (
            await ctx.db
              .query('chatroom_commandOutputV2')
              .withIndex('by_runId_chunkIndex', (q) => q.eq('runId', runId))
              .collect()
          ).length
      );
    const runExists = () =>
      t.run((ctx) => ctx.db.get('chatroom_commandRunsV2', runId).then((row) => row !== null));
    const tailCount = () =>
      t.run(
        async (ctx) =>
          (
            await ctx.db
              .query('chatroom_commandRunTailsV2')
              .withIndex('by_runId', (q) => q.eq('runId', runId))
              .collect()
          ).length
      );

    const first = await t.run((ctx) => purgeMachineBatch(ctx, key));
    expect(first).toMatchObject({ drained: false });
    expect(await chunkCount()).toBe(70);
    expect(await runExists()).toBe(true);

    const second = await t.run((ctx) => purgeMachineBatch(ctx, key));
    expect(second).toMatchObject({ drained: false });
    expect(await chunkCount()).toBe(20);
    expect(await runExists()).toBe(true);

    const third = await t.run((ctx) => purgeMachineBatch(ctx, key));
    expect(third).toMatchObject({ drained: true });
    expect(await chunkCount()).toBe(0);
    expect(await tailCount()).toBe(0);
    expect(await runExists()).toBe(false);
  });
});

// ─── 6. Sweeper ─────────────────────────────────────────────────────────────

describe('sweepMachineDeletions', () => {
  async function insertTombstone(
    machineId: string,
    userId: Id<'users'>,
    overrides: {
      status: 'purging' | 'completed' | 'failed';
      updatedAt: number;
      restartCount?: number;
    }
  ): Promise<Id<'chatroom_machineDeletions'>> {
    return t.run(async (ctx) =>
      ctx.db.insert('chatroom_machineDeletions', {
        machineId,
        userId,
        initiatedBy: 'system',
        status: overrides.status,
        requestedAt: overrides.updatedAt,
        updatedAt: overrides.updatedAt,
        batchCount: 0,
        restartCount: overrides.restartCount ?? 0,
        deletedRowCount: 0,
        detachedWorkspaceCount: 0,
      })
    );
  }

  test('restarts a dead purging chain and completes it', async () => {
    const { sessionId } = await createTestSession('md-sweep-restart');
    const userId = await userIdFor(sessionId);
    const machineId = 'machine-md-sweep-restart';

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_folderPickerRequests', {
        userId,
        machineId,
        status: 'pending',
        createdAt: Date.now(),
      });
    });
    await insertTombstone(machineId, userId, {
      status: 'purging',
      updatedAt: Date.now() - MACHINE_PURGE_STALE_AFTER_MS - 1,
    });

    await t.mutation(internal.machineDeletion.sweepMachineDeletions, {});
    await drainScheduler();

    const tombstone = await latestTombstone(machineId);
    expect(tombstone?.restartCount).toBe(1);
    expect(tombstone?.status).toBe('completed');
    expect(await countForTable('chatroom_folderPickerRequests', { machineId, userId })).toBe(0);
  });

  test('fails a tombstone that exceeded the restart limit', async () => {
    const { sessionId } = await createTestSession('md-sweep-failed');
    const userId = await userIdFor(sessionId);
    const machineId = 'machine-md-sweep-failed';
    await insertTombstone(machineId, userId, {
      status: 'purging',
      updatedAt: Date.now() - MACHINE_PURGE_STALE_AFTER_MS - 1,
      restartCount: MACHINE_PURGE_MAX_RESTARTS,
    });

    await t.mutation(internal.machineDeletion.sweepMachineDeletions, {});

    const tombstone = await latestTombstone(machineId);
    expect(tombstone?.status).toBe('failed');
    expect(tombstone?.lastError).toBe('Purge exceeded restart limit');
  });

  test('deletes completed tombstones past retention and leaves fresh purges alone', async () => {
    const { sessionId } = await createTestSession('md-sweep-retention');
    const userId = await userIdFor(sessionId);
    const now = Date.now();

    const expiredId = await insertTombstone('machine-md-retention-old', userId, {
      status: 'completed',
      updatedAt: now - 8 * 24 * 60 * 60_000,
    });
    const freshId = await insertTombstone('machine-md-retention-fresh', userId, {
      status: 'purging',
      updatedAt: now,
    });

    await t.mutation(internal.machineDeletion.sweepMachineDeletions, {});

    const expired = await t.run(async (ctx) => ctx.db.get('chatroom_machineDeletions', expiredId));
    expect(expired).toBeNull();

    const fresh = await t.run(async (ctx) => ctx.db.get('chatroom_machineDeletions', freshId));
    expect(fresh?.status).toBe('purging');
    expect(fresh?.restartCount).toBe(0);
  });
});

// ─── 7. System path ─────────────────────────────────────────────────────────

describe('system-initiated deletion', () => {
  test('deletes an online machine synchronously and purges on the scheduler', async () => {
    const { sessionId } = await createTestSession('md-system');
    const userId = await userIdFor(sessionId);
    const machineId = 'machine-md-system';
    await registerMachineWithDaemon(sessionId, machineId);

    const result = await t.run(async (ctx) =>
      startMachineDeletion(ctx, {
        machineId,
        userId,
        initiatedBy: 'system',
        inlineBudget: 0,
        requireOffline: false,
      })
    );

    expect(result).toEqual({
      status: 'deleted',
      purgeComplete: false,
      detachedWorkspaceCount: 0,
      affectedChatroomCount: 0,
    });
    expect(await machineRow(machineId)).toBeNull();

    await drainScheduler();

    const tombstone = await latestTombstone(machineId);
    expect(tombstone?.status).toBe('completed');
    expect(tombstone?.initiatedBy).toBe('system');
  });
});

// ─── 8. 90-day cleanup → shared purge ───────────────────────────────────────

describe('chatroomCleanup.cleanupMachines → shared purge', () => {
  test('purges every registry table, soft-detaches workspaces and preserves chatrooms', async () => {
    const { sessionId } = await createTestSession('md-cleanup-shared');
    const machineId = 'machine-md-cleanup-shared';

    await registerMachine(sessionId, machineId);
    const userId = await userIdFor(sessionId);
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const workspaceId = await registerWorkspace(
      sessionId,
      chatroomId,
      machineId,
      '/work/cleanup-shared'
    );
    await seedMachineGraph(machineId, userId, chatroomId, '/work/cleanup-shared');
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'history that must survive machine deletion',
      type: 'message',
    });
    const participantId = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_participants', { chatroomId, role: 'builder' })
    );

    // Prove the seeded graph is real before cleaning up.
    const key: PurgeKey = { machineId, userId };
    const runId = await t.run(async (ctx) => {
      const run = await ctx.db
        .query('chatroom_commandRunsV2')
        .withIndex('by_machine_workingDir', (q) => q.eq('machineId', machineId))
        .first();
      if (!run) throw new Error('Seeded command run missing');
      return run._id;
    });
    expect(await countForTable('chatroom_machineCommandInbox', key)).toBeGreaterThanOrEqual(1);
    expect(await countForTable('chatroom_workspaceFileTreeShardV3', key)).toBe(1);
    expect(await countForTable('chatroom_commandRunsV2', key)).toBe(1);

    // Selection is driven by the dedicated capabilities recency projection.
    await t.run(async (ctx) => {
      const capabilities = await ctx.db
        .query('chatroom_machineCapabilities')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      expect(capabilities).toBeDefined();
      await ctx.db.patch(capabilities!._id, {
        lastSeenAt: Date.now() - 91 * 24 * 60 * 60 * 1000,
      });
    });

    await t.mutation(internal.chatroomCleanup.cleanupMachines, {});
    await drainScheduler();

    // (a) Every registry table is empty for the machine.
    for (const entry of MACHINE_SCOPED_TABLES) {
      if (entry.table === 'chatroom_machines') continue;
      expect(await countForTable(entry.table, key), entry.table).toBe(0);
    }
    // Command satellites have no machine index; the run delete must remove them.
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query('chatroom_commandOutputV2')
          .withIndex('by_runId_chunkIndex', (q) => q.eq('runId', runId))
          .collect()
      )
    ).toHaveLength(0);
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query('chatroom_commandRunTailsV2')
          .withIndex('by_runId', (q) => q.eq('runId', runId))
          .collect()
      )
    ).toHaveLength(0);

    // (b) Workspaces survive, soft-detached.
    const workspace = await t.run(async (ctx) => ctx.db.get('chatroom_workspaces', workspaceId));
    expect(workspace).not.toBeNull();
    expect(workspace!.removedAt).toBeDefined();

    // (c) Chatroom, messages and participants are preserved.
    expect(await t.run(async (ctx) => ctx.db.get('chatroom_rooms', chatroomId))).not.toBeNull();
    const messages = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(
      await t.run(async (ctx) => ctx.db.get('chatroom_participants', participantId))
    ).not.toBeNull();

    // (d) The tombstone records the system initiator and completes.
    const tombstone = await latestTombstone(machineId);
    expect(tombstone?.initiatedBy).toBe('system');
    expect(tombstone?.status).toBe('completed');

    // (e) A second run is a no-op: no second tombstone.
    await t.mutation(internal.chatroomCleanup.cleanupMachines, {});
    await drainScheduler();
    const tombstones = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_machineDeletions')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .collect()
    );
    expect(tombstones).toHaveLength(1);
  });
});

describe('machines.deleteMachine purges repository ledger snapshots', () => {
  test('removes request and chunk rows for the deleted machine and leaves other machines untouched', async () => {
    const { sessionId } = await createTestSession('md-ledger-owner');
    const userId = await userIdFor(sessionId);
    const deletedMachineId = 'machine-md-ledger-deleted';
    const keptMachineId = 'machine-md-ledger-kept';
    await registerMachine(sessionId, deletedMachineId);
    await registerMachine(sessionId, keptMachineId);
    await seedLedgerSnapshot(userId, deletedMachineId);
    await seedLedgerSnapshot(userId, keptMachineId);

    await t.mutation(api.machines.deleteMachine, { sessionId, machineId: deletedMachineId });
    await drainScheduler();

    const deletedKey = { machineId: deletedMachineId, userId };
    const keptKey = { machineId: keptMachineId, userId };
    expect(await countForTable('chatroom_repositoryLedgerRequests', deletedKey)).toBe(0);
    expect(await countForTable('chatroom_repositoryLedgerChunks', deletedKey)).toBe(0);
    expect(await countForTable('chatroom_repositoryLedgerRequests', keptKey)).toBe(1);
    expect(await countForTable('chatroom_repositoryLedgerChunks', keptKey)).toBe(2);
  });
});
