// fallow-ignore-file unused-export complexity
/**
 * Reorders a single queued message within a chatroom's queue.
 *
 * ## Design
 *
 * Positions come from the shared counter `chatroom_rooms.nextQueuePosition`,
 * which `chatroom_tasks.queuePosition` also uses. To keep that counter and the
 * queue consistent, this module permutes the existing position values instead
 * of inventing new ones: the multiset of values is preserved, so every value
 * stays unique (or, for legacy duplicate rows, is repaired into a strictly
 * increasing sequence) and below the counter.
 *
 * Never use fractional or midpoint positions here — `reserveFrontQueuePosition`
 * (`front.queuePosition - 1`) and `getAndIncrementQueuePosition` both assume
 * integer positions.
 *
 * The planner is pure so the ordering rules are testable without a database.
 * The use case writes only the rows whose value changed and patches only the
 * `queuePosition` field (plus the counter guard described below).
 */

import { ConvexError } from 'convex/values';

import { BACKEND_ERROR_CODES } from '../../../../config/errorCodes';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

/** Maximum queue size this mutation will reorder in one transaction. */
export const MAX_REORDER_WINDOW = 1000;

type QueueRow = { _id: Id<'chatroom_messageQueue'>; queuePosition: number };

export type QueueReorderPlan =
  | { kind: 'stale' }
  | { kind: 'noop' }
  | {
      kind: 'write';
      patches: { id: Id<'chatroom_messageQueue'>; queuePosition: number }[];
      maxPosition: number;
    };

/**
 * Pure: plans the move over rows given in index (queuePosition ascending) order.
 * Keeps the existing values and reassigns them across the new order, so only
 * rows whose value changes are patched. Duplicate values are repaired by
 * raising each value to at least the previous value plus one.
 */
export function planQueueReorder(
  rows: QueueRow[],
  movedId: Id<'chatroom_messageQueue'>,
  afterId: Id<'chatroom_messageQueue'> | null
): QueueReorderPlan {
  const moved = rows.find((r) => r._id === movedId);
  if (!moved) return { kind: 'stale' };
  if (afterId !== null && !rows.some((r) => r._id === afterId)) return { kind: 'stale' };

  const without = rows.filter((r) => r._id !== movedId);
  const insertAt = afterId === null ? 0 : without.findIndex((r) => r._id === afterId) + 1;
  const reordered = [...without.slice(0, insertAt), moved, ...without.slice(insertAt)];

  if (reordered.every((r, i) => r._id === rows[i]?._id)) return { kind: 'noop' };

  const values = rows.map((r) => r.queuePosition);
  const next: number[] = [];
  for (let i = 0; i < reordered.length; i++) {
    const floor = i > 0 ? (next[i - 1] as number) + 1 : Number.NEGATIVE_INFINITY;
    next.push(Math.max(values[i] as number, floor));
  }

  const patches: { id: Id<'chatroom_messageQueue'>; queuePosition: number }[] = [];
  reordered.forEach((row, i) => {
    const value = next[i] as number;
    if (row.queuePosition !== value) patches.push({ id: row._id, queuePosition: value });
  });

  return {
    kind: 'write',
    patches,
    maxPosition: next[next.length - 1] as number,
  };
}

/**
 * Moves one queued message after `afterId` (or to the front when `afterId` is null).
 *
 * Permutes the existing `queuePosition` values: a move that keeps the current
 * order is a no-op, and a move rewrites only the rows whose value changes.
 * `chatroom_rooms.nextQueuePosition` is untouched in the unique-position case;
 * it is bumped to `maxPosition + 1` only when it is unset or no greater than
 * the highest position (the duplicate-position repair path).
 *
 * Patches only `queuePosition` on queue rows. Content, attachments,
 * `taskEnvelope`, `scheduledPromptId`, `startInNewSession`, `sourcePlatform`,
 * `chatroom_rooms.lastActivityAt` and `chatroom_taskCounts` are untouched.
 *
 * A missing moved or anchor row resolves `'stale'`; a row from another
 * chatroom or a self-anchor throws a coded `ConvexError`.
 */
export async function reorderQueuedMessage(
  ctx: MutationCtx,
  args: {
    chatroom: Doc<'chatroom_rooms'>;
    movedId: Id<'chatroom_messageQueue'>;
    afterId: Id<'chatroom_messageQueue'> | null;
  }
): Promise<'ok' | 'stale'> {
  const { chatroom, movedId, afterId } = args;
  if (afterId !== null && afterId === movedId) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.INVALID_REORDER_TARGET,
      message: 'A queued message cannot be moved after itself.',
    });
  }

  const moved = await ctx.db.get('chatroom_messageQueue', movedId);
  if (!moved) return 'stale';
  if (moved.chatroomId !== chatroom._id) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.QUEUE_ITEM_NOT_IN_CHATROOM,
      message: 'Queued message does not belong to this chatroom.',
    });
  }

  if (afterId !== null) {
    const anchor = await ctx.db.get('chatroom_messageQueue', afterId);
    if (!anchor) return 'stale';
    if (anchor.chatroomId !== chatroom._id) {
      throw new ConvexError({
        code: BACKEND_ERROR_CODES.QUEUE_ITEM_NOT_IN_CHATROOM,
        message: 'Queued message does not belong to this chatroom.',
      });
    }
  }

  const rows = await ctx.db
    .query('chatroom_messageQueue')
    .withIndex('by_chatroom_queue', (q) => q.eq('chatroomId', chatroom._id))
    .order('asc')
    .take(MAX_REORDER_WINDOW + 1);
  if (rows.length > MAX_REORDER_WINDOW) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.QUEUE_TOO_LARGE_TO_REORDER,
      message: `Queue has more than ${MAX_REORDER_WINDOW} messages and cannot be reordered.`,
    });
  }

  const plan = planQueueReorder(rows, movedId, afterId);
  if (plan.kind === 'stale') return 'stale';
  if (plan.kind === 'noop') return 'ok';

  for (const patch of plan.patches) {
    await ctx.db.patch('chatroom_messageQueue', patch.id, { queuePosition: patch.queuePosition });
  }
  if (chatroom.nextQueuePosition === undefined || chatroom.nextQueuePosition <= plan.maxPosition) {
    await ctx.db.patch('chatroom_rooms', chatroom._id, {
      nextQueuePosition: plan.maxPosition + 1,
    });
  }
  return 'ok';
}
