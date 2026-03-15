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

  test('seeding is idempotent — calling activate twice does not duplicate skills', async () => {
    const { sessionId } = await createTestSession('skills-activate-idempotent-1');
    const chatroomId = await createChatroom(sessionId);

    // Activate twice
    await t.mutation(api.skills.activate, {
      sessionId,
      chatroomId,
      skillId: 'backlog-score',
      role: 'builder',
    });
    await t.mutation(api.skills.activate, {
      sessionId,
      chatroomId,
      skillId: 'backlog-score',
      role: 'builder',
    });

    // List should show only one backlog-score entry
    const skills = await t.query(api.skills.list, {
      sessionId,
      chatroomId,
    });

    const backlogScoreSkills = skills.filter((s) => s.skillId === 'backlog-score');
    expect(backlogScoreSkills).toHaveLength(1);
  });

  test('activate correctly sets createdBy on the task', async () => {
    const { sessionId } = await createTestSession('skills-activate-createdby-1');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.skills.activate, {
      sessionId,
      chatroomId,
      skillId: 'backlog-score',
      role: 'planner',
    });

    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });

    expect(task).toBeDefined();
    expect(task?.createdBy).toBe('planner');
  });

  test('activate fails if sessionId is invalid', async () => {
    const { sessionId } = await createTestSession('skills-activate-invalidsession-1');
    const chatroomId = await createChatroom(sessionId);

    await expect(
      t.mutation(api.skills.activate, {
        sessionId: 'bogus-invalid-session-id-xyz' as SessionId,
        chatroomId,
        skillId: 'backlog-score',
        role: 'builder',
      })
    ).rejects.toThrow();
  });

  test('activate fails if chatroomId belongs to a different session', async () => {
    const { sessionId: sessionA } = await createTestSession('skills-activate-crosschatroom-a');
    const { sessionId: sessionB } = await createTestSession('skills-activate-crosschatroom-b');

    // chatroomA belongs to sessionA
    const chatroomA = await createChatroom(sessionA);
    // chatroomB belongs to sessionB
    await createChatroom(sessionB);

    // sessionB tries to activate a skill in chatroomA — should be rejected
    await expect(
      t.mutation(api.skills.activate, {
        sessionId: sessionB,
        chatroomId: chatroomA,
        skillId: 'backlog-score',
        role: 'builder',
      })
    ).rejects.toThrow();
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

  test('only returns enabled skills — disabled skills are excluded', async () => {
    const { sessionId } = await createTestSession('skills-list-disabled-1');
    const chatroomId = await createChatroom(sessionId);

    // Seed via activate
    await t.mutation(api.skills.activate, {
      sessionId,
      chatroomId,
      skillId: 'backlog-score',
      role: 'builder',
    });

    // Manually disable the skill
    await t.run(async (ctx) => {
      const skill = await ctx.db
        .query('chatroom_skills')
        .withIndex('by_chatroom_skillId', (q) =>
          q.eq('chatroomId', chatroomId).eq('skillId', 'backlog-score')
        )
        .unique();
      if (skill) {
        await ctx.db.patch(skill._id, { isEnabled: false });
      }
    });

    const skills = await t.query(api.skills.list, {
      sessionId,
      chatroomId,
    });

    // Disabled skill should not appear
    expect(skills.some((s) => s.skillId === 'backlog-score')).toBe(false);
  });

  test('returns correct shape { skillId, name, description, type } without prompt or _id', async () => {
    const { sessionId } = await createTestSession('skills-list-shape-1');
    const chatroomId = await createChatroom(sessionId);

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

    expect(skills.length).toBeGreaterThan(0);
    const skill = skills[0]!;

    // Required fields
    expect(skill).toHaveProperty('skillId');
    expect(skill).toHaveProperty('name');
    expect(skill).toHaveProperty('description');
    expect(skill).toHaveProperty('type');

    // Fields that should NOT be present in the summary view
    expect(skill).not.toHaveProperty('prompt');
    expect(skill).not.toHaveProperty('_id');
    expect(skill).not.toHaveProperty('_creationTime');
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

  test('returns the full document including prompt text', async () => {
    const { sessionId } = await createTestSession('skills-get-prompt-1');
    const chatroomId = await createChatroom(sessionId);

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
    // Prompt should be a non-empty string containing key context
    expect(typeof skill?.prompt).toBe('string');
    expect(skill?.prompt).toContain('backlog-score');
  });
});
