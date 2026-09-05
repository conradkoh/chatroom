/** Migration: strip legacy operational fields from machine task snapshots. */

import { createTaskEnvelope, type TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { projectAssignedTaskSnapshotsForChatroom } from '../../src/domain/usecase/machine/machine-assigned-task-snapshot-sync';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

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
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 0,
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

describe('snapshot projection: session augmentation from canonical envelope', () => {
  async function seedProjectedTask(settings: {
    sessionPrefix: string;
    taskEnvelope?: TaskEnvelopeV1 | undefined;
    startInNewSession?: boolean | undefined;
  }): Promise<{ sessionId: SessionId; machineId: string; taskId: Id<'chatroom_tasks'> }> {
    const session = await createTestSession(`${settings.sessionPrefix}-session`);
    const machineId = `${settings.sessionPrefix}-machine`;
    await registerMachineWithDaemon(session.sessionId as never, machineId);
    const chatroomId = await createBuilderEntryDuoChatroom(session.sessionId as never);
    await setupRemoteAgentConfig(session.sessionId as never, chatroomId, machineId, 'builder');

    const taskId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'builder',
        content: 'projection test task',
        status: 'pending' as const,
        assignedTo: 'builder',
        queuePosition: 0,
        createdAt: now,
        updatedAt: now,
        ...(settings.taskEnvelope !== undefined ? { taskEnvelope: settings.taskEnvelope } : {}),
        ...(settings.startInNewSession !== undefined
          ? { startInNewSession: settings.startInNewSession }
          : {}),
      });
      await projectAssignedTaskSnapshotsForChatroom(ctx, chatroomId);
      return id;
    });

    return { sessionId: session.sessionId, machineId, taskId };
  }

  async function readSnapshotRow(
    machineId: string,
    taskId: Id<'chatroom_tasks'>
  ): Promise<{ sessionAugmentation: 'none' | 'new_session' | undefined } | null> {
    return await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_machineAssignedTaskSnapshots')
        .withIndex('by_machineId_taskId_role', (q) =>
          q.eq('machineId', machineId).eq('taskId', taskId).eq('role', 'builder')
        )
        .unique();
    });
  }

  test('explicit envelope new wins over stale scalar false', async () => {
    const { sessionId, machineId, taskId } = await seedProjectedTask({
      sessionPrefix: 'proj-env-new',
      taskEnvelope: createTaskEnvelope({ conversationMode: 'code', sessionPolicy: 'new' }),
      startInNewSession: false,
    });

    const row = await readSnapshotRow(machineId, taskId);
    expect(row?.sessionAugmentation).toBe('new_session');

    const actionView = await t.query(api.machines.getAssignedTaskForAction, {
      sessionId: sessionId as never,
      machineId,
      taskId,
      role: 'builder',
    });
    expect(actionView?.taskEnvelope).toEqual(
      createTaskEnvelope({ conversationMode: 'code', sessionPolicy: 'new' })
    );
  });

  test('explicit envelope continue wins over stale scalar true', async () => {
    const { machineId, taskId } = await seedProjectedTask({
      sessionPrefix: 'proj-env-continue',
      taskEnvelope: createTaskEnvelope({ conversationMode: 'chat', sessionPolicy: 'continue' }),
      startInNewSession: true,
    });

    const row = await readSnapshotRow(machineId, taskId);
    expect(row?.sessionAugmentation).toBe('none');
  });

  test('legacy task without envelope preserves scalar and role-default behavior', async () => {
    const scalarTrue = await seedProjectedTask({
      sessionPrefix: 'proj-legacy-true',
      startInNewSession: true,
    });
    expect(
      (await readSnapshotRow(scalarTrue.machineId, scalarTrue.taskId))?.sessionAugmentation
    ).toBe('new_session');

    const scalarFalse = await seedProjectedTask({
      sessionPrefix: 'proj-legacy-false',
      startInNewSession: false,
    });
    expect(
      (await readSnapshotRow(scalarFalse.machineId, scalarFalse.taskId))?.sessionAugmentation
    ).toBe('none');

    const undefinedScalar = await seedProjectedTask({ sessionPrefix: 'proj-legacy-undefined' });
    expect(
      (await readSnapshotRow(undefinedScalar.machineId, undefinedScalar.taskId))
        ?.sessionAugmentation
    ).toBe('new_session');
  });
});
