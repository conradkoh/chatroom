import { describe, expect, test } from 'vitest';

import { syncBuilderTeamAgentConfigFromCoordinator } from './sync-builder-team-agent-config';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';
import {
  createDuoTeamChatroom,
  createSoloTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../../../../tests/helpers/integration';

describe('syncBuilderTeamAgentConfigFromCoordinator', () => {
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
      syncBuilderTeamAgentConfigFromCoordinator(ctx, {
        chatroomId,
        teamId: 'duo',
        coordinatorRole: 'planner',
      })
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

  test('returns null when coordinator config is incomplete', async () => {
    const { sessionId } = await createTestSession('sync-builder-2');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'sync-builder-machine-2';
    await registerMachineWithDaemon(sessionId, machineId);

    // No planner config inserted — should be a no-op
    const result = await t.run((ctx) =>
      syncBuilderTeamAgentConfigFromCoordinator(ctx, {
        chatroomId,
        teamId: 'duo',
        coordinatorRole: 'planner',
      })
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
    await t.run((ctx) =>
      syncBuilderTeamAgentConfigFromCoordinator(ctx, {
        chatroomId,
        teamId: 'duo',
        coordinatorRole: 'planner',
      })
    );

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
      syncBuilderTeamAgentConfigFromCoordinator(ctx, {
        chatroomId,
        teamId: 'duo',
        coordinatorRole: 'planner',
      })
    );
    expect(result?.lifecycleRevision).toBe(7);
  });

  test('copies solo config fields to builder config', async () => {
    const { sessionId } = await createTestSession('sync-builder-solo');
    const chatroomId = await createSoloTeamChatroom(sessionId);
    const machineId = 'sync-builder-machine-solo';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'solo', 'solo'),
        chatroomId,
        role: 'solo',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'solo-model',
        workingDir: '/workspace/solo',
        enabled: true,
        desiredState: 'running',
        lifecycleRevision: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.run((ctx) =>
      syncBuilderTeamAgentConfigFromCoordinator(ctx, {
        chatroomId,
        teamId: 'solo',
        coordinatorRole: 'solo',
      })
    );

    expect(result).not.toBeNull();
    expect(result?.role).toBe('builder');
    expect(result?.machineId).toBe(machineId);
    expect(result?.model).toBe('solo-model');
    expect(result?.workingDir).toBe('/workspace/solo');

    const builderRow = await t.run((ctx) =>
      ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'solo', 'builder'))
        )
        .first()
    );
    expect(builderRow?.machineId).toBe(machineId);
    expect(builderRow?.model).toBe('solo-model');
    expect(builderRow?.workingDir).toBe('/workspace/solo');
  });
});
