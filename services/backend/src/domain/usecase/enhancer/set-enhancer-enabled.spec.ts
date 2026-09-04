import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';
import {
  createDuoTeamChatroom,
  createSoloTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../../../../tests/helpers/integration';

async function seedCompleteEnhancerRow(
  chatroomId: Parameters<typeof buildTeamRoleKey>[0],
  teamId: string,
  machineId: string,
  overrides?: { enabled?: boolean; model?: string; workingDir?: string }
): Promise<void> {
  await t.run(async (ctx) => {
    const teamRoleKey = buildTeamRoleKey(chatroomId, teamId, 'enhancer');
    const existing = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
      .first();
    const fields = {
      chatroomId,
      role: 'enhancer',
      type: 'remote' as const,
      machineId,
      agentHarness: 'opencode' as const,
      model: overrides?.model ?? 'test-model',
      workingDir: overrides?.workingDir ?? '/workspace/enhancer',
      enabled: overrides?.enabled ?? false,
      desiredState: 'stopped' as const,
      circuitState: 'closed' as const,
      lifecycleRevision: 2,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch('chatroom_teamAgentConfigs', existing._id, fields);
    } else {
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        ...fields,
        teamRoleKey,
        createdAt: Date.now(),
      });
    }
  });
}

describe('web.enhancer.setEnhancerEnabled', () => {
  test('enabling a complete enhancer row patches only enabled in duo chatroom', async () => {
    const { sessionId } = await createTestSession('set-enhancer-duo-enable');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'set-enhancer-duo-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'planner');
    await seedCompleteEnhancerRow(chatroomId, 'duo', machineId);

    const result = await t.mutation(api.web.enhancer.index.setEnhancerEnabled, {
      sessionId,
      chatroomId,
      enabled: true,
    });
    expect(result).toEqual({ success: true, enabled: true });

    const row = await t.run((ctx) =>
      ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'enhancer'))
        )
        .first()
    );
    expect(row?.enabled).toBe(true);
    expect(row?.machineId).toBe(machineId);
    expect(row?.model).toBe('test-model');
    expect(row?.agentHarness).toBe('opencode');
    expect(row?.workingDir).toBe('/workspace/enhancer');
    expect(row?.lifecycleRevision).toBe(2);
  });

  test('enabling a complete enhancer row patches only enabled in solo chatroom', async () => {
    const { sessionId } = await createTestSession('set-enhancer-solo-enable');
    const chatroomId = await createSoloTeamChatroom(sessionId);
    const machineId = 'set-enhancer-solo-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'solo');
    await seedCompleteEnhancerRow(chatroomId, 'solo', machineId);

    const result = await t.mutation(api.web.enhancer.index.setEnhancerEnabled, {
      sessionId,
      chatroomId,
      enabled: true,
    });
    expect(result).toEqual({ success: true, enabled: true });
  });

  test('rejects enabling with no or incomplete enhancer row', async () => {
    const { sessionId } = await createTestSession('set-enhancer-incomplete');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'set-enhancer-incomplete-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'planner');

    await expect(
      t.mutation(api.web.enhancer.index.setEnhancerEnabled, {
        sessionId,
        chatroomId,
        enabled: true,
      })
    ).rejects.toMatchObject({ data: { code: 'ENHANCER_CONFIG_INCOMPLETE' } });

    await seedCompleteEnhancerRow(chatroomId, 'duo', machineId, {
      model: '',
      workingDir: '/workspace/enhancer',
    });
    await expect(
      t.mutation(api.web.enhancer.index.setEnhancerEnabled, {
        sessionId,
        chatroomId,
        enabled: true,
      })
    ).rejects.toMatchObject({ data: { code: 'ENHANCER_CONFIG_INCOMPLETE' } });
  });

  test('disabling leaves other fields intact', async () => {
    const { sessionId } = await createTestSession('set-enhancer-disable');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'set-enhancer-disable-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'planner');
    await seedCompleteEnhancerRow(chatroomId, 'duo', machineId, { enabled: true });

    const result = await t.mutation(api.web.enhancer.index.setEnhancerEnabled, {
      sessionId,
      chatroomId,
      enabled: false,
    });
    expect(result).toEqual({ success: true, enabled: false });

    const row = await t.run((ctx) =>
      ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'enhancer'))
        )
        .first()
    );
    expect(row?.enabled).toBe(false);
    expect(row?.machineId).toBe(machineId);
    expect(row?.model).toBe('test-model');
    expect(row?.workingDir).toBe('/workspace/enhancer');
    expect(row?.lifecycleRevision).toBe(2);
  });
});
