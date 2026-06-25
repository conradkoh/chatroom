/**
 * Participant Status Tracking — Integration Tests
 *
 * Verifies that lastStatus and lastDesiredState on participant records
 * are correctly patched as agents move through their lifecycle.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { startAgent } from '../../src/domain/usecase/agent/start-agent';
import { stopAgent } from '../../src/domain/usecase/agent/stop-agent';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  registerMachineWithDaemon,
  joinParticipant,
  setupRemoteAgentConfig,
} from '../helpers/integration';

async function getParticipantStatus(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return t.run(async (ctx) => {
    const p = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .unique();
    return {
      lastStatus: p?.lastStatus ?? null,
      lastDesiredState: p?.lastDesiredState ?? null,
    };
  });
}

async function getEventStreamTypes(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return t.run(async (ctx) => {
    const events = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
    return events.filter((e) => e.role === role).map((e) => e.type);
  });
}

async function createAcknowledgedTask(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
) {
  const { taskId } = await t.mutation(api.tasks.createTask, {
    sessionId,
    chatroomId,
    content: 'Native lifecycle test task',
    createdBy: 'user',
  });

  await t.mutation(api.tasks.claimTask, {
    sessionId,
    chatroomId,
    role,
    taskId,
  });

  return taskId;
}

describe('Participant Status Tracking', () => {
  test('agent.registered via recordRemoteAgentRegistered', async () => {
    const { sessionId } = await createTestSession('test-pst-registered');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-pst-registered';
    await registerMachineWithDaemon(sessionId, machineId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.machines.recordRemoteAgentRegistered, {
      sessionId,
      chatroomId,
      role: 'builder',
      machineId,
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.registered');
  });

  test('agent.registered + lastDesiredState=running via saveTeamAgentConfig', async () => {
    const { sessionId } = await createTestSession('test-pst-save-config');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
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
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-pst-start';
    await registerMachineWithDaemon(sessionId, machineId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (!user) throw new Error('expected test user');
      if (!machine) throw new Error('expected test machine');

      return startAgent(
        ctx,
        {
          machineId,
          chatroomId,
          role: 'builder',
          userId: user._id,
          model: 'claude-sonnet-4',
          agentHarness: 'opencode',
          workingDir: '/test/workspace',
          reason: 'user.start',
        },
        machine
      );
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.requestStart');
    expect(status.lastDesiredState).toBe('running');
  });

  test('agent.started via updateSpawnedAgent', async () => {
    const { sessionId } = await createTestSession('test-pst-spawned');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
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
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
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

  test('agent.waiting via join with native:waiting', async () => {
    const { sessionId } = await createTestSession('test-pst-native-waiting');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:waiting',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.waiting');

    const eventTypes = await getEventStreamTypes(chatroomId, 'builder');
    expect(eventTypes).toContain('agent.waiting');
  });

  test('task.acknowledged via join with native:task-injected', async () => {
    const { sessionId } = await createTestSession('test-pst-native-injected');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    const taskId = await createAcknowledgedTask(sessionId, chatroomId, 'builder');

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:task-injected',
      taskId,
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('task.acknowledged');

    const eventTypes = await getEventStreamTypes(chatroomId, 'builder');
    expect(eventTypes.filter((type) => type === 'task.acknowledged').length).toBeGreaterThanOrEqual(
      1
    );
  });

  test('task.inProgress via updateTokenActivity when lastStatus is task.acknowledged', async () => {
    const { sessionId } = await createTestSession('test-pst-native-token-ack');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    const taskId = await createAcknowledgedTask(sessionId, chatroomId, 'builder');

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:task-injected',
      taskId,
    });

    await t.mutation(api.participants.updateTokenActivity, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('task.inProgress');

    const eventTypes = await getEventStreamTypes(chatroomId, 'builder');
    expect(eventTypes.filter((type) => type === 'task.inProgress')).toHaveLength(1);

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('in_progress');
  });

  test('native:waiting does not downgrade acknowledged task awaiting first token', async () => {
    const { sessionId } = await createTestSession('test-pst-native-waiting-guard');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    const taskId = await createAcknowledgedTask(sessionId, chatroomId, 'builder');

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:task-injected',
      taskId,
    });

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:waiting',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('task.acknowledged');
  });

  test('updateTokenActivity starts task when native:task-injected but lastStatus was agent.waiting', async () => {
    const { sessionId } = await createTestSession('test-pst-native-token-race');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    const taskId = await createAcknowledgedTask(sessionId, chatroomId, 'builder');

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:task-injected',
      taskId,
    });

    await t.run(async (ctx) => {
      const participant = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      if (participant) {
        await ctx.db.patch('chatroom_participants', participant._id, {
          lastStatus: 'agent.waiting',
        });
      }
    });

    await t.mutation(api.participants.updateTokenActivity, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('task.inProgress');

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('in_progress');
  });

  test('updateTokenActivity starts task when get-next-task:stopped but lastStatus was agent.waiting', async () => {
    const { sessionId } = await createTestSession('test-pst-cli-token-race');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    const taskId = await createAcknowledgedTask(sessionId, chatroomId, 'builder');

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'get-next-task:stopped',
      taskId,
    });

    await t.run(async (ctx) => {
      const participant = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      if (participant) {
        await ctx.db.patch('chatroom_participants', participant._id, {
          lastStatus: 'agent.waiting',
        });
      }
    });

    await t.mutation(api.participants.updateTokenActivity, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('task.inProgress');

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('in_progress');
  });

  test('updateTokenActivity does not duplicate task.inProgress when already in progress', async () => {
    const { sessionId } = await createTestSession('test-pst-native-token-dedup');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    const taskId = await createAcknowledgedTask(sessionId, chatroomId, 'builder');

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:task-injected',
      taskId,
    });

    await t.mutation(api.participants.updateTokenActivity, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    await t.mutation(api.participants.updateTokenActivity, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('task.inProgress');

    const eventTypes = await getEventStreamTypes(chatroomId, 'builder');
    expect(eventTypes.filter((type) => type === 'task.inProgress')).toHaveLength(1);
  });

  test('task.acknowledged via claimTask', async () => {
    const { sessionId } = await createTestSession('test-pst-ack');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
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
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
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
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
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

  test('agent.exited + lastDesiredState=stopped via stop-agent use case (eager stop)', async () => {
    const { sessionId } = await createTestSession('test-pst-stop');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-pst-stop';
    await registerMachineWithDaemon(sessionId, machineId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      if (!user) throw new Error('expected test user');
      return stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'builder',
        userId: user._id,
        reason: 'user.stop',
      });
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    // stopAgent now transitions to 'agent.exited' eagerly (not 'agent.requestStop')
    expect(status.lastStatus).toBe('agent.exited');
    expect(status.lastDesiredState).toBe('stopped');
  });

  test('no-op when participant does not exist', async () => {
    const { sessionId } = await createTestSession('test-pst-noop');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-pst-noop';
    await registerMachineWithDaemon(sessionId, machineId);

    // recordRemoteAgentRegistered without joining as participant first
    await t.mutation(api.machines.recordRemoteAgentRegistered, {
      sessionId,
      chatroomId,
      role: 'builder',
      machineId,
    });

    // No participant should exist, so no crash
    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBeNull();
  });

  test('full lifecycle: registered → start → spawned → waiting → ack → inProgress → exited → stop', async () => {
    const { sessionId } = await createTestSession('test-pst-lifecycle');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-pst-lifecycle';
    await registerMachineWithDaemon(sessionId, machineId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    // 1. Register
    await t.mutation(api.machines.recordRemoteAgentRegistered, {
      sessionId,
      chatroomId,
      role: 'builder',
      machineId,
    });
    expect((await getParticipantStatus(chatroomId, 'builder')).lastStatus).toBe('agent.registered');

    // 2. Start agent
    await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (!user) throw new Error('expected test user');
      if (!machine) throw new Error('expected test machine');
      return startAgent(
        ctx,
        {
          machineId,
          chatroomId,
          role: 'builder',
          userId: user._id,
          model: 'claude-sonnet-4',
          agentHarness: 'opencode',
          workingDir: '/test/workspace',
          reason: 'user.start',
        },
        machine
      );
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
    expect((await getParticipantStatus(chatroomId, 'builder')).lastStatus).toBe(
      'task.acknowledged'
    );

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
      if (!user) throw new Error('expected test user');
      return stopAgent(ctx, {
        machineId,
        chatroomId,
        role: 'builder',
        userId: user._id,
        reason: 'user.stop',
      });
    });
    status = await getParticipantStatus(chatroomId, 'builder');
    // stopAgent now transitions to 'agent.exited' eagerly (not 'agent.requestStop')
    expect(status.lastStatus).toBe('agent.exited');
    expect(status.lastDesiredState).toBe('stopped');
  });

  test('emitSessionResumeRequested writes event stream row and updates lastStatus', async () => {
    const { sessionId } = await createTestSession('test-pst-session-resume-requested');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-pst-session-resume-requested';
    await registerMachineWithDaemon(sessionId, machineId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.mutation(api.machines.emitSessionResumeRequested, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      agentHarness: 'cursor-sdk',
      harnessSessionId: 'harness-sess-requested-xyz',
    });

    const events = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });

    const requested = events.filter((e) => e.type === 'agent.sessionResumeRequested');
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatchObject({
      agentHarness: 'cursor-sdk',
      harnessSessionId: 'harness-sess-requested-xyz',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.sessionResumeRequested');
  });

  test('emitSessionResumed writes event stream row and updates lastStatus', async () => {
    const { sessionId } = await createTestSession('test-pst-session-resumed');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-pst-session-resumed';
    await registerMachineWithDaemon(sessionId, machineId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.mutation(api.machines.emitSessionResumed, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
    });

    const events = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });

    const resumed = events.filter((e) => e.type === 'agent.sessionResumed');
    expect(resumed).toHaveLength(1);

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.sessionResumed');
  });

  test('emitSessionResumed persists harnessSessionId on event stream row', async () => {
    const { sessionId } = await createTestSession('test-pst-session-resumed-harness');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-pst-session-resumed-harness';
    await registerMachineWithDaemon(sessionId, machineId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.mutation(api.machines.emitSessionResumed, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      harnessSessionId: 'harness-sess-resumed-xyz',
    });

    const events = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });

    const resumed = events.filter((e) => e.type === 'agent.sessionResumed');
    expect(resumed).toHaveLength(1);
    expect(resumed[0].harnessSessionId).toBe('harness-sess-resumed-xyz');
  });

  test('emitSessionResumeFailed persists harnessSessionId on event stream row', async () => {
    const { sessionId } = await createTestSession('test-pst-session-resume-failed-harness');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-pst-session-resume-failed-harness';
    await registerMachineWithDaemon(sessionId, machineId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    await t.mutation(api.machines.emitSessionResumeFailed, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      reason: 'no session in daemon memory',
      harnessSessionId: 'harness-sess-failed-xyz',
    });

    const events = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });

    const failed = events.filter((e) => e.type === 'agent.sessionResumeFailed');
    expect(failed).toHaveLength(1);
    expect(failed[0].harnessSessionId).toBe('harness-sess-failed-xyz');
  });
});
