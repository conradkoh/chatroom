/**
 * Phase 3 Convex Query Wrappers — Integration Tests
 *
 * Tests the canonical Convex queries (`getViewStatus`, `getStartFormData`,
 * `getChatroomStatus`) that wrap the current workspace-agent use cases. Validates session auth,
 * data shape, and basic correctness when called through the Convex API layer.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
  updateSpawnedAgentInTest,
} from '../helpers/integration';
import { TEST_MODEL_OPENCODE_LEGACY } from '../helpers/test-models';

// ============================================================================
// getAgentViewStatus
// ============================================================================

describe('agents.getViewStatus', () => {
  test('returns agent status for valid session', async () => {
    const { sessionId } = await createTestSession('test-gas-q-valid-1');
    const machineId = 'machine-gas-q-valid-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    const result = await t.query(api.agents.getViewStatus, {
      sessionId: sessionId as any,
      chatroomId,
    });

    expect(result).not.toBeNull();
    expect(result!.teamRoles).toContain('planner');
    expect(result!.teamRoles).toContain('builder');
    expect(result!.agents).toHaveLength(result!.teamRoles.length);
    for (const agent of result!.agents) {
      expect(agent).toHaveProperty('role');
      expect(agent).toHaveProperty('state');
      expect(agent).toHaveProperty('type');
    }
  });

  test('returns null for invalid session', async () => {
    const { sessionId } = await createTestSession('test-gas-q-invalid-setup');
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    await expect(
      t.query(api.agents.getViewStatus, {
        sessionId: 'bogus-session-id' as any,
        chatroomId,
      })
    ).rejects.toThrow(/Authentication failed/);
  });

  test('returns running state when agent has PID', async () => {
    const { sessionId } = await createTestSession('test-gas-q-running-1');
    const machineId = 'machine-gas-q-running-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');
    await updateSpawnedAgentInTest(sessionId as any, machineId, chatroomId, 'builder', 55555);

    const result = await t.query(api.agents.getViewStatus, {
      sessionId: sessionId as any,
      chatroomId,
    });

    const builder = result!.agents.find((a) => a.role === 'builder');
    expect(builder).toBeDefined();
    expect(builder!.state).toBe('running');
  });
});

// ============================================================================
// getAgentStartConfig
// ============================================================================

describe('agents.getStartFormData', () => {
  test('returns start config for valid session', async () => {
    const { sessionId } = await createTestSession('test-gasc-q-valid-1');
    const machineId = 'machine-gasc-q-valid-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    const result = await t.query(api.agents.getStartFormData, {
      sessionId: sessionId as any,
      chatroomId,
      role: 'builder',
    });

    expect(result).not.toBeNull();
    expect(result!.role).toBe('builder');
    expect(result!.connectedMachines).toBeDefined();
    expect(Array.isArray(result!.connectedMachines)).toBe(true);
    expect(result!.connectedMachines).toHaveLength(1);
    expect(result!.defaults).toBeDefined();
  });

  test('returns null for invalid session', async () => {
    const { sessionId } = await createTestSession('test-gasc-q-invalid-setup');
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    await expect(
      t.query(api.agents.getStartFormData, {
        sessionId: 'bogus-session-id' as any,
        chatroomId,
        role: 'builder',
      })
    ).rejects.toThrow(/Authentication failed/);
  });

  test('returns defaults from team config when available', async () => {
    const { sessionId } = await createTestSession('test-gasc-q-defaults-1');
    const machineId = 'machine-gasc-q-defaults-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    const result = await t.query(api.agents.getStartFormData, {
      sessionId: sessionId as any,
      chatroomId,
      role: 'builder',
    });

    expect(result).not.toBeNull();
    expect(result!.defaults.machineId).toBe(machineId);
    expect(result!.defaults.agentHarness).toBe('opencode');
    expect(result!.defaults.model).toBe(TEST_MODEL_OPENCODE_LEGACY);
    expect(result!.defaults.workingDir).toBe('/test/workspace');
  });
});

// ============================================================================
// getChatroomStatus
// ============================================================================

describe('agents.getChatroomStatus', () => {
  test('returns idle status for a valid session', async () => {
    const { sessionId } = await createTestSession('test-chatroom-status-idle');
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    const result = await t.query(api.agents.getChatroomStatus, {
      sessionId: sessionId as any,
      chatroomId,
    });

    expect(result).toEqual({
      chatroomId,
      activityStatus: 'idle',
      state: 'offline',
      remoteAgentStatus: 'none',
      canStop: false,
    });
  });

  test('rejects an invalid session', async () => {
    const { sessionId } = await createTestSession('test-chatroom-status-invalid');
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    await expect(
      t.query(api.agents.getChatroomStatus, {
        sessionId: 'bogus-session-id' as any,
        chatroomId,
      })
    ).rejects.toThrow(/Authentication failed/);
  });

  test('rejects access to another user’s chatroom', async () => {
    const owner = await createTestSession('test-chatroom-status-owner');
    const other = await createTestSession('test-chatroom-status-other');
    const chatroomId = await createDuoTeamChatroom(owner.sessionId as any);

    await expect(
      t.query(api.agents.getChatroomStatus, {
        sessionId: other.sessionId as any,
        chatroomId,
      })
    ).rejects.toThrow(/Access denied/);
  });

  test.each([
    ['working', 'working', 'active'],
    ['waiting', 'active', 'active'],
    ['starting', 'transitioning', 'attention'],
    ['stopping', 'transitioning', 'attention'],
    ['error', 'transitioning', 'attention'],
  ] as const)(
    'derives %s activity as %s and state %s',
    async (agentStatus, expectedActivity, expectedState) => {
      const { sessionId } = await createTestSession(`test-chatroom-status-${agentStatus}`);
      const chatroomId = await createDuoTeamChatroom(sessionId as any);

      await t.run(async (ctx) => {
        await ctx.db.insert('chatroom_agentRoleStatusReadModel', {
          chatroomId,
          role: 'builder',
          roleKind: 'persistent',
          status: agentStatus,
          projectedAt: Date.now(),
        });
      });

      const result = await t.query(api.agents.getChatroomStatus, {
        sessionId: sessionId as any,
        chatroomId,
      });

      expect(result.activityStatus).toBe(expectedActivity);
      expect(result.state).toBe(expectedState);
      expect(result.remoteAgentStatus).toBe('running');
      expect(result.canStop).toBe(true);
    }
  );

  test('returns completed for an archived chatroom regardless of role rows', async () => {
    const { sessionId } = await createTestSession('test-chatroom-status-completed');
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    await t.run(async (ctx) => {
      await ctx.db.patch(chatroomId, { status: 'completed' });
      await ctx.db.insert('chatroom_agentRoleStatusReadModel', {
        chatroomId,
        role: 'builder',
        roleKind: 'persistent',
        status: 'working',
        projectedAt: Date.now(),
      });
    });

    const result = await t.query(api.agents.getChatroomStatus, {
      sessionId: sessionId as any,
      chatroomId,
    });

    expect(result.activityStatus).toBe('completed');
    expect(result.state).toBe('completed');
  });

  test('reports a running remote agent when a role has a PID', async () => {
    const { sessionId } = await createTestSession('test-chatroom-status-running');
    const machineId = 'machine-chatroom-status-running';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');
    await updateSpawnedAgentInTest(sessionId as any, machineId, chatroomId, 'builder', 77777);

    const result = await t.query(api.agents.getChatroomStatus, {
      sessionId: sessionId as any,
      chatroomId,
    });

    expect(result.remoteAgentStatus).toBe('running');
    expect(result.canStop).toBe(true);
  });
});
