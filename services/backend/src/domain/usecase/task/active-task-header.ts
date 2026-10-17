/**
 * Active task header projection.
 *
 * `chatroom_activeTaskHeaders` holds one slim row per task that is currently
 * active and assigned, so daemon/taskStatus:listActive never loads
 * `chatroom_tasks.content`. This module is the ONLY writer of that table.
 *
 * Invariant: a row exists iff `task.status` is active AND `task.assignedTo` is
 * set, and its fields equal the task's. The status union here mirrors the schema
 * validator and `ACTIVE_TASK_STATUSES`.
 */

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { omitUndefined } from '../../../../convex/lib/omitUndefined';
import { ACTIVE_TASK_STATUSES } from '../../entities/task';

/** Active task statuses, matching the `chatroom_activeTaskHeaders.status` validator. */
type ActiveTaskHeaderStatus = 'pending' | 'acknowledged' | 'in_progress';

type ActiveAssignedTask = Doc<'chatroom_tasks'> & {
  status: ActiveTaskHeaderStatus;
  assignedTo: string;
};

function isActiveAssignedTask(task: Doc<'chatroom_tasks'>): task is ActiveAssignedTask {
  return ACTIVE_TASK_STATUSES.has(task.status) && task.assignedTo !== undefined;
}

/** Builds the slim projection row; shared by the insert and patch paths. */
function toActiveTaskHeader(task: {
  taskId: Id<'chatroom_tasks'>;
  chatroomId: Id<'chatroom_rooms'>;
  status: ActiveTaskHeaderStatus;
  assignedTo: string;
  createdAt: number;
  updatedAt: number;
  startInNewSession?: boolean | undefined;
}) {
  return omitUndefined({
    taskId: task.taskId,
    chatroomId: task.chatroomId,
    status: task.status,
    assignedTo: task.assignedTo,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startInNewSession: task.startInNewSession,
  });
}

/** Task fields mirrored by the projection, compared field-by-field for no-op suppression. */
const HEADER_FIELDS = [
  'chatroomId',
  'status',
  'assignedTo',
  'createdAt',
  'updatedAt',
  'startInNewSession',
] as const;

function headerDiffers(
  existing: Doc<'chatroom_activeTaskHeaders'>,
  header: ReturnType<typeof toActiveTaskHeader>
): boolean {
  return HEADER_FIELDS.some((field) => existing[field] !== header[field]);
}

function readHeader(ctx: MutationCtx, taskId: Id<'chatroom_tasks'>) {
  return ctx.db
    .query('chatroom_activeTaskHeaders')
    .withIndex('by_taskId', (q) => q.eq('taskId', taskId))
    .first();
}

async function deleteHeaderRow(
  ctx: MutationCtx,
  existing: Doc<'chatroom_activeTaskHeaders'> | null
): Promise<void> {
  if (existing) await ctx.db.delete('chatroom_activeTaskHeaders', existing._id);
}

async function upsertHeaderRow(
  ctx: MutationCtx,
  existing: Doc<'chatroom_activeTaskHeaders'> | null,
  task: ActiveAssignedTask
): Promise<void> {
  const header = toActiveTaskHeader({
    taskId: task._id,
    chatroomId: task.chatroomId,
    status: task.status,
    assignedTo: task.assignedTo,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startInNewSession: task.startInNewSession,
  });

  if (!existing) {
    await ctx.db.insert('chatroom_activeTaskHeaders', header);
    return;
  }

  if (headerDiffers(existing, header)) {
    // Set startInNewSession explicitly (possibly undefined) so a cleared session
    // policy is removed from the row; patch leaves unspecified fields unchanged.
    await ctx.db.patch('chatroom_activeTaskHeaders', existing._id, {
      ...header,
      startInNewSession: task.startInNewSession,
    });
  }
}

/**
 * Keeps `chatroom_activeTaskHeaders` equal to the task's header when active and
 * assigned; deletes it otherwise. Idempotent: unchanged tasks cause no write, so
 * no-op task updates do not invalidate the listActive subscription.
 */
export async function syncActiveTaskHeader(
  ctx: MutationCtx,
  task: Doc<'chatroom_tasks'>
): Promise<void> {
  const existing = await readHeader(ctx, task._id);

  if (!isActiveAssignedTask(task)) {
    await deleteHeaderRow(ctx, existing);
    return;
  }

  await upsertHeaderRow(ctx, existing, task);
}

/** Deletes the projection row for a task, if present. Idempotent. */
export async function removeActiveTaskHeader(
  ctx: MutationCtx,
  taskId: Id<'chatroom_tasks'>
): Promise<void> {
  await deleteHeaderRow(ctx, await readHeader(ctx, taskId));
}
