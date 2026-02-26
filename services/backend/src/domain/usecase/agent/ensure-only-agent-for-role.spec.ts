/**
 * Tests for the ensureOnlyAgentForRole use case.
 *
 * Uses `t.run` to exercise the function directly against an in-memory Convex DB,
 * since the use case is an internal helper (not a public mutation).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { ensureOnlyAgentForRole } from './ensure-only-agent-for-role';
import { t } from '../../../../test.setup';

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
    teamId: 'pair',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
}

async function insertTeamConfig(
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  machineId: string,
  type: 'remote' | 'custom' = 'remote',
  keyOverride?: string
): Promise<void> {
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_teamAgentConfigs', {
      teamRoleKey: keyOverride ?? `chatroom_${chatroomId}#role_${role}_${machineId}`,
      chatroomId,
      role,
      type,
      machineId: type === 'remote' ? machineId : undefined,
      agentHarness: type === 'remote' ? ('opencode' as const) : undefined,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function countStopCommands(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return await t.run(async (ctx) => {
    const commands = await ctx.db
      .query('chatroom_machineCommands')
      .filter((q) =>
        q.and(
          q.eq(q.field('type'), 'stop-agent'),
          q.eq(q.field('payload.chatroomId'), chatroomId),
          q.eq(q.field('payload.role'), role)
        )
      )
      .collect();
    return commands.length;
  });
}

async function getStopCommandMachineIds(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return await t.run(async (ctx) => {
    const commands = await ctx.db
      .query('chatroom_machineCommands')
      .filter((q) =>
        q.and(
          q.eq(q.field('type'), 'stop-agent'),
          q.eq(q.field('payload.chatroomId'), chatroomId),
          q.eq(q.field('payload.role'), role)
        )
      )
      .collect();
    return commands.map((c) => c.machineId);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensureOnlyAgentForRole', () => {
  test('stops conflicting remote agents for the same role', async () => {
    const { sessionId, userId } = await createTestSession('eoafr-1');
    const chatroomId = await createChatroom(sessionId);

    // Insert two remote configs for the same role with different teamRoleKeys
    // (simulates two agents racing to register simultaneously)
    await insertTeamConfig(chatroomId, 'builder', 'machine-a');
    await insertTeamConfig(chatroomId, 'builder', 'machine-b');

    // Call ensureOnlyAgentForRole — no excludeMachineId, should stop both
    await t.run(async (ctx) => {
      await ensureOnlyAgentForRole(ctx, {
        chatroomId,
        role: 'builder',
        userId,
      });
    });

    const stoppedMachines = await getStopCommandMachineIds(chatroomId, 'builder');
    expect(stoppedMachines).toContain('machine-a');
    expect(stoppedMachines).toContain('machine-b');
  });

  test('skips the excluded machine when excludeMachineId is provided', async () => {
    const { sessionId, userId } = await createTestSession('eoafr-2');
    const chatroomId = await createChatroom(sessionId);

    // Insert two remote configs for the same role
    await insertTeamConfig(chatroomId, 'builder', 'machine-a');
    await insertTeamConfig(chatroomId, 'builder', 'machine-c');

    // Exclude machine-c — only machine-a should be stopped
    await t.run(async (ctx) => {
      await ensureOnlyAgentForRole(ctx, {
        chatroomId,
        role: 'builder',
        userId,
        excludeMachineId: 'machine-c',
      });
    });

    const stoppedMachines = await getStopCommandMachineIds(chatroomId, 'builder');
    expect(stoppedMachines).toContain('machine-a');
    expect(stoppedMachines).not.toContain('machine-c');
  });

  test('no-op when no existing configs exist', async () => {
    const { sessionId, userId } = await createTestSession('eoafr-3');
    const chatroomId = await createChatroom(sessionId);

    await t.run(async (ctx) => {
      await ensureOnlyAgentForRole(ctx, {
        chatroomId,
        role: 'builder',
        userId,
      });
    });

    const stopCount = await countStopCommands(chatroomId, 'builder');
    expect(stopCount).toBe(0);
  });

  test('does not stop custom-type configs (only remote type is stopped)', async () => {
    const { sessionId, userId } = await createTestSession('eoafr-4');
    const chatroomId = await createChatroom(sessionId);

    // Insert a custom-type config — should not be stopped
    await insertTeamConfig(chatroomId, 'builder', 'machine-e', 'custom');

    await t.run(async (ctx) => {
      await ensureOnlyAgentForRole(ctx, {
        chatroomId,
        role: 'builder',
        userId,
      });
    });

    const stopCount = await countStopCommands(chatroomId, 'builder');
    expect(stopCount).toBe(0);
  });
});
