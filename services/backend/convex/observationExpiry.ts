import { v } from 'convex/values';

import { OBSERVATION_TTL_MS } from '../config/reliability';
import { internalMutation } from './_generated/server';
import { enqueueWorkspaceListChangedForChatroom } from '../src/domain/usecase/workspace/enqueue-workspace-list-changed';

/** Fire an observation expiry nudge only if no newer heartbeat replaced the anchor. */
export const fireObservationExpiryNudge = internalMutation({
  args: {
    chatroomId: v.id('chatroom_rooms'),
    anchorLastObservedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const observation = await ctx.db
      .query('chatroom_observation')
      .withIndex('by_chatroomId', (q) => q.eq('chatroomId', args.chatroomId))
      .first();
    if (!observation) return;
    if (observation.lastObservedAt !== args.anchorLastObservedAt) return;
    if (Date.now() - args.anchorLastObservedAt < OBSERVATION_TTL_MS) return;
    await enqueueWorkspaceListChangedForChatroom(ctx, args.chatroomId);
  },
});
