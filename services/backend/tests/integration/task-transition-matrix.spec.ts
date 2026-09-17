/**
 * Task Transition Matrix — Integration Tests
 *
 * Verifies task lifecycle transitions for persistent and ephemeral team roles.
 *
 * DAEMON_WORKER_ROLES must match packages/cli/src/domain/execution-kind.ts
 *
 * | Role kind | Trigger | Expected result |
 * |-----------|---------|----------------|
 * | team_agent (planner) | readTask intent (daemon-driven) | in_progress |
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  assertDuoTeamOnly,
  createDuoTeamChatroom,
  createTestSession,
  joinParticipant,
} from '../helpers/integration';

async function createSessionChatroomAndJoin(
  key: string,
  role: string
): Promise<{ sessionId: Id<'chatroom_sessions'>; chatroomId: Id<'chatroom_rooms'> }> {
  const { sessionId } = await createTestSession(key);
  const chatroomId = await createDuoTeamChatroom(sessionId);
  await joinParticipant(sessionId, chatroomId, role);
  return { sessionId, chatroomId };
}

async function seedPendingTask(
  chatroomId: Id<'chatroom_rooms'>,
  assignedTo: string
): Promise<Id<'chatroom_tasks'>> {
  return t.run(async (ctx) => {
    return ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: `Pending task for ${assignedTo}`,
      status: 'pending',
      assignedTo,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      queuePosition: 0,
    });
  });
}

describe('task transition matrix', () => {
  test('team agent + readTask intent (daemon-driven) -> in_progress', async () => {
    const { sessionId, chatroomId } = await createSessionChatroomAndJoin('ttm-injected', 'planner');
    await assertDuoTeamOnly(chatroomId);

    const taskId = await seedPendingTask(chatroomId, 'planner');

    // The daemon's delivery claims the pending task (pending → acknowledged)…
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'planner',
      taskId,
    });

    // …and applies the read intent once the turn produces output.
    await t.mutation(api.tasks.readTask, {
      sessionId,
      chatroomId,
      role: 'planner',
      taskId,
    });

    const status = await t.run(async (ctx) => (await ctx.db.get('chatroom_tasks', taskId))?.status);
    expect(status).toBe('in_progress');
  });

  test('read intent on a pending task starts it without an acknowledged intermediate', async () => {
    const { sessionId, chatroomId } = await createSessionChatroomAndJoin('ttm-waiting', 'planner');
    await assertDuoTeamOnly(chatroomId);

    const taskId = await seedPendingTask(chatroomId, 'planner');

    await t.mutation(api.tasks.readTask, {
      sessionId,
      chatroomId,
      role: 'planner',
      taskId,
    });

    const status = await t.run(async (ctx) => (await ctx.db.get('chatroom_tasks', taskId))?.status);
    expect(status).toBe('in_progress');
  });
});
