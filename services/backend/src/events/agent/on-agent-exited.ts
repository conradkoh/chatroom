import type { Id } from '../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../convex/_generated/server';
import { internal } from '../../../convex/_generated/api';
import { getTeamEntryPoint } from '../../domain/entities/team';
import { ACTIVE_TASK_STATUSES } from '../../domain/entities/task';
import { buildTeamRoleKey } from '../../../convex/utils/teamRoleKey';
import { AGENT_REQUEST_DEADLINE_MS } from '../../../config/reliability';
import { patchParticipantStatus } from '../../domain/entities/participant';

export interface OnAgentExitedArgs {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  intentional: boolean;
  stopReason?: string;
}

/**
 * Handles the `agent.exited` event (backend side).
 *
 * Two recovery paths:
 *
 * 1. **Active-task recovery** — If the exited role has an active task, schedules
 *    an immediate `ensureAgentHandler.check` to restart the agent with minimal delay.
 *
 * 2. **Eager (idle) recovery** — If no active task exists but the config says the
 *    agent should be running (`desiredState === 'running'`), emits an
 *    `agent.requestStart` event directly so the daemon restarts the agent.
 *    This prevents agents from staying dead when they crash between tasks.
 *    Guarded by the circuit breaker (`circuitState !== 'open'`).
 *
 * Intentional stops (`user.stop`, `platform.team_switch`) skip recovery entirely.
 */
export async function onAgentExited(ctx: MutationCtx, args: OnAgentExitedArgs): Promise<void> {
  const { chatroomId, role, intentional, stopReason } = args;

  // Determine if this exit warrants crash recovery.
  // Restart on clean exits and unexpected crashes, including signal-terminated
  // processes (daemon kills idle agent after turn ends in RPC mode).
  // The desiredState guard below prevents restart when the user explicitly stops.
  const shouldRestart = stopReason
    ? stopReason !== 'user.stop' && stopReason !== 'platform.team_switch' && stopReason !== 'daemon.turn_complete'
    : !intentional;

  if (!shouldRestart) {
    return;
  }

  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);

  let teamConfig = null;
  if (chatroom?.teamId) {
    const exitTeamRoleKey = buildTeamRoleKey(chatroomId, chatroom.teamId, role);
    teamConfig = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', exitTeamRoleKey))
      .first();
  }

  if (teamConfig?.desiredState === 'stopped') {
    return;
  }

  if (teamConfig && teamConfig.type !== 'remote') {
    return;
  }

  const entryPoint = getTeamEntryPoint(chatroom ?? {});
  const normalizedRole = role.toLowerCase();

  const allTasks = await ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  const activeTasks = allTasks.filter((t) => ACTIVE_TASK_STATUSES.has(t.status));

  const relevantTask = activeTasks.find((task) => {
    const assignedRole = task.assignedTo?.toLowerCase();
    if (assignedRole) return assignedRole === normalizedRole;
    return normalizedRole === entryPoint?.toLowerCase();
  });

  if (relevantTask) {
    // Path 1: Active-task recovery — schedule immediate ensure-agent check
    await ctx.scheduler.runAfter(0, internal.ensureAgentHandler.check, {
      taskId: relevantTask._id,
      chatroomId,
      snapshotUpdatedAt: 0, // bypass staleness guard
    });
    return;
  }

  // Path 2: Eager (idle) recovery — no active task, but agent should be running.
  // Emit agent.requestStart directly so the daemon restarts the agent promptly.
  if (
    teamConfig &&
    teamConfig.desiredState === 'running' &&
    teamConfig.circuitState !== 'open' &&
    teamConfig.machineId &&
    teamConfig.agentHarness &&
    teamConfig.model &&
    teamConfig.workingDir
  ) {
    const now = Date.now();
    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.requestStart',
      chatroomId,
      machineId: teamConfig.machineId,
      role: teamConfig.role,
      agentHarness: teamConfig.agentHarness,
      model: teamConfig.model,
      workingDir: teamConfig.workingDir,
      reason: 'platform.crash_recovery',
      deadline: now + AGENT_REQUEST_DEADLINE_MS,
      timestamp: now,
    });
    await patchParticipantStatus(ctx, chatroomId, teamConfig.role, 'agent.requestStart');
  }
}
