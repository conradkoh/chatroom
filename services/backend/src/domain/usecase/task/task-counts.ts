/**
 * Materialized Task Counts
 *
 * Provides helpers to maintain per-chatroom task counts atomically.
 * These counts are read by `getTaskCounts` query instead of scanning all tasks.
 *
 * The counts doc is auto-created on first increment. If no doc exists,
 * the query falls back to the old counting approach (migration safety).
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

// ─── Types ──────────────────────────────────────────────────────────────────

export type TaskCountField =
  | 'pending'
  | 'acknowledged'
  | 'inProgress'
  | 'completed'
  | 'queueSize'
  | 'backlogCount'
  | 'pendingReviewCount';

const DEFAULT_COUNTS = {
  pending: 0,
  acknowledged: 0,
  inProgress: 0,
  completed: 0,
  queueSize: 0,
  backlogCount: 0,
  pendingReviewCount: 0,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Get or create the materialized counts document for a chatroom.
 */
async function getOrCreateCounts(ctx: MutationCtx, chatroomId: Id<'chatroom_rooms'>) {
  const existing = await ctx.db
    .query('chatroom_taskCounts')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .first();

  if (existing) return existing;

  const id = await ctx.db.insert('chatroom_taskCounts', {
    chatroomId,
    ...DEFAULT_COUNTS,
  });

  return (await ctx.db.get("chatroom_taskCounts", id))!;
}

/**
 * Increment (or decrement) a specific counter field for a chatroom.
 *
 * @param ctx - Mutation context
 * @param chatroomId - Chatroom to update
 * @param field - Which counter to change
 * @param delta - Amount to add (use negative for decrement). Clamps to 0.
 */
export async function adjustTaskCount(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  field: TaskCountField,
  delta: number
): Promise<void> {
  const counts = await getOrCreateCounts(ctx, chatroomId);
  const newValue = Math.max(0, counts[field] + delta);
  await ctx.db.patch("chatroom_taskCounts", counts._id, { [field]: newValue });
}

/**
 * Map a task status to its corresponding count field.
 */
export function statusToCountField(status: string): TaskCountField | null {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'acknowledged':
      return 'acknowledged';
    case 'in_progress':
      return 'inProgress';
    case 'completed':
      return 'completed';
    default:
      return null;
  }
}

/**
 * Handle a task status transition: decrement old status counter, increment new.
 */
export async function adjustTaskCountsForTransition(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  oldStatus: string,
  newStatus: string
): Promise<void> {
  const oldField = statusToCountField(oldStatus);
  const newField = statusToCountField(newStatus);

  if (oldField) {
    await adjustTaskCount(ctx, chatroomId, oldField, -1);
  }
  if (newField) {
    await adjustTaskCount(ctx, chatroomId, newField, 1);
  }
}
