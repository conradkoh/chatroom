/** Message read-model stays in sync when a message is linked to a task at creation time. */
import { expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createBuilderEntryDuoChatroom, createTestSession } from '../helpers/integration';

test('read model includes taskId immediately after user message creates task', async () => {
  const { sessionId } = await createTestSession('read-model-task-link');
  const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

  await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content: 'hello task',
    type: 'message',
  });

  const readModel = await t.run(async (ctx) => {
    const message = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .first();
    if (!message) return null;
    return ctx.db
      .query('chatroom_messageReadModels')
      .withIndex('by_messageId', (q) => q.eq('messageId', message._id))
      .first();
  });

  expect(readModel).not.toBeNull();
  expect(readModel!.taskId).toBeDefined();
  expect(readModel!.taskStatus).toBe('pending');
});
