/**
 * Stop Agent Command Handler — stops a running agent process.
 *
 * Delegates to AgentProcessManager.stop() for the actual kill + cleanup.
 */

import type { StopReason } from '../../../../infrastructure/machine/stop-reason.js';
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
  }
): Promise<CommandResult> {
  const { chatroomId, role, reason } = args;
  console.log(`   ↪ stop-agent command received`);
  console.log(`      Chatroom: ${chatroomId}`);
  console.log(`      Role: ${role}`);
  console.log(`      Reason: ${reason}`);

  const result = await ctx.deps.agentProcessManager.stop({
    chatroomId,
    role,
    reason: reason as StopReason,
  });

  const msg = result.success ? `Agent stopped (${role})` : `Failed to stop agent (${role})`;
  console.log(`   ${result.success ? '✅' : '⚠️ '} ${msg}`);

  return { result: msg, failed: !result.success };
}

/**
 * Handle a stop-agent command — thin wrapper around executeStopAgent.
 */
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
