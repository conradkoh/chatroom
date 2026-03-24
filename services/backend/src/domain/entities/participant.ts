/**
 * Domain Model: Participant
 *
 * Constants and helpers for participant record management.
 * Participant records track real-time agent connection state.
 */

import type { Id } from '../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../convex/_generated/server';

/**
 * The `lastSeenAction` value set when an agent exits (crash or intentional).
 * Participant records are patched with this value instead of being deleted,
 * preserving `lastSeenAt` history for the UI.
 *
 * Consumers that list "active" participants must filter out records
 * with this action value.
 */
export const PARTICIPANT_EXITED_ACTION = 'exited';

/**
 * Returns true if the participant is in an active (non-exited) state.
 * Use this to filter participant lists for routing, handoff, and queue promotion.
 */
export function isActiveParticipant(participant: { lastSeenAction?: string | null }): boolean {
  return participant.lastSeenAction !== PARTICIPANT_EXITED_ACTION;
}

/**
 * Patches the participant's lastStatus (and optionally lastDesiredState).
 * No-op if no participant exists for the chatroom+role yet.
 *
 * @deprecated Use `transitionAgentStatus()` from `src/domain/usecase/agent/transition-agent-status.ts`
 * for new code. This function only updates participant.lastStatus (one of two status sources).
 * `transitionAgentStatus()` updates all status sources atomically to prevent state divergence.
 */
export async function patchParticipantStatus(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  lastStatus: string,
  lastDesiredState?: string
): Promise<void> {
  const participant = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
    .unique();
  if (!participant) return;
  const patch: Record<string, string> = { lastStatus };
  if (lastDesiredState !== undefined) {
    patch.lastDesiredState = lastDesiredState;
  }
  await ctx.db.patch('chatroom_participants', participant._id, patch);
}
