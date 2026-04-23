/**
 * Tests for assertMachineBelongsToChatroom — binding match, mismatch, and no-binding branches.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';
import { assertMachineBelongsToChatroom } from './assert-machine-belongs-to-chatroom';

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

describe('assertMachineBelongsToChatroom', () => {
  test('allows when bound machine matches', async () => {
    const { sessionId } = await createTestSession('assert-m-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'm-assert-1';

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'pair', 'builder'),
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'm',
        workingDir: '/tmp',
        createdAt: now,
        updatedAt: now,
        desiredState: 'running',
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
    const { sessionId } = await createTestSession('assert-m-2');
    const chatroomId = await createChatroom(sessionId);

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'pair', 'builder'),
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId: 'old-machine',
        agentHarness: 'opencode',
        model: 'm',
        workingDir: '/tmp',
        createdAt: now,
        updatedAt: now,
        desiredState: 'running',
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
    const { sessionId } = await createTestSession('assert-m-3');
    const chatroomId = await createChatroom(sessionId);

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'pair', 'builder'),
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId: 'old-machine',
        agentHarness: 'opencode',
        model: 'm',
        workingDir: '/tmp',
        createdAt: now,
        updatedAt: now,
        desiredState: 'running',
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
