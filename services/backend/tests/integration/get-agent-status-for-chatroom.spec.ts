/**
 * Get Agent Status for Chatroom — Integration Tests
 *
 * Tests the use case that returns a UI-safe, role-centric view of
 * agent status for a chatroom.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { getAgentStatusForChatroom } from '../../src/domain/usecase/chatroom/get-agent-statuses';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

function createSquadChatroom(sessionId: string) {
  return t.mutation(api.chatrooms.create, {
    sessionId: sessionId as any,
    teamId: 'squad',
    teamName: 'Squad Team',
    teamRoles: ['planner', 'builder', 'reviewer'],
    teamEntryPoint: 'planner',
  });
}

async function getOwnerUserId(chatroomId: Id<'chatroom_rooms'>) {
  return t.run(async (ctx) => {
    const room = await ctx.db.get('chatroom_rooms', chatroomId);
    return room!.ownerId;
  });
}

async function runStatusQuery(chatroomId: Id<'chatroom_rooms'>) {
  const ownerId = await getOwnerUserId(chatroomId);
  return t.run(async (ctx) => {
    return getAgentStatusForChatroom(ctx, { chatroomId, userId: ownerId });
  });
}

// ─── Fresh team (no configs) ──────────────────────────────────────────────────

describe('getAgentStatusForChatroom — fresh team', () => {
  test('returns all team roles with stopped state when no agents configured', async () => {
    const { sessionId } = await createTestSession('test-gas-fresh-1');
    const chatroomId = await createSquadChatroom(sessionId);

    const result = await runStatusQuery(chatroomId);

    expect(result).not.toBeNull();
    expect(result!.teamRoles).toEqual(['planner', 'builder', 'reviewer']);
    expect(result!.agents).toHaveLength(3);
    for (const agent of result!.agents) {
      expect(agent.state).toBe('stopped');
    }
    expect(result!.workspaces).toHaveLength(0);
  });
});

// ─── Running agents ───────────────────────────────────────────────────────────

describe('getAgentStatusForChatroom — running agents', () => {
  test('returns running state when machineAgentConfig has PID', async () => {
    const { sessionId } = await createTestSession('test-gas-running-1');
    const machineId = 'machine-gas-running-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId: sessionId as any,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 12345,
    });

    const result = await runStatusQuery(chatroomId);

    expect(result).not.toBeNull();
    const builder = result!.agents.find((a) => a.role === 'builder');
    expect(builder).toBeDefined();
    expect(builder!.state).toBe('running');
    expect(builder!.machineName).toBe('test-host');
    expect(builder!.agentHarness).toBe('opencode');
    expect(builder!.model).toBe('claude-sonnet-4');
    expect(builder!.spawnedAt).toBeDefined();
  });

  test('returns starting state when desiredState is running but no PID', async () => {
    const { sessionId } = await createTestSession('test-gas-starting-1');
    const machineId = 'machine-gas-starting-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    const result = await runStatusQuery(chatroomId);

    const builder = result!.agents.find((a) => a.role === 'builder');
    expect(builder).toBeDefined();
    expect(builder!.state).toBe('starting');
  });

  test('returns stopped when desiredState is stopped', async () => {
    const { sessionId } = await createTestSession('test-gas-stopped-1');
    const machineId = 'machine-gas-stopped-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');
    await t.mutation(api.machines.sendCommand, {
      sessionId: sessionId as any,
      machineId,
      type: 'stop-agent',
      payload: { chatroomId, role: 'builder' },
    });

    const result = await runStatusQuery(chatroomId);

    const builder = result!.agents.find((a) => a.role === 'builder');
    expect(builder).toBeDefined();
    expect(builder!.state).toBe('stopped');
  });
});

// ─── Circuit breaker ──────────────────────────────────────────────────────────

describe('getAgentStatusForChatroom — circuit breaker', () => {
  test('returns circuit_open when circuit is tripped', async () => {
    const { sessionId } = await createTestSession('test-gas-circuit-1');
    const machineId = 'machine-gas-circuit-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .first();
      if (config) {
        await ctx.db.patch(config._id, {
          circuitState: 'open',
          circuitOpenedAt: Date.now(),
        });
      }
    });

    const result = await runStatusQuery(chatroomId);

    const builder = result!.agents.find((a) => a.role === 'builder');
    expect(builder).toBeDefined();
    expect(builder!.state).toBe('circuit_open');
  });
});

// ─── Stale roles excluded ─────────────────────────────────────────────────────

describe('getAgentStatusForChatroom — stale role exclusion', () => {
  test('does not return agents for roles not in current team', async () => {
    const { sessionId } = await createTestSession('test-gas-stale-1');
    const machineId = 'machine-gas-stale-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createSquadChatroom(sessionId);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'reviewer');

    await t.mutation(api.chatrooms.updateTeam, {
      sessionId: sessionId as any,
      chatroomId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });

    const result = await runStatusQuery(chatroomId);

    expect(result).not.toBeNull();
    expect(result!.teamRoles).toEqual(['planner', 'builder']);
    expect(result!.agents).toHaveLength(2);
    const roles = result!.agents.map((a) => a.role).sort();
    expect(roles).toEqual(['builder', 'planner']);
  });
});

// ─── Workspace derivation ─────────────────────────────────────────────────────

describe('getAgentStatusForChatroom — workspaces', () => {
  test('derives workspaces from team configs with machine+workingDir', async () => {
    const { sessionId } = await createTestSession('test-gas-ws-1');
    const machineId = 'machine-gas-ws-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'reviewer');

    const result = await runStatusQuery(chatroomId);

    expect(result!.workspaces).toHaveLength(1);
    expect(result!.workspaces[0].hostname).toBe('test-host');
    expect(result!.workspaces[0].workingDir).toBe('/test/workspace');
    expect(result!.workspaces[0].agentRoles.sort()).toEqual(['builder', 'reviewer']);
  });
});

// ─── Access control ───────────────────────────────────────────────────────────

describe('getAgentStatusForChatroom — access control', () => {
  test('returns null for non-owner user', async () => {
    const { sessionId: ownerSession } = await createTestSession('test-gas-access-owner');
    const chatroomId = await createPairTeamChatroom(ownerSession as any);

    await createTestSession('test-gas-access-other');

    const result = await t.run(async (ctx) => {
      const room = await ctx.db.get('chatroom_rooms', chatroomId);
      const users = await ctx.db.query('users').collect();
      const nonOwner = users.find((u) => u._id !== room!.ownerId);
      if (!nonOwner) return 'skip';
      return getAgentStatusForChatroom(ctx, {
        chatroomId,
        userId: nonOwner._id,
      });
    });

    if (result === 'skip') return;
    expect(result).toBeNull();
  });
});
