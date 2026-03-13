/**
 * Shared cleanup for agents running on a machine.
 *
 * Used by:
 * - `recordAgentExited` (machines.ts) — single-agent exit reported by the daemon
 * - `cleanupStaleMachines` (tasks.ts) — bulk cleanup when a machine's heartbeat expires
 * - `daemonShutdown` (machines.ts) — graceful daemon shutdown
 *
 * Callers are responsible for emitting their own agent.exited events (each
 * call-site needs different event fields such as exitCode, signal, etc.).
 * This helper handles the state cleanup that is common to all paths:
 *   1. Clear spawnedAgentPid / spawnedAt on the agent config
 *   2. Process any pending config-removal request
 *   3. Mark the participant record as exited
 */

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { processConfigRemoval } from '../agent/config-removal';
import { PARTICIPANT_EXITED_ACTION } from '../../entities/participant';

export interface CleanupMachineAgentInput {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  /** Skip config-removal processing (e.g. daemonShutdown doesn't need it). */
  skipConfigRemoval?: boolean;
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
  await ctx.db.patch(config._id, {
    spawnedAgentPid: undefined,
    spawnedAt: undefined,
    updatedAt: now,
  });
}

/**
 * Run the full agent-cleanup pipeline for a single chatroom+role on a machine.
 *
 * Steps:
 *   1. Clear PID/spawnedAt on the matching config (by teamRoleKey lookup)
 *   2. Process any pending config-removal request (unless `skipConfigRemoval`)
 *   3. Mark participant as exited
 */
export async function cleanupMachineAgent(
  ctx: MutationCtx,
  input: CleanupMachineAgentInput
): Promise<void> {
  const now = Date.now();

  // 1. Clear PID from chatroom_teamAgentConfigs
  const chatroom = await ctx.db.get(input.chatroomId);
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
  if (!input.skipConfigRemoval) {
    await processConfigRemoval(ctx, {
      chatroomId: input.chatroomId,
      role: input.role,
      machineId: input.machineId,
    });
  }

  // 3. Mark participant as exited
  const participant = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom_and_role', (q) =>
      q.eq('chatroomId', input.chatroomId).eq('role', input.role)
    )
    .unique();
  if (participant) {
    await ctx.db.patch(participant._id, {
      lastSeenAction: PARTICIPANT_EXITED_ACTION,
      connectionId: undefined,
      lastStatus: 'agent.exited',
    });
  }
}
