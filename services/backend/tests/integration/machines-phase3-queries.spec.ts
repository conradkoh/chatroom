/**
 * Phase 3 Convex Query Wrappers — Integration Tests
 *
 * Tests the three new Convex queries (`getAgentViewStatus`, `getAgentStartConfig`,
 * `listAgentOverview`) that wrap Phase 1 use cases. Validates session auth,
 * data shape, and basic correctness when called through the Convex API layer.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
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

describe('machines.getAgentViewStatus', () => {
  test('returns agent status for valid session', async () => {
    const { sessionId } = await createTestSession('test-gas-q-valid-1');
    const machineId = 'machine-gas-q-valid-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    const result = await t.query(api.machines.getAgentViewStatus, {
      sessionId: sessionId as any,
      chatroomId,
    });

    expect(result).not.toBeNull();
    expect(result!.teamRoles).toEqual(['planner', 'builder']);
    expect(result!.agents).toHaveLength(2);
    for (const agent of result!.agents) {
      expect(agent).toHaveProperty('role');
      expect(agent).toHaveProperty('state');
      expect(agent).toHaveProperty('type');
    }
  });

  test('returns null for invalid session', async () => {
    const { sessionId } = await createTestSession('test-gas-q-invalid-setup');
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    const result = await t.query(api.machines.getAgentViewStatus, {
      sessionId: 'bogus-session-id' as any,
      chatroomId,
    });

    expect(result).toBeNull();
  });

  test('returns running state when agent has PID', async () => {
    const { sessionId } = await createTestSession('test-gas-q-running-1');
    const machineId = 'machine-gas-q-running-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');
    await updateSpawnedAgentInTest(sessionId as any, machineId, chatroomId, 'planner', 55555);

    const result = await t.query(api.machines.getAgentViewStatus, {
      sessionId: sessionId as any,
      chatroomId,
    });

    const builder = result!.agents.find((a) => a.role === 'planner');
    expect(builder).toBeDefined();
    expect(builder!.state).toBe('running');
  });
});

// ============================================================================
// getAgentStartConfig
// ============================================================================

describe('machines.getAgentStartConfig', () => {
  test('returns start config for valid session', async () => {
    const { sessionId } = await createTestSession('test-gasc-q-valid-1');
    const machineId = 'machine-gasc-q-valid-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    const result = await t.query(api.machines.getAgentStartConfig, {
      sessionId: sessionId as any,
      chatroomId,
      role: 'planner',
    });

    expect(result).not.toBeNull();
    expect(result!.role).toBe('planner');
    expect(result!.connectedMachines).toBeDefined();
    expect(Array.isArray(result!.connectedMachines)).toBe(true);
    expect(result!.connectedMachines).toHaveLength(1);
    expect(result!.defaults).toBeDefined();
  });

  test('returns null for invalid session', async () => {
    const { sessionId } = await createTestSession('test-gasc-q-invalid-setup');
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    const result = await t.query(api.machines.getAgentStartConfig, {
      sessionId: 'bogus-session-id' as any,
      chatroomId,
      role: 'planner',
    });

    expect(result).toBeNull();
  });

  test('returns defaults from team config when available', async () => {
    const { sessionId } = await createTestSession('test-gasc-q-defaults-1');
    const machineId = 'machine-gasc-q-defaults-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');

    const result = await t.query(api.machines.getAgentStartConfig, {
      sessionId: sessionId as any,
      chatroomId,
      role: 'planner',
    });

    expect(result).not.toBeNull();
    expect(result!.defaults.machineId).toBe(machineId);
    expect(result!.defaults.agentHarness).toBe('opencode');
    expect(result!.defaults.model).toBe(TEST_MODEL_OPENCODE_LEGACY);
    expect(result!.defaults.workingDir).toBe('/test/workspace');
  });
});

// ============================================================================
// listAgentOverview
// ============================================================================

describe('machines.listAgentOverview', () => {
  test('returns overview for valid session', async () => {
    const { sessionId } = await createTestSession('test-lao-q-valid-1');
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    const results = await t.query(api.machines.listAgentOverview, {
      sessionId: sessionId as any,
    });

    expect(Array.isArray(results)).toBe(true);
    const entry = results.find((r) => r.chatroomId === chatroomId);
    expect(entry).toBeDefined();
    expect(entry!.agentStatus).toBe('none');
    expect(entry!.runningRoles).toEqual([]);
  });

  test('returns empty array for invalid session', async () => {
    const results = await t.query(api.machines.listAgentOverview, {
      sessionId: 'bogus-session-id' as any,
    });

    expect(results).toEqual([]);
  });

  test('returns running status when agent has PID', async () => {
    const { sessionId } = await createTestSession('test-lao-q-running-1');
    const machineId = 'machine-lao-q-running-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');
    await updateSpawnedAgentInTest(sessionId as any, machineId, chatroomId, 'planner', 77777);

    const results = await t.query(api.machines.listAgentOverview, {
      sessionId: sessionId as any,
    });

    const entry = results.find((r) => r.chatroomId === chatroomId);
    expect(entry).toBeDefined();
    expect(entry!.agentStatus).toBe('running');
    expect(entry!.runningRoles).toContain('planner');
  });

  test('overview entries do not contain machineId', async () => {
    const { sessionId } = await createTestSession('test-lao-q-noleak-1');
    const machineId = 'machine-lao-q-noleak-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'planner');

    const results = await t.query(api.machines.listAgentOverview, {
      sessionId: sessionId as any,
    });

    const entry = results.find((r) => r.chatroomId === chatroomId);
    expect(entry).toBeDefined();
    const keys = Object.keys(entry!).sort();
    expect(keys).toEqual([
      'agentStatus',
      'aliveRoles',
      'chatroomId',
      'runningAgents',
      'runningRoles',
    ]);
  });
});

// ============================================================================
// getTeamRoleConfigs
// ============================================================================

describe('machines.getTeamRoleConfigs', () => {
  test('returns rows for the current team only', async () => {
    const { sessionId } = await createTestSession('test-gtrc-current-team');
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    const machineId = 'machine-gtrc-current-team';
    await registerMachineWithDaemon(sessionId as any, machineId);

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'planner'),
        chatroomId,
        role: 'planner',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'planner-model',
        workingDir: '/planner',
        enabled: true,
        desiredState: 'running',
        lifecycleRevision: 1,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'builder'),
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'builder-model',
        workingDir: '/builder',
        enabled: true,
        desiredState: 'stopped',
        lifecycleRevision: 0,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: `${chatroomId}#team_old#builder`,
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'stale-model',
        workingDir: '/stale',
        enabled: true,
        desiredState: 'running',
        lifecycleRevision: 9,
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t.query(api.machines.getTeamRoleConfigs, {
      sessionId: sessionId as any,
      chatroomId,
    });

    expect(result.configs).toHaveLength(2);
    const roles = result.configs.map((c) => c.role).sort();
    expect(roles).toEqual(['builder', 'planner']);
    expect(result.configs.every((c) => c.model !== 'stale-model')).toBe(true);
  });

  test('includes unbound row with enabled and desiredState', async () => {
    const { sessionId } = await createTestSession('test-gtrc-unbound');
    const chatroomId = await createDuoTeamChatroom(sessionId as any);

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'enhancer'),
        chatroomId,
        role: 'enhancer',
        type: 'remote',
        enabled: false,
        desiredState: 'stopped',
        lifecycleRevision: 3,
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t.query(api.machines.getTeamRoleConfigs, {
      sessionId: sessionId as any,
      chatroomId,
    });

    const enhancer = result.configs.find((c) => c.role === 'enhancer');
    expect(enhancer).toBeDefined();
    expect(enhancer!.machineId).toBeNull();
    expect(enhancer!.enabled).toBe(false);
    expect(enhancer!.desiredState).toBe('stopped');
    expect(enhancer!.type).toBe('remote');
    expect(enhancer!.lifecycleRevision).toBe(3);
  });

  test('returns empty configs for non-owner', async () => {
    const { sessionId } = await createTestSession('test-gtrc-owner');
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    const { sessionId: otherSessionId } = await createTestSession('test-gtrc-non-owner');

    const result = await t.query(api.machines.getTeamRoleConfigs, {
      sessionId: otherSessionId as any,
      chatroomId,
    });

    expect(result).toEqual({ configs: [] });
  });
});
