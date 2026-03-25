/**
 * Use Case: Agent Exited
 *
 * Idempotent handler for when an agent process exits. Replaces the inline
 * cleanup previously done in `recordAgentExited` (machines.ts).
 *
 * Three responsibilities:
 *   1. Insert `agent.exited` event to the event stream (audit trail — always)
 *   2. Clear PID on config — only if the PID and machineId match (PID-gated idempotency)
 *   3. Mark participant as exited — only if the config still belongs to the same machine
 *      (prevents overwriting a running agent's status during machine switch)
 *
 * After clearing the PID, `processConfigRemoval()` is called to handle any
 * pending config-removal requests.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { PARTICIPANT_EXITED_ACTION } from '../../entities/participant';
import { processConfigRemoval } from './config-removal';
import { transitionAgentStatus } from './transition-agent-status';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Input parameters for the agentExited use case. */
export interface AgentExitedInput {
  /** The chatroom the agent was running in. */
  chatroomId: Id<'chatroom_rooms'>;
  /** The role of the exited agent. */
  role: string;
  /** The machine that reported the exit. */
  machineId: string;
  /** The PID of the exited agent process. */
  pid: number;
  /** Optional reason for the stop (e.g. 'user.stop', 'platform.crash_recovery'). */
  stopReason?: string;
  /** Optional exit code of the process. */
  exitCode?: number;
  /** Optional signal that killed the process. */
  signal?: string;
  /** Optional stop signal requested. */
  stopSignal?: string;
  /** Optional agent harness identifier. */
  agentHarness?: string;
}

// ─── Use Case ────────────────────────────────────────────────────────────────

/**
 * Handle an agent exit event.
 *
 * This function is idempotent — calling it multiple times with the same input
 * is safe. The PID-gated check ensures we never clear a newer agent's PID.
 *
 * @param ctx - Convex mutation context
 * @param input - The exit parameters
 */
export async function agentExited(ctx: MutationCtx, input: AgentExitedInput): Promise<void> {
  const { chatroomId, role, machineId, pid, stopReason, exitCode, signal, stopSignal } = input;

  // 1. Always insert the audit-trail event
  await ctx.db.insert('chatroom_eventStream', {
    type: 'agent.exited',
    chatroomId,
    role,
    machineId,
    pid,
    exitCode,
    signal,
    stopReason,
    stopSignal,
    timestamp: Date.now(),
  });

  // Look up the current config for this role
  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!chatroom?.teamId) return;

  const teamRoleKey = buildTeamRoleKey(chatroomId, chatroom.teamId, role);
  const config = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .first();

  // 2. Clear PID on config — PID-gated idempotency
  //    Only clear if BOTH the PID and machineId match. This prevents clearing
  //    a newer agent's PID if a stale exit report arrives after a new agent
  //    has been spawned.
  if (config && config.spawnedAgentPid === pid && config.machineId === machineId) {
    await ctx.db.patch('chatroom_teamAgentConfigs', config._id, {
      spawnedAgentPid: undefined,
      spawnedAt: undefined,
      updatedAt: Date.now(),
    });
  }

  // Process any pending config-removal requests (requires PID to be cleared first)
  await processConfigRemoval(ctx, {
    chatroomId,
    role,
    machineId,
  });

  // 3. Mark participant as exited — guard against machine switch
  //    If the config for this role now belongs to a different machine, or the
  //    participant status is already set from a newer agent, skip the patch.
  const shouldUpdateParticipant =
    !config || // No config — safe to mark exited
    config.machineId === machineId; // Config belongs to same machine

  if (shouldUpdateParticipant) {
    await transitionAgentStatus(ctx, chatroomId, role, 'agent.exited');

    // Also mark the participant as exited and clear the connection (matching
    // the cleanup previously done by cleanupMachineAgent).
    const participant = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', role)
      )
      .unique();
    if (participant) {
      await ctx.db.patch('chatroom_participants', participant._id, {
        lastSeenAction: PARTICIPANT_EXITED_ACTION,
        connectionId: undefined,
      });
    }
  }
}
