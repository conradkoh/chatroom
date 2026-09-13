/**
 * Centralized Agent Status Transition
 *
 * Projects a daemon/task status observation to the thin role-status read model
 * and keeps the participant status mirror compatible with task routing. It does
 * not write desired state or process state in Convex.
 */

import {
  projectAgentRoleStatusReadModel,
  statusEventForAgentEvent,
  type StatusEvent,
} from './project-agent-role-status-read-model';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { getParticipantForChatroomRole } from '../machine/assigned-tasks-core';

/**
 * Transition the agent's status across all state sources.
 *
 * Call this instead of directly patching participant records. The participant
 * lastStatus field is retained only as a task/session compatibility mirror;
 * web presentation comes from the daemon-fed role-status projection.
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
  _lastDesiredState?: string,
  statusEvent?: StatusEvent,
  projection?: {
    machineId?: string | undefined;
    emittedAt?: number | undefined;
    revisionKey?: string | undefined;
  }
): Promise<void> {
  // 1. Update participant record (denormalized — deprecated as primary source)
  const participant = await getParticipantForChatroomRole(ctx, chatroomId, role);
  if (participant) {
    const patch: Record<string, string> = { lastStatus };
    await ctx.db.patch('chatroom_participants', participant._id, patch);
  }

  await projectAgentRoleStatusReadModel(ctx, {
    chatroomId,
    role,
    event: statusEvent ?? statusEventForAgentEvent(lastStatus),
    sourceMachineId: projection?.machineId,
    sourceEventAt: projection?.emittedAt,
    sourceRevisionKey: projection?.revisionKey,
  });
}
