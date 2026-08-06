/**
 * Handles an agent.requestStart event from chatroom_eventStream.
 * Delegates to v2 startAgent use case via agent-control bridge.
 */

import { Effect } from 'effect';

import type { Id } from '../../../../api.js';
import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../../../../commands/machine/daemon-start/daemon-services.js';
import type { AgentHarness } from '../../../../commands/machine/daemon-start/types.js';
import { startAgent } from '../../../../daemon/domain/usecase/start-agent.js';
import { createStartAgentDeps } from '../../../../daemon/entry/bridge/agent-control-bridge.js';

export interface AgentRequestStartEventPayload {
  _id: Id<'chatroom_eventStream'>;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
  reason: string;
  deadline: number;
  wantResume?: boolean;
}

export const onRequestStartAgentEffect = (
  event: AgentRequestStartEventPayload
): Effect.Effect<void, never, DaemonAgentProcessManagerService | DaemonSessionService> =>
  Effect.gen(function* () {
    const agentPm = yield* DaemonAgentProcessManagerService;
    const session = yield* DaemonSessionService;

    yield* Effect.promise(() =>
      startAgent(createStartAgentDeps(agentPm, session), {
        commandId: event._id.toString(),
        chatroomId: event.chatroomId as string,
        role: event.role,
        agentHarness: event.agentHarness,
        model: event.model,
        workingDir: event.workingDir,
        reason: event.reason,
        deadline: event.deadline,
        wantResume: event.wantResume,
      })
    );
  });
