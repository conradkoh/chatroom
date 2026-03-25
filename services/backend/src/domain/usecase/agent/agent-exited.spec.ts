/**
 * Tests for the agentExited use case.
 *
 * Verifies:
 *   - Audit event is always inserted
 *   - PID-gated config cleanup (only clears when PID+machineId match)
 *   - Participant update guard (skips when config belongs to a different machine)
 *   - Idempotency (calling twice with same input is safe)
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { agentExited } from './agent-exited';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'pair',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
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

async function setupAgentConfig(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  role: string,
  pid: number
) {
  await registerMachine(sessionId, machineId);
  await t.mutation(api.machines.saveTeamAgentConfig, {
    sessionId,
    chatroomId,
    role,
    type: 'remote',
    machineId,
    agentHarness: 'opencode',
  });

  // Set spawnedAgentPid on the config
  await t.run(async (ctx) => {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', role))
      )
      .first();
    if (config) {
      await ctx.db.patch('chatroom_teamAgentConfigs', config._id, {
        spawnedAgentPid: pid,
        spawnedAt: Date.now(),
        desiredState: 'running',
      });
    }
  });
}

async function joinParticipant(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
) {
  await t.mutation(api.participants.join, {
    sessionId,
    chatroomId,
    role,
    agentType: 'remote',
  });
}

async function getConfig(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'pair', role))
      )
      .first();
  });
}

async function getParticipant(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return await t.run(async (ctx) => {
    return ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', role)
      )
      .unique();
  });
}

async function countExitedEvents(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return await t.run(async (ctx) => {
    const events = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom_type', (q) =>
        q.eq('chatroomId', chatroomId).eq('type', 'agent.exited')
      )
      .collect();
    return events.filter((e) => e.type === 'agent.exited' && e.role === role).length;
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('agentExited use case', () => {
  test('inserts agent.exited event (audit trail)', async () => {
    const { sessionId } = await createTestSession('ae-audit-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'machine-ae-1';
    await setupAgentConfig(sessionId, chatroomId, machineId, 'builder', 12345);

    await t.run(async (ctx) => {
      await agentExited(ctx, {
        chatroomId,
        role: 'builder',
        machineId,
        pid: 12345,
        stopReason: 'user.stop',
      });
    });

    const count = await countExitedEvents(chatroomId, 'builder');
    expect(count).toBe(1);
  });

  test('clears PID only when config.spawnedAgentPid matches input.pid', async () => {
    const { sessionId } = await createTestSession('ae-pid-match-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'machine-ae-2';
    await setupAgentConfig(sessionId, chatroomId, machineId, 'builder', 12345);

    // Exit with matching PID — should clear
    await t.run(async (ctx) => {
      await agentExited(ctx, {
        chatroomId,
        role: 'builder',
        machineId,
        pid: 12345,
      });
    });

    const config = await getConfig(chatroomId, 'builder');
    expect(config?.spawnedAgentPid).toBeUndefined();
    expect(config?.spawnedAt).toBeUndefined();
  });

  test('does NOT clear PID when input.pid does not match config', async () => {
    const { sessionId } = await createTestSession('ae-pid-mismatch-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'machine-ae-3';
    await setupAgentConfig(sessionId, chatroomId, machineId, 'builder', 12345);

    // Exit with WRONG PID — should NOT clear (a newer agent may be running)
    await t.run(async (ctx) => {
      await agentExited(ctx, {
        chatroomId,
        role: 'builder',
        machineId,
        pid: 99999,
      });
    });

    const config = await getConfig(chatroomId, 'builder');
    expect(config?.spawnedAgentPid).toBe(12345);
    expect(config?.spawnedAt).toBeTypeOf('number');
  });

  test('skips PID clear when machineId does not match', async () => {
    const { sessionId } = await createTestSession('ae-machine-mismatch-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'machine-ae-4';
    await setupAgentConfig(sessionId, chatroomId, machineId, 'builder', 12345);

    // Exit from a DIFFERENT machine — should NOT clear
    await t.run(async (ctx) => {
      await agentExited(ctx, {
        chatroomId,
        role: 'builder',
        machineId: 'machine-ae-4-OTHER',
        pid: 12345,
      });
    });

    const config = await getConfig(chatroomId, 'builder');
    expect(config?.spawnedAgentPid).toBe(12345);
  });

  test('skips participant update when config belongs to a different machine', async () => {
    const { sessionId } = await createTestSession('ae-machine-guard-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'machine-ae-5';
    await setupAgentConfig(sessionId, chatroomId, machineId, 'builder', 12345);
    await joinParticipant(sessionId, chatroomId, 'builder');

    // Set participant to a "running" status
    await t.run(async (ctx) => {
      const participant = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      if (participant) {
        await ctx.db.patch('chatroom_participants', participant._id, {
          lastStatus: 'agent.started',
        });
      }
    });

    // Exit from a DIFFERENT machine — participant should NOT be updated
    await t.run(async (ctx) => {
      await agentExited(ctx, {
        chatroomId,
        role: 'builder',
        machineId: 'machine-ae-5-OTHER',
        pid: 99999,
      });
    });

    const participant = await getParticipant(chatroomId, 'builder');
    expect(participant?.lastStatus).toBe('agent.started');
  });

  test('is idempotent (calling twice with same input is safe)', async () => {
    const { sessionId } = await createTestSession('ae-idempotent-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'machine-ae-6';
    await setupAgentConfig(sessionId, chatroomId, machineId, 'builder', 12345);
    await joinParticipant(sessionId, chatroomId, 'builder');

    const input = {
      chatroomId,
      role: 'builder',
      machineId,
      pid: 12345,
      stopReason: 'user.stop',
    };

    // Call once
    await t.run(async (ctx) => {
      await agentExited(ctx, input);
    });

    // Call again — should not throw
    await t.run(async (ctx) => {
      await agentExited(ctx, input);
    });

    // Two audit events should exist (one per call)
    const count = await countExitedEvents(chatroomId, 'builder');
    expect(count).toBe(2);

    // Config PID should still be cleared
    const config = await getConfig(chatroomId, 'builder');
    expect(config?.spawnedAgentPid).toBeUndefined();

    // Participant should be marked exited
    const participant = await getParticipant(chatroomId, 'builder');
    expect(participant?.lastStatus).toBe('agent.exited');
  });

  test('updates participant lastSeenAction and clears connectionId', async () => {
    const { sessionId } = await createTestSession('ae-participant-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'machine-ae-7';
    await setupAgentConfig(sessionId, chatroomId, machineId, 'builder', 12345);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.run(async (ctx) => {
      await agentExited(ctx, {
        chatroomId,
        role: 'builder',
        machineId,
        pid: 12345,
      });
    });

    const participant = await getParticipant(chatroomId, 'builder');
    expect(participant?.lastStatus).toBe('agent.exited');
    expect(participant?.lastSeenAction).toBe('exited');
    expect(participant?.connectionId).toBeUndefined();
  });
});
