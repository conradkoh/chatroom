/**
 * Use Case: Publish Grounding
 *
 * Stores an agent-published, immutable `type: 'grounding'` message after
 * validating the grounding markdown with `validateGrounding`.
 *
 * A grounding is a neutral, factual observation record published before
 * delegating discovery work. It is deliberately task-free and side-effect free:
 * no `taskId`, no `targetRole`, no attachments, and — unlike `notifyUser` — it
 * does NOT patch `chatroom_rooms.lastActivityAt`, mark the chatroom unread, or
 * create tasks.
 *
 * Constraints:
 * - The caller MUST pass an already team-structured chatroom (see
 *   `withActiveTeamStructure`), so team role validation is a pure read.
 * - Grounding content is the only stored truth: no structured columns and no
 *   update/delete path (groundings are immutable).
 * - `insertChatroomMessage` writes the `chatroom_messages` row and the timeline
 *   read model in one call; it is the only persistence here.
 * - Validation runs before the active-task check, so a rejected publish stores
 *   nothing.
 */

import { ConvexError } from 'convex/values';

import { insertChatroomMessage } from './message-read-model';
import { assertValidSenderRole, senderHasActiveTask } from './message-sender-guards';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { ResolvedChatroom } from '../../../../convex/lib/chatroomTeam';
import { validateGrounding } from '../../grounding/validate-grounding';

/** Reject blank content before the template check. */
function assertContentNotEmpty(content: string): void {
  if (content.trim().length === 0) {
    throw new ConvexError({
      code: 'EMPTY_CONTENT',
      message: 'Grounding content cannot be empty',
    });
  }
}

async function assertSenderHasActiveTask(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  senderRole: string
): Promise<void> {
  const hasActiveTask = await senderHasActiveTask(ctx, chatroomId, senderRole);
  if (hasActiveTask) return;
  throw new ConvexError({
    code: 'NO_ACTIVE_TASK',
    message: `Role "${senderRole}" has no active task. grounding publish only works while you are working on a task. If you already ran handoff for this task, end your turn.`,
  });
}

/**
 * Validate and store a grounding message.
 *
 * Throws a `ConvexError` with a stable `code` on any failure:
 * - `INVALID_ROLE` — sender is `user` or not part of the team configuration
 * - `EMPTY_CONTENT` — content is blank after trimming
 * - `INVALID_GROUNDING` — content does not match the grounding template; `errors` lists every violation as `{ code, line, message }`
 * - `NO_ACTIVE_TASK` — sender has no active task to publish from
 */
export async function publishGrounding(
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
  assertContentNotEmpty(args.content);

  const result = validateGrounding(args.content);
  if (!result.ok) {
    throw new ConvexError({
      code: 'INVALID_GROUNDING',
      message: 'Grounding does not match the grounding template',
      errors: result.errors.map((error) => ({ ...error })),
    });
  }

  await assertSenderHasActiveTask(ctx, chatroomId, args.senderRole);

  const messageId = await insertChatroomMessage(ctx, {
    chatroomId,
    senderRole: args.senderRole,
    content: args.content.trimEnd(),
    type: 'grounding',
  });

  return { messageId };
}
