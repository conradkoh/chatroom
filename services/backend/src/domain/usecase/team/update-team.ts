/**
 * Use Case: Update Team
 *
 * Handles the team switch lifecycle:
 *   1. Updates the chatroom's team configuration
 *   2. Dispatches stop events for running agents on outgoing team roles
 *   3. Preserves outgoing teamAgentConfigs, restores target-team rows, seeds missing ones
 *   4. Starts target-team agents that have complete configs
 */

import { buildSeedTeamAgentConfigFields } from './seed-team-config-on-switch';
import { startTargetTeamAgentsOnSwitch } from './start-target-team-agents-on-switch';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey, teamRoleKeyMatchesTeam } from '../../../../convex/utils/teamRoleKey';
import { rebuildAgentOperationalStatusForChatroom } from '../agent/project-agent-operational-status';
import { requestAgentStop } from '../agent/request-agent-stop';
import { upsertAgentViewMetadata } from '../chatroom/project-agent-view-metadata';
import { projectAssignedTaskSnapshotsForMachines } from '../machine/patch-team-agent-config';
import { reassignInFlightTasksOnTeamSwitch } from '../task/release-tasks-on-agent-exit';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UpdateTeamInput {
  chatroomId: Id<'chatroom_rooms'>;
  teamId: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  userId: Id<'users'>;
}

export interface UpdateTeamResult {
  /** Number of stop events dispatched for running agents. */
  stoppedAgentCount: number;
  /** Number of outgoing team agent configs preserved (not deleted). */
  preservedCount: number;
  restoredCount: number;
  seededCount: number;
  /** Number of start events dispatched for target-team agents. */
  startedAgentCount: number;
}

// ─── Use Case ────────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
export async function updateTeam(
  ctx: MutationCtx,
  input: UpdateTeamInput
): Promise<UpdateTeamResult> {
  const { chatroomId, teamId, teamName, teamRoles, teamEntryPoint, userId } = input;
  const previousChatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  const oldTeamId = previousChatroom?.teamId;

  const existingTeamConfigs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();

  const now = Date.now();
  let stoppedAgentCount = 0;
  let preservedCount = 0;
  let restoredCount = 0;
  let seededCount = 0;

  await ctx.db.patch('chatroom_rooms', chatroomId, {
    teamId,
    teamName,
    teamRoles,
    teamEntryPoint,
  });
  const updatedRoom = await ctx.db.get('chatroom_rooms', chatroomId);
  if (updatedRoom)
    await upsertAgentViewMetadata(ctx, {
      chatroomId,
      ownerId: updatedRoom.ownerId,
      teamId,
      teamName,
      teamRoles,
    });

  await reassignInFlightTasksOnTeamSwitch(ctx, chatroomId);

  const affectedMachineIds = new Set<string>();

  for (const config of existingTeamConfigs.filter(
    (c) => !oldTeamId || teamRoleKeyMatchesTeam(c.teamRoleKey, chatroomId, oldTeamId)
  )) {
    if (config.machineId) {
      affectedMachineIds.add(config.machineId);
    }
    if (config.machineId && (config.desiredState === 'running' || config.spawnedAgentPid != null)) {
      await requestAgentStop(ctx, {
        machineId: config.machineId,
        chatroomId,
        role: config.role,
        reason: 'platform.team_switch',
      });
      stoppedAgentCount++;
    }

    preservedCount++;
  }

  for (const role of teamRoles) {
    const key = buildTeamRoleKey(chatroomId, teamId, role);
    const existing = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', key))
      .first();
    if (existing) {
      await ctx.db.patch('chatroom_teamAgentConfigs', existing._id, {
        desiredState: 'stopped',
        spawnedAgentPid: undefined,
        spawnedAt: undefined,
        updatedAt: now,
      });
      if (existing.machineId) affectedMachineIds.add(existing.machineId);
      restoredCount++;
    } else {
      const seedFields = await buildSeedTeamAgentConfigFields({
        ctx,
        chatroomId,
        userId,
        targetTeamId: teamId,
        targetRole: role,
        previousChatroom,
        existingTeamConfigs,
      });
      if (seedFields?.machineId) {
        await ctx.db.insert('chatroom_teamAgentConfigs', {
          teamRoleKey: key,
          chatroomId,
          role,
          type: 'remote',
          createdAt: now,
          updatedAt: now,
          desiredState: 'stopped',
          ...seedFields,
        });
        affectedMachineIds.add(seedFields.machineId);
        seededCount++;
      }
    }
  }

  await projectAssignedTaskSnapshotsForMachines(ctx, affectedMachineIds);
  await rebuildAgentOperationalStatusForChatroom(ctx, chatroomId, undefined, { pruneStale: true });

  const startedAgentCount = await startTargetTeamAgentsOnSwitch(ctx, {
    chatroomId,
    teamId,
    teamRoles,
    userId,
  });

  return {
    stoppedAgentCount,
    preservedCount,
    restoredCount,
    seededCount,
    startedAgentCount,
  };
}
