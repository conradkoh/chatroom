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

/** Flat deps for core — no DaemonContext. */
export interface AgentExitedDeps {
  handleExit: (opts: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    pid: number;
    code: number | null;
    signal: string | null;
  }) => Promise<void>;
}

/**
 * Core — passthrough to AgentProcessManager.handleExit().
 */
export async function onAgentExitedCore(
  deps: AgentExitedDeps,
  payload: AgentExitedPayload
): Promise<void> {
  await deps.handleExit({
    chatroomId: payload.chatroomId,
    role: payload.role,
    pid: payload.pid,
    code: payload.code,
    signal: payload.signal,
  });
}

/** Effect twin — yields DaemonAgentProcessManagerService. */
// fallow-ignore-next-line unused-export
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
