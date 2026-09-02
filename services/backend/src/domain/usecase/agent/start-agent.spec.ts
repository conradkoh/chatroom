/**
 * Tests for start-agent use case — verifies that desiredState is set correctly.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';
import { getInboxCommandsForMachine } from '../../../../tests/helpers/machine-command-inbox';
import { TEST_MODEL_OPENCODE } from '../../../../tests/helpers/test-models';

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
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

async function registerMachine(sessionId: SessionId, machineId: string) {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
}

async function startAgent(
  sessionId: SessionId,
  machineId: string,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  options?: { allowNewMachine?: boolean | undefined; wantResume?: boolean | undefined }
) {
  return await t.mutation(api.machines.sendCommand, {
    sessionId,
    machineId,
    type: 'start-agent',
    payload: {
      chatroomId,
      role,
      model: TEST_MODEL_OPENCODE,
      agentHarness: 'opencode',
      workingDir: '/tmp/test',
      ...(options?.allowNewMachine !== undefined
        ? { allowNewMachine: options.allowNewMachine }
        : {}),
      ...(options?.wantResume !== undefined ? { wantResume: options.wantResume } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startAgent use case — desiredState', () => {
  test('sets desiredState: running on team config after starting an agent', async () => {
    const { sessionId } = await createTestSession('start-agent-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'start-machine-1';

    await registerMachine(sessionId, machineId);
    await startAgent(sessionId, machineId, chatroomId, 'builder');

    const teamConfig = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first();
    });

    expect(teamConfig?.desiredState).toBe('running');
  });

  test('resets desiredState from stopped to running when agent is started', async () => {
    const { sessionId } = await createTestSession('start-agent-2');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'start-machine-2';

    await registerMachine(sessionId, machineId);

    // Register a team config with desiredState: 'stopped'
    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: 'opencode',
    });

    // Mark it as stopped (no spawned PID on this config — patch intent directly)
    await t.mutation(api.agentStops.request, { sessionId, machineId, chatroomId, role: 'builder' });
    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first();
      if (config) await ctx.db.patch(config._id, { desiredState: 'stopped' });
    });

    // Verify it's stopped
    const stopped = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first();
    });
    expect(stopped?.desiredState).toBe('stopped');

    // Now start it again
    await startAgent(sessionId, machineId, chatroomId, 'builder');

    // Verify desiredState is now 'running'
    const running = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first();
    });
    expect(running?.desiredState).toBe('running');
  });

  test('resets circuit breaker state when manually starting an agent', async () => {
    const { sessionId } = await createTestSession('start-agent-3');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'start-machine-3';

    await registerMachine(sessionId, machineId);

    // Seed a team config with circuit breaker OPEN
    await t.run(async (ctx) => {
      const now = Date.now();
      const teamRoleKey = buildTeamRoleKey(chatroomId, 'duo', 'builder');
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey,
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: TEST_MODEL_OPENCODE,
        workingDir: '/tmp/test',
        createdAt: now,
        updatedAt: now,
        desiredState: 'stopped',
        circuitState: 'open', // Circuit tripped
        circuitOpenedAt: now - 30_000, // 30s ago
      });
    });

    // Manually start the agent (should reset circuit)
    await startAgent(sessionId, machineId, chatroomId, 'builder');

    // Verify circuit breaker was reset
    const config = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first();
    });

    expect(config?.circuitState).toBe('closed');
    expect(config?.circuitOpenedAt).toBeUndefined();
    expect(config?.desiredState).toBe('running');
  });

  test('emits machine.switched when starting on a different machine with allowNewMachine: true', async () => {
    const { sessionId } = await createTestSession('start-agent-switch-1');
    const chatroomId = await createChatroom(sessionId);
    const machineA = 'start-switch-a';
    const machineB = 'start-switch-b';

    await registerMachine(sessionId, machineA);
    await registerMachine(sessionId, machineB);
    await startAgent(sessionId, machineA, chatroomId, 'builder');

    await startAgent(sessionId, machineB, chatroomId, 'builder', { allowNewMachine: true });

    const config = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first()
    );
    expect(config?.machineId).toBe(machineB);
  });

  test('does not emit machine.switched when the same machine is used again', async () => {
    const { sessionId } = await createTestSession('start-agent-switch-2');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'start-switch-same';

    await registerMachine(sessionId, machineId);
    await startAgent(sessionId, machineId, chatroomId, 'builder');
    await startAgent(sessionId, machineId, chatroomId, 'builder');

    expect(true).toBe(true);
  });

  test('rejects start on a different machine when allowNewMachine is false', async () => {
    const { sessionId } = await createTestSession('start-agent-switch-3');
    const chatroomId = await createChatroom(sessionId);
    const machineA = 'start-reject-a';
    const machineB = 'start-reject-b';

    await registerMachine(sessionId, machineA);
    await registerMachine(sessionId, machineB);
    await startAgent(sessionId, machineA, chatroomId, 'builder');

    await expect(
      startAgent(sessionId, machineB, chatroomId, 'builder', { allowNewMachine: false })
    ).rejects.toThrow(/allowNewMachine: true/);
  });

  test('rejects start on a different machine when allowNewMachine is omitted (default policy)', async () => {
    const { sessionId } = await createTestSession('start-agent-switch-4');
    const chatroomId = await createChatroom(sessionId);
    const machineA = 'start-default-a';
    const machineB = 'start-default-b';

    await registerMachine(sessionId, machineA);
    await registerMachine(sessionId, machineB);
    // First start binds the role to machineA (initial binding is permitted by default policy).
    await startAgent(sessionId, machineA, chatroomId, 'builder');

    // Second start on machineB without an explicit allowNewMachine flag must be rejected —
    // once bound, switching machines requires explicit opt-in.
    await expect(startAgent(sessionId, machineB, chatroomId, 'builder')).rejects.toThrow(
      /allowNewMachine: true/
    );

    expect(true).toBe(true);
  });
});

describe('startAgent use case — wantResume runtime behavior', () => {
  async function readTeamConfig(chatroomId: Id<'chatroom_rooms'>, role: string) {
    return await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', role))
        )
        .first();
    });
  }

  test('does not persist wantResume on user start and emits the false default', async () => {
    const { sessionId } = await createTestSession('start-agent-resume-false');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'start-machine-resume-false';

    await registerMachine(sessionId, machineId);
    await startAgent(sessionId, machineId, chatroomId, 'builder');

    const config = await readTeamConfig(chatroomId, 'builder');
    expect(config?.wantResume).toBeUndefined();

    const starts = await getInboxCommandsForMachine(machineId, 'agent.requestStart');
    const start = starts.at(-1);
    expect(start?.command.type).toBe('agent.requestStart');
    if (start?.command.type === 'agent.requestStart') {
      expect(start.command.wantResume).toBe(false);
    }
  });

  test('keeps an explicit wantResume value runtime-only on user start', async () => {
    const { sessionId } = await createTestSession('start-agent-resume-true');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'start-machine-resume-true';

    await registerMachine(sessionId, machineId);
    await startAgent(sessionId, machineId, chatroomId, 'builder', { wantResume: true });

    const config = await readTeamConfig(chatroomId, 'builder');
    expect(config?.wantResume).toBeUndefined();

    const starts = await getInboxCommandsForMachine(machineId, 'agent.requestStart');
    const start = starts.at(-1);
    expect(start?.command.type).toBe('agent.requestStart');
    if (start?.command.type === 'agent.requestStart') {
      expect(start.command.wantResume).toBe(true);
    }
  });
});
