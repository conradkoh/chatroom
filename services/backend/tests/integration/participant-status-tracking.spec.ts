/**
 * Participant Status Tracking — Integration Tests
 *
 * Verifies that lastStatus and lastDesiredState on participant records
 * are correctly patched as agents move through their lifecycle.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { startAgent } from '../../src/domain/usecase/agent/start-agent';
import { stopAgent } from '../../src/domain/usecase/agent/stop-agent';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
  joinParticipant,
  setupRemoteAgentConfig,
} from '../helpers/integration';
import type { Id } from '../../convex/_generated/dataModel';

async function getParticipantStatus(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return t.run(async (ctx) => {
    const p = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', role)
      )
      .unique();
    return {
      lastStatus: p?.lastStatus ?? null,
      lastDesiredState: p?.lastDesiredState ?? null,
    };
  });
}

describe('Participant Status Tracking', () => {
  test('agent.registered via recordAgentRegistered', async () => {
    const { sessionId } = await createTestSession('test-pst-registered');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.machines.recordAgentRegistered, {
      sessionId,
      chatroomId,
      role: 'builder',
      agentType: 'remote',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.registered');
  });

  test('agent.registered + lastDesiredState=running via saveTeamAgentConfig', async () => {
    const { sessionId } = await createTestSession('test-pst-save-config');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-pst-save-config';
    await registerMachineWithDaemon(sessionId, machineId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: 'opencode',
      model: 'claude-sonnet-4',
      workingDir: '/test/workspace',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.registered');
    expect(status.lastDesiredState).toBe('running');
  });

  test('agent.requestStart + lastDesiredState=running via start-agent use case', async () => {
    const { sessionId } = await createTestSession('test-pst-start');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-pst-start';
    await registerMachineWithDaemon(sessionId, machineId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();

      return startAgent(
        ctx,
        {
          machineId,
          chatroomId,
          role: 'builder',
          userId: user!._id,
          model: 'claude-sonnet-4',
          agentHarness: 'opencode',
          workingDir: '/test/workspace',
          reason: 'user.start',
        },
        machine!,
      );
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.requestStart');
    expect(status.lastDesiredState).toBe('running');
  });

  test('agent.started via updateSpawnedAgent', async () => {
    const { sessionId } = await createTestSession('test-pst-spawned');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-pst-spawned';
    await registerMachineWithDaemon(sessionId, machineId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 12345,
      model: 'claude-sonnet-4',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.started');
  });

  test('agent.waiting via join with get-next-task:started', async () => {
    const { sessionId } = await createTestSession('test-pst-waiting');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'get-next-task:started',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.waiting');
  });

  test('task.acknowledged via claimTask', async () => {
    const { sessionId } = await createTestSession('test-pst-ack');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Test task for ack',
      createdBy: 'user',
    });

    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('task.acknowledged');
  });

  test('task.inProgress via startTask', async () => {
    const { sessionId } = await createTestSession('test-pst-inprog');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Test task for in_progress',
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

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('task.inProgress');
  });

  test('agent.exited via recordAgentExited', async () => {
    const { sessionId } = await createTestSession('test-pst-exited');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-pst-exited';
    await registerMachineWithDaemon(sessionId, machineId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 12345,
      model: 'claude-sonnet-4',
    });

    await t.mutation(api.machines.recordAgentExited, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 12345,
      stopReason: 'user.stop',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.exited');
  });

  test('agent.requestStop + lastDesiredState=stopped via stop-agent use case', async () => {
    const { sessionId } = await createTestSession('test-pst-stop');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-pst-stop';
    await registerMachineWithDaemon(sessionId, machineId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      return stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'builder',
        userId: user!._id,
        reason: 'user.stop',
      });
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.requestStop');
    expect(status.lastDesiredState).toBe('stopped');
  });

  test('no-op when participant does not exist', async () => {
    const { sessionId } = await createTestSession('test-pst-noop');
    const chatroomId = await createPairTeamChatroom(sessionId);

    // recordAgentRegistered without joining as participant first
    await t.mutation(api.machines.recordAgentRegistered, {
      sessionId,
      chatroomId,
      role: 'builder',
      agentType: 'remote',
    });

    // No participant should exist, so no crash
    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBeNull();
  });

  test('full lifecycle: registered → start → spawned → waiting → ack → inProgress → exited → stop', async () => {
    const { sessionId } = await createTestSession('test-pst-lifecycle');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-pst-lifecycle';
    await registerMachineWithDaemon(sessionId, machineId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    // 1. Register
    await t.mutation(api.machines.recordAgentRegistered, {
      sessionId,
      chatroomId,
      role: 'builder',
      agentType: 'remote',
    });
    expect((await getParticipantStatus(chatroomId, 'builder')).lastStatus).toBe('agent.registered');

    // 2. Start agent
    await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return startAgent(ctx, {
        machineId,
        chatroomId,
        role: 'builder',
        userId: user!._id,
        model: 'claude-sonnet-4',
        agentHarness: 'opencode',
        workingDir: '/test/workspace',
        reason: 'user.start',
      }, machine!);
    });
    let status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.requestStart');
    expect(status.lastDesiredState).toBe('running');

    // 3. Agent spawned
    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 99999,
      model: 'claude-sonnet-4',
    });
    expect((await getParticipantStatus(chatroomId, 'builder')).lastStatus).toBe('agent.started');

    // 4. Agent waiting
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'get-next-task:started',
    });
    expect((await getParticipantStatus(chatroomId, 'builder')).lastStatus).toBe('agent.waiting');

    // 5. Create task and claim (acknowledge)
    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Lifecycle test task',
      createdBy: 'user',
    });

    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });
    expect((await getParticipantStatus(chatroomId, 'builder')).lastStatus).toBe('task.acknowledged');

    // 6. Start task (in progress)
    await t.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });
    expect((await getParticipantStatus(chatroomId, 'builder')).lastStatus).toBe('task.inProgress');

    // 7. Agent exited
    await t.mutation(api.machines.recordAgentExited, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 99999,
      stopReason: 'user.stop',
    });
    expect((await getParticipantStatus(chatroomId, 'builder')).lastStatus).toBe('agent.exited');

    // 8. Stop agent → lastDesiredState = stopped
    await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      return stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'builder',
        userId: user!._id,
        reason: 'user.stop',
      });
    });
    status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.requestStop');
    expect(status.lastDesiredState).toBe('stopped');
  });
});
