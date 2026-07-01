/**
 * Use Case: Update Team
 *
 * Handles the team switch lifecycle:
 *   1. Updates the chatroom's team configuration
 *   2. Dispatches stop events for running agents on stale roles
 *   3. Deletes teamAgentConfigs (these belong to the platform, not the machine)
 */

import { AGENT_REQUEST_DEADLINE_MS } from '../../../../config/reliability';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { emitConfigRemoval } from '../agent/config-removal';
import {
  patchTeamAgentConfig,
  projectAssignedTaskSnapshotsForMachines,
} from '../machine/patch-team-agent-config';
import { reassignInFlightTasksOnTeamSwitch } from '../task/release-tasks-on-agent-exit';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UpdateTeamInput {
  chatroomId: Id<'chatroom_rooms'>;
  teamId: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
}

export interface UpdateTeamResult {
  /** Number of stop events dispatched for running agents. */
  stoppedAgentCount: number;
  /** Number of team agent configs deleted. */
  deletedTeamConfigCount: number;
}

// ─── Use Case ────────────────────────────────────────────────────────────────

export async function updateTeam(
  ctx: MutationCtx,
  input: UpdateTeamInput
): Promise<UpdateTeamResult> {
  const { chatroomId, teamId, teamName, teamRoles, teamEntryPoint } = input;

  // ── Step 1: Update chatroom team fields ────────────────────────────────

  await ctx.db.patch('chatroom_rooms', chatroomId, {
    teamId,
    teamName,
    teamRoles,
    teamEntryPoint,
  });

  // Reassign in-flight tasks to the new team entry point before stopping agents.
  await reassignInFlightTasksOnTeamSwitch(ctx, chatroomId);

  // ── Step 2: Stop running agents and delete team configs ────────────────

  const existingTeamConfigs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();

  const now = Date.now();
  let stoppedAgentCount = 0;
  let deletedTeamConfigCount = 0;

  // Track machines whose configs are being torn down so we can prune their
  // orphaned snapshot projection rows after the configs are deleted.
  const affectedMachineIds = new Set<string>();

  for (const config of existingTeamConfigs) {
    if (config.machineId) {
      affectedMachineIds.add(config.machineId);
    }
    // Dispatch stop event for running remote agents.
    // The daemon will receive this, stop the process, and call recordAgentExited
    // which clears the PID in teamAgentConfig.
    if (config.machineId && (config.desiredState === 'running' || config.spawnedAgentPid != null)) {
      await ctx.db.insert('chatroom_eventStream', {
        type: 'agent.requestStop',
        chatroomId,
        machineId: config.machineId,
        role: config.role,
        reason: 'platform.team_switch',
        deadline: now + AGENT_REQUEST_DEADLINE_MS,
        timestamp: now,
        pid: config.spawnedAgentPid ?? undefined,
      });
      stoppedAgentCount++;

      // Immediately clear the spawned PID and set desiredState to stopped.
      // This prevents stale configs from appearing as "running" in the UI
      // if the daemon doesn't process the stop event in time (deadline expiry,
      // daemon disconnected, etc.).
      await patchTeamAgentConfig(
        ctx,
        config._id,
        {
          spawnedAgentPid: undefined,
          spawnedAt: undefined,
          desiredState: 'stopped',
        },
        { skipProject: true }
      );
    }

    if (config.machineId) {
      // Request config removal via event stream — actual deletion happens
      // in recordAgentExited after the process is confirmed dead
      await emitConfigRemoval(ctx, {
        chatroomId,
        role: config.role,
        machineId: config.machineId,
        reason: 'team_switch',
      });

      // Since we cleared spawnedAgentPid above (or it was never set),
      // the config can be deleted immediately. The daemon will still
      // receive the stop event to kill the actual process.
      await ctx.db.delete('chatroom_teamAgentConfigs', config._id);
      deletedTeamConfigCount++;
    } else {
      // No machine — safe to delete (custom config or orphan)
      await ctx.db.delete('chatroom_teamAgentConfigs', config._id);
      deletedTeamConfigCount++;
    }
  }

  // Rebuild each affected machine's snapshot projection. With this chatroom's
  // configs now deleted, projection rebuild prunes the orphaned rows.
  await projectAssignedTaskSnapshotsForMachines(ctx, affectedMachineIds);

  return {
    stoppedAgentCount,
    deletedTeamConfigCount,
  };
}
