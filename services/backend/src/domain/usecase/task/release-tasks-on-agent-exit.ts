/**
 * Release in-flight tasks when an agent exits unexpectedly.
 *
 * Resets acknowledged/in_progress tasks assigned to the exited role back to
 * `pending` with cleared claim fields so get-next-task can reclaim immediately
 * (no RECOVERY_GRACE_PERIOD_MS block on acknowledgedAt).
 */

import { transitionTask } from './transition-task';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { TaskStatus } from '../../../../convex/lib/taskStateMachine';

const RELEASE_FROM_STATUSES: TaskStatus[] = ['acknowledged', 'in_progress'];

/**
 * Intentional stops — task should stay claimed until the user or workflow
 * completes or reassigns it explicitly.
 */
const SKIP_TASK_RELEASE_STOP_REASONS = new Set([
  'user.stop',
  'platform.team_switch',
  'daemon.shutdown',
]);

export function shouldReleaseTasksOnAgentExit(stopReason?: string): boolean {
  if (!stopReason) return true;
  return !SKIP_TASK_RELEASE_STOP_REASONS.has(stopReason);
}

export async function releaseTasksOnAgentExit(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string }
): Promise<number> {
  const normalizedRole = args.role.toLowerCase();
  let released = 0;

  for (const status of RELEASE_FROM_STATUSES) {
    const tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', status)
      )
      .collect();

    for (const task of tasks) {
      if (task.assignedTo?.toLowerCase() !== normalizedRole) continue;

      await transitionTask(ctx, task._id, 'pending', 'releaseTaskOnAgentExit', undefined, {
        skipAgentStatusUpdate: true,
      });
      released++;
    }
  }

  return released;
}
