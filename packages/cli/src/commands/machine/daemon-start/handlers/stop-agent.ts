/**
 * Stop Agent Command Handler — stops a running agent process.
 *
 * Delegates to AgentProcessManager.stop() for the actual kill + cleanup.
 */

import { Effect } from 'effect';

import type { StopReason } from '../../../../infrastructure/machine/stop-reason.js';
import { DaemonContextService } from '../daemon-context-service.js';
import type { CommandResult, DaemonContext, StopAgentCommand, StopAgentReason } from '../types.js';

/**
 * Execute the stop-agent logic for a given set of explicit args.
 * Delegates to AgentProcessManager for lifecycle management.
 */
export async function executeStopAgent(
  ctx: DaemonContext,
  args: {
    chatroomId: string;
    role: string;
    reason: StopAgentReason;
    pid?: number;
  }
): Promise<CommandResult> {
  const { chatroomId, role, reason, pid } = args;
  console.log(`   ↪ stop-agent command received`);
  console.log(`      Chatroom: ${chatroomId}`);
  console.log(`      Role: ${role}`);
  console.log(`      Reason: ${reason}`);

  const result = await ctx.deps.agentProcessManager.stop({
    chatroomId,
    role,
    reason: reason as StopReason,
    pid,
  });

  const msg = result.success ? `Agent stopped (${role})` : `Failed to stop agent (${role})`;
  console.log(`   ${result.success ? '✅' : '⚠️ '} ${msg}`);

  return { result: msg, failed: !result.success };
}

/**
 * Handle a stop-agent command — thin wrapper around executeStopAgent.
 */
// fallow-ignore-next-line unused-export
export async function handleStopAgent(
  ctx: DaemonContext,
  command: StopAgentCommand
): Promise<CommandResult> {
  return executeStopAgent(ctx, {
    chatroomId: command.payload.chatroomId,
    role: command.payload.role,
    reason: command.reason,
  });
}

// ── Effect twins ──────────────────────────────────────────────────────────────

/** Effect twin for executeStopAgent — yields DaemonContextService. */
// fallow-ignore-next-line unused-export
export const executeStopAgentEffect = (args: {
  chatroomId: string;
  role: string;
  reason: StopAgentReason;
  pid?: number;
}): Effect.Effect<CommandResult, never, DaemonContextService> =>
  Effect.gen(function* () {
    const ctx = yield* DaemonContextService;
    return yield* Effect.promise(() => executeStopAgent(ctx, args));
  });

/** Effect twin for handleStopAgent — extracts args from command and delegates. */
// fallow-ignore-next-line unused-export
export const handleStopAgentEffect = (
  command: StopAgentCommand
): Effect.Effect<CommandResult, never, DaemonContextService> =>
  executeStopAgentEffect({
    chatroomId: command.payload.chatroomId,
    role: command.payload.role,
    reason: command.reason,
  });
