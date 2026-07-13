/**
 * Handles an agent.restart event from chatroom_eventStream.
 */

import { Effect } from 'effect';

import type { Id } from '../../../api.js';
import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../../../commands/machine/daemon-start/daemon-services.js';
import { runRestartOrchestrator } from '../../../commands/machine/daemon-start/restart-orchestrator.js';

export interface AgentRestartEventPayload {
  _id: Id<'chatroom_eventStream'>;
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
  agentHarness: string;
  model: string;
  workingDir: string;
  correlationId: string;
  deadline: number;
  wantResume?: boolean;
}

export const onRequestRestartAgentEffect = (
  event: AgentRestartEventPayload
): Effect.Effect<void, never, DaemonAgentProcessManagerService | DaemonSessionService> =>
  Effect.gen(function* () {
    if (Date.now() > event.deadline) {
      console.log(
        `[daemon] ⏰ Skipping expired agent.restart for role=${event.role} (deadline passed)`
      );
      return;
    }

    console.log(
      `[daemon] Processing agent.restart (correlationId=${event.correlationId}) for role=${event.role}`
    );

    const agentMgr = yield* DaemonAgentProcessManagerService;
    const session = yield* DaemonSessionService;

    yield* Effect.tryPromise(() =>
      runRestartOrchestrator(
        {
          session: {
            sessionId: session.sessionId,
            machineId: session.machineId,
            convexUrl: session.convexUrl,
            backend: session.backend,
          },
          agentMgr,
        },
        {
          chatroomId: event.chatroomId,
          role: event.role,
          agentHarness: event.agentHarness,
          model: event.model,
          workingDir: event.workingDir,
          correlationId: event.correlationId,
          wantResume: event.wantResume,
        }
      )
    ).pipe(Effect.catchAll(() => Effect.void));
  });
