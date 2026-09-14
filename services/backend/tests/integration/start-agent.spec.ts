/**
 * Start Agent — Integration Tests
 *
 * Tests the `startAgent` use case which takes pre-resolved config values
 * (model, agentHarness, workingDir are all required), records the last launch
 * request, and dispatches a start-agent command.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { startAgent } from '../../src/domain/usecase/agent/start-agent';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  getCommandEvents,
  registerMachineWithDaemon,
} from '../helpers/integration';
import { TEST_MODEL_OPENCODE_LEGACY } from '../helpers/test-models';

// ─── Config persistence ──────────────────────────────────────────────────────

describe('startAgent — config persistence', () => {
  test('creates team config on first start', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-sa-persist-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
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
          model: TEST_MODEL_OPENCODE_LEGACY,
          agentHarness: 'opencode',
          workingDir: '/test/workspace',
          reason: 'user.manual_spawn',
        },
        machine!
      );
    });

    // ===== VERIFY =====
    expect(result.agentHarness).toBe('opencode');
    expect(result.model).toBe(TEST_MODEL_OPENCODE_LEGACY);
    expect(result.workingDir).toBe('/test/workspace');

    const request = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_agentLastSentLaunchRequests')
        .withIndex('by_requestKey', (q) => q.eq('requestKey', `${chatroomId}:duo@1:builder`))
        .first()
    );
    expect(request).toMatchObject({
      chatroomId,
      role: 'builder',
      agentType: 'remote',
      model: TEST_MODEL_OPENCODE_LEGACY,
      machineId,
      workingDir: '/test/workspace',
    });
  });

  test('start form data restores the last launch configuration', async () => {
    const { sessionId } = await createTestSession('test-sa-desired-source-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-sa-desired-source-1';
    await registerMachineWithDaemon(sessionId, machineId);

    await t.mutation(api.agents.requestStart, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      agentHarness: 'opencode',
      model: TEST_MODEL_OPENCODE_LEGACY,
      workingDir: '/tmp/test',
    });

    const result = await t.query(api.agents.getStartFormData, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(result?.defaults).toMatchObject({
      machineId,
      agentHarness: 'opencode',
      model: TEST_MODEL_OPENCODE_LEGACY,
      workingDir: '/tmp/test',
    });
  });

  test('updates existing team config on subsequent start', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-sa-persist-2');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
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
          reason: 'user.manual_spawn',
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
          reason: 'user.manual_spawn',
        },
        machine!
      );
    });

    // ===== VERIFY =====
    expect(result.model).toBe('new-model');
    expect(result.workingDir).toBe('/new/path');

    const requests = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_agentLastSentLaunchRequests')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'builder'))
        .collect()
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ model: 'new-model', workingDir: '/new/path' });
  });
});

// ─── Harness validation ──────────────────────────────────────────────────────

describe('startAgent — harness validation', () => {
  test('throws when harness is not available on machine', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-sa-harness-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-sa-harness-1';

    // Register machine WITHOUT opencode harness
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: [],
      availableModels: {},
    });
    await t.mutation(api.machines.markDaemonOnline, {
      sessionId,
      machineId,
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
            model: TEST_MODEL_OPENCODE_LEGACY,
            agentHarness: 'opencode',
            workingDir: '/test/workspace',
            reason: 'user.manual_spawn',
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
    // Create two separate chatrooms both using the duo team type.
    // Before the fix, both would generate the same teamRoleKey because the key
    // used chatroom.teamId ("duo") instead of chatroom._id (unique per chatroom).
    const { sessionId } = await createTestSession('test-sa-collision-1');
    const chatroomId1 = await createBuilderEntryDuoChatroom(sessionId);
    const chatroomId2 = await createBuilderEntryDuoChatroom(sessionId);
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
          reason: 'user.manual_spawn',
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
          reason: 'user.manual_spawn',
        },
        machine!
      );
    });

    // ===== VERIFY =====
    // There must be two distinct launch snapshots — one per chatroom.
    // Before the fix, the second startAgent would have overwritten the first
    // (same teamRoleKey), so only one row would exist.
    const allRequests = await t.run(async (ctx) =>
      ctx.db.query('chatroom_agentLastSentLaunchRequests').collect()
    );

    const config1 = allRequests.find((c) => c.chatroomId === chatroomId1 && c.role === 'builder');
    const config2 = allRequests.find((c) => c.chatroomId === chatroomId2 && c.role === 'builder');

    // Both configs must exist independently
    expect(config1).toBeDefined();
    expect(config2).toBeDefined();

    // Each config must carry its own model — no cross-chatroom overwrite
    expect(config1!.model).toBe('model-for-chatroom-1');
    expect(config2!.model).toBe('model-for-chatroom-2');

    // The two request keys must be different
    expect(config1!.requestKey).not.toBe(config2!.requestKey);
  });

  test('teamRoleKey includes chatroom._id (not teamId) in its format', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-sa-key-format-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
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
          model: TEST_MODEL_OPENCODE_LEGACY,
          agentHarness: 'opencode',
          workingDir: '/test/workspace',
          reason: 'user.manual_spawn',
        },
        machine!
      );
    });

    // ===== VERIFY =====
    const request = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_agentLastSentLaunchRequests')
        .withIndex('by_requestKey', (q) => q.eq('requestKey', `${chatroomId}:duo@1:builder`))
        .first();
    });

    expect(request).toBeDefined();
    const key = request!.requestKey;

    // Key must contain the actual chatroom._id value
    expect(key).toContain(chatroomId);

    expect(key).toBe(`${chatroomId}:duo@1:builder`);
  });
});

// ─── getInitPrompt agentType regression ──────────────────────────────────────

describe('getInitPrompt — agentType lookup uses chatroom._id', () => {
  test('agentType reflects registered config when queried via getInitPrompt', async () => {
    // Regression test: messages.ts must build the teamRoleKey using the correct
    // format: `chatroom_<chatroom._id>#team_<teamId>#role_<role>`.
    // If messages.ts uses a different format than startAgent, getInitPrompt would
    // fail to find the config and return agentType='unset'.

    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-init-prompt-agenttype-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const machineId = 'machine-init-prompt-agenttype-1';
    await registerMachineWithDaemon(sessionId, machineId);

    // Join participants so getInitPrompt can read presence
    await t.mutation(api.participants.join, { sessionId, chatroomId, role: 'builder' });
    await t.mutation(api.participants.join, { sessionId, chatroomId, role: 'planner' });

    // ===== ACTION =====
    // Start a remote agent — this writes chatroom_agentDesiredConfigs with type='remote'
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
          model: TEST_MODEL_OPENCODE_LEGACY,
          agentHarness: 'opencode',
          workingDir: '/test/workspace',
          reason: 'user.manual_spawn',
        },
        machine!
      );
    });

    // ===== VERIFY =====
    // getInitPrompt must look up the config by the same key used in startAgent
    // (`chatroom_${chatroom._id}#team_${teamId}#role_builder`) and return agentType='remote'.
    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(initPrompt).toBeDefined();
    // agentType='remote' causes `--type=remote` to appear in the register-agent command
    expect(initPrompt?.prompt).toContain('--type=remote');
    // agentType='unset' would produce the placeholder instead
    expect(initPrompt?.prompt).not.toContain('--type=<remote|custom>');
  });

  test('agentType is unset when no config exists for chatroom+role', async () => {
    // Verifies the fallback path is still correct.
    const { sessionId } = await createTestSession('test-init-prompt-agenttype-2');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

    await t.mutation(api.participants.join, { sessionId, chatroomId, role: 'builder' });
    await t.mutation(api.participants.join, { sessionId, chatroomId, role: 'planner' });

    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(initPrompt).toBeDefined();
    // agentType='unset' produces the placeholder `--type=<remote|custom>`
    expect(initPrompt?.prompt).toContain('--type=<remote|custom>');
  });
});

// ─── Command payload correctness ─────────────────────────────────────────────

describe('startAgent — command payload', () => {
  test('dispatched command payload matches the input exactly', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-sa-payload-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
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
          reason: 'user.manual_spawn',
        },
        machine!
      );
    });

    // ===== VERIFY =====
    const events = await getCommandEvents(sessionId, machineId);
    expect(events.length).toBe(1);
    const evt = events[0]!;
    expect(evt.type).toBe('agent.requestStart');
    if (evt.type === 'agent.requestStart') {
      expect(evt.model).toBe('my-specific-model');
      expect(evt.agentHarness).toBe('opencode');
      expect(evt.workingDir).toBe('/specific/path');
      expect(evt.chatroomId).toBe(chatroomId);
      expect(evt.role).toBe('builder');
    }
  });
});
