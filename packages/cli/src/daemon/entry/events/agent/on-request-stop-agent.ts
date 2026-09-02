/**
 * Handles an agent.requestStop command from the machine command inbox.
 * Delegates to v2 stopAgent use case via agent-control bridge.
 */

import { Effect } from 'effect';

import type { Id } from '../../../../api.js';
import { DaemonAgentProcessManagerService } from '../../daemon-services.js';

export interface AgentRequestStopEventPayload {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  reason: string;
  deadline: number;
  pid?: number | undefined;
}

export const onRequestStopAgentEffect = (
  event: AgentRequestStopEventPayload
): Effect.Effect<void, never, DaemonAgentProcessManagerService> =>
  Effect.gen(function* () {
    const agentMgr = yield* DaemonAgentProcessManagerService;

    if (Date.now() > event.deadline) return;
    if (agentMgr.runInboxRoleScopedStop) yield* agentMgr.runInboxRoleScopedStop(event);
  });
