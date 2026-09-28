/**
 * Tests for assertMachineBelongsToChatroom — binding match, mismatch, and no-binding branches.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { assertMachineBelongsToChatroom } from './assert-machine-belongs-to-chatroom';
import { recordLastSentLaunchRequest } from './record-last-sent-launch-request';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { AgentStartReasonCode } from '../../entities/agent';

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

describe('assertMachineBelongsToChatroom', () => {
  test('allows when bound machine matches', async () => {
    const { sessionId } = await createTestSession('assert-m-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'm-assert-1';

    await t.run(async (ctx) => {
      const now = Date.now();
      const user = await ctx.db.query('users').first();
      await recordLastSentLaunchRequest(ctx, {
        requestId: 'assert-m-1-request',
        commandId: 'assert-m-1-command',
        chatroomId,
        teamStructureId: 'duo@1',
        role: 'builder',
        agentType: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'm',
        workingDir: '/tmp',
        reason: AgentStartReasonCode.USER_START,
        wantResume: false,
        requestedBy: user!._id,
        requestedAt: now,
      });
      /*
       * The role binding is the last launch request, not a desired-config row.
       */
      await ctx.db.insert('chatroom_agentRoleStatusReadModel', {
        chatroomId,
        role: 'builder',
        roleKind: 'persistent',
        status: 'starting',
        machineId,
        projectedAt: now,
      });
    });

    await t.run(async (ctx) => {
      await expect(
        assertMachineBelongsToChatroom(ctx, {
          chatroomId,
          machineId,
          role: 'builder',
          allowNewMachine: false,
        })
      ).resolves.toBeUndefined();
    });
  });

  test('throws when bound to a different machine and allowNewMachine is false', async () => {
    const { sessionId, userId } = await createTestSession('assert-m-2');
    const chatroomId = await createChatroom(sessionId);

    await t.run(async (ctx) => {
      const now = Date.now();
      await recordLastSentLaunchRequest(ctx, {
        requestId: 'assert-m-2-request',
        commandId: 'assert-m-2-command',
        chatroomId,
        teamStructureId: 'duo@1',
        role: 'builder',
        agentType: 'remote',
        machineId: 'old-machine',
        agentHarness: 'opencode',
        model: 'm',
        workingDir: '/tmp',
        reason: AgentStartReasonCode.USER_START,
        wantResume: false,
        requestedBy: userId,
        requestedAt: now,
      });
    });

    await t.run(async (ctx) => {
      await expect(
        assertMachineBelongsToChatroom(ctx, {
          chatroomId,
          machineId: 'new-machine',
          role: 'builder',
          allowNewMachine: false,
        })
      ).rejects.toThrow(/allowNewMachine: true/);
    });
  });

  test('allows when bound to a different machine and allowNewMachine is true', async () => {
    const { sessionId, userId } = await createTestSession('assert-m-3');
    const chatroomId = await createChatroom(sessionId);

    await t.run(async (ctx) => {
      const now = Date.now();
      await recordLastSentLaunchRequest(ctx, {
        requestId: 'assert-m-3-request',
        commandId: 'assert-m-3-command',
        chatroomId,
        teamStructureId: 'duo@1',
        role: 'builder',
        agentType: 'remote',
        machineId: 'old-machine',
        agentHarness: 'opencode',
        model: 'm',
        workingDir: '/tmp',
        reason: AgentStartReasonCode.USER_START,
        wantResume: false,
        requestedBy: userId,
        requestedAt: now,
      });
    });

    await t.run(async (ctx) => {
      await expect(
        assertMachineBelongsToChatroom(ctx, {
          chatroomId,
          machineId: 'new-machine',
          role: 'builder',
          allowNewMachine: true,
        })
      ).resolves.toBeUndefined();
    });
  });

  test('throws when there is no machine binding and allowNewMachine is false', async () => {
    const { sessionId } = await createTestSession('assert-m-4');
    const chatroomId = await createChatroom(sessionId);

    await t.run(async (ctx) => {
      await expect(
        assertMachineBelongsToChatroom(ctx, {
          chatroomId,
          machineId: 'any-machine',
          role: 'builder',
          allowNewMachine: false,
        })
      ).rejects.toThrow(/No machine binding exists/);
    });
  });

  test('allows when there is no machine binding and allowNewMachine is true', async () => {
    const { sessionId } = await createTestSession('assert-m-5');
    const chatroomId = await createChatroom(sessionId);

    await t.run(async (ctx) => {
      await expect(
        assertMachineBelongsToChatroom(ctx, {
          chatroomId,
          machineId: 'any-machine',
          role: 'builder',
          allowNewMachine: true,
        })
      ).resolves.toBeUndefined();
    });
  });
});
