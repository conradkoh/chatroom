/**
 * Use Case: Agent Exited
 *
 * Idempotent handler for when an agent process exits. Replaces the inline
 * cleanup previously done in `recordAgentExited` (machines.ts).
 *
 * Ordered so a dropped fact has no side effects:
 *   1. Guard — the launch request must exist and belong to the reporting machine,
 *      and a non-zero pid must match the last observed pid (pid 0 means "no
 *      process", so it bypasses the pid guard).
 *   2. Project the role offline first. The read-model projection owns the
 *      ordering (stale_event) and machine (machine_mismatch) guards; if it drops
 *      the fact, nothing else is mutated.
 *   3. Mark the participant as exited and clear its connection.
 *
 */

import { getLastSentLaunchRequestForRole } from './get-last-sent-launch-request';
import { projectAgentRoleStatusReadModel } from './project-agent-role-status-read-model';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
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
export type AgentExitedRejectionReason =
  'not_configured' | 'pid_mismatch' | 'stale_event' | 'machine_mismatch' | 'room_missing';

export type AgentExitedResult = {
  applied: boolean;
  reason?: AgentExitedRejectionReason | undefined;
};

export async function agentExited(
  ctx: MutationCtx,
  input: AgentExitedInput
): Promise<AgentExitedResult> {
  const { chatroomId, role, machineId, pid } = input;

  const launchRequest = await getLastSentLaunchRequestForRole(ctx, { chatroomId, role });
  if (!launchRequest || launchRequest.machineId !== machineId)
    return { applied: false, reason: 'not_configured' };

  // The daemon owns the process. Convex only checks the last observed PID in
  // its thin read model so a stale exit cannot overwrite a newer observation.
  const normalizedRole = role.trim().toLowerCase();
  const statusRow = launchRequest.workspaceId
    ? await ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_workspace_role', (q) =>
          q
            .eq('chatroomId', chatroomId)
            .eq('workspaceId', launchRequest.workspaceId)
            .eq('role', normalizedRole)
        )
        .first()
    : await ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', normalizedRole)
        )
        .first();
  // pid 0 means the daemon has no process for this role (the idle-slot stop path
  // emits it). It is not an identifier, so it cannot be a stale exit of a
  // different process: bypass the guard and let the projection clear observedPid.
  if (pid > 0 && statusRow?.observedPid !== undefined && statusRow.observedPid !== pid) {
    return { applied: false, reason: 'pid_mismatch' };
  }

  // Project first. A fact dropped by the projection's ordering or machine guard
  // must not mutate participants or anything else.
  const projection = await projectAgentRoleStatusReadModel(ctx, {
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
  if (!projection.applied) return { applied: false, reason: projection.reason };

  // Mark the participant as exited and clear its connection. The launch request
  // already matched this machine above.
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
  return { applied: true };
}
