/**
 * Handles an agent.requestStop event from chatroom_eventStream.
 * Delegates to v2 stopAgent use case via agent-control bridge.
 */

import { Effect } from 'effect';

import type { Id } from '../../../../api.js';
import { DaemonAgentProcessManagerService } from '../../../../commands/machine/daemon-start/daemon-services.js';
import { stopAgent } from '../../../../daemon/domain/usecase/stop-agent.js';
import { createStopAgentDeps } from '../../../../daemon/entry/bridge/agent-control-bridge.js';

export interface AgentRequestStopEventPayload {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  reason: string;
  deadline: number;
  pid?: number;
}

export const onRequestStopAgentEffect = (
  event: AgentRequestStopEventPayload
): Effect.Effect<void, never, DaemonAgentProcessManagerService> =>
  Effect.gen(function* () {
    const agentMgr = yield* DaemonAgentProcessManagerService;

    yield* Effect.promise(() =>
      stopAgent(createStopAgentDeps(agentMgr), {
        chatroomId: event.chatroomId as string,
        role: event.role,
        reason: event.reason,
        deadline: event.deadline,
        pid: event.pid,
      })
    );
  });
