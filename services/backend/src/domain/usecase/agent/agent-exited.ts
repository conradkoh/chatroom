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

import { transitionAgentStatus } from './transition-agent-status';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { AgentStopReasonEnum } from '../../entities/agent';
import { normalizeAgentStopRole } from '../../entities/agent-stop-command';
import { PARTICIPANT_EXITED_ACTION } from '../../entities/participant';
import { patchTeamAgentConfig } from '../machine/patch-team-agent-config';

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
  /** Optional reason for the stop (e.g. 'user.stop', 'platform.crash_recovery'). */
  stopReason?: string | undefined;
  /** Optional exit code of the process. */
  exitCode?: number | undefined;
  /** Optional signal that killed the process. */
  signal?: string | undefined;
  /** Optional stop signal requested. */
  stopSignal?: string | undefined;
  /** Optional agent harness identifier. */
  agentHarness?: string | undefined;
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

  // Look up the current config for this role
  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!chatroom?.teamId) return { applied: false };

  const teamRoleKey = buildTeamRoleKey(chatroomId, chatroom.teamId, role);
  const config = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .first();

  if (input.revisionKey && !input.revisionKey.startsWith('exited:')) {
    const target = await ctx.db
      .query('chatroom_agentStopTargets')
      .withIndex('by_chatroom_role', (q) =>
        q.eq('chatroomId', chatroomId).eq('role', normalizeAgentStopRole(role))
      )
      .filter((q) => q.eq(q.field('revisionKey'), input.revisionKey))
      .first();
    if (!target || target.pid !== pid || target.machineId !== machineId) return { applied: false };
  }

  // 1. Clear PID on config — PID-gated idempotency
  //    Only clear if BOTH the PID and machineId match. This prevents clearing
  //    a newer agent's PID if a stale exit report arrives after a new agent
  //    has been spawned.
  if (config && config.spawnedAgentPid === pid && config.machineId === machineId) {
    await patchTeamAgentConfig(ctx, config._id, {
      ...{},
      ...{},
    });
  }

  // 2. Mark participant as exited — guard against machine switch
  //    If the config for this role now belongs to a different machine, or the
  //    participant status is already set from a newer agent, skip the patch.
  const shouldUpdateParticipant =
    !config || // No config — safe to mark exited
    config.machineId === machineId; // Config belongs to same machine

  if (shouldUpdateParticipant) {
    const isResumeStorm = stopReason === AgentStopReasonEnum['platform.resume_storm'];
    const isOrchestratedRestart =
      stopReason === AgentStopReasonEnum['platform.task_start_in_new_session'] ||
      stopReason === AgentStopReasonEnum['daemon.respawn'] ||
      stopReason === AgentStopReasonEnum['user.restart'];
    const participantStatus = isResumeStorm
      ? 'agent.resumeStormAborted'
      : isOrchestratedRestart
        ? 'agent.restart'
        : 'agent.exited';
    const participantDesiredState = isResumeStorm
      ? 'stopped'
      : isOrchestratedRestart
        ? 'running'
        : undefined;
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
  return { applied: true };
}
