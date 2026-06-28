/**
 * Tests for skill prompt full output verification.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { t } from './test.setup';

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

describe('skill activation: what the agent sees', () => {
  test('backlog: agent sees full default prompt on activate', async () => {
    const { sessionId } = await createTestSession('agent-sees-backlog-1');
    const chatroomId = await createChatroom(sessionId);

    const result = await t.mutation(api.skills.activate, {
      sessionId,
      chatroomId,
      skillId: 'backlog',
      role: 'builder',
    });

    expect(result.success).toBe(true);

    const event = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('type'), 'skill.activated'))
        .first();
    });

    expect(event).toBeDefined();
    expect(event?.prompt).toContain('You have been activated with the "backlog" skill');
    expect(event?.prompt).toContain('mark-for-review');
  });
});
