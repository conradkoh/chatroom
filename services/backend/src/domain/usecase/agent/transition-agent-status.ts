/**
 * Centralized Agent Status Transition
 *
 * Single function that atomically updates all status sources for an agent:
 *   1. chatroom_participants.lastStatus (denormalized, used by UI — being deprecated)
 *   2. chatroom_participants.lastDesiredState (denormalized mirror)
 *
 * This ensures the dual-state sources (participant.lastStatus + teamAgentConfigs.desiredState)
 * never diverge.
 *
 * Future: When a new `status` field is added to chatroom_teamAgentConfigs (schema change),
 * this function will also write to that field, making teamAgentConfigs the single source of truth.
 *
 * @see patchParticipantStatus — deprecated in favor of this function for new code
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { patchParticipantStatus } from '../../entities/participant';

/**
 * Transition the agent's status across all state sources.
 *
 * Call this instead of bare `patchParticipantStatus()` to ensure all
 * status-related fields stay in sync.
 *
 * @param ctx - Convex mutation context
 * @param chatroomId - The chatroom
 * @param role - The agent role
 * @param lastStatus - The new event type (e.g. 'agent.requestStart', 'agent.exited')
 * @param lastDesiredState - Optional desired lifecycle state ('running' | 'stopped')
 */
export async function transitionAgentStatus(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  lastStatus: string,
  lastDesiredState?: string
): Promise<void> {
  // 1. Update participant record (denormalized — deprecated as primary source)
  await patchParticipantStatus(ctx, chatroomId, role, lastStatus, lastDesiredState);

  // Future: 2. Update chatroom_teamAgentConfigs.status field when schema is updated
  // This would make teamAgentConfigs the single source of truth for agent status.
}
