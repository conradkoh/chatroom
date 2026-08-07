/**
 * Stop Agent Command Handler — stops a running agent process.
 * Delegates to v2 stopAgent use case via agent-control bridge.
 */

import { Effect } from 'effect';

import { stopAgent } from '../../domain/usecase/stop-agent.js';
import { createStopAgentDeps } from '../bridge/agent-control-bridge.js';
import { DaemonAgentProcessManagerService } from '../daemon-services.js';
import type { CommandResult, StopAgentCommand, StopAgentReason } from '../daemon-types.js';

export const executeStopAgentEffect = (args: {
  chatroomId: string;
  role: string;
  reason: StopAgentReason;
  pid?: number;
}): Effect.Effect<CommandResult, never, DaemonAgentProcessManagerService> =>
  Effect.gen(function* () {
    const agentMgr = yield* DaemonAgentProcessManagerService;

    const result = yield* Effect.promise(() =>
      stopAgent(createStopAgentDeps(agentMgr), {
        chatroomId: args.chatroomId,
        role: args.role,
        reason: args.reason,
        deadline: Number.MAX_SAFE_INTEGER,
        pid: args.pid,
      })
    );

    return result;
  });

/** Effect twin for handleStopAgent — extracts args from command and delegates. */
export const handleStopAgentEffect = (
  command: StopAgentCommand
): Effect.Effect<CommandResult, never, DaemonAgentProcessManagerService> =>
  executeStopAgentEffect({
    chatroomId: command.payload.chatroomId,
    role: command.payload.role,
    reason: command.reason,
  });
