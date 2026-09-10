import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from '../_generated/server';
import { requireChatroomAccess } from '../auth/chatroomAccess';

const conversationModeValidator = v.union(
  v.literal('chat'),
  v.literal('code'),
  v.literal('code:enhanced')
);

export const get = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const preference = await ctx.db
      .query('chatroom_conversationModePreferences')
      .withIndex('by_chatroom_user', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('userId', session.userId)
      )
      .unique();
    return preference?.mode ?? null;
  },
});

export const set = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    mode: conversationModeValidator,
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const existing = await ctx.db
      .query('chatroom_conversationModePreferences')
      .withIndex('by_chatroom_user', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('userId', session.userId)
      )
      .unique();
    const updatedAt = Date.now();
    if (existing) {
      await ctx.db.patch('chatroom_conversationModePreferences', existing._id, {
        mode: args.mode,
        updatedAt,
      });
      return existing._id;
    }
    return await ctx.db.insert('chatroom_conversationModePreferences', {
      chatroomId: args.chatroomId,
      userId: session.userId,
      mode: args.mode,
      updatedAt,
    });
  },
});
