/** Tests for the structural team-switch use case. */

import { describe, expect, test } from 'vitest';

import { updateTeam } from './update-team';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { createTestSession } from '../../../../tests/helpers/integration';

describe('updateTeam use case', () => {
  test('records a structural switch without reconciling agent lifecycle state', async () => {
    const { sessionId } = await createTestSession('test-utu-structural-switch');
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId: sessionId as any,
      teamStructureId: 'duo@1',
    });
    const userId = await t.run(async (ctx) => {
      const room = await ctx.db.get('chatroom_rooms', chatroomId);
      return room!.ownerId;
    });

    const result = await t.run(async (ctx) =>
      updateTeam(ctx, {
        chatroomId,
        teamId: 'solo',
        teamName: 'Solo Team',
        teamRoles: ['builder'],
        teamEntryPoint: 'builder',
        userId: userId as Id<'users'>,
      })
    );

    expect(result).toEqual({
      stoppedAgentCount: 0,
      preservedCount: 0,
      restoredCount: 0,
      seededCount: 0,
      startedAgentCount: 0,
    });

    const room = await t.run((ctx) => ctx.db.get('chatroom_rooms', chatroomId));
    expect(room?.teamId).toBeUndefined();
    expect(room?.teamRoles).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query('chatroom_agentDesiredConfigs').collect())).toEqual(
      []
    );
    expect(await t.run((ctx) => ctx.db.query('chatroom_agentRuntimeStates').collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query('chatroom_machineCommandInbox').collect())).toEqual(
      []
    );
  });
});
