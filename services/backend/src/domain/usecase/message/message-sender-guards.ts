/**
 * Message Sender Guards
 *
 * Shared validation for agent-authored chatroom messages. Extracted from
 * `notify-user.ts` so `publishPlan` reuses the exact same role and active-task
 * rules (and therefore the exact same error codes and messages).
 *
 * Constraints:
 * - `assertValidSenderRole` is a pure read of the resolved chatroom.
 * - `senderHasActiveTask` performs at most one `.first()` index read per active
 *   status; it adds no index.
 */

import { ConvexError } from 'convex/values';

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { ResolvedChatroom } from '../../../../convex/lib/chatroomTeam';
import { getTeamRolesFromChatroom } from '../chatroom/get-team-roles';

/**
 * Statuses under which a sender role counts as actively working a task.
 * `pending` is included because native harnesses work on a pending task until
 * token activity moves it to `in_progress` (see `runHandoffHandler`).
 */
const ACTIVE_STATUSES = ['in_progress', 'acknowledged', 'pending'] as const;

/** Reject `user` and any role outside the chatroom's team configuration. */
export function assertValidSenderRole(chatroom: ResolvedChatroom, senderRole: string): void {
  const normalized = senderRole.toLowerCase();
  const { teamRoles, normalizedTeamRoles } = getTeamRolesFromChatroom(chatroom);
  if (normalized === 'user' || !normalizedTeamRoles.includes(normalized)) {
    throw new ConvexError({
      code: 'INVALID_ROLE',
      message: `Invalid senderRole: "${senderRole}" is not in team configuration. Allowed roles: ${teamRoles.join(', ')}`,
    });
  }
}

/**
 * Whether the sender role is actively working a task.
 * At most three `.first()` index reads (one per active status); no new index.
 */
export async function senderHasActiveTask(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  senderRole: string
): Promise<boolean> {
  for (const status of ACTIVE_STATUSES) {
    const task = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status_assignedTo', (q) =>
        q.eq('chatroomId', chatroomId).eq('status', status).eq('assignedTo', senderRole)
      )
      .first();
    if (task) return true;
  }
  return false;
}
