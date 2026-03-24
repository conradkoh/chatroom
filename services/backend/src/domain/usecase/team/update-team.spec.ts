/**
 * Update Team Use Case — Unit Tests
 *
 * Tests the core updateTeam use case logic in isolation:
 * - Chatroom fields are updated
 * - Team configs are deleted
 * - Stop events dispatched for running team-config agents
 */

import { describe, expect, test } from 'vitest';

import { updateTeam } from './update-team';
import { api } from '../../../../convex/_generated/api';
import { t } from '../../../../test.setup';
import {
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../../../../tests/helpers/integration';

function createSquadChatroom(sessionId: string) {
  return t.mutation(api.chatrooms.create, {
    sessionId: sessionId as any,
    teamId: 'squad',
    teamName: 'Squad Team',
    teamRoles: ['planner', 'builder', 'reviewer'],
    teamEntryPoint: 'planner',
  });
}

describe('updateTeam use case', () => {
  test('updates chatroom team fields', async () => {
    const { sessionId } = await createTestSession('test-utu-fields-1');
    const chatroomId = await createSquadChatroom(sessionId);

    await t.run(async (ctx) => {
      return updateTeam(ctx, {
        chatroomId,
        teamId: 'duo',
        teamName: 'Duo Team',
        teamRoles: ['planner', 'builder'],
        teamEntryPoint: 'planner',
      });
    });

    const room = await t.run(async (ctx) => ctx.db.get('chatroom_rooms', chatroomId));
    expect(room!.teamId).toBe('duo');
    expect(room!.teamName).toBe('Duo Team');
    expect(room!.teamRoles).toEqual(['planner', 'builder']);
  });

  test('deletes all teamAgentConfigs', async () => {
    const { sessionId } = await createTestSession('test-utu-delete-1');
    const machineId = 'machine-utu-delete-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createSquadChatroom(sessionId);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    const result = await t.run(async (ctx) => {
      return updateTeam(ctx, {
        chatroomId,
        teamId: 'duo',
        teamName: 'Duo Team',
        teamRoles: ['planner', 'builder'],
      });
    });

    expect(result.deletedTeamConfigCount).toBe(2);

    const remaining = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    expect(remaining).toHaveLength(0);
  });

  test('dispatches stop events for running agents and returns count', async () => {
    const { sessionId } = await createTestSession('test-utu-stop-1');
    const machineId = 'machine-utu-stop-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createSquadChatroom(sessionId);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    const result = await t.run(async (ctx) => {
      return updateTeam(ctx, {
        chatroomId,
        teamId: 'duo',
        teamName: 'Duo Team',
        teamRoles: ['planner', 'builder'],
      });
    });

    // Both planner and builder had desiredState=running
    expect(result.stoppedAgentCount).toBeGreaterThanOrEqual(2);
  });

  test('clears spawnedAgentPid on old-team configs during team switch', async () => {
    const { sessionId } = await createTestSession('test-utu-pid-clear-1');
    const machineId = 'machine-utu-pid-clear-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createSquadChatroom(sessionId);

    // Set up agent config and simulate a running agent by setting spawnedAgentPid
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    // Directly patch the config to have a spawnedAgentPid (simulating daemon updateSpawnedAgent)
    await t.run(async (ctx) => {
      const configs = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
      const builderConfig = configs.find((c) => c.role === 'builder');
      if (builderConfig) {
        await ctx.db.patch('chatroom_teamAgentConfigs', builderConfig._id, {
          spawnedAgentPid: 12345,
          spawnedAt: Date.now(),
        });
      }
    });

    // Switch team — should clear PID and delete the config
    const result = await t.run(async (ctx) => {
      return updateTeam(ctx, {
        chatroomId,
        teamId: 'duo',
        teamName: 'Duo Team',
        teamRoles: ['planner', 'builder'],
      });
    });

    // Config should be deleted (PID cleared first, then deleted)
    expect(result.deletedTeamConfigCount).toBeGreaterThanOrEqual(1);

    // No configs should remain
    const remaining = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    expect(remaining).toHaveLength(0);
  });
});
