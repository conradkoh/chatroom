/**
 * Start Agent — Integration Tests
 *
 * Tests the `startAgent` use case which takes pre-resolved config values
 * (model, agentHarness, workingDir are all required), persists them to
 * machine + team configs, and dispatches a start-agent command.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { startAgent } from '../../src/domain/usecase/agent/start-agent';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
  getPendingCommands,
  registerMachineWithDaemon,
} from '../helpers/integration';

// ─── Config persistence ──────────────────────────────────────────────────────

describe('startAgent — config persistence', () => {
  test('creates machine and team configs on first start', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-sa-persist-1');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-sa-persist-1';
    await registerMachineWithDaemon(sessionId, machineId);

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();

      return startAgent(
        ctx,
        {
          machineId,
          chatroomId,
          role: 'builder',
          userId: user!._id,
          model: 'claude-sonnet-4',
          agentHarness: 'opencode',
          workingDir: '/test/workspace',
        },
        machine!
      );
    });

    // ===== VERIFY =====
    expect(result.commandId).toBeDefined();
    expect(result.agentHarness).toBe('opencode');
    expect(result.model).toBe('claude-sonnet-4');
    expect(result.workingDir).toBe('/test/workspace');

    // Verify machine agent config was created
    const machineConfig = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_machineAgentConfigs')
        .withIndex('by_machine_chatroom_role', (q) =>
          q.eq('machineId', machineId).eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .first();
    });
    expect(machineConfig).toBeDefined();
    expect(machineConfig!.model).toBe('claude-sonnet-4');
    expect(machineConfig!.agentType).toBe('opencode');
    expect(machineConfig!.workingDir).toBe('/test/workspace');

    // Verify team agent config was created
    const teamConfig = await t.run(async (ctx) => {
      return ctx.db.query('chatroom_teamAgentConfigs').collect();
    });
    const relevantTeamConfig = teamConfig.find(
      (c) => c.chatroomId === chatroomId && c.role === 'builder'
    );
    expect(relevantTeamConfig).toBeDefined();
    expect(relevantTeamConfig!.type).toBe('remote');
    expect(relevantTeamConfig!.model).toBe('claude-sonnet-4');
    expect(relevantTeamConfig!.machineId).toBe(machineId);
  });

  test('updates existing machine and team configs on subsequent start', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-sa-persist-2');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-sa-persist-2';
    await registerMachineWithDaemon(sessionId, machineId);

    // First start
    await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();

      return startAgent(
        ctx,
        {
          machineId,
          chatroomId,
          role: 'builder',
          userId: user!._id,
          model: 'old-model',
          agentHarness: 'opencode',
          workingDir: '/old/path',
        },
        machine!
      );
    });

    // ===== ACTION =====
    // Second start with new model and workingDir
    const result = await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();

      return startAgent(
        ctx,
        {
          machineId,
          chatroomId,
          role: 'builder',
          userId: user!._id,
          model: 'new-model',
          agentHarness: 'opencode',
          workingDir: '/new/path',
        },
        machine!
      );
    });

    // ===== VERIFY =====
    expect(result.model).toBe('new-model');
    expect(result.workingDir).toBe('/new/path');

    // Verify machine config was updated
    const machineConfig = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_machineAgentConfigs')
        .withIndex('by_machine_chatroom_role', (q) =>
          q.eq('machineId', machineId).eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .first();
    });
    expect(machineConfig!.model).toBe('new-model');
    expect(machineConfig!.workingDir).toBe('/new/path');

    // Verify team config was updated (not duplicated)
    const teamConfigs = await t.run(async (ctx) => {
      return ctx.db.query('chatroom_teamAgentConfigs').collect();
    });
    const builderConfigs = teamConfigs.filter(
      (c) => c.chatroomId === chatroomId && c.role === 'builder'
    );
    expect(builderConfigs.length).toBe(1);
    expect(builderConfigs[0]!.model).toBe('new-model');
  });
});

// ─── Harness validation ──────────────────────────────────────────────────────

describe('startAgent — harness validation', () => {
  test('throws when harness is not available on machine', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-sa-harness-1');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-sa-harness-1';

    // Register machine WITHOUT opencode harness
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: [],
      availableModels: [],
    });
    await t.mutation(api.machines.updateDaemonStatus, {
      sessionId,
      machineId,
      connected: true,
    });

    // ===== ACTION + VERIFY =====
    await expect(
      t.run(async (ctx) => {
        const user = await ctx.db.query('users').first();
        const machine = await ctx.db
          .query('chatroom_machines')
          .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
          .first();

        return startAgent(
          ctx,
          {
            machineId,
            chatroomId,
            role: 'builder',
            userId: user!._id,
            model: 'claude-sonnet-4',
            agentHarness: 'opencode',
            workingDir: '/test/workspace',
          },
          machine!
        );
      })
    ).rejects.toThrow("Agent harness 'opencode' is not available on this machine");
  });
});

// ─── teamRoleKey collision regression ────────────────────────────────────────

describe('startAgent — teamRoleKey collision regression', () => {
  test('two chatrooms with the same teamId but different _id produce different teamRoleKeys', async () => {
    // ===== SETUP =====
    // Create two separate chatrooms both using the "pair" team type.
    // Before the fix, both would generate the same teamRoleKey because the key
    // used chatroom.teamId ("pair") instead of chatroom._id (unique per chatroom).
    const { sessionId } = await createTestSession('test-sa-collision-1');
    const chatroomId1 = await createPairTeamChatroom(sessionId);
    const chatroomId2 = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-sa-collision-1';
    await registerMachineWithDaemon(sessionId, machineId);

    // ===== ACTION =====
    // Start a builder agent in each chatroom with different models so we can
    // distinguish which config belongs to which chatroom.
    await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();

      await startAgent(
        ctx,
        {
          machineId,
          chatroomId: chatroomId1,
          role: 'builder',
          userId: user!._id,
          model: 'model-for-chatroom-1',
          agentHarness: 'opencode',
          workingDir: '/workspace/chatroom1',
        },
        machine!
      );

      await startAgent(
        ctx,
        {
          machineId,
          chatroomId: chatroomId2,
          role: 'builder',
          userId: user!._id,
          model: 'model-for-chatroom-2',
          agentHarness: 'opencode',
          workingDir: '/workspace/chatroom2',
        },
        machine!
      );
    });

    // ===== VERIFY =====
    // There must be two distinct teamAgentConfigs — one per chatroom.
    // Before the fix, the second startAgent would have overwritten the first
    // (same teamRoleKey), so only one row would exist.
    const allTeamConfigs = await t.run(async (ctx) => {
      return ctx.db.query('chatroom_teamAgentConfigs').collect();
    });

    const config1 = allTeamConfigs.find(
      (c) => c.chatroomId === chatroomId1 && c.role === 'builder'
    );
    const config2 = allTeamConfigs.find(
      (c) => c.chatroomId === chatroomId2 && c.role === 'builder'
    );

    // Both configs must exist independently
    expect(config1).toBeDefined();
    expect(config2).toBeDefined();

    // Each config must carry its own model — no cross-chatroom overwrite
    expect(config1!.model).toBe('model-for-chatroom-1');
    expect(config2!.model).toBe('model-for-chatroom-2');

    // The two teamRoleKeys must be different
    expect(config1!.teamRoleKey).not.toBe(config2!.teamRoleKey);
  });

  test('teamRoleKey includes chatroom._id (not teamId) in its format', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-sa-key-format-1');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-sa-key-format-1';
    await registerMachineWithDaemon(sessionId, machineId);

    // ===== ACTION =====
    await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();

      return startAgent(
        ctx,
        {
          machineId,
          chatroomId,
          role: 'builder',
          userId: user!._id,
          model: 'claude-sonnet-4',
          agentHarness: 'opencode',
          workingDir: '/test/workspace',
        },
        machine!
      );
    });

    // ===== VERIFY =====
    const teamConfig = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_teamAgentConfigs')
        .filter((q) => q.eq(q.field('chatroomId'), chatroomId))
        .first();
    });

    expect(teamConfig).toBeDefined();
    const key = teamConfig!.teamRoleKey;

    // Key must contain the actual chatroom._id value
    expect(key).toContain(chatroomId);

    // Key must NOT contain the static teamId string "pair" as the discriminator
    // (it may appear elsewhere in the string, but the primary identifier is _id)
    expect(key).toMatch(/^chatroom_/);
    expect(key).toContain('#role_builder');
  });
});

// ─── Command payload correctness ─────────────────────────────────────────────

describe('startAgent — command payload', () => {
  test('dispatched command payload matches the input exactly', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-sa-payload-1');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-sa-payload-1';
    await registerMachineWithDaemon(sessionId, machineId);

    // ===== ACTION =====
    await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();

      return startAgent(
        ctx,
        {
          machineId,
          chatroomId,
          role: 'builder',
          userId: user!._id,
          model: 'my-specific-model',
          agentHarness: 'opencode',
          workingDir: '/specific/path',
        },
        machine!
      );
    });

    // ===== VERIFY =====
    const commands = await getPendingCommands(sessionId, machineId);
    expect(commands.length).toBe(1);
    const cmd = commands[0]!;
    expect(cmd.type).toBe('start-agent');
    expect(cmd.payload.model).toBe('my-specific-model');
    expect(cmd.payload.agentHarness).toBe('opencode');
    expect(cmd.payload.workingDir).toBe('/specific/path');
    expect(cmd.payload.chatroomId).toBe(chatroomId);
    expect(cmd.payload.role).toBe('builder');
  });
});
