/**
 * Handles an agent.requestAbort event from chatroom_eventStream.
 * Calls driver.stop() for the agent session/process.
 */

import type { Id } from '../../../api.js';
import { executeStopAgent } from '../../../commands/machine/daemon-start/handlers/stop-agent.js';
import type {
  DaemonContext,
  StopAgentReason,
} from '../../../commands/machine/daemon-start/types.js';

export interface AgentRequestAbortEventPayload {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  timestamp: number;
}

export async function onRequestAbortAgent(
  ctx: DaemonContext,
  event: AgentRequestAbortEventPayload
): Promise<void> {
  // Abort is equivalent to stop with 'user.abort' reason
  await executeStopAgent(ctx, {
    chatroomId: event.chatroomId,
    role: event.role,
    reason: 'user.abort' as StopAgentReason,
  });
}
