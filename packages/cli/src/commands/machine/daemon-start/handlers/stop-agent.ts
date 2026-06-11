/**
 * Stop Agent Command Handler — stops a running agent process.
 *
 * Delegates to AgentProcessManager.stop() for the actual kill + cleanup.
 */

import { Effect } from 'effect';

import type { StopReason } from '../../../../infrastructure/machine/stop-reason.js';
import { DaemonAgentProcessManagerService } from '../daemon-services.js';
import type { CommandResult, StopAgentCommand, StopAgentReason } from '../types.js';

// ── Effect twins ──────────────────────────────────────────────────────────────

/** Effect twin for executeStopAgent — yields DaemonAgentProcessManagerService directly. */
export const executeStopAgentEffect = (args: {
  chatroomId: string;
  role: string;
  reason: StopAgentReason;
  pid?: number;
}): Effect.Effect<CommandResult, never, DaemonAgentProcessManagerService> =>
  Effect.gen(function* () {
    const agentMgr = yield* DaemonAgentProcessManagerService;
    const { chatroomId, role, reason, pid } = args;
    console.log(`   ↪ stop-agent command received`);
    console.log(`      Chatroom: ${chatroomId}`);
    console.log(`      Role: ${role}`);
    console.log(`      Reason: ${reason}`);

    const result = yield* agentMgr.stop({
      chatroomId,
      role,
      reason: reason as StopReason,
      pid,
    });

    const msg = result.success ? `Agent stopped (${role})` : `Failed to stop agent (${role})`;
    console.log(`   ${result.success ? '✅' : '⚠️ '} ${msg}`);

    return { result: msg, failed: !result.success };
  });

/** Effect twin for handleStopAgent — extracts args from command and delegates. */
// fallow-ignore-next-line unused-export
export const handleStopAgentEffect = (
  command: StopAgentCommand
): Effect.Effect<CommandResult, never, DaemonAgentProcessManagerService> =>
  executeStopAgentEffect({
    chatroomId: command.payload.chatroomId,
    role: command.payload.role,
    reason: command.reason,
  });
