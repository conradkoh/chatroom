/**
 * Integration tests for registerWorkspace path validation.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { listWorkspacesForChatroom } from './list-workspaces-for-chatroom';
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
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
}

describe('registerWorkspace path validation', () => {
  test('rejects relative working directory paths', async () => {
    const { sessionId } = await createSession('register-ws-invalid-path');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'machine-invalid-path';
    await registerMachine(sessionId, machineId);

    await expect(
      t.mutation(api.workspaces.registerWorkspace, {
        sessionId,
        chatroomId,
        machineId,
        workingDir: 'relative/path',
        hostname: 'test-host',
        registeredBy: 'user',
      })
    ).rejects.toThrow(/absolute path/i);
  });

  test('accepts valid absolute working directory paths', async () => {
    const { sessionId } = await createSession('register-ws-valid-path');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'machine-valid-path';
    await registerMachine(sessionId, machineId);

    const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/tmp/valid-workspace',
      hostname: 'test-host',
      registeredBy: 'user',
    });

    expect(workspaceId).toBeDefined();
  });

  test('new workspace defaults file-tree synchronization to disabled', async () => {
    const { sessionId } = await createSession('register-ws-sync-default');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'machine-sync-default';
    await registerMachine(sessionId, machineId);

    const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/tmp/sync-default-workspace',
      hostname: 'test-host',
      registeredBy: 'user',
    });

    const row = await t.run(async (ctx) => ctx.db.get('chatroom_workspaces', workspaceId));
    expect(row?.fileTreeSyncEnabled).toBe(false);
  });

  test('reactivating a workspace preserves its file-tree synchronization setting', async () => {
    const { sessionId } = await createSession('register-ws-sync-reactivate');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'machine-sync-reactivate';
    await registerMachine(sessionId, machineId);

    const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/tmp/sync-reactivate-workspace',
      hostname: 'test-host',
      registeredBy: 'user',
    });
    await t.mutation(api.workspaces.removeWorkspace, { sessionId, workspaceId });

    const reactivatedId = await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/tmp/sync-reactivate-workspace',
      hostname: 'test-host-2',
      registeredBy: 'user',
    });

    expect(reactivatedId).toBe(workspaceId);
    const row = await t.run(async (ctx) => ctx.db.get('chatroom_workspaces', workspaceId));
    expect(row?.fileTreeSyncEnabled).toBe(false);
    expect(row?.removedAt).toBeUndefined();
  });

  test('legacy workspace without a setting resolves disabled in list and get projections', async () => {
    const { sessionId } = await createSession('register-ws-sync-legacy');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'machine-sync-legacy';
    await registerMachine(sessionId, machineId);

    const workspaceId = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_workspaces', {
        chatroomId,
        machineId,
        workingDir: '/tmp/sync-legacy-workspace',
        hostname: 'test-host',
        registeredAt: Date.now(),
        registeredBy: 'user',
      })
    );

    const listed = await t.run((ctx) => listWorkspacesForChatroom(ctx, { chatroomId }));
    expect(listed.find((workspace) => workspace._id === workspaceId)?.fileTreeSyncEnabled).toBe(
      false
    );

    const fetched = await t.query(api.workspaces.getWorkspaceById, { sessionId, workspaceId });
    expect(fetched?.fileTreeSyncEnabled).toBe(false);
  });

  test('owner can toggle file-tree synchronization', async () => {
    const { sessionId } = await createSession('register-ws-sync-toggle');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'machine-sync-toggle';
    await registerMachine(sessionId, machineId);

    const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/tmp/sync-toggle-workspace',
      hostname: 'test-host',
      registeredBy: 'user',
    });

    await t.mutation(api.workspaces.setFileTreeSyncEnabled, {
      sessionId,
      workspaceId,
      enabled: true,
    });
    let row = await t.run(async (ctx) => ctx.db.get('chatroom_workspaces', workspaceId));
    expect(row?.fileTreeSyncEnabled).toBe(true);

    await t.mutation(api.workspaces.setFileTreeSyncEnabled, {
      sessionId,
      workspaceId,
      enabled: false,
    });
    row = await t.run(async (ctx) => ctx.db.get('chatroom_workspaces', workspaceId));
    expect(row?.fileTreeSyncEnabled).toBe(false);
  });

  test('disabling file-tree sync atomically stops watch lease and pending request', async () => {
    const { sessionId } = await createSession('register-ws-sync-disable-lifecycle');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'machine-sync-disable-lifecycle';
    const workingDir = '/tmp/sync-disable-lifecycle-workspace';
    await registerMachine(sessionId, machineId);

    const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir,
      hostname: 'test-host',
      registeredBy: 'user',
    });
    await t.mutation(api.workspaces.setFileTreeSyncEnabled, {
      sessionId,
      workspaceId,
      enabled: true,
    });

    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_workspaceFileTreeWatches', {
        machineId,
        workingDir,
        watchCount: 2,
        expiresAt: now + 60_000,
        updatedAt: now,
      });
      await ctx.db.insert('chatroom_workspaceFileTreeRequests', {
        machineId,
        workingDir,
        status: 'pending',
        force: false,
        requestedAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(api.workspaces.setFileTreeSyncEnabled, {
      sessionId,
      workspaceId,
      enabled: false,
    });

    const lifecycle = await t.run(async (ctx) => {
      const watch = await ctx.db
        .query('chatroom_workspaceFileTreeWatches')
        .withIndex('by_machine_workingDir', (q) =>
          q.eq('machineId', machineId).eq('workingDir', workingDir)
        )
        .first();
      const request = await ctx.db
        .query('chatroom_workspaceFileTreeRequests')
        .withIndex('by_machine_workingDir', (q) =>
          q.eq('machineId', machineId).eq('workingDir', workingDir)
        )
        .first();
      const release = await ctx.db
        .query('chatroom_workspaceFileTreeReleaseRequests')
        .withIndex('by_machine_workingDir', (q) =>
          q.eq('machineId', machineId).eq('workingDir', workingDir)
        )
        .first();
      return { watch, request, release };
    });

    expect(lifecycle.watch).toMatchObject({ watchCount: 0, updatedAt: expect.any(Number) });
    expect(lifecycle.watch?.expiresAt).toBeUndefined();
    expect(lifecycle.request).toMatchObject({ status: 'done', updatedAt: expect.any(Number) });
    expect(lifecycle.release).toMatchObject({ status: 'pending', workingDir });
  });

  test('different user cannot toggle file-tree synchronization', async () => {
    const { sessionId } = await createSession('register-ws-sync-owner');
    const { sessionId: otherSessionId } = await createSession('register-ws-sync-other');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'machine-sync-unauthorized';
    await registerMachine(sessionId, machineId);

    const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/tmp/sync-unauthorized-workspace',
      hostname: 'test-host',
      registeredBy: 'user',
    });

    await expect(
      t.mutation(api.workspaces.setFileTreeSyncEnabled, {
        sessionId: otherSessionId,
        workspaceId,
        enabled: true,
      })
    ).rejects.toThrow();
  });
});
