/**
 * Start target-team agents after a team switch.
 *
 * For each role on the new team, starts the agent when a complete remote config
 * exists (machineId, model, workingDir, agentHarness). Roles without config or
 * with unavailable harnesses are skipped so the switch still completes.
 */

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { startAgent } from '../agent/start-agent';

export interface StartTargetTeamAgentsInput {
  chatroomId: Id<'chatroom_rooms'>;
  teamId: string;
  teamRoles: string[];
  userId: Id<'users'>;
}

async function getOwnedMachine(
  ctx: MutationCtx,
  machineId: string,
  userId: Id<'users'>
): Promise<Doc<'chatroom_machines'> | null> {
  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  if (!machine || machine.userId !== userId) return null;
  return machine;
}

// fallow-ignore-next-line complexity
export async function startTargetTeamAgentsOnSwitch(
  ctx: MutationCtx,
  input: StartTargetTeamAgentsInput
): Promise<number> {
  const { chatroomId, teamId, teamRoles, userId } = input;
  let startedAgentCount = 0;
  const machineCache = new Map<string, Doc<'chatroom_machines'>>();

  for (const role of teamRoles) {
    const teamRoleKey = buildTeamRoleKey(chatroomId, teamId, role);
    // fallow-ignore-next-line code-duplication
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
      .first();

    if (config?.type !== 'remote') continue;

    const { machineId, model, workingDir, agentHarness } = config;
    if (!machineId || !model || !workingDir || !agentHarness) continue;

    let machine = machineCache.get(machineId);
    if (!machine) {
      const resolved = await getOwnedMachine(ctx, machineId, userId);
      if (!resolved) continue;
      machine = resolved;
      machineCache.set(machineId, machine);
    }

    try {
      await startAgent(
        ctx,
        {
          machineId,
          chatroomId,
          role,
          userId,
          model,
          agentHarness,
          workingDir,
          reason: 'platform.team_switch',
          wantResume: config.wantResume,
        },
        machine
      );
      startedAgentCount++;
    } catch {
      // Harness unavailable or other start failure — skip this role.
    }
  }

  return startedAgentCount;
}
