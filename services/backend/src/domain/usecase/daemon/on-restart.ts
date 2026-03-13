/**
 * Centralized agent cleanup on exit.
 *
 * Consolidates the cleanup steps that were previously duplicated across
 * `cleanupStaleMachines` (tasks.ts) and `recordAgentExited` (machines.ts):
 * event emission, PID clearing, config removal, participant update, and
 * crash recovery scheduling.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { processConfigRemoval } from '../agent/config-removal';
import { PARTICIPANT_EXITED_ACTION } from '../../entities/participant';
import { onAgentExited } from '../../../events/agent/on-agent-exited';

export interface CleanupAgentOnExitInput {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  pid: number;
  intentional: boolean;
  stopReason?: string;
  /** If true, skip emitting agent.exited event (caller already emitted it) */
  skipEvent?: boolean;
}

export async function cleanupAgentOnExit(
  ctx: MutationCtx,
  input: CleanupAgentOnExitInput
): Promise<void> {
  const now = Date.now();

  // 1. Emit agent.exited event
  if (!input.skipEvent) {
    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.exited',
      chatroomId: input.chatroomId,
      role: input.role,
      machineId: input.machineId,
      pid: input.pid,
      intentional: input.intentional,
      stopReason: input.stopReason,
      timestamp: now,
    });
  }

  // 2. Clear PID from chatroom_teamAgentConfigs
  const chatroom = await ctx.db.get(input.chatroomId);
  if (chatroom?.teamId) {
    const teamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, input.role);
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
      .first();

    if (config && config.machineId === input.machineId) {
      await ctx.db.patch(config._id, {
        spawnedAgentPid: undefined,
        spawnedAt: undefined,
        updatedAt: now,
      });
    }
  }

  // 3. Process pending config removal
  await processConfigRemoval(ctx, {
    chatroomId: input.chatroomId,
    role: input.role,
    machineId: input.machineId,
  });

  // 4. Mark participant as exited
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

  // 5. Trigger crash recovery
  await onAgentExited(ctx, {
    chatroomId: input.chatroomId,
    role: input.role,
    intentional: input.intentional,
    stopReason: input.stopReason,
  });
}
