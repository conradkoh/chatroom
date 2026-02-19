/**
 * Try Enforce Agent Liveness — Integration Tests
 *
 * Tests the `tryEnforceAgentLiveness` use case which gates restart attempts
 * on agent type. Verifies that remote agents delegate to restart logic,
 * custom agents produce error results, and edge cases are handled.
 */

import { describe, expect, test } from 'vitest';

import { DAEMON_HEARTBEAT_TTL_MS } from '../../config/reliability';
import { api } from '../../convex/_generated/api';
import { tryEnforceAgentLiveness } from '../../src/domain/usecase/agent/try-enforce-agent-liveness';
import { t } from '../../test.setup';
import {
  createPairTeamChatroom,
  createTestSession,
  getPendingCommands,
  joinParticipant,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

// ─── Error Cases ────────────────────────────────────────────────────────────

describe('tryEnforceAgentLiveness — error cases', () => {
  test('returns error when agent is custom (not_remote)', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-liveness-err-1');
    const chatroomId = await createPairTeamChatroom(sessionId);

    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'custom',
    });

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return tryEnforceAgentLiveness(ctx, {
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
      expect(result.message).toContain('builder');
    }
  });
});

// ─── Skip Cases ─────────────────────────────────────────────────────────────

describe('tryEnforceAgentLiveness — skip cases', () => {
  test('skips when no agent config exists', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-liveness-skip-1');
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'no-config-liveness',
      teamName: 'No Config Liveness',
      teamRoles: ['agent-x', 'agent-y'],
      teamEntryPoint: 'agent-x',
    });

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return tryEnforceAgentLiveness(ctx, {
        chatroomId,
        targetRole: 'agent-x',
        userId: (await ctx.db.query('users').first())!._id,
      });
    });

    // ===== VERIFY =====
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toBe('no_agent_config');
    }
  });

  test('skips when remote agent is already online', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-liveness-skip-2');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-liveness-skip-2';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Join builder as participant (online)
    await joinParticipant(sessionId, chatroomId, 'builder', Date.now() + 60_000);

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return tryEnforceAgentLiveness(ctx, {
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

  test('skips when daemon is not connected', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-liveness-skip-3');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-liveness-skip-3';
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
      return tryEnforceAgentLiveness(ctx, {
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

  test('skips when daemon heartbeat is stale', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-liveness-skip-4');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-liveness-skip-4';
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
      return tryEnforceAgentLiveness(ctx, {
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

  test('skips when duplicate pending command exists', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-liveness-skip-5');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-liveness-skip-5';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // First call — should enforce
    const firstResult = await t.run(async (ctx) => {
      return tryEnforceAgentLiveness(ctx, {
        chatroomId,
        targetRole: 'builder',
        userId: (await ctx.db.query('users').first())!._id,
      });
    });
    expect(firstResult.status).toBe('enforced');

    // Second call — should be deduped
    const secondResult = await t.run(async (ctx) => {
      return tryEnforceAgentLiveness(ctx, {
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

// ─── Enforced (Success) Cases ───────────────────────────────────────────────

describe('tryEnforceAgentLiveness — enforced', () => {
  test('dispatches restart for offline remote agent', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-liveness-ok-1');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-liveness-ok-1';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Builder is NOT joined (offline)

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return tryEnforceAgentLiveness(ctx, {
        chatroomId,
        targetRole: 'builder',
        userId: (await ctx.db.query('users').first())!._id,
      });
    });

    // ===== VERIFY =====
    expect(result.status).toBe('enforced');
    if (result.status === 'enforced') {
      expect(result.machineId).toBe(machineId);
      expect(result.model).toBe('claude-sonnet-4');
    }

    // Verify commands were created
    const pending = await getPendingCommands(sessionId, machineId);
    const stopCmd = pending.find((c) => c.type === 'stop-agent');
    const startCmd = pending.find((c) => c.type === 'start-agent');

    expect(stopCmd).toBeDefined();
    expect(startCmd).toBeDefined();
    expect(startCmd!.payload.role).toBe('builder');
  });

  test('restarts expired waiting participant', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-liveness-ok-2');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'machine-liveness-ok-2';
    await registerMachineWithDaemon(sessionId, machineId);
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

    // Join builder with expired readyUntil
    await joinParticipant(sessionId, chatroomId, 'builder', Date.now() - 60_000);

    // ===== ACTION =====
    const result = await t.run(async (ctx) => {
      return tryEnforceAgentLiveness(ctx, {
        chatroomId,
        targetRole: 'builder',
        userId: (await ctx.db.query('users').first())!._id,
      });
    });

    // ===== VERIFY =====
    expect(result.status).toBe('enforced');
  });
});
