import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import { findActiveEnhancerJob } from '../../../../convex/web/enhancer/jobHelpers';
import { transitionAgentStatus } from '../agent/transition-agent-status';

async function emitParticipantStatusEvent(
  ctx: MutationCtx,
  params: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    type: 'agent.enhancing' | 'agent.waiting';
    timestamp: number;
  }
): Promise<void> {
  await ctx.db.insert('chatroom_eventStream', {
    type: params.type,
    chatroomId: params.chatroomId,
    role: params.role,
    timestamp: params.timestamp,
  });
}

/** Set planner status while a handoff enhancer job is in flight. */
export async function transitionPlannerToEnhancing(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<void> {
  const now = Date.now();
  await emitParticipantStatusEvent(ctx, {
    type: 'agent.enhancing',
    chatroomId,
    role: 'planner',
    timestamp: now,
  });
  await transitionAgentStatus(ctx, chatroomId, 'planner', 'agent.enhancing');
}

/** Clear enhancing status after enhancer job finishes or handoff is delivered. */
export async function transitionPlannerFromEnhancingToWaiting(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<void> {
  const now = Date.now();
  await emitParticipantStatusEvent(ctx, {
    type: 'agent.waiting',
    chatroomId,
    role: 'planner',
    timestamp: now,
  });
  await transitionAgentStatus(ctx, chatroomId, 'planner', 'agent.waiting');
}

export async function hasActivePlannerEnhancerJob(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  const active = await findActiveEnhancerJob(ctx, chatroomId, 'planner', 'builder');
  return active !== null;
}
