/**
 * Release a single in-flight task after a native turn failure.
 *
 * Scoped to the exact (chatroomId, role, taskId): transitions
 * `acknowledged`/`in_progress` back to `pending` via the
 * `releaseTaskAfterTurnFailure` FSM trigger, preserving `assignedTo`.
 * Already-`pending`/`completed` tasks are idempotent no-ops.
 */

import { transitionTask } from './transition-task';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { TaskStatus } from '../../../../convex/lib/taskStateMachine';

export type ReleaseTaskAfterTurnFailureResult = {
  released: boolean;
  status: TaskStatus;
  updatedAt: number;
};

type ReleaseScope = {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  taskId: Id<'chatroom_tasks'>;
};

function isAssignedToRole(task: Doc<'chatroom_tasks'>, role: string): boolean {
  const assigned = task.assignedTo ?? 'nobody';
  return assigned.toLowerCase() === role.toLowerCase();
}

/** Loads the task. Throws when absent. */
async function fetchTaskOrThrow(
  ctx: MutationCtx,
  taskId: Id<'chatroom_tasks'>
): Promise<Doc<'chatroom_tasks'>> {
  const task = await ctx.db.get('chatroom_tasks', taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }
  return task;
}

/** Enforces exact (chatroom, role) scope. Throws on mismatch. */
function assertReleaseScope(task: Doc<'chatroom_tasks'>, args: ReleaseScope): void {
  if (task.chatroomId !== args.chatroomId) {
    throw new Error('Task does not belong to this chatroom');
  }
  if (!isAssignedToRole(task, args.role)) {
    throw new Error(`Task is assigned to ${task.assignedTo ?? 'nobody'}, not ${args.role}`);
  }
}

/** Loads the task and enforces exact (chatroom, role) scope. Throws on mismatch. */
async function loadScopedTask(
  ctx: MutationCtx,
  args: ReleaseScope
): Promise<Doc<'chatroom_tasks'>> {
  const task = await fetchTaskOrThrow(ctx, args.taskId);
  assertReleaseScope(task, args);
  return task;
}

function isReleasableStatus(status: TaskStatus): boolean {
  return status === 'acknowledged' || status === 'in_progress';
}

function isSettledStatus(status: TaskStatus): boolean {
  return status === 'pending' || status === 'completed';
}

export async function releaseTaskAfterTurnFailure(
  ctx: MutationCtx,
  args: ReleaseScope
): Promise<ReleaseTaskAfterTurnFailureResult> {
  const task = await loadScopedTask(ctx, args);
  const status = task.status as TaskStatus;
  if (isReleasableStatus(status)) {
    await transitionTask(ctx, args.taskId, 'pending', 'releaseTaskAfterTurnFailure', undefined, {
      skipAgentStatusUpdate: true,
      skipAutoPromotion: true,
      source: 'task_service',
    });
    const released = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!released) {
      throw new Error(`Task ${args.taskId} not found after transition`);
    }
    return { released: true, status: 'pending', updatedAt: released.updatedAt };
  }
  if (isSettledStatus(status)) {
    return { released: false, status, updatedAt: task.updatedAt };
  }
  throw new Error(`Cannot release task with status: ${status}`);
}
