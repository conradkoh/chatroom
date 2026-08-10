/**
 * Unit tests for listAllWorkspaces.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { listAllWorkspaces } from './list-all-workspaces';
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

describe('listAllWorkspaces', () => {
  test('returns workspaces across owned chatrooms', async () => {
    const { sessionId, userId } = await createSession('all-1');
    const c1 = await createChatroom(sessionId);
    const c2 = await createChatroom(sessionId);
    await registerMachine(sessionId, 'all-machine');
    await registerWorkspace(sessionId, c1, 'all-machine', '/tmp/ws1');
    await registerWorkspace(sessionId, c2, 'all-machine', '/tmp/ws2');

    const result = await t.run(async (ctx) => listAllWorkspaces(ctx, { userId }));
    expect(result.map((w) => w.workingDir).sort()).toEqual(['/tmp/ws1', '/tmp/ws2']);
  });

  test('excludes removed workspaces', async () => {
    const { sessionId, userId } = await createSession('all-removed');
    const chatroomId = await createChatroom(sessionId);
    await registerMachine(sessionId, 'all-rm-machine');
    await registerWorkspace(sessionId, chatroomId, 'all-rm-machine', '/tmp/removed');

    const before = await t.run(async (ctx) => listAllWorkspaces(ctx, { userId }));
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_workspaces', before[0]!._id, { removedAt: Date.now() });
    });

    const result = await t.run(async (ctx) => listAllWorkspaces(ctx, { userId }));
    expect(result).toHaveLength(0);
  });

  test('excludes chatrooms not owned by the user', async () => {
    const owner = await createSession('all-owner');
    const other = await createSession('all-other');
    const chatroomId = await createChatroom(owner.sessionId);
    await registerMachine(owner.sessionId, 'all-own-machine');
    await registerWorkspace(owner.sessionId, chatroomId, 'all-own-machine', '/tmp/private');

    const result = await t.run(async (ctx) => listAllWorkspaces(ctx, { userId: other.userId }));
    expect(result).toHaveLength(0);
  });

  test('enriches machine alias', async () => {
    const { sessionId, userId } = await createSession('all-enrich');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'all-enrich-machine';
    await registerMachine(sessionId, machineId);
    await registerWorkspace(sessionId, chatroomId, machineId, '/tmp/enrich');
    await t.mutation(api.machines.setMachineAlias, { sessionId, machineId, alias: 'Dev-Box' });

    const result = await t.run(async (ctx) => listAllWorkspaces(ctx, { userId }));
    expect(result[0]!.machineAlias).toBe('Dev-Box');
    expect(result[0]).not.toHaveProperty('chatroomName');
  });
});
