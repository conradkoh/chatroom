/**
 * Handles an agent.requestStop event from chatroom_eventStream.
 * Checks deadline before executing — expired requests are skipped.
 * Calls executeStopAgent directly — no synthetic command ID needed.
 */

import type { Id } from '../../../api.js';
import { executeStopAgent } from '../../../commands/machine/daemon-start/handlers/stop-agent.js';
import type {
  DaemonContext,
  StopAgentReason,
} from '../../../commands/machine/daemon-start/types.js';

export interface AgentRequestStopEventPayload {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  reason: string;
  deadline: number;
}

export async function onRequestStopAgent(
  ctx: DaemonContext,
  event: AgentRequestStopEventPayload
): Promise<void> {
  if (Date.now() > event.deadline) {
    console.log(
      `[daemon] ⏰ Skipping expired agent.requestStop for role=${event.role} (deadline passed)`
    );
    return;
  }
  await executeStopAgent(ctx, {
    chatroomId: event.chatroomId,
    role: event.role,
    reason: event.reason as StopAgentReason,
  });
}
