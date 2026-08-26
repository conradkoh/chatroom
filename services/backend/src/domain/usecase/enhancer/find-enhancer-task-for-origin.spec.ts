import { describe, expect, test } from 'vitest';
import { t } from '../../../../test.setup';
import { findEnhancerTaskForOrigin } from './find-enhancer-task-for-origin';

describe('findEnhancerTaskForOrigin', () => {
  test('finds only the enhancer task for the requested origin', async () => {
    const sessionId = 'find-enhancer-origin' as any;
    await t.mutation((await import('../../../../convex/_generated/api')).api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation((await import('../../../../convex/_generated/api')).api.chatrooms.create, { sessionId, teamId: 'duo', teamName: 'Duo', teamRoles: ['planner', 'enhancer', 'builder'], teamEntryPoint: 'planner' });
    const row = await t.run(async (ctx) => {
      const room = await ctx.db.get(chatroomId);
      const origin = await ctx.db.insert('chatroom_messages', { chatroomId, senderRole: 'user', content: 'origin', type: 'message' });
      const other = await ctx.db.insert('chatroom_messages', { chatroomId, senderRole: 'user', content: 'other', type: 'message' });
      const taskId = await ctx.db.insert('chatroom_tasks', { chatroomId, createdBy: 'planner', content: 'enhance', status: 'pending', assignedTo: 'enhancer', sourceMessageId: origin, originUserMessageId: origin, createdAt: Date.now(), updatedAt: Date.now(), queuePosition: 1 });
      return { chatroomId, origin, other, taskId, ownerId: room!.ownerId };
    });
    expect(await t.run((ctx) => findEnhancerTaskForOrigin(ctx, { chatroomId: row.chatroomId, originUserMessageId: row.origin }))).not.toBeNull();
    expect(await t.run((ctx) => findEnhancerTaskForOrigin(ctx, { chatroomId: row.chatroomId, originUserMessageId: row.other }))).toBeNull();
  });
});
