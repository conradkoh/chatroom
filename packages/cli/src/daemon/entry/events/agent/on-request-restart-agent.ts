/**
 * Handles an agent.restart command from the machine command inbox.
 * Delegates to v2 restartAgent use case via agent-control bridge.
 */

import { Effect } from 'effect';

import type { Id } from '../../../../api.js';
import type { MaxReasoningLevel } from '../../../../daemon/domain/entities/harness-shared-types.js';
import { restartAgent } from '../../../../daemon/domain/usecase/restart-agent.js';
import { createRestartAgentDeps } from '../../../../daemon/entry/bridge/agent-control-bridge.js';
import { DaemonAgentProcessManagerService, DaemonSessionService } from '../../daemon-services.js';

export interface AgentRestartEventPayload {
  _id: Id<'chatroom_machineCommandInbox'>;
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
  agentHarness: string;
  model: string;
  workingDir: string;
  correlationId: string;
  deadline: number;
  wantResume: boolean;
  lifecycleRevision?: number;
  maxReasoningLevel?: MaxReasoningLevel;
}

export const onRequestRestartAgentEffect = (
  event: AgentRestartEventPayload
): Effect.Effect<void, never, DaemonAgentProcessManagerService | DaemonSessionService> =>
  Effect.gen(function* () {
    const agentMgr = yield* DaemonAgentProcessManagerService;
    const session = yield* DaemonSessionService;

    yield* Effect.promise(() =>
      restartAgent(createRestartAgentDeps(agentMgr, session), {
        commandId: event._id.toString(),
        chatroomId: event.chatroomId as string,
        machineId: event.machineId,
        role: event.role,
        agentHarness: event.agentHarness,
        model: event.model,
        workingDir: event.workingDir,
        correlationId: event.correlationId,
        deadline: event.deadline,
        wantResume: event.wantResume,
        lifecycleRevision: event.lifecycleRevision,
        maxReasoningLevel: event.maxReasoningLevel,
      })
    );
  });
