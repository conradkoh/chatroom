/**
 * Use Case: Try Enforce Agent Liveness
 *
 * High-level entry point for ensuring an agent is alive. This is the use case
 * that callers (handoff, sendMessage, task recovery cron) should invoke instead
 * of calling `restartOfflineAgent` directly.
 *
 * Responsibilities:
 *   1. Resolve agent config via getAgentConfig
 *   2. Gate on agent type — only remote agents are eligible for auto-restart.
 *      Non-remote (custom/user-managed) agents produce an explicit error result,
 *      making misuse visible to callers.
 *   3. Delegate to `restartOfflineAgent` for the actual restart logic.
 *
 * Returns a discriminated-union result type so callers can handle each outcome
 * without exceptions.
 */

import { getAgentConfig } from './get-agent-config';
import { restartOfflineAgent, type RestartOfflineAgentResult } from './restart-offline-agent';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TryEnforceAgentLivenessInput {
  chatroomId: Id<'chatroom_rooms'>;
  targetRole: string;
  userId: Id<'users'>;
}

export type TryEnforceAgentLivenessResult =
  | { status: 'enforced'; machineId: string; model: string | undefined }
  | { status: 'skipped'; reason: EnforceSkipReason }
  | { status: 'error'; code: EnforceErrorCode; message: string };

export type EnforceSkipReason =
  | 'agent_online'
  | 'no_agent_config'
  | 'no_machine_id'
  | 'daemon_not_connected'
  | 'daemon_stale'
  | 'missing_model'
  | 'missing_harness_or_workdir'
  | 'duplicate_pending_command';

export type EnforceErrorCode = 'not_remote';

// ─── Use Case ────────────────────────────────────────────────────────────────

/**
 * Attempt to enforce that the target agent is alive.
 *
 * For remote agents this delegates to `restartOfflineAgent`.
 * For custom (user-managed) agents this returns an error result — the platform
 * cannot restart agents it doesn't control.
 */
export async function tryEnforceAgentLiveness(
  ctx: MutationCtx,
  input: TryEnforceAgentLivenessInput
): Promise<TryEnforceAgentLivenessResult> {
  const { chatroomId, targetRole, userId } = input;

  // ── Step 1: Resolve agent config ──────────────────────────────────────

  const configResult = await getAgentConfig(ctx, { chatroomId, role: targetRole });

  if (!configResult.found) {
    return { status: 'skipped', reason: 'no_agent_config' };
  }

  const config = configResult.config;

  // ── Step 2: Gate on agent type ────────────────────────────────────────

  if (config.type !== 'remote') {
    return {
      status: 'error',
      code: 'not_remote',
      message:
        `Agent "${targetRole}" is type "${config.type}" (user-managed). ` +
        `Only remote agents can be auto-restarted by the platform.`,
    };
  }

  // ── Step 3: Delegate to restartOfflineAgent ───────────────────────────

  const restartResult: RestartOfflineAgentResult = await restartOfflineAgent(ctx, {
    chatroomId,
    targetRole,
    userId,
  });

  if (restartResult.status === 'dispatched') {
    return {
      status: 'enforced',
      machineId: restartResult.machineId,
      model: restartResult.model,
    };
  }

  if (restartResult.status === 'error') {
    return {
      status: 'error',
      code: restartResult.code,
      message: restartResult.message,
    };
  }

  return { status: 'skipped', reason: restartResult.reason };
}
