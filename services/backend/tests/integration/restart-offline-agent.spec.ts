/**
 * Restart Offline Agent — Integration Tests
 *
 * Tests the `restartOfflineAgent` use case which consolidates the logic for
 * detecting and restarting offline remote agents. Verifies all skip reasons,
 * successful dispatch, model resolution, and dedup behavior.
 */

import { describe, expect, test } from 'vitest';

import { DAEMON_HEARTBEAT_TTL_MS } from '../../config/reliability';
import { api } from '../../convex/_generated/api';
import { restartOfflineAgent } from '../../src/domain/usecase/agent/restart-offline-agent';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
  getPendingCommands,
  joinParticipant,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

// ─── Skip Reason Tests ──────────────────────────────────────────────────────

describe('restartOfflineAgent — skip reasons', () => {
  test('skips when agent is online (agent_online)', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-roa-skip-1');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-roa-skip-1';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Join builder as participant (online)
    await joinParticipant(sessionId, chatroomId, 'builder', Date.now() + 60_000);

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return restartOfflineAgent(ctx, {
        chatroomId,
        targetRole: 'builder',
        userId: (await ctx.db.query('users').first())!._id,
      });
    });

    // ===== VERIFY =====
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toBe('agent_online');
    }
  });

  test('skips when no agent config exists (no_agent_config)', async () => {
    // ===== SETUP =====
    // Use a unique team to avoid team config pollution from other tests
    const { sessionId } = await createTestSession('test-roa-skip-2');
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'no-config-team',
      teamName: 'No Config Team',
      teamRoles: ['agent-alpha', 'agent-beta'],
      teamEntryPoint: 'agent-alpha',
    });
    // No team config created for agent-alpha

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return restartOfflineAgent(ctx, {
        chatroomId,
        targetRole: 'agent-alpha',
        userId: (await ctx.db.query('users').first())!._id,
      });
    });

    // ===== VERIFY =====
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toBe('no_agent_config');
    }
  });

  test('errors when agent is custom (not_remote)', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-roa-skip-3');
    const chatroomId = await createPairTeamChatroom(sessionId);

    // Save custom agent config
    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'custom',
    });

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return restartOfflineAgent(ctx, {
        chatroomId,
        targetRole: 'builder',
        userId: (await ctx.db.query('users').first())!._id,
      });
    });

    // ===== VERIFY =====
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.code).toBe('not_remote');
      expect(result.message).toContain('user-managed');
    }
  });

  test('skips when daemon is not connected (daemon_not_connected)', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-roa-skip-4');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-roa-skip-4';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Disconnect daemon
    await t.mutation(api.machines.updateDaemonStatus, {
      sessionId,
      machineId,
      connected: false,
    });

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return restartOfflineAgent(ctx, {
        chatroomId,
        targetRole: 'builder',
        userId: (await ctx.db.query('users').first())!._id,
      });
    });

    // ===== VERIFY =====
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toBe('daemon_not_connected');
    }
  });

  test('skips when daemon heartbeat is stale (daemon_stale)', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-roa-skip-5');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-roa-skip-5';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Make daemon heartbeat stale
    await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (machine) {
        await ctx.db.patch('chatroom_machines', machine._id, {
          lastSeenAt: Date.now() - DAEMON_HEARTBEAT_TTL_MS - 10_000,
        });
      }
    });

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return restartOfflineAgent(ctx, {
        chatroomId,
        targetRole: 'builder',
        userId: (await ctx.db.query('users').first())!._id,
      });
    });

    // ===== VERIFY =====
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toBe('daemon_stale');
    }
  });

  test('skips when duplicate pending command exists (duplicate_pending_command)', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-roa-skip-6');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-roa-skip-6';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // First call — should dispatch
    const firstResult = await t.run(async (ctx) => {
      return restartOfflineAgent(ctx, {
        chatroomId,
        targetRole: 'builder',
        userId: (await ctx.db.query('users').first())!._id,
      });
    });
    expect(firstResult.status).toBe('dispatched');

    // Second call — should be deduped
    const secondResult = await t.run(async (ctx) => {
      return restartOfflineAgent(ctx, {
        chatroomId,
        targetRole: 'builder',
        userId: (await ctx.db.query('users').first())!._id,
      });
    });

    // ===== VERIFY =====
    expect(secondResult.status).toBe('skipped');
    if (secondResult.status === 'skipped') {
      expect(secondResult.reason).toBe('duplicate_pending_command');
    }
  });
});

// ─── Successful Dispatch Tests ──────────────────────────────────────────────

describe('restartOfflineAgent — successful dispatch', () => {
  test('dispatches stop + start commands for offline remote agent', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-roa-dispatch-1');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-roa-dispatch-1';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Builder is NOT joined (offline)

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return restartOfflineAgent(ctx, {
        chatroomId,
        targetRole: 'builder',
        userId: (await ctx.db.query('users').first())!._id,
      });
    });

    // ===== VERIFY =====
    expect(result.status).toBe('dispatched');
    if (result.status === 'dispatched') {
      expect(result.machineId).toBe(machineId);
      expect(result.model).toBe('claude-sonnet-4'); // From setupRemoteAgentConfig
    }

    // Verify commands were created
    const pending = await getPendingCommands(sessionId, machineId);
    const stopCmd = pending.find((c) => c.type === 'stop-agent');
    const startCmd = pending.find((c) => c.type === 'start-agent');

    expect(stopCmd).toBeDefined();
    expect(startCmd).toBeDefined();
    expect(startCmd!.payload.role).toBe('builder');
    expect(startCmd!.payload.model).toBe('claude-sonnet-4');
    expect(startCmd!.payload.agentHarness).toBe('opencode');
    expect(startCmd!.payload.workingDir).toBe('/test/workspace');
  });

  test('uses model from machine config when team config has no model', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-roa-dispatch-2');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-roa-dispatch-2';
    await registerMachineWithDaemon(sessionId, machineId);

    // Start agent with specific model (saves to both configs)
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

    // Ack all pending commands
    const cmds = await getPendingCommands(sessionId, machineId);
    for (const cmd of cmds) {
      await t.mutation(api.machines.ackCommand, {
        sessionId,
        commandId: cmd._id,
        status: 'completed' as const,
      });
    }

    // Overwrite team config WITHOUT model (simulates register-agent)
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

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return restartOfflineAgent(ctx, {
        chatroomId,
        targetRole: 'builder',
        userId: (await ctx.db.query('users').first())!._id,
      });
    });

    // ===== VERIFY =====
    expect(result.status).toBe('dispatched');
    if (result.status === 'dispatched') {
      expect(result.model).toBe('claude-opus-4'); // Fell back to machine config
    }

    // Verify the start command has the correct model
    const pending = await getPendingCommands(sessionId, machineId);
    const startCmd = pending.find((c) => c.type === 'start-agent');
    expect(startCmd).toBeDefined();
    expect(startCmd!.payload.model).toBe('claude-opus-4');
  });

  test('restarts expired waiting participant', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-roa-dispatch-3');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-roa-dispatch-3';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Join builder with expired readyUntil
    await joinParticipant(sessionId, chatroomId, 'builder', Date.now() - 60_000);

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return restartOfflineAgent(ctx, {
        chatroomId,
        targetRole: 'builder',
        userId: (await ctx.db.query('users').first())!._id,
      });
    });

    // ===== VERIFY =====
    expect(result.status).toBe('dispatched');
  });
});
