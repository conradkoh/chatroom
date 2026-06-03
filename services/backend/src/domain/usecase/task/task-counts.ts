/**
 * Materialized Task Counts
 *
 * Provides helpers to maintain per-chatroom task counts atomically.
 * These counts are read by `getTaskCounts` query instead of scanning all tasks.
 *
 * The counts doc is auto-created on first increment. If no doc exists,
 * the query falls back to the old counting approach (migration safety).
 */

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import { ACTIVE_TASK_STATUSES } from '../../entities/task';

type DbCtx = MutationCtx | QueryCtx;

export type ActiveTaskCounts = {
  pending: number;
  acknowledged: number;
  inProgress: number;
};

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

/** Count active tasks from source rows (indexed by status). */
export async function countActiveTasksFromSource(
  ctx: DbCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<ActiveTaskCounts> {
  const [pendingTasks, acknowledgedTasks, inProgressTasks] = await Promise.all([
    ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', chatroomId).eq('status', 'pending')
      )
      .collect(),
    ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', chatroomId).eq('status', 'acknowledged')
      )
      .collect(),
    ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', chatroomId).eq('status', 'in_progress')
      )
      .collect(),
  ]);

  return {
    pending: pendingTasks.length,
    acknowledged: acknowledgedTasks.length,
    inProgress: inProgressTasks.length,
  };
}

export function activeTaskCountsDrifted(
  materialized: ActiveTaskCounts & { pending: number; acknowledged: number; inProgress: number },
  actual: ActiveTaskCounts
): boolean {
  return (
    materialized.pending !== actual.pending ||
    materialized.acknowledged !== actual.acknowledged ||
    materialized.inProgress !== actual.inProgress
  );
}

/** Returns true if any active status has at least one task row. */
export async function hasActiveTaskFromSource(
  ctx: DbCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  for (const status of ACTIVE_TASK_STATUSES) {
    const active = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', chatroomId).eq('status', status)
      )
      .first();
    if (active) return true;
  }
  return false;
}

/**
 * Re-sync pending/acknowledged/inProgress on the materialized counts doc from task rows.
 * No-op when counts doc is missing or active counters already match source.
 */
export async function reconcileActiveTaskCountsFromSource(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  const counts = await ctx.db
    .query('chatroom_taskCounts')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .first();

  if (!counts) return false;

  const actual = await countActiveTasksFromSource(ctx, chatroomId);
  if (!activeTaskCountsDrifted(counts, actual)) {
    return false;
  }

  await ctx.db.patch('chatroom_taskCounts', counts._id, {
    pending: actual.pending,
    acknowledged: actual.acknowledged,
    inProgress: actual.inProgress,
  });

  return true;
}

/** Active counts for UI/API: source when materialized active counters drift. */
export function resolveActiveCountsForRead(
  materialized: Doc<'chatroom_taskCounts'>,
  actual: ActiveTaskCounts
): ActiveTaskCounts {
  if (!activeTaskCountsDrifted(materialized, actual)) {
    return {
      pending: materialized.pending,
      acknowledged: materialized.acknowledged,
      inProgress: materialized.inProgress,
    };
  }
  return actual;
}
