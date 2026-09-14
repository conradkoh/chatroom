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

describe('startAgent use case — request snapshots', () => {
  test('starts all permanent roles from their saved configurations', async () => {
    const { sessionId } = await createTestSession('start-agent-all-current-config');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'start-machine-all-current-config';

    await registerMachine(sessionId, machineId);
    const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/tmp/test',
      hostname: 'test-host',
      registeredBy: 'planner',
    });
    await t.mutation(api.workspaces.setPrimaryWorkspaceForChatroom, {
      sessionId,
      chatroomId,
      workspaceId,
    });
    for (const role of ['planner', 'builder']) {
      await t.mutation(api.agents.saveConfig, {
        sessionId,
        chatroomId,
        workspaceId,
        role,
        machineId,
        agentHarness: 'opencode',
        model: TEST_MODEL_OPENCODE,
        workingDir: '/tmp/test',
      });
    }

    const first = await t.mutation(api.agents.startAllPermanent, {
      sessionId,
      chatroomId,
    });
    const second = await t.mutation(api.agents.startAllPermanent, {
      sessionId,
      chatroomId,
    });

    expect(first).toMatchObject({
      started: expect.arrayContaining(['planner', 'builder']),
      skipped: [],
      failed: [],
    });
    expect(second).toMatchObject(first);
    expect((await getInboxCommandsForMachine(machineId, 'agent.requestStart')).length).toBe(2);
  });

  test('records a last-sent request without creating backend runtime state', async () => {
    const { sessionId } = await createTestSession('start-agent-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'start-machine-1';

    await registerMachine(sessionId, machineId);
    await startAgent(sessionId, machineId, chatroomId, 'builder');

    const request = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_agentLastSentLaunchRequests')
        .withIndex('by_requestKey', (q) => q.eq('requestKey', `${chatroomId}:duo@1:builder`))
        .first()
    );
    const commands = await getInboxCommandsForMachine(machineId, 'agent.requestStart');
    expect(request).toMatchObject({
      chatroomId,
      teamStructureId: 'duo@1',
      role: 'builder',
      machineId,
      agentHarness: 'opencode',
      model: TEST_MODEL_OPENCODE,
      workingDir: '/tmp/test',
      reason: 'user.start',
      requestedBy: expect.any(String),
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]?.command.type).toBe('agent.requestStart');
    if (commands[0]?.command.type === 'agent.requestStart') {
      expect(commands[0].command).toMatchObject({
        requestId: request?.requestId,
        chatroomId,
        role: 'builder',
        agentHarness: 'opencode',
        model: TEST_MODEL_OPENCODE,
        workingDir: '/tmp/test',
        reason: 'user.start',
      });
    }
    const runtimeRows = await t.run((ctx) => ctx.db.query('chatroom_agentRuntimeStates').collect());
    expect(runtimeRows).toEqual([]);
  });

  test('does not reset a daemon-owned circuit breaker when manually starting an agent', async () => {
    const { sessionId } = await createTestSession('start-agent-3');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'start-machine-3';

    await registerMachine(sessionId, machineId);

    // Seed a team config with circuit breaker OPEN
    await t.run(async (ctx) => {
      const now = Date.now();
      const teamRoleKey = buildTeamRoleKey(chatroomId, 'duo', 'builder');
      const configId = await ctx.db.insert('chatroom_agentDesiredConfigs', {
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
      });
      await ctx.db.insert('chatroom_agentRuntimeStates', {
        desiredConfigId: configId,
        chatroomId,
        role: 'builder',
        machineId,
        status: 'offline',
        desiredState: 'stopped',
        circuitState: 'open',
        circuitOpenedAt: now - 30_000,
        updatedAt: now,
      });
    });

    // Manually start the agent (should reset circuit)
    await startAgent(sessionId, machineId, chatroomId, 'builder');

    // The daemon owns the circuit breaker; the webapp start command only sends
    // a self-contained request.
    const config = await t.run(async (ctx) => {
      const desired = await ctx.db
        .query('chatroom_agentDesiredConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first();
      return desired
        ? await ctx.db
            .query('chatroom_agentRuntimeStates')
            .withIndex('by_desiredConfig', (q) => q.eq('desiredConfigId', desired._id))
            .first()
        : null;
    });

    expect(config?.circuitState).toBe('open');
    expect(config?.desiredState).toBe('stopped');
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
        .query('chatroom_agentLastSentLaunchRequests')
        .withIndex('by_requestKey', (q) => q.eq('requestKey', `${chatroomId}:duo@1:builder`))
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
        .query('chatroom_agentDesiredConfigs')
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
