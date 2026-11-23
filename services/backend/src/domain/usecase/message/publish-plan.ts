/**
 * Use Case: Publish Plan
 *
 * Stores an agent-published, immutable `type: 'plan'` message after validating
 * the plan markdown with the shared pure parser (`parsePlan`).
 *
 * A plan is deliberately task-free and side-effect free: no `taskId`, no
 * `targetRole`, no attachments, and — unlike `notifyUser` — it does NOT patch
 * `chatroom_rooms.lastActivityAt`, mark the chatroom unread, or create tasks.
 *
 * Constraints:
 * - The caller MUST pass an already team-structured chatroom (see
 *   `withActiveTeamStructure`), so team role validation is a pure read.
 * - Plan content is the only stored truth; there are no structured phase
 *   columns and no update/delete path (plans are immutable).
 * - `insertChatroomMessage` writes the `chatroom_messages` row and the timeline
 *   read model in one call; it is the only persistence here.
 * - `supersedesPlanId` must point at a plan in the same chatroom.
 */

import { ConvexError } from 'convex/values';

import { insertChatroomMessage } from './message-read-model';
import { assertValidSenderRole, senderHasActiveTask } from './message-sender-guards';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { ResolvedChatroom } from '../../../../convex/lib/chatroomTeam';
import { isPlanInChatroom } from '../../plan/is-plan-in-chatroom';
import { parsePlan, type ParsedPlan } from '../../plan/parse-plan';

/**
 * Reject blank content. Length is checked by `parsePlan` (`PLAN_TOO_LONG`), so an
 * over-long plan fails as `INVALID_PLAN` with the parser's error list.
 */
function assertContentNotEmpty(content: string): void {
  if (content.trim().length === 0) {
    throw new ConvexError({ code: 'EMPTY_CONTENT', message: 'Plan content cannot be empty' });
  }
}

/** Run the shared parser and return the parsed plan, or throw INVALID_PLAN. */
function requireValidPlan(content: string): ParsedPlan {
  const parsed = parsePlan(content);
  if (!parsed.ok) {
    throw new ConvexError({
      code: 'INVALID_PLAN',
      message: 'Plan does not match the plan template',
      errors: parsed.errors.map((error) => ({ ...error })),
    });
  }
  return parsed.plan;
}

async function assertSenderHasActiveTask(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  senderRole: string
): Promise<void> {
  if (await senderHasActiveTask(ctx, chatroomId, senderRole)) return;
  throw new ConvexError({
    code: 'NO_ACTIVE_TASK',
    message: `Role "${senderRole}" has no active task. plan publish only works while you are working on a task. If you already ran handoff for this task, end your turn.`,
  });
}

async function assertSupersedesTarget(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  planId: Id<'chatroom_messages'> | undefined
): Promise<void> {
  if (planId === undefined) return;
  const target = await ctx.db.get('chatroom_messages', planId);
  if (isPlanInChatroom(target, chatroomId)) return;
  throw new ConvexError({
    code: 'INVALID_SUPERSEDES',
    message: `Cannot supersede message ${planId}: it must be a plan in this chatroom`,
  });
}

/**
 * Validate and store a plan message.
 *
 * Throws a `ConvexError` with a stable `code` on any failure:
 * - `INVALID_ROLE` — sender is `user` or not part of the team configuration
 * - `EMPTY_CONTENT` — content is blank after trimming
 * - `INVALID_PLAN` — content does not match the plan template or exceeds the length limit; `errors` lists every violation as `{ code, line, message }`, including `PLAN_TOO_LONG` on line 1
 * - `NO_ACTIVE_TASK` — sender has no active task to publish from
 * - `INVALID_SUPERSEDES` — the target message is not a plan in this chatroom
 */
export async function publishPlan(
  ctx: MutationCtx,
  args: {
    /** Already team-structured by the caller (see `withActiveTeamStructure`). */
    chatroom: ResolvedChatroom;
    senderRole: string;
    content: string;
    supersedesPlanId?: Id<'chatroom_messages'> | undefined;
  }
): Promise<{ messageId: Id<'chatroom_messages'>; phaseIds: string[] }> {
  const chatroomId = args.chatroom._id;
  assertValidSenderRole(args.chatroom, args.senderRole);
  assertContentNotEmpty(args.content);
  const parsed = requireValidPlan(args.content);
  await assertSenderHasActiveTask(ctx, chatroomId, args.senderRole);
  await assertSupersedesTarget(ctx, chatroomId, args.supersedesPlanId);

  const messageId = await insertChatroomMessage(ctx, {
    chatroomId,
    senderRole: args.senderRole,
    content: args.content.trimEnd(),
    type: 'plan',
    ...(args.supersedesPlanId ? { supersedesPlanId: args.supersedesPlanId } : {}),
  });

  return { messageId, phaseIds: parsed.phases.map((phase) => phase.id) };
}
