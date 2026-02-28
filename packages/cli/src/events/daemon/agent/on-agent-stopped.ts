import type { Id } from '../../../api.js';
import type { DaemonContext } from '../../../commands/machine/daemon-start/types.js';
import { formatTimestamp } from '../../../commands/machine/daemon-start/utils.js';

export interface AgentStoppedPayload {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  pid: number;
}

/**
 * Handles the `agent:stopped` DaemonEvent.
 *
 * Logs a shutdown message when a stop-agent command successfully kills the process.
 */
export function onAgentStopped(ctx: DaemonContext, payload: AgentStoppedPayload): void {
  const ts = formatTimestamp();
  console.log(`[${ts}] 🔴 Agent stopped: ${payload.role} (PID: ${payload.pid})`);
}
