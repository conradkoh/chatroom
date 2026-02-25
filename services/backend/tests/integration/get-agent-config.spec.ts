/**
 * Get Agent Config — Integration Tests
 *
 * Tests the `getAgentConfig` use case which is the single source of truth
 * for resolving consolidated agent configuration from both
 * chatroom_teamAgentConfigs and chatroom_machineAgentConfigs.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { getAgentConfig } from '../../src/domain/usecase/agent/get-agent-config';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('getAgentConfig', () => {
  test('returns found: false when no team config exists', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-gac-1');
    const chatroomId = await createPairTeamChatroom(sessionId);

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
    const chatroomId = await createPairTeamChatroom(sessionId);

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
    const chatroomId = await createPairTeamChatroom(sessionId);
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
        model: 'claude-opus-4',
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
      expect(result.config.model).toBe('claude-opus-4');
      expect(result.config.modelSource).toBe('team_config');
      expect(result.config.type).toBe('remote');
      expect(result.config.machineId).toBe(machineId);
      expect(result.config.agentHarness).toBe('opencode');
      expect(result.config.workingDir).toBe('/test/workspace');
    }
  });

  test('falls back to machine config model when team config has no model', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-gac-4');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-gac-4';
    await registerMachineWithDaemon(sessionId, machineId);

    // Start agent with model — saves to both configs
    await t.mutation(api.machines.sendCommand, {
      sessionId,
      machineId,
      type: 'start-agent',
      payload: {
        chatroomId,
        role: 'builder',
        model: 'claude-opus-4',
        agentHarness: 'opencode',
        workingDir: '/test/workspace',
      },
    });

    // Directly clear the model on the team config (saveTeamAgentConfig preserves existing model)
    await t.run(async (ctx) => {
      const teamRoleKey = `chatroom_${chatroomId}#role_builder`;
      const teamConfig = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
        .first();
      if (teamConfig) {
        await ctx.db.patch('chatroom_teamAgentConfigs', teamConfig._id, {
          model: undefined,
        });
      }
    });

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return getAgentConfig(ctx, { chatroomId, role: 'builder' });
    });

    // ===== VERIFY =====
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.config.model).toBe('claude-opus-4');
      expect(result.config.modelSource).toBe('machine_config');
    }
  });

  test('returns modelSource "none" when neither config has a model', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-gac-5');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-gac-5';
    await registerMachineWithDaemon(sessionId, machineId);

    // Create team config via saveTeamAgentConfig (no model)
    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId,
      agentHarness: 'opencode',
      workingDir: '/test/workspace',
      // No model
    });

    // Don't create machine config at all (or create one without model)
    // saveTeamAgentConfig creates team config only, not machine config

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return getAgentConfig(ctx, { chatroomId, role: 'builder' });
    });

    // ===== VERIFY =====
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.config.model).toBeUndefined();
      expect(result.config.modelSource).toBe('none');
    }
  });

  test('returns custom type for custom agents', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-gac-6');
    const chatroomId = await createPairTeamChatroom(sessionId);

    // Save a custom agent config (no machine)
    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'custom',
    });

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return getAgentConfig(ctx, { chatroomId, role: 'builder' });
    });

    // ===== VERIFY =====
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.config.type).toBe('custom');
      expect(result.config.machineId).toBeUndefined();
      expect(result.config.agentHarness).toBeUndefined();
    }
  });

  test('includes spawnedAgentPid from machine config', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-gac-7');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-gac-7';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Simulate daemon spawning agent (sets PID in machine config)
    await t.mutation(api.machines.updateSpawnedAgent, {
      sessionId,
      machineId,
      chatroomId,
      role: 'builder',
      pid: 12345,
      model: 'claude-sonnet-4',
    });

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return getAgentConfig(ctx, { chatroomId, role: 'builder' });
    });

    // ===== VERIFY =====
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.config.spawnedAgentPid).toBe(12345);
      expect(result.config.spawnedAt).toBeDefined();
    }
  });
});
