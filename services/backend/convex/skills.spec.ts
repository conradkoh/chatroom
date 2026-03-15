/**
 * Tests for skills mutations and queries.
 */

import { ConvexError } from 'convex/values';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('skills.activate', () => {
  test('activates a valid built-in skill and creates a pending task', async () => {
    const { sessionId } = await createTestSession('skills-activate-valid-1');
    const chatroomId = await createChatroom(sessionId);

    const result = await t.mutation(api.skills.activate, {
      sessionId,
      chatroomId,
      skillId: 'backlog-score',
      role: 'builder',
    });

    expect(result.success).toBe(true);
    expect(result.skill.skillId).toBe('backlog-score');
    expect(result.skill.name).toBe('Score Backlog');

    // Verify a pending task was created with the skill prompt as content
    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });

    expect(task).toBeDefined();
    expect(task?.status).toBe('pending');
    expect(task?.origin).toBe('chat');
    expect(task?.content).toContain('backlog-score');
  });

  test('throws ConvexError for an unknown skill', async () => {
    const { sessionId } = await createTestSession('skills-activate-unknown-1');
    const chatroomId = await createChatroom(sessionId);

    await expect(
      t.mutation(api.skills.activate, {
        sessionId,
        chatroomId,
        skillId: 'nonexistent-skill',
        role: 'builder',
      })
    ).rejects.toThrow(ConvexError);

    // Also verify the error message contains the expected text
    await expect(
      t.mutation(api.skills.activate, {
        sessionId,
        chatroomId,
        skillId: 'nonexistent-skill',
        role: 'builder',
      })
    ).rejects.toMatchObject({
      data: expect.stringContaining('not found or is disabled'),
    });
  });
});

describe('skills.list', () => {
  test('returns seeded built-in skills after activate is called', async () => {
    const { sessionId } = await createTestSession('skills-list-after-activate-1');
    const chatroomId = await createChatroom(sessionId);

    // Activate seeds built-ins
    await t.mutation(api.skills.activate, {
      sessionId,
      chatroomId,
      skillId: 'backlog-score',
      role: 'builder',
    });

    const skills = await t.query(api.skills.list, {
      sessionId,
      chatroomId,
    });

    expect(skills).toBeDefined();
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.some((s) => s.skillId === 'backlog-score')).toBe(true);
  });

  test('returns empty array when no skills exist', async () => {
    const { sessionId } = await createTestSession('skills-list-empty-1');
    const chatroomId = await createChatroom(sessionId);

    const skills = await t.query(api.skills.list, {
      sessionId,
      chatroomId,
    });

    expect(skills).toEqual([]);
  });
});

describe('skills.get', () => {
  test('returns a skill after it has been seeded', async () => {
    const { sessionId } = await createTestSession('skills-get-1');
    const chatroomId = await createChatroom(sessionId);

    // Seed via activate
    await t.mutation(api.skills.activate, {
      sessionId,
      chatroomId,
      skillId: 'backlog-score',
      role: 'builder',
    });

    const skill = await t.query(api.skills.get, {
      sessionId,
      chatroomId,
      skillId: 'backlog-score',
    });

    expect(skill).toBeDefined();
    expect(skill?.skillId).toBe('backlog-score');
    expect(skill?.type).toBe('builtin');
    expect(skill?.isEnabled).toBe(true);
  });

  test('returns null for a non-existent skill', async () => {
    const { sessionId } = await createTestSession('skills-get-null-1');
    const chatroomId = await createChatroom(sessionId);

    const skill = await t.query(api.skills.get, {
      sessionId,
      chatroomId,
      skillId: 'does-not-exist',
    });

    expect(skill).toBeNull();
  });
});
