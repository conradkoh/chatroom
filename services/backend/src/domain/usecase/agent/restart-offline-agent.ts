/**
 * Use Case: Restart Offline Agent
 *
 * Consolidates the logic for detecting and restarting an offline remote agent.
 * This use case encapsulates:
 *   1. Participant liveness check (is the agent actually offline?)
 *   2. Agent config resolution via getAgentConfig (single source of truth)
 *   3. Eligibility checks (remote agent, has machine, has harness/workingDir)
 *   4. Daemon health validation (is the machine daemon connected and fresh?)
 *   5. Dedup check (no duplicate pending start-agent commands)
 *   6. Command dispatch (stop + start)
 *
 * Accepts a Convex MutationCtx as first parameter so it can be called from
 * any mutation handler without being coupled to a specific Convex wrapper.
 */

import { getAgentConfig } from './get-agent-config';
import { startAgent } from './start-agent';
import { stopAgent } from './stop-agent';
import { DAEMON_HEARTBEAT_TTL_MS } from '../../../../config/reliability';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Input parameters for the restart-offline-agent use case. */
export interface RestartOfflineAgentInput {
  /** The chatroom containing the agent. */
  chatroomId: Id<'chatroom_rooms'>;
  /** The role of the agent to restart (e.g. "builder", "reviewer"). */
  targetRole: string;
  /** The user ID dispatching the restart (used as sentBy on commands). */
  userId: Id<'users'>;
}

/** Possible outcomes of the restart attempt. */
export type RestartOfflineAgentResult =
  | { status: 'skipped'; reason: SkipReason }
  | { status: 'error'; code: RestartErrorCode; message: string }
  | { status: 'dispatched'; machineId: string; model: string | undefined };

export type SkipReason =
  | 'agent_online'
  | 'no_agent_config'
  | 'no_machine_id'
  | 'daemon_not_connected'
  | 'daemon_stale'
  | 'missing_model'
  | 'missing_harness_or_workdir'
  | 'duplicate_pending_command';

export type RestartErrorCode = 'not_remote';

// ─── Use Case ────────────────────────────────────────────────────────────────

/**
 * Restart an offline remote agent by dispatching stop + start commands
 * to the machine daemon.
 *
 * @param ctx - Convex mutation context (provides db access)
 * @param input - The restart parameters
 * @returns The outcome of the restart attempt
 */
export async function restartOfflineAgent(
  ctx: MutationCtx,
  input: RestartOfflineAgentInput
): Promise<RestartOfflineAgentResult> {
  const { chatroomId, targetRole, userId } = input;
  const now = Date.now();

  // ── Step 1: Check if the agent is actually offline ─────────────────────

  const participants = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();

  const targetParticipant = participants.find(
    (p) => p.role.toLowerCase() === targetRole.toLowerCase()
  );

  if (targetParticipant) {
    const isWaitingExpired =
      targetParticipant.status === 'waiting' &&
      targetParticipant.readyUntil &&
      targetParticipant.readyUntil < now;
    const isActiveExpired =
      targetParticipant.status === 'active' &&
      targetParticipant.activeUntil &&
      targetParticipant.activeUntil < now;

    if (!isWaitingExpired && !isActiveExpired) {
      return { status: 'skipped', reason: 'agent_online' };
    }
  }

  // ── Step 2: Resolve agent config (single source of truth) ──────────────

  const configResult = await getAgentConfig(ctx, { chatroomId, role: targetRole });

  if (!configResult.found) {
    return { status: 'skipped', reason: 'no_agent_config' };
  }

  const config = configResult.config;

  // ── Step 3: Eligibility checks ─────────────────────────────────────────

  if (config.type !== 'remote') {
    return {
      status: 'error',
      code: 'not_remote',
      message:
        `Agent "${targetRole}" is type "${config.type}" (user-managed). ` +
        `Only remote agents can be restarted.`,
    };
  }

  if (!config.machineId) {
    return { status: 'skipped', reason: 'no_machine_id' };
  }

  if (!config.agentHarness || !config.workingDir) {
    console.warn(
      `[restart-offline-agent] Missing agentHarness or workingDir for role "${targetRole}" ` +
        `(agentHarness=${config.agentHarness ?? 'undefined'}, ` +
        `workingDir=${config.workingDir ?? 'undefined'}), skipping restart`
    );
    return { status: 'skipped', reason: 'missing_harness_or_workdir' };
  }

  if (!config.model) {
    console.warn(
      `[restart-offline-agent] No model found for role "${targetRole}" ` +
        `(source: ${config.modelSource}). Cannot restart without a model.`
    );
    return { status: 'skipped', reason: 'missing_model' };
  }

  // ── Step 4: Validate daemon health ─────────────────────────────────────

  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', config.machineId!))
    .first();

  if (!machine || !machine.daemonConnected) {
    return { status: 'skipped', reason: 'daemon_not_connected' };
  }

  const timeSinceLastSeen = now - machine.lastSeenAt;
  if (timeSinceLastSeen > DAEMON_HEARTBEAT_TTL_MS) {
    console.warn(
      `[restart-offline-agent] Daemon on machine "${machine.hostname}" (${machine.machineId}) ` +
        `appears stale — last seen ${timeSinceLastSeen}ms ago (TTL: ${DAEMON_HEARTBEAT_TTL_MS}ms). ` +
        `Skipping restart for role "${targetRole}".`
    );
    return { status: 'skipped', reason: 'daemon_stale' };
  }

  // ── Step 5: Dedup check ────────────────────────────────────────────────

  const pendingCommands = await ctx.db
    .query('chatroom_machineCommands')
    .withIndex('by_machineId_status', (q) =>
      q.eq('machineId', config.machineId!).eq('status', 'pending')
    )
    .collect();

  const hasPendingRestart = pendingCommands.some(
    (cmd) =>
      cmd.type === 'start-agent' &&
      cmd.payload.chatroomId === chatroomId &&
      cmd.payload.role?.toLowerCase() === targetRole.toLowerCase()
  );

  if (hasPendingRestart) {
    console.warn(
      `[restart-offline-agent] Skipping duplicate restart for role "${targetRole}" ` +
        `in chatroom ${chatroomId} — a pending start-agent command already exists`
    );
    return { status: 'skipped', reason: 'duplicate_pending_command' };
  }

  // ── Step 6: Dispatch stop + start commands via use cases ────────────────
  // At this point all required fields are guaranteed non-null by Steps 3+4

  await stopAgent(ctx, {
    machineId: config.machineId,
    chatroomId,
    role: config.role,
    userId,
  });

  const startResult = await startAgent(
    ctx,
    {
      machineId: config.machineId,
      chatroomId,
      role: config.role,
      userId,
      model: config.model,
      agentHarness: config.agentHarness,
      workingDir: config.workingDir,
    },
    machine
  );

  return {
    status: 'dispatched',
    machineId: config.machineId,
    model: startResult.model,
  };
}
