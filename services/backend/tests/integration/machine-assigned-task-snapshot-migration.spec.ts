/** Migration: strip legacy operational fields from machine task snapshots. */

import { describe, expect, test } from 'vitest';

import { internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createTestSession } from '../helpers/integration';

describe('migration: stripMachineAssignedTaskSnapshotOperationalFields', () => {
  test('clears legacy operational fields from snapshot rows', async () => {
    await createTestSession('migrate-snapshot');
    const snapshotId = await t.run(async (ctx) => {
      const owner = (await ctx.db.query('users').first())!;
      const chatroomId = await ctx.db.insert('chatroom_rooms', {
        status: 'active',
        ownerId: owner._id,
        name: 'migrate-snapshot',
      });
      const taskId = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'planner',
        status: 'in_progress',
        assignedTo: 'planner',
        content: 'test',
      });
      return await ctx.db.insert('chatroom_machineAssignedTaskSnapshots', {
        machineId: 'migrate-machine',
        taskId,
        chatroomId,
        role: 'planner',
        taskStatus: 'in_progress',
        taskCreatedAt: Date.now(),
        taskUpdatedAt: Date.now(),
        agentHarness: 'opencode',
        configUpdatedAt: Date.now(),
        presenceUpdatedAt: Date.now(),
        presenceKey: 'pk',
        revisionKey: 'rk',
        signalUpdatedAt: Date.now(),
        circuitState: 'closed',
        desiredState: 'running',
        spawnedAgentPid: 42,
      });
    });

    await t.mutation(internal.migrations.stripMachineAssignedTaskSnapshotOperationalFields, {
      cursor: null,
      batchSize: 100,
    });

    const after = await t.run(async (ctx) =>
      ctx.db.get(
        'chatroom_machineAssignedTaskSnapshots',
        snapshotId as Id<'chatroom_machineAssignedTaskSnapshots'>
      )
    );
    const row = after as Record<string, unknown>;
    expect(row.circuitState).toBeUndefined();
    expect(row.desiredState).toBeUndefined();
    expect(row.spawnedAgentPid).toBeUndefined();
  });

  test('skips rows without legacy fields (idempotent)', async () => {
    await t.mutation(internal.migrations.stripMachineAssignedTaskSnapshotOperationalFields, {
      cursor: null,
      batchSize: 100,
    });
  });
});
