import { describe, expect, test } from 'vitest';

import { configureTeamAgentRole } from './configure-team-agent-role';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../../../../tests/helpers/integration';

describe('configureTeamAgentRole', () => {
  test('creates new ephemeral role row with desiredState stopped', async () => {
    const { sessionId } = await createTestSession('configure-role-new');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'configure-role-machine-new';
    await registerMachineWithDaemon(sessionId, machineId);

    const ownerId = await t.run(async (ctx) => {
      const room = await ctx.db.get('chatroom_rooms', chatroomId);
      return room!.ownerId;
    });

    const saved = await t.run((ctx) =>
      configureTeamAgentRole(ctx, {
        chatroomId,
        userId: ownerId,
        role: 'builder',
        machineId,
        agentHarness: 'opencode',
        model: 'test-model',
        workingDir: '/workspace/builder',
      })
    );

    expect(saved.role).toBe('builder');
    expect(saved.machineId).toBe(machineId);
    expect(saved.agentHarness).toBe('opencode');
    expect(saved.model).toBe('test-model');
    expect(saved.workingDir).toBe('/workspace/builder');
    expect(saved.enabled).toBe(true);
    expect(saved.desiredState).toBe('stopped');
    expect(saved.lifecycleRevision).toBe(0);
    expect(saved.circuitState).toBe('closed');
  });

  test('preserves existing runtime state on update', async () => {
    const { sessionId } = await createTestSession('configure-role-preserve');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'configure-role-machine-preserve';
    const newMachineId = 'configure-role-machine-preserve-2';
    await registerMachineWithDaemon(sessionId, machineId);
    await registerMachineWithDaemon(sessionId, newMachineId);

    const ownerId = await t.run(async (ctx) => {
      const room = await ctx.db.get('chatroom_rooms', chatroomId);
      return room!.ownerId;
    });

    const createdAt = Date.now() - 60_000;
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'builder'),
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'old-model',
        workingDir: '/old/dir',
        enabled: false,
        desiredState: 'running',
        circuitState: 'open',
        lifecycleRevision: 7,
        createdAt,
        updatedAt: createdAt,
      });
    });

    const saved = await t.run((ctx) =>
      configureTeamAgentRole(ctx, {
        chatroomId,
        userId: ownerId,
        role: 'builder',
        machineId: newMachineId,
        agentHarness: 'opencode',
        model: 'new-model',
        workingDir: '/new/dir',
      })
    );

    expect(saved.desiredState).toBe('running');
    expect(saved.enabled).toBe(false);
    expect(saved.circuitState).toBe('open');
    expect(saved.lifecycleRevision).toBe(7);
    expect(saved.createdAt).toBe(createdAt);
    expect(saved.machineId).toBe(newMachineId);
    expect(saved.model).toBe('new-model');
    expect(saved.workingDir).toBe('/new/dir');
    expect(saved.updatedAt).toBeGreaterThan(createdAt);
  });

  test('rejects unowned machine', async () => {
    const { sessionId } = await createTestSession('configure-role-machine');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const ownerId = await t.run(async (ctx) => {
      const room = await ctx.db.get('chatroom_rooms', chatroomId);
      return room!.ownerId;
    });

    await expect(
      t.run((ctx) =>
        configureTeamAgentRole(ctx, {
          chatroomId,
          userId: ownerId,
          role: 'builder',
          machineId: 'nonexistent-machine',
          agentHarness: 'opencode',
          model: 'test-model',
          workingDir: '/workspace',
        })
      )
    ).rejects.toMatchObject({ data: { code: 'MACHINE_NOT_FOUND' } });
  });

  test('rejects non-team role', async () => {
    const { sessionId } = await createTestSession('configure-role-invalid');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'configure-role-machine-invalid';
    await registerMachineWithDaemon(sessionId, machineId);
    const ownerId = await t.run(async (ctx) => {
      const room = await ctx.db.get('chatroom_rooms', chatroomId);
      return room!.ownerId;
    });

    for (const role of ['user', 'not-a-role']) {
      await expect(
        t.run((ctx) =>
          configureTeamAgentRole(ctx, {
            chatroomId,
            userId: ownerId,
            role,
            machineId,
            agentHarness: 'opencode',
            model: 'test-model',
            workingDir: '/workspace',
          })
        )
      ).rejects.toMatchObject({ data: { code: 'INVALID_ROLE' } });
    }
  });

  test('rejects blank model and workingDir', async () => {
    const { sessionId } = await createTestSession('configure-role-blank');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'configure-role-machine-blank';
    await registerMachineWithDaemon(sessionId, machineId);
    const ownerId = await t.run(async (ctx) => {
      const room = await ctx.db.get('chatroom_rooms', chatroomId);
      return room!.ownerId;
    });

    await expect(
      t.run((ctx) =>
        configureTeamAgentRole(ctx, {
          chatroomId,
          userId: ownerId,
          role: 'builder',
          machineId,
          agentHarness: 'opencode',
          model: '   ',
          workingDir: '/workspace',
        })
      )
    ).rejects.toMatchObject({ data: { code: 'INVALID_MODEL' } });

    await expect(
      t.run((ctx) =>
        configureTeamAgentRole(ctx, {
          chatroomId,
          userId: ownerId,
          role: 'builder',
          machineId,
          agentHarness: 'opencode',
          model: 'test-model',
          workingDir: '  ',
        })
      )
    ).rejects.toMatchObject({ data: { code: 'INVALID_WORKING_DIR' } });
  });

  test('rejects non-owner userId', async () => {
    const { sessionId } = await createTestSession('configure-role-forbidden');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'configure-role-machine-forbidden';
    await registerMachineWithDaemon(sessionId, machineId);

    const { sessionId: otherSessionId } = await createTestSession('configure-role-other-user');
    const otherUserId = await t.run(async (ctx) => {
      const session = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', otherSessionId))
        .first();
      return session!.userId;
    });

    await expect(
      t.run((ctx) =>
        configureTeamAgentRole(ctx, {
          chatroomId,
          userId: otherUserId,
          role: 'builder',
          machineId,
          agentHarness: 'opencode',
          model: 'test-model',
          workingDir: '/workspace',
        })
      )
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  });
});
