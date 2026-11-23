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

import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { withActiveTeamStructure } from './lib/chatroomTeam';
import { isPlanInChatroom } from '../src/domain/plan/is-plan-in-chatroom';
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

async function loadMessageRow(
  ctx: QueryCtx,
  planId: string
): Promise<Doc<'chatroom_messages'> | null> {
  const id = ctx.db.normalizeId('chatroom_messages', planId);
  if (id === null) return null;
  return await ctx.db.get('chatroom_messages', id);
}

/** Resolve the plan row or throw `PLAN_NOT_FOUND` (malformed, non-plan, other room). */
async function requirePlanRow(
  ctx: QueryCtx,
  chatroomId: Id<'chatroom_rooms'>,
  planId: string
): Promise<Doc<'chatroom_messages'>> {
  const row = await loadMessageRow(ctx, planId);
  if (isPlanInChatroom(row, chatroomId)) return row;
  throw new ConvexError({ code: 'PLAN_NOT_FOUND', message: `Plan not found: ${planId}` });
}

/** Advisory only: at most 50 later plans from the same sender are scanned. */
async function findSupersedingPlan(
  ctx: QueryCtx,
  row: Doc<'chatroom_messages'>
): Promise<Doc<'chatroom_messages'> | null> {
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
  return laterPlans.find((candidate) => candidate.supersedesPlanId === row._id) ?? null;
}

export const get = query({
  args: { ...SessionIdArg, chatroomId: v.id('chatroom_rooms'), planId: v.string() },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const row = await requirePlanRow(ctx, args.chatroomId, args.planId);
    const successor = await findSupersedingPlan(ctx, row);
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
