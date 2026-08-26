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
 */

import { projectAgentOperationalStatusForRole } from './project-agent-operational-status';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { getParticipantForChatroomRole } from '../machine/assigned-tasks-core';

const OPERATIONAL_STATUSES = new Set([
  'agent.waiting',
  'agent.enhancing',
  'agent.started',
  'agent.awaitingHandoff',
  'task.acknowledged',
  'task.inProgress',
  'task.completed',
]);

async function resolveLastDesiredState(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  lastStatus: string,
  explicit?: string
): Promise<string | undefined> {
  if (explicit !== undefined || !OPERATIONAL_STATUSES.has(lastStatus)) return explicit;
  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!chatroom?.teamId) return undefined;
  const config = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) =>
      q.eq('teamRoleKey', buildTeamRoleKey(chatroom._id, chatroom.teamId!, role))
    )
    .first();
  return config?.desiredState;
}

/**
 * Transition the agent's status across all state sources.
 *
 * Call this instead of directly patching participant records to ensure all
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
  const participant = await getParticipantForChatroomRole(ctx, chatroomId, role);
  if (participant) {
    const resolvedDesiredState = await resolveLastDesiredState(
      ctx,
      chatroomId,
      role,
      lastStatus,
      lastDesiredState
    );
    const patch: Record<string, string> = { lastStatus };
    if (resolvedDesiredState !== undefined) {
      patch.lastDesiredState = resolvedDesiredState;
    }
    await ctx.db.patch('chatroom_participants', participant._id, patch);
  }

  // Future: 2. Update chatroom_teamAgentConfigs.status field when schema is updated
  // This would make teamAgentConfigs the single source of truth for agent status.
  await projectAgentOperationalStatusForRole(ctx, chatroomId, role, undefined, { lastStatus });
}
