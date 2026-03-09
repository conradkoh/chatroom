/**
 * Use Case: Update Team
 *
 * Handles the team switch lifecycle:
 *   1. Updates the chatroom's team configuration
 *   2. Dispatches stop events for running agents on stale roles
 *   3. Deletes teamAgentConfigs (these belong to the platform, not the machine)
 *
 * IMPORTANT: machineAgentConfigs are NOT deleted here. The machine daemon is
 * the single writer for those records. Stop events are dispatched and the
 * daemon handles cleanup via recordAgentExited (clears PID). The stale
 * machineAgentConfig records are harmless once PIDs are cleared — they just
 * represent "this machine once ran an agent for this role" and will be
 * overwritten when agents restart under the new team.
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
    // which clears the PID in machineAgentConfig.
    if (config.machineId && config.desiredState === 'running') {
      await ctx.db.insert('chatroom_eventStream', {
        type: 'agent.requestStop',
        chatroomId,
        machineId: config.machineId,
        role: config.role,
        reason: 'team-switch',
        deadline: now + AGENT_REQUEST_DEADLINE_MS,
        timestamp: now,
      });
      stoppedAgentCount++;
    }

    // Delete the team config — these belong to the platform layer, not the machine.
    // New configs will be created fresh when agents are restarted under the new team.
    await ctx.db.delete('chatroom_teamAgentConfigs', config._id);
  }

  // ── Step 3: Also stop agents that appear in machineAgentConfigs but ────
  //    may not have teamAgentConfigs (e.g., if the teamConfig was already
  //    deleted or never fully created). This ensures no running process
  //    is left behind.

  const stoppedMachineRoles = new Set(
    existingTeamConfigs
      .filter((c) => c.machineId && c.desiredState === 'running')
      .map((c) => `${c.machineId}::${c.role}`)
  );

  const machineConfigs = await ctx.db
    .query('chatroom_machineAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();

  const newRolesLower = new Set(teamRoles.map((r) => r.toLowerCase()));

  for (const mc of machineConfigs) {
    // Only stop agents for roles being removed AND that have a PID
    if (!newRolesLower.has(mc.role.toLowerCase()) && mc.spawnedAgentPid != null) {
      const key = `${mc.machineId}::${mc.role}`;
      if (!stoppedMachineRoles.has(key)) {
        await ctx.db.insert('chatroom_eventStream', {
          type: 'agent.requestStop',
          chatroomId,
          machineId: mc.machineId,
          role: mc.role,
          reason: 'team-switch',
          deadline: now + AGENT_REQUEST_DEADLINE_MS,
          timestamp: now,
        });
        stoppedAgentCount++;
      }
    }
  }

  return {
    stoppedAgentCount,
    deletedTeamConfigCount: existingTeamConfigs.length,
  };
}
