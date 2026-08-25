/** linkMessageToTask keeps chatroom_messageReadModels in sync with message.taskId patches. */
import { expect, test } from 'vitest';

import {
  insertChatroomMessage,
  linkMessageToTask,
} from '../src/domain/usecase/message/message-read-model';
import { t } from '../test.setup';
import { createTestSession } from '../tests/helpers/integration';

test('linkMessageToTask writes taskId and taskStatus to the read model', async () => {
  await createTestSession('read-model-task-link');
  await t.run(async (ctx) => {
    const owner = (await ctx.db.query('users').first())!;
    const chatroomId = await ctx.db.insert('chatroom_rooms', {
      status: 'active',
      ownerId: owner._id,
      name: 'read-model-link',
    });
    const messageId = await insertChatroomMessage(ctx, {
      chatroomId,
      senderRole: 'user',
      type: 'message',
      content: 'hello',
    });
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      queuePosition: 0,
      content: 'hello',
      status: 'pending',
      assignedTo: 'planner',
      sourceMessageId: messageId,
    });

    await linkMessageToTask(ctx, messageId, taskId);

    const readModel = await ctx.db
      .query('chatroom_messageReadModels')
      .withIndex('by_messageId', (q) => q.eq('messageId', messageId))
      .first();

    expect(readModel?.taskId).toBe(taskId);
    expect(readModel?.taskStatus).toBe('pending');
  });
});
