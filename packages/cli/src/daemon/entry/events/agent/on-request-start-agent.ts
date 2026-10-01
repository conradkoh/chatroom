/**
 * Handles an agent.requestStart command from the machine command inbox.
 * Delegates to v2 startAgent use case via agent-control bridge.
 */

import { isAgentStartReason } from '@workspace/backend/src/domain/entities/agent.js';
import { Effect } from 'effect';

import type { Id } from '../../../../api.js';
import { startAgent } from '../../../../daemon/domain/usecase/start-agent.js';
import { createStartAgentDeps } from '../../../../daemon/entry/bridge/agent-control-bridge.js';
import {
  DaemonAgentProcessManagerCommandService,
  DaemonSessionService,
} from '../../daemon-services.js';
import type { AgentHarness } from '../../daemon-types.js';

export interface AgentRequestStartEventPayload {
  _id: Id<'chatroom_machineCommandInbox'>;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
  reason: string;
  deadline: number;
  wantResume: boolean;
}

export const onRequestStartAgentEffect = (
  event: AgentRequestStartEventPayload
): Effect.Effect<void, never, DaemonAgentProcessManagerCommandService | DaemonSessionService> =>
  Effect.gen(function* () {
    const processManagerService = yield* DaemonAgentProcessManagerCommandService;
    const session = yield* DaemonSessionService;

    yield* Effect.promise(async () => {
      const reason = event.reason;
      const deps = createStartAgentDeps(session, processManagerService);
      if (!isAgentStartReason(reason)) {
        await deps.session.emitAgentStartFailed({
          chatroomId: event.chatroomId,
          role: event.role,
          error: `Invalid agent start reason: ${reason}`,
        });
        return;
      }
      await startAgent(deps, {
        commandId: event._id.toString(),
        chatroomId: event.chatroomId as string,
        role: event.role,
        agentHarness: event.agentHarness,
        model: event.model,
        workingDir: event.workingDir,
        reason,
        deadline: event.deadline,
        wantResume: event.wantResume,
      });
    });
  });
