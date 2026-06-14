/**
 * Integration tests: restart offline remote agents when a user sends a message.
 */

import { expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
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
      await ctx.db.patch(config._id, { desiredState: 'running' });
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

test('does not restart when desiredState=stopped', async () => {
  const { sessionId } = await createTestSession('offline-restart-c');
  const chatroomId = await createDuoTeamChatroom(sessionId);
  const machineId = 'machine-offline-restart-c';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  // Set the config to desiredState=stopped and participant to exited
  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
      )
      .first();
    if (config) {
      await ctx.db.patch(config._id, { desiredState: 'stopped' });
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
        lastDesiredState: 'stopped',
      });
    }
  });

  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content: 'Hello stopped agent',
    type: 'message',
  });

  const restartEvents = await findOfflineRestartEvents(chatroomId);
  expect(restartEvents).toHaveLength(0);
});

test('does not restart when circuit open', async () => {
  const { sessionId } = await createTestSession('offline-restart-d');
  const chatroomId = await createDuoTeamChatroom(sessionId);
  const machineId = 'machine-offline-restart-d';
  await registerMachineWithDaemon(sessionId, machineId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

  // Set the config to circuitState=open
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
  expect(restartEvents).toHaveLength(0);
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
