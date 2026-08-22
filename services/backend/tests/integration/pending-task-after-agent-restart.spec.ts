/**
 * Phase E — pending task survives agent restart via operational projection (not snapshot desiredState).
 */
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { startAgent } from '../../src/domain/usecase/agent/start-agent';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  joinParticipant,
  setupRemoteAgentConfig,
} from '../helpers/integration';
import { TEST_MODEL_CURSOR_SDK, TEST_MODEL_OPENCODE } from '../helpers/test-models';

async function syncMachineSnapshots(sessionId: string, machineId: string): Promise<void> {
  await t.mutation(api.machines.syncMachineAssignedTaskSnapshotsMutation, {
    sessionId,
    machineId,
  });
}

async function registerMachineWithCursorSdk(sessionId: string, machineId: string): Promise<void> {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['cursor-sdk', 'opencode'],
    availableModels: {
      'cursor-sdk': [TEST_MODEL_CURSOR_SDK],
      opencode: [TEST_MODEL_OPENCODE],
    },
  });
  await t.mutation(api.machines.updateDaemonStatus, {
    sessionId,
    machineId,
    connected: true,
  });
}

describe('Phase E — pending task after agent restart', () => {
  test('released pending task has slim snapshot and operational projection after restart', async () => {
    const { sessionId } = await createTestSession('phase-e-restart');
    const machineId = 'machine-phase-e-restart';
    await registerMachineWithCursorSdk(sessionId, machineId);
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder', {
      agentHarness: 'cursor-sdk',
    });
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 42_424,
    });

    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Phase E task before restart',
      createdBy: 'user',
    });
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });
    await t.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });

    await t.mutation(api.machines.recordAgentExited, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 42_424,
      stopReason: 'user.stop',
    });

    const taskAfterExit = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(taskAfterExit?.status).toBe('pending');

    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'restart-agent',
      payload: {
        chatroomId,
        role: 'builder',
        model: TEST_MODEL_CURSOR_SDK,
        agentHarness: 'cursor-sdk',
        workingDir: '/tmp/project',
        wantResume: true,
      },
    });

    await syncMachineSnapshots(sessionId, machineId);
    const { tasks } = await t.query(api.machines.listMachineAssignedTaskSnapshots, {
      sessionId,
      machineId,
    });
    const snap = tasks.find((row) => row.taskId === taskId);
    expect(snap).toBeDefined();
    expect(snap!.status).toBe('pending');
    expect(snap!.agentConfig.spawnedAgentPid).toBeUndefined();
    expect(snap!.agentConfig).not.toHaveProperty('desiredState');

    const op = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_agentRoleOperationalStatus')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'builder'))
        .first()
    );
    expect(op?.operationalState).toMatch(/starting|running/);
  });

  test('startAgent refreshes delivery config on pending snapshot without task transition', async () => {
    const { sessionId } = await createTestSession('phase-e-start-config');
    const machineId = 'machine-phase-e-start';
    await registerMachineWithCursorSdk(sessionId, machineId);
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder', {
      agentHarness: 'cursor-sdk',
      model: 'old-model',
    });

    await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Pending only — no claim',
      createdBy: 'user',
    });
    await syncMachineSnapshots(sessionId, machineId);

    await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      const user = await ctx.db.query('users').first();
      return startAgent(
        ctx,
        {
          machineId,
          chatroomId,
          role: 'builder',
          userId: user!._id,
          model: 'updated-model',
          agentHarness: 'cursor-sdk',
          workingDir: '/updated/wd',
          reason: 'test',
        },
        machine!
      );
    });

    await syncMachineSnapshots(sessionId, machineId);
    const { tasks } = await t.query(api.machines.listMachineAssignedTaskSnapshots, {
      sessionId,
      machineId,
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.agentConfig.model).toBe('updated-model');
    expect(tasks[0]!.agentConfig.workingDir).toBe('/updated/wd');
    expect(tasks[0]!.agentConfig.spawnedAgentPid).toBeUndefined();
    expect(tasks[0]!.agentConfig).not.toHaveProperty('desiredState');

    const op = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_agentRoleOperationalStatus')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'builder'))
        .first()
    );
    expect(op).toBeDefined();
  });
});
