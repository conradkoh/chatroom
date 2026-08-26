/**
 * Tests for the ensureOnlyAgentForRole use case.
 *
 * Uses `t.run` to exercise the function directly against an in-memory Convex DB,
 * since the use case is an internal helper (not a public mutation).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { ensureOnlyAgentForRole } from './ensure-only-agent-for-role';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';
import {
  getInboxCommandsForChatroom,
  getStopCommandMachineIdsForRole,
} from '../../../../tests/helpers/machine-command-inbox';

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
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
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
      teamRoleKey: keyOverride ?? buildTeamRoleKey(chatroomId, 'duo', `${role}_${machineId}`),
      chatroomId,
      role,
      type,
      machineId: type === 'remote' ? machineId : undefined,
      agentHarness: type === 'remote' ? ('opencode' as const) : undefined,
      createdAt: now,
      updatedAt: now,
      spawnedAgentPid:
        type === 'remote' ? 1000 + machineId.charCodeAt(machineId.length - 1) : undefined,
      desiredState: type === 'remote' ? 'running' : undefined,
    });
  });
}

/** Get machine IDs that received agent.requestStop commands for a given role */
async function getStopEventMachineIds(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return getStopCommandMachineIdsForRole(chatroomId, role);
}

/** Count agent.requestStop events for a given chatroom + role */
async function countStopEvents(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return (await getStopEventMachineIds(chatroomId, role)).length;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensureOnlyAgentForRole', () => {
  test('stops conflicting remote agents for the same role', async () => {
    const { sessionId } = await createTestSession('eoafr-1');
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
      });
    });

    const rows = await getInboxCommandsForChatroom(chatroomId, 'agent.stopScope');
    expect(rows.map((r) => r.machineId)).toEqual(
      expect.arrayContaining(['machine-a', 'machine-b'])
    );
  });

  test('skips the excluded machine when excludeMachineId is provided', async () => {
    const { sessionId } = await createTestSession('eoafr-2');
    const chatroomId = await createChatroom(sessionId);

    // Insert two remote configs for the same role
    await insertTeamConfig(chatroomId, 'builder', 'machine-a');
    await insertTeamConfig(chatroomId, 'builder', 'machine-c');

    // Exclude machine-c — only machine-a should be stopped
    await t.run(async (ctx) => {
      await ensureOnlyAgentForRole(ctx, {
        chatroomId,
        role: 'builder',
        excludeMachineId: 'machine-c',
      });
    });

    const rows = await getInboxCommandsForChatroom(chatroomId, 'agent.stopScope');
    expect(rows.map((r) => r.machineId)).toContain('machine-a');
    expect(rows.map((r) => r.machineId)).not.toContain('machine-c');
  });

  test('no-op when no existing configs exist', async () => {
    const { sessionId } = await createTestSession('eoafr-3');
    const chatroomId = await createChatroom(sessionId);

    await t.run(async (ctx) => {
      await ensureOnlyAgentForRole(ctx, {
        chatroomId,
        role: 'builder',
      });
    });

    const stopCount = await countStopEvents(chatroomId, 'builder');
    expect(stopCount).toBe(0);
  });

  test('does not stop custom-type configs (only remote type is stopped)', async () => {
    const { sessionId } = await createTestSession('eoafr-4');
    const chatroomId = await createChatroom(sessionId);

    // Insert a custom-type config — should not be stopped
    await insertTeamConfig(chatroomId, 'builder', 'machine-e', 'custom');

    await t.run(async (ctx) => {
      await ensureOnlyAgentForRole(ctx, {
        chatroomId,
        role: 'builder',
      });
    });

    const stopCount = await countStopEvents(chatroomId, 'builder');
    expect(stopCount).toBe(0);
  });

  test('emitted stop events have correct fields (deadline, reason, type)', async () => {
    const { sessionId } = await createTestSession('eoafr-5');
    const chatroomId = await createChatroom(sessionId);

    await insertTeamConfig(chatroomId, 'builder', 'machine-f');

    const before = Date.now();
    await t.run(async (ctx) => {
      await ensureOnlyAgentForRole(ctx, {
        chatroomId,
        role: 'builder',
      });
    });

    const inbox = await getInboxCommandsForChatroom(chatroomId, 'agent.stopScope');

    expect(inbox.length).toBe(1);
    const row = inbox[0]!;
    expect(row.command.type).toBe('agent.stopScope');
    if (row.command.type === 'agent.stopScope') {
      expect(row.machineId).toBe('machine-f');
      expect(row.command.reason).toBe('platform.dedup');
      expect(row.deadline).toBeGreaterThan(before);
      expect(typeof row.createdAt).toBe('number');
    }
  });
});
