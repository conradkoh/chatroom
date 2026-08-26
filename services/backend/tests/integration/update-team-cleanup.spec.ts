/**
 * Update Team — Integration Tests
 *
 * Verifies the team switch lifecycle:
 * 1. Team agent configs are deleted (platform-owned, recreated on restart)
 * 2. Stop events are dispatched for running agents
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createTestSession,
  registerMachineWithDaemon,
  seedRunningAgentPid,
  setupRemoteAgentConfig,
} from '../helpers/integration';
import {
  getStopScopeCommandsForChatroom,
  getInboxCommandsForChatroom,
} from '../helpers/machine-command-inbox';

function createThreeRoleChatroom(sessionId: string) {
  return t.mutation(api.chatrooms.create, {
    sessionId: sessionId as any,
    teamId: 'custom',
    teamName: 'Custom Three-Role Team',
    teamRoles: ['planner', 'builder', 'architect'],
    teamEntryPoint: 'planner',
  });
}

// ─── teamAgentConfigs lifecycle ───────────────────────────────────────────────

describe('updateTeam — teamAgentConfigs', () => {
  test('preserves outgoing configs and seeds target-team rows on team switch', async () => {
    const { sessionId } = await createTestSession('test-ut-tac-1');
    const machineId = 'machine-ut-tac-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createThreeRoleChatroom(sessionId);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');

    await t.mutation(api.chatrooms.updateTeam, {
      sessionId: sessionId as any,
      chatroomId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });

    const teamConfigs = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });

    expect(teamConfigs.length).toBeGreaterThanOrEqual(2);
    const duoPlannerKey = `chatroom_${chatroomId}#team_duo#role_planner`;
    expect(teamConfigs.some((c) => c.teamRoleKey === duoPlannerKey)).toBe(true);
  });
});

// ─── Stop events dispatched ──────────────────────────────────────────────────

describe('updateTeam — stop events', () => {
  test('dispatches stop events for running agents from teamAgentConfigs', async () => {
    const { sessionId } = await createTestSession('test-ut-stop-1');
    const machineId = 'machine-ut-stop-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createThreeRoleChatroom(sessionId);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');
    await seedRunningAgentPid(sessionId as any, chatroomId, machineId, 'planner', 50101);
    await seedRunningAgentPid(sessionId as any, chatroomId, machineId, 'builder', 50102);

    await t.mutation(api.chatrooms.updateTeam, {
      sessionId: sessionId as any,
      chatroomId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });

    const stopRows = await getStopScopeCommandsForChatroom(chatroomId);
    const teamSwitchStops = stopRows.filter(
      (row) =>
        row.command.type === 'agent.stopScope' && row.command.reason === 'platform.team_switch'
    );
    expect(teamSwitchStops.length).toBeGreaterThanOrEqual(1);
    const stopCommandId =
      teamSwitchStops[0]?.command.type === 'agent.stopScope'
        ? teamSwitchStops[0].command.stopCommandId
        : undefined;
    if (stopCommandId) {
      const targetCount = await t.run(
        async (ctx) =>
          (
            await ctx.db
              .query('chatroom_agentStopTargets')
              .withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', stopCommandId))
              .collect()
          ).length
      );
      expect(targetCount).toBeGreaterThanOrEqual(2);
    }
  });
});

// ─── Start events dispatched ─────────────────────────────────────────────────

describe('updateTeam — start events', () => {
  test('dispatches start events for target-team roles with configs', async () => {
    const { sessionId } = await createTestSession('test-ut-start-1');
    const machineId = 'machine-ut-start-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createThreeRoleChatroom(sessionId);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    await t.mutation(api.chatrooms.updateTeam, {
      sessionId: sessionId as any,
      chatroomId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });

    const inboxStarts = await getInboxCommandsForChatroom(chatroomId, 'agent.requestStart');
    const teamSwitchStarts = inboxStarts.filter(
      (row) =>
        row.command.type === 'agent.requestStart' && row.command.reason === 'platform.team_switch'
    );
    expect(teamSwitchStarts.length).toBeGreaterThanOrEqual(2);

    const duoPlannerKey = `chatroom_${chatroomId}#team_duo#role_planner`;
    const duoBuilderKey = `chatroom_${chatroomId}#team_duo#role_builder`;
    const configs = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });

    const duoPlanner = configs.find((c) => c.teamRoleKey === duoPlannerKey);
    const duoBuilder = configs.find((c) => c.teamRoleKey === duoBuilderKey);
    expect(duoPlanner?.desiredState).toBe('running');
    expect(duoBuilder?.desiredState).toBe('running');
  });
});

// ─── Chatroom team fields updated ─────────────────────────────────────────────

describe('updateTeam — chatroom fields', () => {
  test('updates teamId, teamName, teamRoles, teamEntryPoint', async () => {
    const { sessionId } = await createTestSession('test-ut-fields-1');
    const chatroomId = await createThreeRoleChatroom(sessionId);

    await t.mutation(api.chatrooms.updateTeam, {
      sessionId: sessionId as any,
      chatroomId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });

    const room = await t.run(async (ctx) => {
      return ctx.db.get('chatroom_rooms', chatroomId);
    });

    expect(room?.teamId).toBe('duo');
    expect(room?.teamName).toBe('Duo Team');
    expect(room?.teamRoles).toEqual(['planner', 'builder']);
    expect(room?.teamEntryPoint).toBe('planner');
  });
});

// ─── Active tasks reassigned end-to-end (race-safety) ─────────────────────────

describe('updateTeam — active task reassignment (end-to-end)', () => {
  test('moves ALL active tasks (pending/acknowledged/in_progress) on a removed role to pending under the new entry point', async () => {
    const { sessionId } = await createTestSession('test-ut-tasks-1');
    const chatroomId = await createThreeRoleChatroom(sessionId); // entry 'planner', roles planner/builder/architect

    // Seed one task per active status, all assigned to 'architect' (a role removed on switch).
    const now = Date.now();
    const taskIds = await t.run(async (ctx) => {
      const pendingId = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'pending architect task',
        status: 'pending',
        assignedTo: 'architect',
        queuePosition: 0,
        createdAt: now,
        updatedAt: now,
      });
      const ackId = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'acknowledged architect task',
        status: 'acknowledged',
        assignedTo: 'architect',
        acknowledgedAt: now,
        queuePosition: 1,
        createdAt: now,
        updatedAt: now,
      });
      const inProgressId = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'in-progress architect task',
        status: 'in_progress',
        assignedTo: 'architect',
        acknowledgedAt: now,
        startedAt: now,
        queuePosition: 2,
        createdAt: now,
        updatedAt: now,
      });
      return { pendingId, ackId, inProgressId };
    });

    // Switch to a team WITHOUT 'architect', with a different entry point ('builder').
    await t.mutation(api.chatrooms.updateTeam, {
      sessionId: sessionId as any,
      chatroomId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'builder',
    });

    const tasks = await t.run(async (ctx) => {
      return Promise.all([
        ctx.db.get('chatroom_tasks', taskIds.pendingId),
        ctx.db.get('chatroom_tasks', taskIds.ackId),
        ctx.db.get('chatroom_tasks', taskIds.inProgressId),
      ]);
    });

    // No task is left on the removed 'architect' role; all are pending under the new entry point.
    for (const task of tasks) {
      expect(task?.status).toBe('pending');
      expect(task?.assignedTo).toBe('builder');
    }
  });
});
