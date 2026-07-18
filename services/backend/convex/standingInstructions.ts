import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';

const MAX_CONTENT_LENGTH = 10_000;

export const get = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const room = await ctx.db.get('chatroom_rooms', args.chatroomId);
    return {
      content: room?.standingInstructions ?? '',
      enabled: room?.standingInstructionsEnabled ?? false,
    };
  },
});

export const upsert = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const trimmed = args.content.trim();
    if (trimmed.length > MAX_CONTENT_LENGTH) {
      throw new ConvexError({
        code: 'CONTENT_TOO_LONG',
        message: `Standing instructions must be ${MAX_CONTENT_LENGTH} characters or less`,
      });
    }
    await ctx.db.patch('chatroom_rooms', args.chatroomId, {
      standingInstructions: trimmed,
      standingInstructionsEnabled: trimmed.length > 0,
    });
  },
});

export const setEnabled = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await ctx.db.patch('chatroom_rooms', args.chatroomId, {
      standingInstructionsEnabled: args.enabled,
    });
  },
});

export const clear = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await ctx.db.patch('chatroom_rooms', args.chatroomId, {
      standingInstructions: '',
      standingInstructionsEnabled: false,
    });
  },
});
