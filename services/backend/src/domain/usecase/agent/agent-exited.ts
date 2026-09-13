/**
 * Use Case: Agent Exited
 *
 * Idempotent handler for when an agent process exits. Replaces the inline
 * cleanup previously done in `recordAgentExited` (machines.ts).
 *
 * Two responsibilities:
 *   1. Clear PID on config — only if the PID and machineId match (PID-gated idempotency)
 *   2. Mark participant as exited — only if the config still belongs to the same machine
 *      (prevents overwriting a running agent's status during machine switch)
 *
 */

import { getLastSentLaunchRequestForRole } from './get-last-sent-launch-request';
import { projectAgentRoleStatusReadModel } from './project-agent-role-status-read-model';
import { transitionAgentStatus } from './transition-agent-status';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { AgentStopReasonEnum } from '../../entities/agent';
import { PARTICIPANT_EXITED_ACTION } from '../../entities/participant';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Input parameters for the agentExited use case. */
export interface AgentExitedInput {
  revisionKey?: string | undefined;
  /** The chatroom the agent was running in. */
  chatroomId: Id<'chatroom_rooms'>;
  /** The role of the exited agent. */
  role: string;
  /** The machine that reported the exit. */
  machineId: string;
  /** The PID of the exited agent process. */
  pid: number;
  /** Optional reason for the stop (e.g. 'user.stop' or 'daemon.shutdown'). */
  stopReason?: string | undefined;
  /** Optional exit code of the process. */
  exitCode?: number | undefined;
  /** Optional signal that killed the process. */
  signal?: string | undefined;
  /** Optional stop signal requested. */
  stopSignal?: string | undefined;
  /** Optional agent harness identifier. */
  agentHarness?: string | undefined;
  /** Daemon outbox ordering metadata. */
  emittedAt?: number | undefined;
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
export type AgentExitedResult = { applied: boolean };

export async function agentExited(
  ctx: MutationCtx,
  input: AgentExitedInput
): Promise<AgentExitedResult> {
  const { chatroomId, role, machineId, pid, stopReason } = input;

  const launchRequest = await getLastSentLaunchRequestForRole(ctx, { chatroomId, role });
  if (!launchRequest || launchRequest.machineId !== machineId) return { applied: false };

  // The daemon owns the process. Convex only checks the last observed PID in
  // its thin read model so a stale exit cannot overwrite a newer observation.
  const statusRow = await ctx.db
    .query('chatroom_agentRoleStatusReadModel')
    .withIndex('by_chatroom_role', (q) =>
      q.eq('chatroomId', chatroomId).eq('role', role.trim().toLowerCase())
    )
    .first();
  if (statusRow?.observedPid !== undefined && statusRow.observedPid !== pid) {
    return { applied: false };
  }

  // 2. Mark participant as exited — guard against machine switch
  //    If the config for this role now belongs to a different machine, or the
  //    participant status is already set from a newer agent, skip the patch.
  const shouldUpdateParticipant = launchRequest.machineId === machineId;

  if (shouldUpdateParticipant) {
    const isOrchestratedRestart =
      stopReason === AgentStopReasonEnum['platform.task_start_in_new_session'] ||
      stopReason === AgentStopReasonEnum['daemon.respawn'] ||
      stopReason === AgentStopReasonEnum['user.restart'];
    const participantStatus = isOrchestratedRestart ? 'agent.restart' : 'agent.exited';
    const participantDesiredState = isOrchestratedRestart ? 'running' : undefined;
    await transitionAgentStatus(ctx, chatroomId, role, participantStatus, participantDesiredState);

    // Also mark the participant as exited and clear the connection (matching
    // the cleanup previously done by cleanupMachineAgent).
    const participant = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .unique();
    if (participant) {
      await ctx.db.patch('chatroom_participants', participant._id, {
        lastSeenAction: PARTICIPANT_EXITED_ACTION,
        connectionId: undefined,
      });
    }
  }
  await projectAgentRoleStatusReadModel(ctx, {
    chatroomId,
    role,
    launchRequest,
    event: { status: 'offline' },
    agentType: launchRequest.agentType,
    clearObservedPid: true,
    observedAt: input.emittedAt ?? Date.now(),
    sourceMachineId: machineId,
    sourceEventAt: input.emittedAt,
    sourceRevisionKey: input.revisionKey,
  });
  return { applied: true };
}
