/**
 * Release in-flight tasks for a role back to `pending` with cleared claim fields
 * so get-next-task can reclaim immediately (no RECOVERY_GRACE_PERIOD_MS block on
 * acknowledgedAt).
 *
 * Callers are explicit, user-initiated flows only (chatroom stop interrupts the
 * enhancer role; agent restart requests). The `agent.exited` lifecycle fact no
 * longer triggers this — see `onAgentExited` (plan R1/R2).
 */

import { transitionTask } from './transition-task';
import { writeTaskStatusSignals } from './write-task-status-signals';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { withActiveTeamStructure } from '../../../../convex/lib/chatroomTeam';
import type { TaskStatus } from '../../../../convex/lib/taskStateMachine';
import { WorkspaceTaskInboxEventType } from '../../entities/chatroom-workspace-task-inbox';
import { getTeamEntryPoint } from '../../entities/team';
import { writeWorkspaceTaskInboxEvent } from '../machine/write-workspace-task-inbox-event';

const RELEASE_FROM_STATUSES: TaskStatus[] = ['acknowledged', 'in_progress'];

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

/**
 * Reassign all in-flight tasks to the chatroom's current team entry point on team switch.
 * Called from updateTeam after the new team fields are persisted.
 */
export async function reassignInFlightTasksOnTeamSwitch(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<number> {
  const rawChatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!rawChatroom) return 0;
  const chatroom = await withActiveTeamStructure(ctx, rawChatroom);

  const entryPoint = getTeamEntryPoint(chatroom);
  if (!entryPoint) return 0;

  const normalizedEntry = entryPoint.toLowerCase();
  let reassigned = 0;

  // Acknowledged / in_progress → pending, reassigned to the new entry point.
  for (const status of RELEASE_FROM_STATUSES) {
    const tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) => q.eq('chatroomId', chatroomId).eq('status', status))
      .collect();

    for (const task of tasks) {
      await transitionTask(
        ctx,
        task._id,
        'pending',
        'reassignTaskOnTeamSwitch',
        { assignedTo: entryPoint },
        { skipAgentStatusUpdate: true }
      );
      reassigned++;
    }
  }

  // Already-pending tasks assigned to a now-stale role. transitionTask's no-op
  // guard (currentStatus === newStatus) prevents it from updating assignedTo here,
  // so patch directly. The new entry point's get-next-task (claimTask) filters
  // pending tasks by assignedTo and will surface these. Tasks already targeting
  // the entry point (or unassigned, which resolve to it dynamically) are skipped.
  const pendingTasks = await ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom_status', (q) => q.eq('chatroomId', chatroomId).eq('status', 'pending'))
    .collect();

  for (const task of pendingTasks) {
    if (!task.assignedTo) continue;
    if (task.assignedTo.toLowerCase() === normalizedEntry) continue;
    await ctx.db.patch('chatroom_tasks', task._id, {
      assignedTo: entryPoint,
      updatedAt: Date.now(),
    });
    const reassignedTask = await ctx.db.get('chatroom_tasks', task._id);
    if (reassignedTask) {
      await writeWorkspaceTaskInboxEvent(
        ctx,
        WorkspaceTaskInboxEventType.TaskUpdated,
        reassignedTask
      );
      await writeTaskStatusSignals(ctx, reassignedTask);
    }
    reassigned++;
  }

  return reassigned;
}

/**
 * Reassign in-flight tasks for the exiting role to the new team entry point.
 * Used when recordAgentExited runs with stopReason `platform.team_switch`.
 */
export async function reassignTasksOnTeamSwitch(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string }
): Promise<number> {
  const rawChatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!rawChatroom) return 0;
  const chatroom = await withActiveTeamStructure(ctx, rawChatroom);

  const entryPoint = getTeamEntryPoint(chatroom);
  if (!entryPoint) return 0;

  const normalizedRole = args.role.toLowerCase();
  let reassigned = 0;

  for (const status of RELEASE_FROM_STATUSES) {
    const tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', status)
      )
      .collect();

    for (const task of tasks) {
      if (task.assignedTo?.toLowerCase() !== normalizedRole) continue;

      await transitionTask(
        ctx,
        task._id,
        'pending',
        'reassignTaskOnTeamSwitch',
        { assignedTo: entryPoint },
        { skipAgentStatusUpdate: true }
      );
      reassigned++;
    }
  }

  return reassigned;
}
