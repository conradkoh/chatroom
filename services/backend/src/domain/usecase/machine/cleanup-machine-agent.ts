/**
 * @deprecated Use `agentExited` from `../agent/agent-exited.ts` instead.
 * This module is kept for backward compatibility but should not be used by new code.
 *
 * Shared cleanup for agents running on a machine.
 *
 * Previously used by:
 * - `recordAgentExited` (machines.ts) — now uses `agentExited` use case
 *
 * This helper handles cleanup responsibilities for a single agent exit:
 *   1. Clear spawnedAgentPid / spawnedAt on the agent config
 *   2. Process any pending config-removal request
 *   3. Mark the participant record as exited
 *
 * Note: Callers are responsible for emitting `agent.exited` to the event stream.
 */

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { PARTICIPANT_EXITED_ACTION } from '../../entities/participant';
import { processConfigRemoval } from '../agent/config-removal';

export interface CleanupMachineAgentInput {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
}

/**
 * Clear the spawned-agent PID and timestamp on a team-agent config row.
 * No-op if the config has no PID set.
 */
export async function clearAgentSpawnState(
  ctx: MutationCtx,
  config: Doc<'chatroom_teamAgentConfigs'>,
  now: number
): Promise<void> {
  if (config.spawnedAgentPid == null) return;
  await ctx.db.patch('chatroom_teamAgentConfigs', config._id, {
    spawnedAgentPid: undefined,
    spawnedAt: undefined,
    updatedAt: now,
  });
}

/**
 * @deprecated Use `agentExited` from `../agent/agent-exited.ts` instead.
 *
 * Run the agent-cleanup pipeline for a single chatroom+role on a machine.
 *
 * Steps:
 *   1. Clear PID/spawnedAt on the matching config (by teamRoleKey lookup)
 *   2. Process any pending config-removal request
 *   3. Mark participant as exited
 *
 * Note: Callers (e.g. `recordAgentExited`) are responsible for emitting
 * `agent.exited` to the event stream before or after calling this function.
 */
export async function cleanupMachineAgent(
  ctx: MutationCtx,
  input: CleanupMachineAgentInput
): Promise<void> {
  const now = Date.now();

  // 1. Clear PID from chatroom_teamAgentConfigs
  const chatroom = await ctx.db.get('chatroom_rooms', input.chatroomId);
  if (chatroom?.teamId) {
    const teamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, input.role);
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
      .first();

    if (config && config.machineId === input.machineId) {
      await clearAgentSpawnState(ctx, config, now);
    }
  }

  // 2. Process pending config removal
  await processConfigRemoval(ctx, {
    chatroomId: input.chatroomId,
    role: input.role,
    machineId: input.machineId,
  });

  // 3. Mark participant as exited
  const participant = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom_and_role', (q) =>
      q.eq('chatroomId', input.chatroomId).eq('role', input.role)
    )
    .unique();
  if (participant) {
    await ctx.db.patch('chatroom_participants', participant._id, {
      lastSeenAction: PARTICIPANT_EXITED_ACTION,
      connectionId: undefined,
      lastStatus: 'agent.exited',
    });
  }
}
