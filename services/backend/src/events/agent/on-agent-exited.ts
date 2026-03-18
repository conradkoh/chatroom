import type { Id } from '../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../convex/utils/teamRoleKey';
import { AGENT_REQUEST_DEADLINE_MS } from '../../../config/reliability';
import { patchParticipantStatus } from '../../domain/entities/participant';

export interface OnAgentExitedArgs {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  stopReason?: string;
  agentHarness?: string;
}

/**
 * Handles the `agent.exited` event (backend side).
 *
 * Recovery path:
 *
 * **Eager (idle) recovery** — If the agent should be running
 * (`desiredState === 'running'`), emits an `agent.requestStart` event
 * directly so the daemon restarts the agent. This prevents agents from
 * staying dead when they crash between tasks.
 * Guarded by the circuit breaker (`circuitState !== 'open'`).
 *
 * Intentional stops (`user.stop`, `platform.team_switch`) skip recovery entirely.
 *
 * Note: Active-task recovery is now handled by the daemon's task monitor
 * instead of this backend handler. The daemon monitors tasks directly and
 * restarts agents as needed.
 */
export async function onAgentExited(ctx: MutationCtx, args: OnAgentExitedArgs): Promise<void> {
  const { chatroomId, role, stopReason } = args;

  // Determine if this exit warrants crash recovery.
  // Restart on clean exits and unexpected crashes, including signal-terminated
  // processes (daemon kills idle agent after turn ends in RPC mode).
  // The desiredState guard below prevents restart when the user explicitly stops.
  // Excludes: user.stop, platform.team_switch, agent_process.turn_end, agent_process.turn_end_quick_fail
  // If no stopReason is provided, default to restarting (safe fallback for legacy events).
  const shouldRestart = !stopReason ||
    !['user.stop', 'platform.team_switch', 'agent_process.turn_end', 'agent_process.turn_end_quick_fail'].includes(stopReason);

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

  // Emit agent.requestStart directly so the daemon restarts the agent promptly.
  // This covers both active-task recovery and idle recovery.
  if (
    teamConfig &&
    teamConfig.desiredState === 'running' &&
    teamConfig.circuitState !== 'open' &&
    teamConfig.machineId &&
    teamConfig.agentHarness &&
    teamConfig.model &&
    teamConfig.workingDir
  ) {
    // Skip crash recovery for Pi harness — the daemon's task monitor owns restarts.
    // The backend only handles crash recovery for OpenCode (and as a fallback when daemon is offline).
    if (args.agentHarness === 'pi') {
      return;
    }

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
