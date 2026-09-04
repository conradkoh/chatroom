/** Integration coverage for renewable file-tree watch leases. */

import { describe, expect, test } from 'vitest';

import { api, internal } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerWorkspaceWithFileTreeSync } from '../helpers/integration';

const WORKING_DIR = '/tmp/watch-lease';

async function setup(sessionKey: string, machineId: string) {
  const { sessionId } = await createTestSession(sessionKey);
  await registerWorkspaceWithFileTreeSync(sessionId, machineId, WORKING_DIR);
  return { sessionId, machineId };
}

describe('workspace file-tree watch leases', () => {
  test('adjusting a watch creates and renews its lease deadline', async () => {
    const { sessionId, machineId } = await setup(
      'test-file-tree-watch-lease-adjust',
      'machine-file-tree-watch-lease-adjust'
    );

    const adjusted = await t.mutation(api.workspaceFiles.adjustFileTreeWatch, {
      sessionId,
      machineId,
      workingDir: `${WORKING_DIR}/`,
      delta: 1,
    });
    expect(adjusted).toEqual({ watchCount: 1 });

    const initial = await t.query(api.workspaceFiles.getFileTreeWatchLease, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
    });
    expect(initial).toMatchObject({ watchCount: 1, leaseActive: true });
    expect(initial?.expiresAt).toBeGreaterThan(Date.now());

    const renewed = await t.mutation(api.workspaceFiles.renewFileTreeWatchLease, {
      sessionId,
      machineId,
      workingDir: `${WORKING_DIR}/`,
    });
    expect(renewed.watchCount).toBe(1);
    expect(renewed.expiresAt).toBeGreaterThanOrEqual(initial?.expiresAt ?? 0);
  });

  test('cron queues a release request for an expired lease without clearing the count', async () => {
    const { sessionId, machineId } = await setup(
      'test-file-tree-watch-lease-cron',
      'machine-file-tree-watch-lease-cron'
    );
    await t.run((ctx) =>
      ctx.db.insert('chatroom_workspaceFileTreeWatches', {
        machineId,
        workingDir: WORKING_DIR,
        watchCount: 1,
        expiresAt: Date.now() - 1,
        updatedAt: Date.now(),
      })
    );

    await t.mutation(internal.workspaceFileTreeWatchCron.expireFileTreeWatchLeases, {});

    const rows = await t.run((ctx) =>
      ctx.db
        .query('chatroom_workspaceFileTreeReleaseRequests')
        .withIndex('by_machine_workingDir', (q) =>
          q.eq('machineId', machineId).eq('workingDir', WORKING_DIR)
        )
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', workingDir: WORKING_DIR });

    const firstHead = await t.query(api.workspaceFiles.subscribeMachineFileTreeReleaseHead, {
      sessionId,
      machineId,
    });
    expect(firstHead).toEqual({ revision: 1 });

    await t.mutation(internal.workspaceFileTreeWatchCron.expireFileTreeWatchLeases, {});
    const secondHead = await t.query(api.workspaceFiles.subscribeMachineFileTreeReleaseHead, {
      sessionId,
      machineId,
    });
    expect(secondHead).toEqual({ revision: 1 });

    const watch = await t.run((ctx) =>
      ctx.db
        .query('chatroom_workspaceFileTreeWatches')
        .withIndex('by_machine_workingDir', (q) =>
          q.eq('machineId', machineId).eq('workingDir', WORKING_DIR)
        )
        .first()
    );
    expect(watch?.watchCount).toBe(1);
  });

  test('inactive machine cleanup deletes the release wake-up head', async () => {
    const { sessionId, machineId } = await setup(
      'test-file-tree-watch-lease-cleanup',
      'machine-file-tree-watch-lease-cleanup'
    );

    await t.mutation(api.workspaceFiles.adjustFileTreeWatch, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      delta: 1,
    });
    await t.mutation(api.workspaceFiles.adjustFileTreeWatch, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      delta: -1,
    });

    await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      expect(machine).toBeDefined();
      await ctx.db.patch('chatroom_machines', machine!._id, {
        lastSeenAt: Date.now() - 91 * 24 * 60 * 60 * 1000,
      });
    });

    await t.mutation(internal.chatroomCleanup.cleanupMachines, {});

    const head = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineFileTreeReleaseHeads')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first()
    );
    expect(head).toBeNull();
  });

  test('watch count falling to zero bumps the release wake-up head', async () => {
    const { sessionId, machineId } = await setup(
      'test-file-tree-watch-lease-head',
      'machine-file-tree-watch-lease-head'
    );

    await t.mutation(api.workspaceFiles.adjustFileTreeWatch, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      delta: 1,
    });
    const first = await t.mutation(api.workspaceFiles.adjustFileTreeWatch, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      delta: -1,
    });
    expect(first).toEqual({ watchCount: 0 });

    const head = await t.query(api.workspaceFiles.subscribeMachineFileTreeReleaseHead, {
      sessionId,
      machineId,
    });
    expect(head).toEqual({ revision: 1 });

    await t.mutation(api.workspaceFiles.fulfillFileTreeReleaseRequest, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
    });
    await t.mutation(api.workspaceFiles.adjustFileTreeWatch, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      delta: 1,
    });
    await t.mutation(api.workspaceFiles.adjustFileTreeWatch, {
      sessionId,
      machineId,
      workingDir: WORKING_DIR,
      delta: -1,
    });

    await expect(
      t.query(api.workspaceFiles.subscribeMachineFileTreeReleaseHead, { sessionId, machineId })
    ).resolves.toEqual({ revision: 2 });
  });
});
