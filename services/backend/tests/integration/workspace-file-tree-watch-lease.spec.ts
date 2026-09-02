/** Integration coverage for renewable file-tree watch leases. */

import { describe, expect, test } from 'vitest';

import { api, internal } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

const WORKING_DIR = '/tmp/watch-lease';

async function setup(sessionKey: string, machineId: string) {
  const { sessionId } = await createTestSession(sessionKey);
  await registerMachineWithDaemon(sessionId, machineId);
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
    const { machineId } = await setup(
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
});
