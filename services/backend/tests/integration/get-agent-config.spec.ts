/**
 * Get Agent Config — Integration Tests
 *
 * Tests the `getAgentConfig` compatibility reader backed by the last launch
 * request snapshot.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { getAgentConfig } from '../../src/domain/usecase/agent/get-agent-config';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
  updateSpawnedAgentInTest,
} from '../helpers/integration';
import { TEST_MODEL_OPENCODE } from '../helpers/test-models';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('getAgentConfig', () => {
  test('returns found: false when no team config exists', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-gac-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    // No team config created — just a chatroom

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return getAgentConfig(ctx, { chatroomId, role: 'builder' });
    });

    // ===== VERIFY =====
    expect(result.found).toBe(false);
  });

  test('returns found: false when chatroom does not exist', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-gac-2');
    // Create a real chatroom just to get a valid ID format, then delete it
    const chatroomId = await createDuoTeamChatroom(sessionId);

    // Delete the chatroom so it no longer exists
    await t.run(async (ctx) => {
      await ctx.db.delete('chatroom_rooms', chatroomId);
    });

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return getAgentConfig(ctx, { chatroomId, role: 'builder' });
    });

    // ===== VERIFY =====
    expect(result.found).toBe(false);
  });

  test('resolves model from team config (highest priority)', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-gac-3');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'machine-gac-3';
    await registerMachineWithDaemon(sessionId, machineId);

    // Start agent with a specific model — saves to both team and machine config
    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'start-agent',
      payload: {
        chatroomId,
        role: 'builder',
        model: TEST_MODEL_OPENCODE,
        agentHarness: 'opencode',
        workingDir: '/test/workspace',
      },
    });

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return getAgentConfig(ctx, { chatroomId, role: 'builder' });
    });

    // ===== VERIFY =====
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.config.model).toBe(TEST_MODEL_OPENCODE);
      expect(result.config.modelSource).toBe('team_config');
      expect(result.config.type).toBe('remote');
      expect(result.config.machineId).toBe(machineId);
      expect(result.config.agentHarness).toBe('opencode');
      expect(result.config.workingDir).toBe('/test/workspace');
    }
  });

  test('does not expose spawnedAgentPid from the compatibility reader', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-gac-7');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'machine-gac-7';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Simulate a daemon observation in the role-status read model.
    await updateSpawnedAgentInTest(sessionId, machineId, chatroomId, 'builder', 12345);

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return getAgentConfig(ctx, { chatroomId, role: 'builder' });
    });

    // ===== VERIFY =====
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.config.spawnedAgentPid).toBeUndefined();
      expect(result.config.spawnedAt).toBeUndefined();
    }
  });
});
