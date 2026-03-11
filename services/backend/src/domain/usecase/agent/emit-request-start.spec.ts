/**
 * Tests for emitRequestStartIfNeeded — the unified agent start helper.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { emitRequestStartIfNeeded } from './emit-request-start';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'pair',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
}

async function registerMachine(
  sessionId: SessionId,
  machineId: string,
  opts?: { harnesses?: ('opencode' | 'pi' | 'cursor')[] }
) {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'linux',
    availableHarnesses: opts?.harnesses ?? ['opencode'],
  });
  // Machine registers with daemonConnected: false — set to true for tests
  await t.run(async (ctx) => {
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .first();
    if (machine) {
      await ctx.db.patch(machine._id, { daemonConnected: true });
    }
  });
}

async function seedTeamAgentConfig(
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  overrides?: Partial<{
    desiredState: 'running' | 'stopped';
    spawnedAgentPid: number;
    circuitState: 'closed' | 'open' | 'half-open';
    circuitOpenedAt: number;
    type: 'remote' | 'custom';
    agentHarness: 'opencode' | 'pi' | 'cursor';
    model: string;
    workingDir: string;
    machineId: string;
  }>
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert('chatroom_teamAgentConfigs', {
      teamRoleKey: buildTeamRoleKey(chatroomId, 'pair', 'builder'),
      chatroomId,
      role: 'builder',
      type: overrides?.type ?? 'remote',
      machineId: overrides?.machineId ?? machineId,
      agentHarness: overrides?.agentHarness ?? 'opencode',
      model: overrides?.model ?? 'anthropic/claude-sonnet-4',
      workingDir: overrides?.workingDir ?? '/tmp/test',
      createdAt: now,
      updatedAt: now,
      desiredState: overrides?.desiredState,
      spawnedAgentPid: overrides?.spawnedAgentPid,
      circuitState: overrides?.circuitState,
      circuitOpenedAt: overrides?.circuitOpenedAt,
    });
  });
}

async function seedAgentPreference(
  userId: Id<'users'>,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  overrides?: Partial<{
    agentHarness: 'opencode' | 'pi' | 'cursor';
    model: string;
    workingDir: string;
  }>
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_agentPreferences', {
      userId,
      chatroomId,
      role: 'builder',
      machineId,
      agentHarness: overrides?.agentHarness ?? 'opencode',
      model: overrides?.model ?? 'anthropic/claude-sonnet-4',
      workingDir: overrides?.workingDir ?? '/tmp/test',
      updatedAt: Date.now(),
    });
  });
}

async function countRequestStartEvents(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run(async (ctx) => {
    const events = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom_type', (q) =>
        q.eq('chatroomId', chatroomId).eq('type', 'agent.requestStart')
      )
      .collect();
    return events.length;
  });
}

async function countTeamAgentConfigs(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run(async (ctx) => {
    const configs = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
    return configs.length;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('emitRequestStartIfNeeded', () => {
  // 1. Config exists, PID null, desiredState running, daemon connected → emits requestStart
  test('emits requestStart when config exists with running state and no PID', async () => {
    const { sessionId } = await createTestSession('ers-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'ers-machine-1';

    await registerMachine(sessionId, machineId);
    await seedTeamAgentConfig(chatroomId, machineId, { desiredState: 'running' });

    const result = await t.run(async (ctx) => {
      return await emitRequestStartIfNeeded(ctx, {
        chatroomId,
        role: 'builder',
        reason: 'platform.task_activated',
      });
    });

    expect(result).toBe(true);
    expect(await countRequestStartEvents(chatroomId)).toBe(1);
  });

  // 2. Config exists, PID alive → returns false (no-op)
  test('returns false when config has a spawned PID', async () => {
    const { sessionId } = await createTestSession('ers-2');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'ers-machine-2';

    await registerMachine(sessionId, machineId);
    await seedTeamAgentConfig(chatroomId, machineId, {
      desiredState: 'running',
      spawnedAgentPid: 12345,
    });

    const result = await t.run(async (ctx) => {
      return await emitRequestStartIfNeeded(ctx, {
        chatroomId,
        role: 'builder',
        reason: 'platform.task_activated',
      });
    });

    expect(result).toBe(false);
    expect(await countRequestStartEvents(chatroomId)).toBe(0);
  });

  // 3. Config exists, desiredState stopped → returns false
  test('returns false when desiredState is stopped', async () => {
    const { sessionId } = await createTestSession('ers-3');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'ers-machine-3';

    await registerMachine(sessionId, machineId);
    await seedTeamAgentConfig(chatroomId, machineId, { desiredState: 'stopped' });

    const result = await t.run(async (ctx) => {
      return await emitRequestStartIfNeeded(ctx, {
        chatroomId,
        role: 'builder',
        reason: 'platform.task_activated',
      });
    });

    expect(result).toBe(false);
    expect(await countRequestStartEvents(chatroomId)).toBe(0);
  });

  // 4. Config exists, desiredState undefined → returns false
  test('returns false when desiredState is undefined', async () => {
    const { sessionId } = await createTestSession('ers-4');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'ers-machine-4';

    await registerMachine(sessionId, machineId);
    await seedTeamAgentConfig(chatroomId, machineId);

    const result = await t.run(async (ctx) => {
      return await emitRequestStartIfNeeded(ctx, {
        chatroomId,
        role: 'builder',
        reason: 'platform.task_activated',
      });
    });

    expect(result).toBe(false);
    expect(await countRequestStartEvents(chatroomId)).toBe(0);
  });

  // 5. No config, preference exists, daemon connected → creates config + emits requestStart
  test('creates config from preference and emits requestStart when no config exists', async () => {
    const { sessionId, userId } = await createTestSession('ers-5');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'ers-machine-5';

    await registerMachine(sessionId, machineId);
    await seedAgentPreference(userId, chatroomId, machineId);

    const result = await t.run(async (ctx) => {
      return await emitRequestStartIfNeeded(ctx, {
        chatroomId,
        role: 'builder',
        reason: 'platform.task_activated',
        createFromPreferences: true,
      });
    });

    expect(result).toBe(true);
    expect(await countRequestStartEvents(chatroomId)).toBe(1);
    expect(await countTeamAgentConfigs(chatroomId)).toBe(1);

    const config = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });
    expect(config?.desiredState).toBe('running');
    expect(config?.circuitState).toBe('closed');
    expect(config?.machineId).toBe(machineId);
  });

  // 6. No config, no preference → returns false
  test('returns false when no config and no preference', async () => {
    const { sessionId } = await createTestSession('ers-6');
    const chatroomId = await createChatroom(sessionId);

    const result = await t.run(async (ctx) => {
      return await emitRequestStartIfNeeded(ctx, {
        chatroomId,
        role: 'builder',
        reason: 'platform.task_activated',
        createFromPreferences: true,
      });
    });

    expect(result).toBe(false);
    expect(await countRequestStartEvents(chatroomId)).toBe(0);
  });

  // 7. No config, preference exists, daemon offline → returns false
  test('returns false when preference exists but daemon is offline', async () => {
    const { sessionId, userId } = await createTestSession('ers-7');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'ers-machine-7';

    await registerMachine(sessionId, machineId);
    await seedAgentPreference(userId, chatroomId, machineId);

    // Disconnect the daemon
    await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (machine) {
        await ctx.db.patch(machine._id, { daemonConnected: false });
      }
    });

    const result = await t.run(async (ctx) => {
      return await emitRequestStartIfNeeded(ctx, {
        chatroomId,
        role: 'builder',
        reason: 'platform.task_activated',
        createFromPreferences: true,
      });
    });

    expect(result).toBe(false);
    expect(await countRequestStartEvents(chatroomId)).toBe(0);
  });

  // 8. No config, preference exists, harness not available on machine → returns false
  test('returns false when preference harness is not available on machine', async () => {
    const { sessionId, userId } = await createTestSession('ers-8');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'ers-machine-8';

    // Machine only has 'opencode', preference requests 'cursor'
    await registerMachine(sessionId, machineId, { harnesses: ['opencode'] });
    await seedAgentPreference(userId, chatroomId, machineId, { agentHarness: 'cursor' });

    const result = await t.run(async (ctx) => {
      return await emitRequestStartIfNeeded(ctx, {
        chatroomId,
        role: 'builder',
        reason: 'platform.task_activated',
        createFromPreferences: true,
      });
    });

    expect(result).toBe(false);
    expect(await countRequestStartEvents(chatroomId)).toBe(0);
  });

  // 9. Circuit open + skipCircuitBreaker=false → returns false
  test('returns false when circuit is open and skipCircuitBreaker is false', async () => {
    const { sessionId } = await createTestSession('ers-9');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'ers-machine-9';

    await registerMachine(sessionId, machineId);
    await seedTeamAgentConfig(chatroomId, machineId, {
      desiredState: 'running',
      circuitState: 'open',
      circuitOpenedAt: Date.now() - 10_000, // 10s ago, within 60s cooldown
    });

    const result = await t.run(async (ctx) => {
      return await emitRequestStartIfNeeded(ctx, {
        chatroomId,
        role: 'builder',
        reason: 'platform.task_activated',
        skipCircuitBreaker: false,
      });
    });

    expect(result).toBe(false);
    expect(await countRequestStartEvents(chatroomId)).toBe(0);
  });

  // 10. Circuit open + skipCircuitBreaker=true → emits requestStart
  test('emits requestStart when circuit is open but skipCircuitBreaker is true', async () => {
    const { sessionId } = await createTestSession('ers-10');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'ers-machine-10';

    await registerMachine(sessionId, machineId);
    await seedTeamAgentConfig(chatroomId, machineId, {
      desiredState: 'running',
      circuitState: 'open',
      circuitOpenedAt: Date.now() - 10_000,
    });

    const result = await t.run(async (ctx) => {
      return await emitRequestStartIfNeeded(ctx, {
        chatroomId,
        role: 'builder',
        reason: 'platform.task_activated',
        skipCircuitBreaker: true,
      });
    });

    expect(result).toBe(true);
    expect(await countRequestStartEvents(chatroomId)).toBe(1);
  });

  // 11. Config exists but missing machineId → returns false
  test('returns false when config is missing machineId', async () => {
    const { sessionId } = await createTestSession('ers-11');
    const chatroomId = await createChatroom(sessionId);

    // Seed config directly without a machineId
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'pair', 'builder'),
        chatroomId,
        role: 'builder',
        type: 'remote',
        agentHarness: 'opencode',
        model: 'anthropic/claude-sonnet-4',
        workingDir: '/tmp/test',
        createdAt: now,
        updatedAt: now,
        desiredState: 'running',
      });
    });

    const result = await t.run(async (ctx) => {
      return await emitRequestStartIfNeeded(ctx, {
        chatroomId,
        role: 'builder',
        reason: 'platform.task_activated',
      });
    });

    expect(result).toBe(false);
    expect(await countRequestStartEvents(chatroomId)).toBe(0);
  });

  // 12. No chatroom teamId → returns false
  test('returns false when chatroom has no teamId', async () => {
    const { sessionId } = await createTestSession('ers-12');

    // Create chatroom without a teamId by patching after creation
    const chatroomId = await createChatroom(sessionId);
    await t.run(async (ctx) => {
      await ctx.db.patch(chatroomId, { teamId: undefined });
    });

    const result = await t.run(async (ctx) => {
      return await emitRequestStartIfNeeded(ctx, {
        chatroomId,
        role: 'builder',
        reason: 'platform.task_activated',
      });
    });

    expect(result).toBe(false);
    expect(await countRequestStartEvents(chatroomId)).toBe(0);
  });
});
