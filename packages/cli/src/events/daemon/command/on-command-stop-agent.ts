/**
 * Handles a command.stopAgent event from chatroom_eventStream.
 * Calls executeStopAgent directly — no synthetic command ID needed.
 */

import type { Id } from '../../../api.js';
import type {
  DaemonContext,
  StopAgentReason,
} from '../../../commands/machine/daemon-start/types.js';
import { executeStopAgent } from '../../../commands/machine/daemon-start/handlers/stop-agent.js';

export interface CommandStopAgentEventPayload {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  reason: string;
}

export async function onCommandStopAgent(
  ctx: DaemonContext,
  event: CommandStopAgentEventPayload
): Promise<void> {
  await executeStopAgent(ctx, {
    chatroomId: event.chatroomId,
    role: event.role,
    reason: event.reason as StopAgentReason,
  });
}
