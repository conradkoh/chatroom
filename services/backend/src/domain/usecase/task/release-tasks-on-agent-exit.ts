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
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import type { TaskStatus } from '../../../../convex/lib/taskStateMachine';
import { getTeamEntryPoint } from '../../entities/team';

const RELEASE_FROM_STATUSES: TaskStatus[] = ['acknowledged', 'in_progress'];

/**
 * Whether agent exit should release tasks back to pending for the exiting role.
 * `platform.team_switch` reassigns to the new team entry point instead.
 */
export function shouldReleaseTasksOnAgentExit(stopReason?: string): boolean {
  return stopReason !== 'platform.team_switch';
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

/**
 * Reassign all in-flight tasks to the chatroom's current team entry point on team switch.
 * Called from updateTeam after the new team fields are persisted.
 */
export async function reassignInFlightTasksOnTeamSwitch(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<number> {
  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!chatroom) return 0;

  const entryPoint = getTeamEntryPoint(chatroom);
  if (!entryPoint) return 0;

  let reassigned = 0;

  for (const status of RELEASE_FROM_STATUSES) {
    const tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', chatroomId).eq('status', status)
      )
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
  const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!chatroom) return 0;

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

/**
 * Release orphaned tasks when the agent process is gone but recordAgentExited was missed.
 *
 * Trigger: invoked from claimTask (before claiming) and sweepOrphanedTasks mutation.
 * Sweeps when teamAgentConfig has no live PID and is not desired running.
 */
export async function releaseOrphanedTasksForRole(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string }
): Promise<number> {
  const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!chatroom?.teamId) return 0;

  const teamRoleKey = buildTeamRoleKey(args.chatroomId, chatroom.teamId, args.role);
  const config = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .first();

  const agentAlive =
    config != null &&
    (config.spawnedAgentPid != null || config.desiredState === 'running');

  if (agentAlive) {
    return 0;
  }

  return releaseTasksOnAgentExit(ctx, args);
}
