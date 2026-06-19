/**
 * Integration tests: restart offline remote agents when a user sends a message.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createPlannerBuilderDuoChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

async function findOfflineRestartEvents(chatroomId: Id<'chatroom_rooms'>) {
  const events = await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });
  return events.filter(
    (e) =>
      e.type === 'agent.requestStart' &&
      (e as { reason?: string }).reason === 'platform.restart_offline_on_user_message'
  );
}

async function getPendingTasks(sessionId: SessionId, chatroomId: Id<'chatroom_rooms'>) {
  return t.query(api.tasks.listTasks, { sessionId, chatroomId, statusFilter: 'pending' });
}

test('restarts offline builder on user sendMessage', async () => {
  const { sessionId } = await createTestSession('offline-restart-a');
  const chatroomId = await createDuoTeamChatroom(sessionId);
  const machineId = 'machine-offline-restart-a';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  // Set the config to desiredState=running and set participant lastStatus to agent.exited
  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
      )
      .first();
    if (config) {
      await ctx.db.patch(config._id, { desiredState: 'running' });
    }

    const participant = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', 'builder')
      )
      .unique();
    if (participant) {
      await ctx.db.patch(participant._id, { lastStatus: 'agent.exited' });
    } else {
      await ctx.db.insert('chatroom_participants', {
        chatroomId,
        role: 'builder',
        agentType: 'remote',
        lastStatus: 'agent.exited',
        lastDesiredState: 'running',
      });
    }
  });

  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content: 'Hello offline agent',
    type: 'message',
  });

  const restartEvents = await findOfflineRestartEvents(chatroomId);
  expect(restartEvents).toHaveLength(1);
  expect(restartEvents[0].role).toBe('builder');
  expect(restartEvents[0].machineId).toBe(machineId);
  if (restartEvents[0].type === 'agent.requestStart') {
    expect(restartEvents[0].reason).toBe('platform.restart_offline_on_user_message');
  }
});

test('does not restart when agent is waiting', async () => {
  const { sessionId } = await createTestSession('offline-restart-b');
  const chatroomId = await createDuoTeamChatroom(sessionId);
  const machineId = 'machine-offline-restart-b';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  // Create a participant row with lastStatus=agent.waiting (online) so the use case skips restart
  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
      )
      .first();
    if (config) {
      await ctx.db.patch(config._id, { desiredState: 'running', spawnedAgentPid: 4242 });
    }

    const existing = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', 'builder')
      )
      .unique();
    if (!existing) {
      await ctx.db.insert('chatroom_participants', {
        chatroomId,
        role: 'builder',
        agentType: 'remote',
        lastStatus: 'agent.waiting',
        lastDesiredState: 'running',
      });
    } else {
      await ctx.db.patch(existing._id, { lastStatus: 'agent.waiting' });
    }
  });

  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content: 'Hello waiting agent',
    type: 'message',
  });

  const restartEvents = await findOfflineRestartEvents(chatroomId);
  expect(restartEvents).toHaveLength(0);
});

test('restarts when desiredState=stopped on user message (wake on message)', async () => {
  const { sessionId } = await createTestSession('offline-restart-stopped-wake');
  const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
  const machineId = 'machine-offline-restart-stopped-wake';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'planner');

  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'planner'))
      )
      .first();
    if (config) {
      await ctx.db.patch(config._id, {
        desiredState: 'stopped',
        spawnedAgentPid: undefined,
      });
    }
    const existing = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', 'planner')
      )
      .unique();
    const data = {
      lastStatus: 'agent.exited' as const,
      lastDesiredState: 'stopped' as const,
      lastSeenAction: 'exited' as const,
    };
    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert('chatroom_participants', {
        chatroomId,
        role: 'planner',
        agentType: 'remote',
        ...data,
      });
    }
  });

  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content: 'Wake after stop',
    type: 'message',
  });

  const restartEvents = await findOfflineRestartEvents(chatroomId);
  expect(restartEvents).toHaveLength(1);
  expect(restartEvents[0].role).toBe('planner');

  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'planner'))
      )
      .first();
    expect(config?.desiredState).toBe('running');
  });
});

test('restarts after agent.startFailed left desiredState=stopped', async () => {
  const { sessionId } = await createTestSession('offline-restart-startfailed');
  const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
  const machineId = 'machine-offline-restart-startfailed';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'planner');

  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'planner'))
      )
      .first();
    if (config) {
      await ctx.db.patch(config._id, {
        desiredState: 'stopped',
        agentHarness: 'pi',
        spawnedAgentPid: undefined,
      });
    }
    const existing = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', 'planner')
      )
      .unique();
    const data = {
      lastStatus: 'agent.startFailed' as const,
      lastDesiredState: 'stopped' as const,
    };
    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert('chatroom_participants', {
        chatroomId,
        role: 'planner',
        agentType: 'remote',
        ...data,
      });
    }
  });

  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content: 'Retry after start failed',
    type: 'message',
  });

  const restartEvents = await findOfflineRestartEvents(chatroomId);
  expect(restartEvents).toHaveLength(1);
  expect(restartEvents[0].role).toBe('planner');
});

test('does not restart when user message is queued behind active task', async () => {
  const { sessionId } = await createTestSession('offline-restart-queued');
  const chatroomId = await createDuoTeamChatroom(sessionId);
  const machineId = 'machine-offline-restart-queued';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content: 'First message',
    type: 'message',
  });

  await t.mutation(api.participants.join, {
    sessionId,
    chatroomId,
    role: 'builder',
    action: 'get-next-task:started',
  });
  await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
  await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });

  const restartEventsBefore = await findOfflineRestartEvents(chatroomId);
  const countBefore = restartEventsBefore.length;

  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
      )
      .first();
    if (config) {
      await ctx.db.patch(config._id, { spawnedAgentPid: undefined, spawnedAt: undefined });
    }
    const participant = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', 'builder')
      )
      .unique();
    if (participant) {
      await ctx.db.patch(participant._id, { lastStatus: 'agent.exited' });
    }
  });

  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content: 'Queued message',
    type: 'message',
  });

  const queued = await t.query(api.messages.listQueued, { sessionId, chatroomId });
  expect(queued).toHaveLength(1);

  const restartEventsAfter = await findOfflineRestartEvents(chatroomId);
  expect(restartEventsAfter).toHaveLength(countBefore);
});

test('restarts when circuit open on user message', async () => {
  const { sessionId } = await createTestSession('offline-restart-d');
  const chatroomId = await createDuoTeamChatroom(sessionId);
  const machineId = 'machine-offline-restart-d';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
      )
      .first();
    if (config) {
      await ctx.db.patch(config._id, { circuitState: 'open' });
    }

    const participant = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', 'builder')
      )
      .unique();
    if (participant) {
      await ctx.db.patch(participant._id, { lastStatus: 'agent.exited' });
    } else {
      await ctx.db.insert('chatroom_participants', {
        chatroomId,
        role: 'builder',
        agentType: 'remote',
        lastStatus: 'agent.exited',
        lastDesiredState: 'running',
      });
    }
  });

  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content: 'Hello circuit-open agent',
    type: 'message',
  });

  const restartEvents = await findOfflineRestartEvents(chatroomId);
  expect(restartEvents).toHaveLength(1);
  expect(restartEvents[0].role).toBe('builder');

  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
      )
      .first();
    expect(config?.circuitState).toBe('closed');
  });
});

test('restarts when lastStatus is agent.waiting but spawnedAgentPid is cleared (stale state)', async () => {
  const { sessionId } = await createTestSession('offline-restart-stale');
  const chatroomId = await createDuoTeamChatroom(sessionId);
  const machineId = 'machine-offline-restart-stale';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
      )
      .first();
    if (config) {
      await ctx.db.patch(config._id, {
        desiredState: 'running',
        spawnedAgentPid: undefined,
        spawnedAt: undefined,
      });
    }

    const participant = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', 'builder')
      )
      .unique();
    if (participant) {
      await ctx.db.patch(participant._id, {
        lastStatus: 'agent.waiting',
        lastDesiredState: 'running',
      });
    } else {
      await ctx.db.insert('chatroom_participants', {
        chatroomId,
        role: 'builder',
        agentType: 'remote',
        lastStatus: 'agent.waiting',
        lastDesiredState: 'running',
      });
    }
  });

  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content: 'Wake up stale agent',
    type: 'message',
  });

  const restartEvents = await findOfflineRestartEvents(chatroomId);
  expect(restartEvents).toHaveLength(1);
  expect(restartEvents[0].role).toBe('builder');
});

test('restarts offline planner on user sendMessage (production duo: planner entry point)', async () => {
  const { sessionId } = await createTestSession('offline-restart-planner');
  const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
  const machineId = 'machine-offline-restart-planner';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'planner');

  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'planner'))
      )
      .first();
    if (config) {
      await ctx.db.patch(config._id, {
        desiredState: 'running',
        spawnedAgentPid: undefined,
        spawnedAt: undefined,
      });
    }
    const existing = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', 'planner')
      )
      .unique();
    const participantData = {
      lastStatus: 'agent.waiting' as const,
      lastDesiredState: 'running' as const,
      lastSeenAction: 'exited' as const,
    };
    if (existing) {
      await ctx.db.patch(existing._id, participantData);
    } else {
      await ctx.db.insert('chatroom_participants', {
        chatroomId,
        role: 'planner',
        agentType: 'remote',
        ...participantData,
      });
    }
  });

  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content: 'Wake up planner',
    type: 'message',
  });

  const tasks = await getPendingTasks(sessionId, chatroomId);
  expect(tasks).toHaveLength(1);
  expect(tasks[0]?.assignedTo).toBe('planner');

  const restartEvents = await findOfflineRestartEvents(chatroomId);
  expect(restartEvents).toHaveLength(1);
  expect(restartEvents[0].role).toBe('planner');
  expect(restartEvents[0].machineId).toBe(machineId);
});

test('restarts when participant lastDesiredState is stale stopped but config desiredState is running', async () => {
  const { sessionId } = await createTestSession('offline-restart-desync');
  const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
  const machineId = 'machine-offline-restart-desync';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'planner');

  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'planner'))
      )
      .first();
    if (config) {
      await ctx.db.patch(config._id, {
        desiredState: 'running',
        spawnedAgentPid: undefined,
      });
    }
    const existing = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', 'planner')
      )
      .unique();
    const data = {
      lastStatus: 'agent.exited' as const,
      lastDesiredState: 'stopped' as const,
    };
    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert('chatroom_participants', {
        chatroomId,
        role: 'planner',
        agentType: 'remote',
        ...data,
      });
    }
  });

  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content: 'Restart despite stale participant state',
    type: 'message',
  });

  const restartEvents = await findOfflineRestartEvents(chatroomId);
  expect(restartEvents).toHaveLength(1);
  expect(restartEvents[0].role).toBe('planner');
});

test('restarts when lastStatus is task.inProgress but spawnedAgentPid is cleared', async () => {
  const { sessionId } = await createTestSession('offline-restart-inprogress');
  const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
  const machineId = 'machine-offline-restart-inprogress';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'planner');

  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'planner'))
      )
      .first();
    if (config) {
      await ctx.db.patch(config._id, {
        desiredState: 'running',
        spawnedAgentPid: undefined,
      });
    }
    const existing = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', 'planner')
      )
      .unique();
    const data = {
      lastStatus: 'task.inProgress' as const,
      lastDesiredState: 'running' as const,
    };
    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert('chatroom_participants', {
        chatroomId,
        role: 'planner',
        agentType: 'remote',
        ...data,
      });
    }
  });

  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content: 'Restart after crash mid-task',
    type: 'message',
  });

  const restartEvents = await findOfflineRestartEvents(chatroomId);
  expect(restartEvents).toHaveLength(1);
  expect(restartEvents[0].role).toBe('planner');
});

test('restartOfflineAgentsFromConfig mutation works standalone', async () => {
  const { sessionId } = await createTestSession('offline-restart-e');
  const chatroomId = await createDuoTeamChatroom(sessionId);
  const machineId = 'machine-offline-restart-e';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  // Set the config to desiredState=running and set participant lastStatus to agent.exited
  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
      )
      .first();
    if (config) {
      await ctx.db.patch(config._id, { desiredState: 'running' });
    }

    const participant = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', 'builder')
      )
      .unique();
    if (participant) {
      await ctx.db.patch(participant._id, { lastStatus: 'agent.exited' });
    } else {
      await ctx.db.insert('chatroom_participants', {
        chatroomId,
        role: 'builder',
        agentType: 'remote',
        lastStatus: 'agent.exited',
        lastDesiredState: 'running',
      });
    }
  });

  await t.mutation(api.machines.restartOfflineAgentsFromConfig, {
    sessionId,
    chatroomId,
  });

  const restartEvents = await findOfflineRestartEvents(chatroomId);
  expect(restartEvents).toHaveLength(1);
  expect(restartEvents[0].role).toBe('builder');
  expect(restartEvents[0].machineId).toBe(machineId);
  if (restartEvents[0].type === 'agent.requestStart') {
    expect(restartEvents[0].reason).toBe('platform.restart_offline_on_user_message');
  }
});
