/**
 * Tests for skills mutations and queries.
 * Built-in skills are read from BUILTIN_SKILLS constants — no DB seeding.
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
  test('activates the backlog skill and creates a pending task', async () => {
    const { sessionId } = await createTestSession('skills-activate-valid-1');
    const chatroomId = await createChatroom(sessionId);

    const result = await t.mutation(api.skills.activate, {
      sessionId,
      chatroomId,
      skillId: 'backlog',
      role: 'builder',
    });

    expect(result.success).toBe(true);
    expect(result.skill.skillId).toBe('backlog');
    expect(result.skill.name).toBe('Backlog Reference');

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
    expect(task?.content).toContain('Continuous Backlog Execution');
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

  test('activate correctly sets createdBy on the task', async () => {
    const { sessionId } = await createTestSession('skills-activate-createdby-1');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.skills.activate, {
      sessionId,
      chatroomId,
      skillId: 'backlog',
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
        skillId: 'backlog',
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
        skillId: 'backlog',
        role: 'builder',
      })
    ).rejects.toThrow();
  });

  test('activates software-engineering skill and creates a pending task with SOLID content', async () => {
    const { sessionId } = await createTestSession('skills-se-activate-1');
    const chatroomId = await createChatroom(sessionId);

    const result = await t.mutation(api.skills.activate, {
      sessionId,
      chatroomId,
      skillId: 'software-engineering',
      role: 'builder',
    });

    expect(result.success).toBe(true);
    expect(result.skill.skillId).toBe('software-engineering');

    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });

    expect(task).toBeDefined();
    expect(task?.status).toBe('pending');
    expect(task?.content).toContain('SOLID');
  });
});

describe('skills.list', () => {
  test('returns all built-in skills without requiring activate first', async () => {
    const { sessionId } = await createTestSession('skills-list-all-1');
    const chatroomId = await createChatroom(sessionId);

    // list reads from constants — no activate needed
    const skills = await t.query(api.skills.list, {
      sessionId,
      chatroomId,
    });

    expect(skills).toBeDefined();
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.some((s) => s.skillId === 'backlog')).toBe(true);
    expect(skills.some((s) => s.skillId === 'software-engineering')).toBe(true);
  });

  test('returns correct shape { skillId, name, description, type } without prompt or _id', async () => {
    const { sessionId } = await createTestSession('skills-list-shape-1');
    const chatroomId = await createChatroom(sessionId);

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
  test('returns the backlog skill directly from constants', async () => {
    const { sessionId } = await createTestSession('skills-get-1');
    const chatroomId = await createChatroom(sessionId);

    // get reads from constants — no activate needed
    const skill = await t.query(api.skills.get, {
      sessionId,
      chatroomId,
      skillId: 'backlog',
    });

    expect(skill).toBeDefined();
    expect(skill?.skillId).toBe('backlog');
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

  test('returns the full document with consolidated backlog prompt containing all 3 workflows', async () => {
    const { sessionId } = await createTestSession('skills-get-prompt-1');
    const chatroomId = await createChatroom(sessionId);

    // get reads from constants — no activate needed
    const skill = await t.query(api.skills.get, {
      sessionId,
      chatroomId,
      skillId: 'backlog',
    });

    expect(skill).toBeDefined();
    expect(typeof skill?.prompt).toBe('string');
    // Workflow 3: Continuous Backlog Execution
    expect(skill?.prompt).toContain('Continuous Backlog Execution');
    // Workflow 2: After completing a task
    expect(skill?.prompt).toContain('pending_user_review');
    // Stale item concept
    expect(skill?.prompt).toContain('Stale item');
  });
});
