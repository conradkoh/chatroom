/**
 * Update Team Use Case — Unit Tests
 *
 * Tests preserve/restore/seed behavior on team switch.
 */

import { describe, expect, test } from 'vitest';

import { updateTeam } from './update-team';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';
import {
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../../../../tests/helpers/integration';
import { TEST_MODEL_OPENCODE_LEGACY } from '../../../../tests/helpers/test-models';

function createThreeRoleChatroom(sessionId: string) {
  return t.mutation(api.chatrooms.create, {
    sessionId: sessionId as any,
    teamId: 'custom',
    teamName: 'Custom Three-Role Team',
    teamRoles: ['planner', 'builder', 'architect'],
    teamEntryPoint: 'planner',
  });
}

async function getOwnerUserId(chatroomId: Id<'chatroom_rooms'>) {
  return t.run(async (ctx) => {
    const room = await ctx.db.get('chatroom_rooms', chatroomId);
    return room!.ownerId;
  });
}

describe('updateTeam use case', () => {
  test('updates chatroom team fields', async () => {
    const { sessionId } = await createTestSession('test-utu-fields-1');
    const chatroomId = await createThreeRoleChatroom(sessionId);
    const userId = await getOwnerUserId(chatroomId);

    await t.run(async (ctx) => {
      return updateTeam(ctx, {
        chatroomId,
        teamId: 'duo',
        teamName: 'Duo Team',
        teamRoles: ['planner', 'builder'],
        teamEntryPoint: 'planner',
        userId,
      });
    });

    const room = await t.run(async (ctx) => ctx.db.get('chatroom_rooms', chatroomId));
    expect(room!.teamId).toBe('duo');
    expect(room!.teamName).toBe('Duo Team');
    expect(room!.teamRoles).toEqual(['planner', 'builder']);
  });

  test('preserves outgoing team configs instead of deleting them', async () => {
    const { sessionId } = await createTestSession('test-utu-preserve-1');
    const machineId = 'machine-utu-preserve-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createThreeRoleChatroom(sessionId);
    const userId = await getOwnerUserId(chatroomId);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    const result = await t.run(async (ctx) => {
      return updateTeam(ctx, {
        chatroomId,
        teamId: 'duo',
        teamName: 'Duo Team',
        teamRoles: ['planner', 'builder'],
        teamEntryPoint: 'planner',
        userId,
      });
    });

    expect(result.preservedCount).toBeGreaterThanOrEqual(2);

    const remaining = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });

    const customPlannerKey = buildTeamRoleKey(chatroomId, 'custom', 'planner');
    expect(remaining.some((c) => c.teamRoleKey === customPlannerKey)).toBe(true);
    expect(remaining.length).toBeGreaterThanOrEqual(2);
  });

  test('seeds missing target-team rows from outgoing entry-point machine', async () => {
    const { sessionId } = await createTestSession('test-utu-seed-1');
    const machineId = 'machine-utu-seed-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createThreeRoleChatroom(sessionId);
    const userId = await getOwnerUserId(chatroomId);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner', {
      workingDir: '/seed/workspace',
    });

    const result = await t.run(async (ctx) => {
      return updateTeam(ctx, {
        chatroomId,
        teamId: 'duo',
        teamName: 'Duo Team',
        teamRoles: ['planner', 'builder'],
        teamEntryPoint: 'planner',
        userId,
      });
    });

    expect(result.seededCount).toBeGreaterThanOrEqual(1);

    const duoBuilderKey = buildTeamRoleKey(chatroomId, 'duo', 'builder');
    const seeded = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', duoBuilderKey))
        .first();
    });

    expect(seeded?.machineId).toBe(machineId);
    expect(seeded?.model).toBe(TEST_MODEL_OPENCODE_LEGACY);
    expect(seeded?.workingDir).toBe('/seed/workspace');
  });

  test('restores existing target-team configs when switching back', async () => {
    const { sessionId } = await createTestSession('test-utu-restore-1');
    const machineId = 'machine-utu-restore-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createThreeRoleChatroom(sessionId);
    const userId = await getOwnerUserId(chatroomId);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');

    await t.run(async (ctx) => {
      return updateTeam(ctx, {
        chatroomId,
        teamId: 'duo',
        teamName: 'Duo Team',
        teamRoles: ['planner', 'builder'],
        teamEntryPoint: 'planner',
        userId,
      });
    });

    const duoPlannerKey = buildTeamRoleKey(chatroomId, 'duo', 'planner');
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', duoPlannerKey))
        .first();
      if (row) {
        await ctx.db.patch('chatroom_teamAgentConfigs', row._id, {
          model: 'restored-model',
          workingDir: '/restored/dir',
        });
      }
    });

    await t.run(async (ctx) => {
      return updateTeam(ctx, {
        chatroomId,
        teamId: 'custom',
        teamName: 'Custom Three-Role Team',
        teamRoles: ['planner', 'builder', 'architect'],
        teamEntryPoint: 'planner',
        userId,
      });
    });

    const restoreResult = await t.run(async (ctx) => {
      return updateTeam(ctx, {
        chatroomId,
        teamId: 'duo',
        teamName: 'Duo Team',
        teamRoles: ['planner', 'builder'],
        teamEntryPoint: 'planner',
        userId,
      });
    });

    expect(restoreResult.restoredCount).toBeGreaterThanOrEqual(1);

    const restored = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', duoPlannerKey))
        .first();
    });

    expect(restored?.model).toBe('restored-model');
    expect(restored?.workingDir).toBe('/restored/dir');
  });

  test('dispatches stop events for running agents and returns count', async () => {
    const { sessionId } = await createTestSession('test-utu-stop-1');
    const machineId = 'machine-utu-stop-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createThreeRoleChatroom(sessionId);
    const userId = await getOwnerUserId(chatroomId);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    const result = await t.run(async (ctx) => {
      return updateTeam(ctx, {
        chatroomId,
        teamId: 'duo',
        teamName: 'Duo Team',
        teamRoles: ['planner', 'builder'],
        teamEntryPoint: 'planner',
        userId,
      });
    });

    expect(result.stoppedAgentCount).toBeGreaterThanOrEqual(2);
  });
});
