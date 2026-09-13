import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { t } from './test.setup';

async function createSession(id: string) {
  const result = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(result.success).toBe(true);
  return { sessionId: id as SessionId, userId: result.userId as Id<'users'> };
}

describe('active team structure assignment', () => {
  test('creates and reads the versioned static structure from its assignment table', async () => {
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

    const structure = await t.query(api.chatrooms.getTeamStructureForChatroom, {
      sessionId,
      chatroomId,
    });
    expect(structure).toMatchObject({
      teamId: 'duo',
      teamStructureId: 'duo@1',
      entryPoint: 'planner',
    });
  });

  test('switches the active assignment without client-supplied structural fields', async () => {
    const { sessionId } = await createSession('team-structure-switch');
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamStructureId: 'duo',
    });

    await t.mutation(api.chatrooms.updateTeam, {
      sessionId,
      chatroomId,
      teamStructureId: 'solo',
    });

    const assignment = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_activeTeamStructures')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first()
    );
    expect(assignment?.teamStructureId).toBe('solo@1');

    const structure = await t.query(api.chatrooms.getTeamStructureForChatroom, {
      sessionId,
      chatroomId,
    });
    expect(structure).toMatchObject({
      teamId: 'solo',
      teamStructureId: 'solo@1',
      entryPoint: 'solo',
    });
  });
});
