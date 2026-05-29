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
 * Release orphaned **tasks** when backend agent state says the role is not running.
 *
 * ## Layering (process vs task orphans)
 *
 * | Layer | Owner | Responsibility |
 * |-------|--------|----------------|
 * | Process | CLI `AgentProcessManager` | Kill live PIDs on every `agent.requestStart` (`killExistingBeforeSpawn`), recover persisted PIDs on daemon restart (`recover()`). Source of truth for OS processes. |
 * | Task | This function | Reset acknowledged/in_progress tasks when `chatroom_teamAgentConfigs` has no `spawnedAgentPid` and `desiredState !== 'running'` — i.e. DB thinks the agent is gone. Does not inspect the OS. |
 *
 * Daemon kill-then-spawn normally clears PID via `recordAgentExited` (`daemon.respawn`) before respawn,
 * so tasks stay assigned during replacement. This sweeper is a **fallback** when exit was never recorded
 * (crash, partial cleanup, manual PID clear).
 *
 * **Triggers:** `claimTask` (before claiming, so get-next-task can reclaim) and `sweepOrphanedTasks`
 * (explicit cleanup). Not redundant with daemon process management — complementary scopes.
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
