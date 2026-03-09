/**
 * Update Team Use Case — Unit Tests
 *
 * Tests the core updateTeam use case logic in isolation:
 * - Chatroom fields are updated
 * - Team configs are deleted
 * - Stop events dispatched for running team-config agents
 * - Stop events dispatched for running machine-config agents on stale roles
 * - Machine configs and preferences are NOT touched
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import { t } from '../../../../test.setup';
import {
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../../../../tests/helpers/integration';
import { updateTeam } from './update-team';

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

  test('preserves machineAgentConfigs (does not delete them)', async () => {
    const { sessionId } = await createTestSession('test-utu-preserve-1');
    const machineId = 'machine-utu-preserve-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createSquadChatroom(sessionId);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'reviewer');

    await t.run(async (ctx) => {
      return updateTeam(ctx, {
        chatroomId,
        teamId: 'duo',
        teamName: 'Duo Team',
        teamRoles: ['planner', 'builder'],
      });
    });

    const machineConfigs = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_machineAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    // Both planner and reviewer configs preserved (even reviewer which is stale)
    expect(machineConfigs).toHaveLength(2);
  });

  test('dispatches stop events for stale machineConfig agents with PIDs', async () => {
    const { sessionId } = await createTestSession('test-utu-stale-1');
    const machineId = 'machine-utu-stale-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createSquadChatroom(sessionId);

    // Start reviewer and give it a PID (simulating running process)
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'reviewer');
    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId: sessionId as any,
      machineId,
      chatroomId,
      role: 'reviewer',
      pid: 11111,
    });

    // Delete the team config manually to simulate an edge case
    // where teamConfig is gone but machineConfig still has a PID
    await t.run(async (ctx) => {
      const configs = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'reviewer')
        )
        .collect();
      for (const c of configs) await ctx.db.delete(c._id);
    });

    const result = await t.run(async (ctx) => {
      return updateTeam(ctx, {
        chatroomId,
        teamId: 'duo',
        teamName: 'Duo Team',
        teamRoles: ['planner', 'builder'],
      });
    });

    // Should still dispatch a stop event for the reviewer via machineConfig path
    expect(result.stoppedAgentCount).toBeGreaterThanOrEqual(1);

    const stopEvents = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom_type', (q) =>
          q.eq('chatroomId', chatroomId).eq('type', 'agent.requestStop')
        )
        .collect();
    });

    const reviewerStops = stopEvents.filter(
      (e) => 'role' in e && e.role === 'reviewer' && 'reason' in e && e.reason === 'platform.team_switch'
    );
    expect(reviewerStops.length).toBeGreaterThanOrEqual(1);
  });
});
