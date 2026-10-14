import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { checkAccess } from '../../modules/auth/accessCheck';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  joinParticipant,
  registerMachineWithDaemon,
} from '../helpers/integration';

describe('security authz protections', () => {
  test('getTasksByIds does not return tasks from unauthorized chatrooms', async () => {
    const { sessionId: ownerSession } = await createTestSession('test-sec-owner');
    const { sessionId: attackerSession } = await createTestSession('test-sec-attacker');

    const ownerChatroomId = await createDuoTeamChatroom(ownerSession);
    const attackerChatroomId = await createDuoTeamChatroom(attackerSession);

    await joinParticipant(ownerSession, ownerChatroomId, 'builder');
    await joinParticipant(attackerSession, attackerChatroomId, 'builder');

    const ownerTask = await t.mutation(api.tasks.createTask, {
      sessionId: ownerSession,
      chatroomId: ownerChatroomId,
      content: 'Owner task',
      createdBy: 'user',
    });

    const attackerTask = await t.mutation(api.tasks.createTask, {
      sessionId: attackerSession,
      chatroomId: attackerChatroomId,
      content: 'Attacker task',
      createdBy: 'user',
    });

    const leakedTasks = await t.query(api.tasks.getTasksByIds, {
      sessionId: attackerSession,
      taskIds: [ownerTask.taskId, attackerTask.taskId],
    });

    expect(leakedTasks).toHaveLength(1);
    expect(leakedTasks[0]?._id).toBe(attackerTask.taskId);
  });

  test('saveConfig rejects non-owner access', async () => {
    const { sessionId: ownerSession } = await createTestSession('test-sec-owner-save');
    const { sessionId: attackerSession } = await createTestSession('test-sec-attacker-save');

    const ownerChatroomId = await createDuoTeamChatroom(ownerSession);
    const machineId = 'machine-sec-owner-save';
    await registerMachineWithDaemon(ownerSession, machineId);
    const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
      sessionId: ownerSession,
      chatroomId: ownerChatroomId,
      machineId,
      workingDir: '/test/workspace',
      hostname: 'test-host',
      registeredBy: 'planner',
    });

    await expect(
      t.mutation(api.agents.saveConfig, {
        sessionId: attackerSession,
        chatroomId: ownerChatroomId,
        role: 'builder',
        workspaceId,
        machineId,
        agentHarness: 'opencode',
        model: 'auto',
        workingDir: '/test/workspace',
      })
    ).rejects.toThrow('Access denied');
  });

  test('listLastSentLaunchRequests rejects non-owner access', async () => {
    const { sessionId: ownerSession } = await createTestSession('test-sec-owner-read');
    const { sessionId: attackerSession } = await createTestSession('test-sec-attacker-read');

    const ownerChatroomId = await createDuoTeamChatroom(ownerSession);
    const machineId = 'machine-sec-owner-read';
    await registerMachineWithDaemon(ownerSession, machineId);
    const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
      sessionId: ownerSession,
      chatroomId: ownerChatroomId,
      machineId,
      workingDir: '/test/workspace',
      hostname: 'test-host',
      registeredBy: 'planner',
    });

    await t.mutation(api.agents.saveConfig, {
      sessionId: ownerSession,
      chatroomId: ownerChatroomId,
      workspaceId,
      role: 'builder',
      machineId,
      agentHarness: 'opencode',
      model: 'auto',
      workingDir: '/test/workspace',
    });

    await expect(
      t.query(api.agents.listLastSentLaunchRequests, {
        sessionId: attackerSession,
        chatroomId: ownerChatroomId,
      })
    ).rejects.toThrow('Access denied');
  });
});

// ─── Non-owner machine write-access (chatroom membership via the Convex adapter) ───

/** Seed a workspace registration directly, so a chatroom other than the machine owner's can exist. */
async function seedWorkspace(params: {
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  workingDir: string;
  removedAt?: number;
}): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert('chatroom_workspaces', {
      chatroomId: params.chatroomId,
      machineId: params.machineId,
      workingDir: params.workingDir,
      hostname: 'test-host',
      registeredBy: 'test',
      registeredAt: Date.now(),
      fileTreeSyncEnabled: false,
      ...(params.removedAt === undefined ? {} : { removedAt: params.removedAt }),
    })
  );
}

/** The user a test session authenticates as (`loginAnon` is not idempotent, so read it back). */
async function userIdForSession(sessionId: string): Promise<string> {
  return t.run(async (ctx) => {
    const session = await ctx.db
      .query('sessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
      .first();
    if (!session) throw new Error(`No session for ${sessionId}`);
    return session.userId;
  });
}

describe('machine write-access via chatroom membership (Convex adapter)', () => {
  test('a non-owner who owns a chatroom with an active workspace gets write-access', async () => {
    const { sessionId: ownerSession } = await createTestSession('test-sec-mwa-grant-owner');
    const { sessionId: collaboratorSession } = await createTestSession('test-sec-mwa-grant-collab');
    const machineId = 'machine-sec-mwa-grant';
    await registerMachineWithDaemon(ownerSession, machineId);

    const collaboratorChatroomId = await createDuoTeamChatroom(collaboratorSession);
    await seedWorkspace({
      chatroomId: collaboratorChatroomId,
      machineId,
      workingDir: '/test/mwa-collaborator',
    });

    const collaboratorUserId = await userIdForSession(collaboratorSession);

    const result = await t.run((ctx) =>
      checkAccess(ctx, {
        accessor: { type: 'user', id: collaboratorUserId },
        resource: { type: 'machine', id: machineId },
        permission: 'write-access',
      })
    );

    expect(result).toEqual({ ok: true, permission: 'write-access' });
  });

  test('removed workspaces are skipped so the machine reports no registrations', async () => {
    const { sessionId: ownerSession } = await createTestSession('test-sec-mwa-removed-owner');
    const { sessionId: strangerSession } = await createTestSession('test-sec-mwa-removed-stranger');
    const machineId = 'machine-sec-mwa-removed';
    await registerMachineWithDaemon(ownerSession, machineId);

    const ownerChatroomId = await createDuoTeamChatroom(ownerSession);
    await seedWorkspace({
      chatroomId: ownerChatroomId,
      machineId,
      workingDir: '/test/mwa-removed',
      removedAt: Date.now(),
    });

    const strangerUserId = await userIdForSession(strangerSession);

    const result = await t.run((ctx) =>
      checkAccess(ctx, {
        accessor: { type: 'user', id: strangerUserId },
        resource: { type: 'machine', id: machineId },
        permission: 'write-access',
      })
    );

    expect(result).toEqual({ ok: false, reason: 'Machine has no workspace registrations' });
  });

  test('a non-owner with no owned chatroom is denied with the exact reason', async () => {
    const { sessionId: ownerSession } = await createTestSession('test-sec-mwa-denied-owner');
    const { sessionId: strangerSession } = await createTestSession('test-sec-mwa-denied-stranger');
    const machineId = 'machine-sec-mwa-denied';
    await registerMachineWithDaemon(ownerSession, machineId);

    const ownerChatroomId = await createDuoTeamChatroom(ownerSession);
    await seedWorkspace({
      chatroomId: ownerChatroomId,
      machineId,
      workingDir: '/test/mwa-owner',
    });

    const strangerUserId = await userIdForSession(strangerSession);

    const result = await t.run((ctx) =>
      checkAccess(ctx, {
        accessor: { type: 'user', id: strangerUserId },
        resource: { type: 'machine', id: machineId },
        permission: 'write-access',
      })
    );

    expect(result).toEqual({
      ok: false,
      reason: 'User does not have access to any chatroom with this machine',
    });
  });
});
