import { Effect } from 'effect';

import type { Id } from '../../../api.js';
import { DaemonAgentProcessManagerService } from '../../../commands/machine/daemon-start/daemon-services.js';
import type { StopReason } from '../../../infrastructure/machine/stop-reason.js';

export interface AgentExitedPayload {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  pid: number;
  code: number | null;
  signal: string | null;
  stopReason: StopReason;
  agentHarness?: string;
  model?: string;
  workingDir?: string;
}

export const onAgentExitedEffect = (
  payload: AgentExitedPayload
): Effect.Effect<void, never, DaemonAgentProcessManagerService> =>
  Effect.gen(function* () {
    const apm = yield* DaemonAgentProcessManagerService;
    yield* apm.handleExit({
      chatroomId: payload.chatroomId,
      role: payload.role,
      pid: payload.pid,
      code: payload.code,
      signal: payload.signal,
    });
  });
