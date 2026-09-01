import { OBSERVATION_TTL_MS } from '../../../../config/reliability';
import { internal } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

/** Schedule a one-shot nudge at observation TTL expiry so daemons reconcile without polling. */
export async function scheduleObservationExpiryNudge(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; lastObservedAt: number }
): Promise<void> {
  await ctx.scheduler.runAfter(
    OBSERVATION_TTL_MS,
    internal.observationExpiry.fireObservationExpiryNudge,
    { chatroomId: args.chatroomId, anchorLastObservedAt: args.lastObservedAt }
  );
}
