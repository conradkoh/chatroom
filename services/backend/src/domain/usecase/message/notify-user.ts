/**
 * Use Case: Notify User
 *
 * Stores an agent → user interim notice: a single `chatroom_messages` row of
 * `type: 'notice'` that reaches the user without any task transition.
 *
 * A notice is deliberately task-free: no `taskId`, no `taskOriginMessageId`,
 * no `terminalHandoffKey`, no attachments. Linking it to a task could make it
 * the task's primary message (`findPrimaryMessageForTask` picks the first
 * `type: 'message'` row by `by_taskId`), so this use case never writes task
 * links.
 *
 * Constraints:
 * - The caller MUST pass an already team-structured chatroom (see
 *   `withActiveTeamStructure`), so team role validation is a pure read.
 * - `chatroom_messages` remains the only source of truth; the read model row is
 *   written by `insertChatroomMessage`, which also marks the notice as timeline.
 * - `chatroom_rooms` is intentionally NOT patched (`lastActivityAt` stays put)
 *   because `requireChatroomAccess` reads the room document — bumping it would
 *   invalidate every access-checked query in the room.
 * - No task, participant, queue or scheduler writes occur here.
 * - Not idempotent by design: a duplicate notice causes no state change, so no
 *   idempotency key is needed.
 */

import { ConvexError } from 'convex/values';

import { insertChatroomMessage } from './message-read-model';
import { assertValidSenderRole, senderHasActiveTask } from './message-sender-guards';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { ResolvedChatroom } from '../../../../convex/lib/chatroomTeam';
import { markChatroomUnread } from '../chatroom/unread-status';

/** Maximum number of characters allowed in a notice body. Enforced by `assertValidContent`. */
const NOTIFY_USER_MAX_CONTENT_LENGTH = 10_000;

/** Reject blank or over-length notice bodies. */
function assertValidContent(content: string): void {
  if (content.trim().length === 0) {
    throw new ConvexError({
      code: 'EMPTY_CONTENT',
      message: 'Notice content cannot be empty',
    });
  }
  if (content.length > NOTIFY_USER_MAX_CONTENT_LENGTH) {
    throw new ConvexError({
      code: 'CONTENT_TOO_LONG',
      message: `Notice content must be ${NOTIFY_USER_MAX_CONTENT_LENGTH} characters or less (got ${content.length})`,
    });
  }
}

/**
 * Validate and store an agent → user notice.
 *
 * Throws a `ConvexError` with a stable `code` on any failure:
 * - `INVALID_ROLE` — sender is `user` or not part of the team configuration
 * - `EMPTY_CONTENT` — content is blank after trimming
 * - `CONTENT_TOO_LONG` — content exceeds `NOTIFY_USER_MAX_CONTENT_LENGTH`
 * - `NO_ACTIVE_TASK` — sender has no active task to notify from
 */
export async function notifyUser(
  ctx: MutationCtx,
  args: {
    /** Already team-structured by the caller (see `withActiveTeamStructure`). */
    chatroom: ResolvedChatroom;
    senderRole: string;
    content: string;
  }
): Promise<{ messageId: Id<'chatroom_messages'> }> {
  const chatroomId = args.chatroom._id;
  assertValidSenderRole(args.chatroom, args.senderRole);
  assertValidContent(args.content);

  if (!(await senderHasActiveTask(ctx, chatroomId, args.senderRole))) {
    throw new ConvexError({
      code: 'NO_ACTIVE_TASK',
      message: `Role "${args.senderRole}" has no active task. notify-user only works while you are working on a task. If you already ran handoff for this task, end your turn.`,
    });
  }

  // `senderRole` is stored as given (matching `runHandoffHandler`); `type` is
  // `notice`, so the read model marks it as timeline automatically.
  const messageId = await insertChatroomMessage(ctx, {
    chatroomId,
    senderRole: args.senderRole,
    content: args.content,
    targetRole: 'user',
    type: 'notice',
  });

  // A notice is an interim update, not a handoff: mark unread without the
  // handoff flag. No-op when the chatroom is already unread.
  if (args.chatroom.ownerId) {
    await markChatroomUnread(ctx, chatroomId, args.chatroom.ownerId, false);
  }

  // Deliberately NO chatroom_rooms patch, NO task/participant/queue writes,
  // NO scheduler.
  return { messageId };
}
