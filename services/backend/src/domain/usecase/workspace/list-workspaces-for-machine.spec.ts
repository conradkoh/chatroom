/**
 * Unit tests for listWorkspacesForMachine with recency filtering.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { listWorkspacesForMachine } from './list-workspaces-for-machine';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FIXED_NOW = 1_800_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

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

async function registerWorkspace(
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

describe('listWorkspacesForMachine (recency filter)', () => {
  test('returns recently observed workspace', async () => {
    const { sessionId } = await createSession('recent-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'recent-machine';
    await registerMachine(sessionId, machineId);
    await registerWorkspace(sessionId, chatroomId, machineId, '/tmp/recent');
    await t.mutation(api.chatrooms.recordChatroomObservation, { sessionId, chatroomId });

    const result = await t.run(async (ctx) => listWorkspacesForMachine(ctx, { machineId }));
    expect(result).toHaveLength(1);
  });

  test('excludes stale observation', async () => {
    const { sessionId } = await createSession('stale-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'stale-machine';
    await registerMachine(sessionId, machineId);
    await registerWorkspace(sessionId, chatroomId, machineId, '/tmp/stale');
    // Insert observation row with old timestamp directly
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_observation', {
        chatroomId,
        lastObservedAt: FIXED_NOW - SEVEN_DAYS_MS - 86_400_000,
      });
    });

    const result = await t.run(async (ctx) => listWorkspacesForMachine(ctx, { machineId }));
    expect(result).toHaveLength(0);
  });

  test('excludes no observation', async () => {
    const { sessionId } = await createSession('no-obs-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'no-obs-machine';
    await registerMachine(sessionId, machineId);
    await registerWorkspace(sessionId, chatroomId, machineId, '/tmp/unobserved');

    const result = await t.run(async (ctx) => listWorkspacesForMachine(ctx, { machineId }));
    expect(result).toHaveLength(0);
  });

  test('excludes removed workspace', async () => {
    const { sessionId } = await createSession('removed-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'removed-machine';
    await registerMachine(sessionId, machineId);
    await registerWorkspace(sessionId, chatroomId, machineId, '/tmp/removed');
    await t.mutation(api.chatrooms.recordChatroomObservation, { sessionId, chatroomId });

    // Find and remove the workspace
    const workspaces = await t.run(async (ctx) => listWorkspacesForMachine(ctx, { machineId }));
    const ws = workspaces[0]!;
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_workspaces', ws._id, { removedAt: FIXED_NOW - 1000 });
    });

    const result = await t.run(async (ctx) => listWorkspacesForMachine(ctx, { machineId }));
    expect(result).toHaveLength(0);
  });

  test('excludes different machineId', async () => {
    const { sessionId } = await createSession('diff-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'diff-machine';
    const otherMachineId = 'other-machine';
    await registerMachine(sessionId, machineId);
    await registerMachine(sessionId, otherMachineId);
    await registerWorkspace(sessionId, chatroomId, otherMachineId, '/tmp/other');
    await t.mutation(api.chatrooms.recordChatroomObservation, { sessionId, chatroomId });

    const result = await t.run(async (ctx) => listWorkspacesForMachine(ctx, { machineId }));
    expect(result).toHaveLength(0);
  });

  test('returns multiple workspaces on same chatroom', async () => {
    const { sessionId } = await createSession('multi-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'multi-machine';
    await registerMachine(sessionId, machineId);
    await registerWorkspace(sessionId, chatroomId, machineId, '/tmp/ws1');
    await registerWorkspace(sessionId, chatroomId, machineId, '/tmp/ws2');
    await t.mutation(api.chatrooms.recordChatroomObservation, { sessionId, chatroomId });

    const result = await t.run(async (ctx) => listWorkspacesForMachine(ctx, { machineId }));
    expect(result).toHaveLength(2);
    const dirs = result.map((w) => w.workingDir).sort();
    expect(dirs).toEqual(['/tmp/ws1', '/tmp/ws2']);
  });
});
