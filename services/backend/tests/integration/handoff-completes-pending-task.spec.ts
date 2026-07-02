/**
 * Handoff completes pending task — Integration Tests
 *
 * Verifies handoff-to-user completes the sender's top pending task even when
 * the sender never claimed or read it.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createPlannerBuilderDuoChatroom,
  createTestSession,
  joinParticipant,
} from '../helpers/integration';

describe('Handoff completes pending task', () => {
  test('handoff-to-user completes sender pending task without claim or read', async () => {
    const { sessionId } = await createTestSession('test-handoff-pending-complete');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');

    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Planner pending work',
      createdBy: 'user',
    });

    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_tasks', taskId, { assignedTo: 'planner' });
    });

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'user',
      content: 'Done — handing back to user.',
    });

    expect(result.success).toBe(true);
    expect(result.completedTaskIds).toContain(taskId);

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('completed');
  });
});
