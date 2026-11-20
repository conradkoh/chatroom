/**
 * Unit tests for findActiveChatroomForWorkingDir.
 *
 * The lookup is the shared "has chatroom" seam for the repository ledger and bulk create:
 * an active, owner-matching chatroom must have an active workspace row for the machine and
 * normalized working directory. Archived chatrooms, removed workspaces, other owners and
 * other machines never match; legacy un-normalized workspace keys do not match either.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { findActiveChatroomForWorkingDir } from './find-active-chatroom-for-working-dir';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import {
  createSoloTeamChatroom,
  registerMachineWithDaemon,
} from '../../../../tests/helpers/integration';

const WORKING_DIR = '/work/repo-1';

async function createOwner(sessionKey: string) {
  const sessionId = sessionKey as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  return { sessionId, ownerId: login.userId as Id<'users'> };
}

async function setup(sessionKey: string, machineId: string) {
  const { sessionId, ownerId } = await createOwner(sessionKey);
  await registerMachineWithDaemon(sessionId, machineId);
  const chatroomId = await createSoloTeamChatroom(sessionId);
  const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir: WORKING_DIR,
    hostname: 'test-host',
    registeredBy: 'builder',
  });
  return { sessionId, ownerId, chatroomId, workspaceId };
}

function find(ownerId: Id<'users'>, machineId: string, workingDir: string) {
  return t.run((ctx) => findActiveChatroomForWorkingDir(ctx, { ownerId, machineId, workingDir }));
}

describe('findActiveChatroomForWorkingDir', () => {
  test('returns the chatroom for an active chatroom with an active workspace', async () => {
    const { ownerId, chatroomId } = await setup('find-active-1', 'machine-find-active-1');

    expect(await find(ownerId, 'machine-find-active-1', WORKING_DIR)).toEqual({ chatroomId });
  });

  test('returns null when no workspace has the path', async () => {
    const { ownerId } = await setup('find-active-2', 'machine-find-active-2');

    expect(await find(ownerId, 'machine-find-active-2', '/work/never-registered')).toBeNull();
  });

  test('returns null for an archived chatroom', async () => {
    const { sessionId, ownerId, chatroomId } = await setup(
      'find-active-3',
      'machine-find-active-3'
    );
    await t.mutation(api.chatrooms.archive, { sessionId, chatroomId });

    expect(await find(ownerId, 'machine-find-active-3', WORKING_DIR)).toBeNull();
  });

  test('returns null for a removed workspace', async () => {
    const { sessionId, ownerId, workspaceId } = await setup(
      'find-active-4',
      'machine-find-active-4'
    );
    await t.mutation(api.workspaces.removeWorkspace, { sessionId, workspaceId });

    expect(await find(ownerId, 'machine-find-active-4', WORKING_DIR)).toBeNull();
  });

  test('returns null when the chatroom belongs to another user', async () => {
    const { ownerId } = await setup('find-active-5', 'machine-find-active-5');
    const { ownerId: otherOwnerId } = await createOwner('find-active-5-other');

    expect(await find(otherOwnerId, 'machine-find-active-5', WORKING_DIR)).toBeNull();
    expect(await find(ownerId, 'machine-find-active-5', WORKING_DIR)).not.toBeNull();
  });

  test('returns null for a legacy workspace row stored with a trailing slash', async () => {
    const { ownerId, chatroomId } = await setup('find-active-6', 'machine-find-active-6');
    await t.run(async (ctx) =>
      ctx.db.insert('chatroom_workspaces', {
        chatroomId,
        machineId: 'machine-find-active-6',
        workingDir: '/work/legacy/',
        hostname: 'test-host',
        registeredAt: 0,
        registeredBy: 'builder',
      })
    );

    expect(await find(ownerId, 'machine-find-active-6', '/work/legacy')).toBeNull();
  });

  test('normalizes its own input', async () => {
    const { ownerId, chatroomId } = await setup('find-active-7', 'machine-find-active-7');

    expect(await find(ownerId, 'machine-find-active-7', '/work/repo-1/')).toEqual({
      chatroomId,
    });
  });

  test('returns null when the workspace is registered on a different machine', async () => {
    const { sessionId, ownerId, chatroomId } = await setup(
      'find-active-8',
      'machine-find-active-8'
    );
    const otherMachineId = 'machine-find-active-8-other';
    await registerMachineWithDaemon(sessionId, otherMachineId);
    await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId: otherMachineId,
      workingDir: '/work/only-on-other-machine',
      hostname: 'test-host',
      registeredBy: 'builder',
    });

    expect(await find(ownerId, 'machine-find-active-8', '/work/only-on-other-machine')).toBeNull();
  });
});
