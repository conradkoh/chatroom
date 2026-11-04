import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { t } from './test.setup';

const expectedRoles = {
  duo: [
    { role: 'planner', lifecycle: 'permanent', optional: false },
    { role: 'architect', lifecycle: 'ephemeral', optional: true },
    { role: 'researcher', lifecycle: 'ephemeral', optional: true },
    { role: 'triage', lifecycle: 'ephemeral', optional: true },
    { role: 'reviewer', lifecycle: 'ephemeral', optional: true },
    { role: 'uiux-engineer', lifecycle: 'ephemeral', optional: true },
    { role: 'game-asset-designer', lifecycle: 'ephemeral', optional: true },
    { role: 'verifier', lifecycle: 'ephemeral', optional: true },
    { role: 'builder', lifecycle: 'permanent', optional: false },
  ],
  solo: [
    { role: 'solo', lifecycle: 'permanent', optional: false },
    { role: 'architect', lifecycle: 'ephemeral', optional: true },
    { role: 'triage', lifecycle: 'ephemeral', optional: true },
    { role: 'uiux-engineer', lifecycle: 'ephemeral', optional: true },
    { role: 'verifier', lifecycle: 'ephemeral', optional: true },
  ],
} as const;

async function createSession(id: string) {
  const sessionId = id as SessionId;
  const result = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(result.success).toBe(true);
  return { sessionId, userId: result.userId as Id<'users'> };
}

async function expectStructure(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  teamId: 'duo' | 'solo'
) {
  const structure = await t.query(api.chatrooms.getTeamStructureForChatroom, {
    sessionId,
    chatroomId,
  });
  expect(structure).toMatchObject({
    teamId,
    teamStructureId: teamId === 'duo' ? 'duo@1' : 'solo@1',
    entryPoint: teamId === 'duo' ? 'planner' : 'solo',
    roles: expectedRoles[teamId],
  });
  expect(structure.roles.map(({ role }) => role)).toEqual(
    expectedRoles[teamId].map(({ role }) => role)
  );
  return structure;
}

describe('active team structure assignment', () => {
  test('creates and reads the complete Duo structure from its versioned assignment', async () => {
    const { sessionId } = await createSession('team-structure-create');
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamStructureId: 'duo',
    });

    const assignment = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_activeTeamStructures')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first()
    );
    expect(assignment?.teamStructureId).toBe('duo@1');
    await expectStructure(sessionId, chatroomId, 'duo');
  });

  test('switches to Solo, repeats that assignment, and ignores stale legacy role fields', async () => {
    const { sessionId } = await createSession('team-structure-switch');
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamStructureId: 'duo',
    });
    await expectStructure(sessionId, chatroomId, 'duo');

    await t.mutation(api.chatrooms.updateTeam, {
      sessionId,
      chatroomId,
      teamStructureId: 'solo',
    });
    await expectStructure(sessionId, chatroomId, 'solo');

    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_rooms', chatroomId, {
        teamId: 'duo',
        teamRoles: ['solo'],
        teamEntryPoint: 'solo',
      });
    });
    await t.mutation(api.chatrooms.updateTeam, {
      sessionId,
      chatroomId,
      teamStructureId: 'solo',
    });

    const assignments = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_activeTeamStructures')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.teamStructureId).toBe('solo@1');
    await expectStructure(sessionId, chatroomId, 'solo');
  });

  test('switching team reassigns pending and in-progress tasks of removed roles to the new entry point', async () => {
    const { sessionId } = await createSession('team-structure-reassign');
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamStructureId: 'duo',
    });

    const { pendingTaskId, inProgressTaskId } = await t.run(async (ctx) => {
      const now = Date.now();
      const pendingTaskId = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'pending builder task',
        status: 'pending',
        assignedTo: 'builder',
        queuePosition: 0,
        createdAt: now,
        updatedAt: now,
      });
      const inProgressTaskId = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'in-progress planner task',
        status: 'in_progress',
        assignedTo: 'planner',
        queuePosition: 1,
        createdAt: now,
        updatedAt: now,
      });
      return { pendingTaskId, inProgressTaskId };
    });

    await t.mutation(api.chatrooms.updateTeam, {
      sessionId,
      chatroomId,
      teamStructureId: 'solo',
    });

    const tasks = await t.run(async (ctx) => ({
      pending: await ctx.db.get('chatroom_tasks', pendingTaskId),
      inProgress: await ctx.db.get('chatroom_tasks', inProgressTaskId),
    }));
    expect(tasks.pending?.assignedTo).toBe('solo');
    expect(tasks.inProgress?.assignedTo).toBe('solo');
  });
});
