/**
 * Handles an agent.requestStop event from chatroom_eventStream.
 * Checks deadline before executing — expired requests are skipped.
 * Calls executeStopAgent directly — no synthetic command ID needed.
 */

import { Effect } from 'effect';

import type { Id } from '../../../api.js';
import type { DaemonAgentProcessManagerService } from '../../../commands/machine/daemon-start/daemon-services.js';
import { executeStopAgentEffect } from '../../../commands/machine/daemon-start/handlers/stop-agent.js';
import type { StopAgentReason } from '../../../commands/machine/daemon-start/types.js';

export interface AgentRequestStopEventPayload {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  reason: string;
  deadline: number;
  pid?: number;
}

// ── Effect twin ──────────────────────────────────────────────────────────────

/**
 * Effect twin for onRequestStopAgent — uses DaemonAgentProcessManagerService.
 * Delegates to executeStopAgentEffect after deadline check.
 */
export const onRequestStopAgentEffect = (
  event: AgentRequestStopEventPayload
): Effect.Effect<void, never, DaemonAgentProcessManagerService> =>
  Effect.gen(function* () {
    if (Date.now() > event.deadline) {
      console.log(
        `[daemon] ⏰ Skipping expired agent.requestStop for role=${event.role} (deadline passed)`
      );
      return;
    }
    yield* executeStopAgentEffect({
      chatroomId: event.chatroomId,
      role: event.role,
      reason: event.reason as StopAgentReason,
      pid: event.pid,
    });
  });
