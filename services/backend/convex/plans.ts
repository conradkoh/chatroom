/**
 * Plans
 *
 * First-class `type: 'plan'` messages: a validated phased plan published by an
 * agent while it works a task, read back by message id.
 *
 * A plan is immutable: there is intentionally no update or delete function.
 * The `get` result is a projection of the message row, plus an advisory
 * `supersededBy` link derived from later plans in the same chatroom.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { withActiveTeamStructure } from './lib/chatroomTeam';
import { publishPlan } from '../src/domain/usecase/message/publish-plan';

/** Bound on the advisory "superseded by" scan; no new index. */
const SUPERSEDED_BY_SCAN_LIMIT = 50;

export const publish = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    content: v.string(),
    supersedesPlanId: v.optional(v.id('chatroom_messages')),
  },
  handler: async (ctx, args) => {
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const teamChatroom = await withActiveTeamStructure(ctx, chatroom);
    const { messageId, phaseIds } = await publishPlan(ctx, {
      chatroom: teamChatroom,
      senderRole: args.senderRole,
      content: args.content,
      supersedesPlanId: args.supersedesPlanId,
    });
    return { messageId, planId: messageId, phaseIds };
  },
});

export const get = query({
  args: { ...SessionIdArg, chatroomId: v.id('chatroom_rooms'), planId: v.string() },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const planId = ctx.db.normalizeId('chatroom_messages', args.planId);
    const row = planId ? await ctx.db.get('chatroom_messages', planId) : null;
    if (!row || row.chatroomId !== args.chatroomId || row.type !== 'plan') {
      throw new ConvexError({ code: 'PLAN_NOT_FOUND', message: `Plan not found: ${args.planId}` });
    }

    // Advisory only: at most 50 later plans from the same sender are scanned.
    const laterPlans = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
        q
          .eq('chatroomId', row.chatroomId)
          .eq('senderRole', row.senderRole)
          .eq('type', 'plan')
          .gt('_creationTime', row._creationTime)
      )
      .take(SUPERSEDED_BY_SCAN_LIMIT);
    const successor = laterPlans.find((candidate) => candidate.supersedesPlanId === row._id);

    return {
      planId: row._id,
      senderRole: row.senderRole,
      createdAt: row._creationTime,
      content: row.content,
      supersedes: row.supersedesPlanId ?? null,
      supersededBy: successor?._id ?? null,
    };
  },
});
