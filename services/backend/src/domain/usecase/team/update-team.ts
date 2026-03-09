/**
 * Use Case: Update Team
 *
 * Handles the team switch lifecycle:
 *   1. Updates the chatroom's team configuration
 *   2. Dispatches stop events for running agents on stale roles
 *   3. Deletes teamAgentConfigs (these belong to the platform, not the machine)
 *
 * agentPreferences are also preserved — they're UI hints for pre-populating
 * the start form and remain useful if the user switches back.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { AGENT_REQUEST_DEADLINE_MS } from '../../../../config/reliability';

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

  // ── Step 2: Stop running agents and delete team configs ────────────────

  const existingTeamConfigs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();

  const now = Date.now();
  let stoppedAgentCount = 0;

  for (const config of existingTeamConfigs) {
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
      });
      stoppedAgentCount++;
    }

    // Delete the team config — these belong to the platform layer, not the machine.
    // New configs will be created fresh when agents are restarted under the new team.
    await ctx.db.delete('chatroom_teamAgentConfigs', config._id);
  }

  return {
    stoppedAgentCount,
    deletedTeamConfigCount: existingTeamConfigs.length,
  };
}
