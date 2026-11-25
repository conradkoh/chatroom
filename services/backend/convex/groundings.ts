/**
 * Groundings
 *
 * First-class `type: 'grounding'` messages: a validated, neutral observation
 * record published by an agent while it works a task, read back by message id.
 *
 * A grounding is immutable: there is intentionally no update or delete
 * function, and the `get` result is a plain projection of the message row.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { withActiveTeamStructure } from './lib/chatroomTeam';
import { isGroundingInChatroom } from '../src/domain/grounding/is-grounding-in-chatroom';
import { publishGrounding } from '../src/domain/usecase/message/publish-grounding';

export const publish = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const teamChatroom = await withActiveTeamStructure(ctx, chatroom);
    const { messageId } = await publishGrounding(ctx, {
      chatroom: teamChatroom,
      senderRole: args.senderRole,
      content: args.content,
    });
    return { messageId, groundingId: messageId };
  },
});

export const get = query({
  args: { ...SessionIdArg, chatroomId: v.id('chatroom_rooms'), groundingId: v.string() },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const id = ctx.db.normalizeId('chatroom_messages', args.groundingId);
    const row = id === null ? null : await ctx.db.get('chatroom_messages', id);
    if (!isGroundingInChatroom(row, args.chatroomId)) {
      throw new ConvexError({
        code: 'GROUNDING_NOT_FOUND',
        message: `Grounding not found: ${args.groundingId}`,
      });
    }
    return {
      groundingId: row._id,
      senderRole: row.senderRole,
      createdAt: row._creationTime,
      content: row.content,
    };
  },
});
