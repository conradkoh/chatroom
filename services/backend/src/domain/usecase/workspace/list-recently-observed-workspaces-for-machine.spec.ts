/**
 * Tests for listRecentlyObservedWorkspacesForMachine daemon observation guard.
 *
 * Unassigned (chatroom-free) workspaces must be ignored without throwing —
 * they have no chatroomId, so they must never be fed into chatroom observation
 * lookups or returned as chatroom-bound workspaces.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { listRecentlyObservedWorkspacesForMachine } from './list-recently-observed-workspaces-for-machine';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

async function createSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Test Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

async function registerMachine(sessionId: SessionId, machineId: string) {
  try {
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'linux',
      availableHarnesses: ['opencode'],
    });
  } catch {
    /* may already exist */
  }
}

async function registerChatroomWorkspace(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  workingDir: string
) {
  await t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'builder',
  });
}

describe('listRecentlyObservedWorkspacesForMachine (unassigned guard)', () => {
  test('ignores unassigned workspaces without throwing', async () => {
    const { sessionId } = await createSession('recent-unassigned');
    const machineId = 'recent-unassigned-machine';
    await registerMachine(sessionId, machineId);
    await t.mutation(api.workspaces.createWorkspace, {
      sessionId,
      machineId,
      workingDir: '/tmp/unassigned',
    });

    const result = await t.run(async (ctx) =>
      listRecentlyObservedWorkspacesForMachine(ctx, { machineId })
    );
    expect(result).toHaveLength(0);
  });

  test('returns only chatroom-bound workspaces when unassigned rows also exist', async () => {
    const { sessionId } = await createSession('recent-mixed');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'recent-mixed-machine';
    await registerMachine(sessionId, machineId);
    await registerChatroomWorkspace(sessionId, chatroomId, machineId, '/tmp/bound');
    await t.mutation(api.workspaces.createWorkspace, {
      sessionId,
      machineId,
      workingDir: '/tmp/unassigned',
    });
    await t.mutation(api.chatrooms.recordChatroomObservation, { sessionId, chatroomId });

    const result = await t.run(async (ctx) =>
      listRecentlyObservedWorkspacesForMachine(ctx, { machineId })
    );
    expect(result.map((w) => w.workingDir)).toEqual(['/tmp/bound']);
  });
});
