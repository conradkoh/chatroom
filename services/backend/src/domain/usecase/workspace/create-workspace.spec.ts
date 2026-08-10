/**
 * Integration tests for createWorkspace (user-owned unassigned workspace).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

async function createSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
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

describe('createWorkspace', () => {
  test('creates an unassigned user-owned workspace', async () => {
    const { sessionId, userId } = await createSession('create-ok');
    const machineId = 'create-ok-machine';
    await registerMachine(sessionId, machineId);

    const id = await t.mutation(api.workspaces.createWorkspace, {
      sessionId,
      machineId,
      workingDir: '/tmp/project',
    });

    const row = await t.run(async (ctx) => ctx.db.get('chatroom_workspaces', id));
    expect(row).toMatchObject({
      userId,
      machineId,
      workingDir: '/tmp/project',
      hostname: 'test-host',
      registeredBy: 'user',
    });
    expect(row?.chatroomId).toBeUndefined();
  });

  test('rejects a machine the user does not own', async () => {
    const owner = await createSession('create-owner');
    const other = await createSession('create-other');
    await registerMachine(owner.sessionId, 'create-owned-machine');

    await expect(
      t.mutation(api.workspaces.createWorkspace, {
        sessionId: other.sessionId,
        machineId: 'create-owned-machine',
        workingDir: '/tmp/private',
      })
    ).rejects.toThrow();
  });

  test('normalizes the working directory before storing', async () => {
    const { sessionId } = await createSession('create-norm');
    const machineId = 'create-norm-machine';
    await registerMachine(sessionId, machineId);

    const id = await t.mutation(api.workspaces.createWorkspace, {
      sessionId,
      machineId,
      workingDir: '/tmp/normalize//',
    });

    const row = await t.run(async (ctx) => ctx.db.get('chatroom_workspaces', id));
    expect(row?.workingDir).toBe('/tmp/normalize');
  });

  test('conflicts on an active duplicate machine + path', async () => {
    const { sessionId } = await createSession('create-conflict');
    const machineId = 'create-conflict-machine';
    await registerMachine(sessionId, machineId);
    await t.mutation(api.workspaces.createWorkspace, {
      sessionId,
      machineId,
      workingDir: '/tmp/dup',
    });

    await expect(
      t.mutation(api.workspaces.createWorkspace, {
        sessionId,
        machineId,
        workingDir: '/tmp/dup',
      })
    ).rejects.toMatchObject({
      data: { code: 'CONFLICT', fields: ['machineId', 'workingDir'] },
    });
  });

  test('allows the same path on a different machine', async () => {
    const { sessionId } = await createSession('create-cross');
    const machineA = 'create-cross-a';
    const machineB = 'create-cross-b';
    await registerMachine(sessionId, machineA);
    await registerMachine(sessionId, machineB);

    const a = await t.mutation(api.workspaces.createWorkspace, {
      sessionId,
      machineId: machineA,
      workingDir: '/tmp/shared',
    });
    const b = await t.mutation(api.workspaces.createWorkspace, {
      sessionId,
      machineId: machineB,
      workingDir: '/tmp/shared',
    });

    expect(a).not.toBe(b);
  });

  test('conflicts when an active chatroom-bound row exists for the machine + path', async () => {
    const { sessionId } = await createSession('create-chat-conflict');
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Test Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    const machineId = 'create-chat-conflict-machine';
    await registerMachine(sessionId, machineId);
    await registerChatroomWorkspace(sessionId, chatroomId, machineId, '/tmp/bound');

    await expect(
      t.mutation(api.workspaces.createWorkspace, {
        sessionId,
        machineId,
        workingDir: '/tmp/bound',
      })
    ).rejects.toMatchObject({ data: { code: 'CONFLICT' } });
  });

  test('a soft-deleted row does not block a fresh create', async () => {
    const { sessionId } = await createSession('create-soft');
    const machineId = 'create-soft-machine';
    await registerMachine(sessionId, machineId);

    const first = await t.mutation(api.workspaces.createWorkspace, {
      sessionId,
      machineId,
      workingDir: '/tmp/again',
    });
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_workspaces', first, { removedAt: Date.now() });
    });

    const second = await t.mutation(api.workspaces.createWorkspace, {
      sessionId,
      machineId,
      workingDir: '/tmp/again',
    });

    expect(second).not.toBe(first);
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_workspaces')
        .withIndex('by_machine_workingDir', (q) =>
          q.eq('machineId', machineId).eq('workingDir', '/tmp/again')
        )
        .collect()
    );
    expect(rows).toHaveLength(2);
  });
});
