import { describe, expect, test } from 'vitest';

import { syncBuilderTeamAgentConfigFromPlanner } from './sync-builder-team-agent-config';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../../../../tests/helpers/integration';

describe('syncBuilderTeamAgentConfigFromPlanner', () => {
  test('copies planner config fields to builder config', async () => {
    const { sessionId } = await createTestSession('sync-builder-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'sync-builder-machine-1';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'planner'),
        chatroomId,
        role: 'planner',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'test-model',
        workingDir: '/workspace/planner',
        enabled: true,
        desiredState: 'running',
        lifecycleRevision: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.run((ctx) =>
      syncBuilderTeamAgentConfigFromPlanner(ctx, { chatroomId, teamId: 'duo' })
    );

    expect(result).not.toBeNull();
    expect(result?.role).toBe('builder');
    expect(result?.machineId).toBe(machineId);
    expect(result?.agentHarness).toBe('opencode');
    expect(result?.model).toBe('test-model');
    expect(result?.workingDir).toBe('/workspace/planner');
    expect(result?.enabled).toBe(true);
    expect(result?.desiredState).toBe('running');
    expect(result?.wantResume).toBe(false);
  });

  test('returns null when planner config is incomplete', async () => {
    const { sessionId } = await createTestSession('sync-builder-2');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'sync-builder-machine-2';
    await registerMachineWithDaemon(sessionId, machineId);

    // No planner config inserted — should be a no-op
    const result = await t.run((ctx) =>
      syncBuilderTeamAgentConfigFromPlanner(ctx, { chatroomId, teamId: 'duo' })
    );
    expect(result).toBeNull();
  });

  test('preserves existing lifecycleRevision on upsert', async () => {
    const { sessionId } = await createTestSession('sync-builder-3');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'sync-builder-machine-3';
    await registerMachineWithDaemon(sessionId, machineId);

    // Insert planner config
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'planner'),
        chatroomId,
        role: 'planner',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'test-model',
        workingDir: '/workspace/planner',
        enabled: true,
        desiredState: 'running',
        lifecycleRevision: 5,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // First sync — creates builder config with lifecycleRevision 0 (from existing)
    await t.run((ctx) => syncBuilderTeamAgentConfigFromPlanner(ctx, { chatroomId, teamId: 'duo' }));

    // Bump lifecycleRevision manually to simulate a start intent
    await t.run(async (ctx) => {
      const builderKey = buildTeamRoleKey(chatroomId, 'duo', 'builder');
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', builderKey))
        .first();
      if (config) await ctx.db.patch(config._id, { lifecycleRevision: 7 });
    });

    // Second sync — should preserve lifecycleRevision: 7
    const result = await t.run((ctx) =>
      syncBuilderTeamAgentConfigFromPlanner(ctx, { chatroomId, teamId: 'duo' })
    );
    expect(result?.lifecycleRevision).toBe(7);
  });
});
