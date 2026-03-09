/**
 * Phase 3 Convex Query Wrappers — Integration Tests
 *
 * Tests the three new Convex queries (`getAgentStatus`, `getAgentStartConfig`,
 * `listAgentOverview`) that wrap Phase 1 use cases. Validates session auth,
 * data shape, and basic correctness when called through the Convex API layer.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

// ============================================================================
// getAgentStatus
// ============================================================================

describe('machines.getAgentStatus', () => {
  test('returns agent status for valid session', async () => {
    const { sessionId } = await createTestSession('test-gas-q-valid-1');
    const machineId = 'machine-gas-q-valid-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    const result = await t.query(api.machines.getAgentStatus, {
      sessionId: sessionId as any,
      chatroomId,
    });

    expect(result).not.toBeNull();
    expect(result!.teamRoles).toEqual(['builder', 'reviewer']);
    expect(result!.agents).toHaveLength(2);
    for (const agent of result!.agents) {
      expect(agent).toHaveProperty('role');
      expect(agent).toHaveProperty('state');
      expect(agent).toHaveProperty('type');
    }
    expect(result!.workspaces).toBeDefined();
  });

  test('returns null for invalid session', async () => {
    const { sessionId } = await createTestSession('test-gas-q-invalid-setup');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    const result = await t.query(api.machines.getAgentStatus, {
      sessionId: 'bogus-session-id' as any,
      chatroomId,
    });

    expect(result).toBeNull();
  });

  test('returns running state when agent has PID', async () => {
    const { sessionId } = await createTestSession('test-gas-q-running-1');
    const machineId = 'machine-gas-q-running-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');
    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId: sessionId as any,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 55555,
    });

    const result = await t.query(api.machines.getAgentStatus, {
      sessionId: sessionId as any,
      chatroomId,
    });

    const builder = result!.agents.find((a) => a.role === 'builder');
    expect(builder).toBeDefined();
    expect(builder!.state).toBe('running');
    expect(builder!.spawnedAt).toBeDefined();
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
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    const result = await t.query(api.machines.getAgentStartConfig, {
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
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    const result = await t.query(api.machines.getAgentStartConfig, {
      sessionId: 'bogus-session-id' as any,
      chatroomId,
      role: 'builder',
    });

    expect(result).toBeNull();
  });

  test('returns defaults from team config when available', async () => {
    const { sessionId } = await createTestSession('test-gasc-q-defaults-1');
    const machineId = 'machine-gasc-q-defaults-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    const result = await t.query(api.machines.getAgentStartConfig, {
      sessionId: sessionId as any,
      chatroomId,
      role: 'builder',
    });

    expect(result).not.toBeNull();
    expect(result!.defaults.machineId).toBe(machineId);
    expect(result!.defaults.agentHarness).toBe('opencode');
    expect(result!.defaults.model).toBe('claude-sonnet-4');
    expect(result!.defaults.workingDir).toBe('/test/workspace');
  });
});

// ============================================================================
// listAgentOverview
// ============================================================================

describe('machines.listAgentOverview', () => {
  test('returns overview for valid session', async () => {
    const { sessionId } = await createTestSession('test-lao-q-valid-1');
    const chatroomId = await createPairTeamChatroom(sessionId as any);

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
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');
    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId: sessionId as any,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 77777,
    });

    const results = await t.query(api.machines.listAgentOverview, {
      sessionId: sessionId as any,
    });

    const entry = results.find((r) => r.chatroomId === chatroomId);
    expect(entry).toBeDefined();
    expect(entry!.agentStatus).toBe('running');
    expect(entry!.runningRoles).toContain('builder');
  });

  test('overview entries do not contain machineId', async () => {
    const { sessionId } = await createTestSession('test-lao-q-noleak-1');
    const machineId = 'machine-lao-q-noleak-1';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createPairTeamChatroom(sessionId as any);

    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    const results = await t.query(api.machines.listAgentOverview, {
      sessionId: sessionId as any,
    });

    const entry = results.find((r) => r.chatroomId === chatroomId);
    expect(entry).toBeDefined();
    const keys = Object.keys(entry!).sort();
    expect(keys).toEqual(['agentStatus', 'chatroomId', 'runningAgents', 'runningRoles']);
  });
});
