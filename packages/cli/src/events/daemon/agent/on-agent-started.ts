import type { Id } from '../../../api.js';
import type { DaemonContext } from '../../../commands/machine/daemon-start/types.js';
import { formatTimestamp } from '../../../commands/machine/daemon-start/utils.js';

export interface AgentStartedPayload {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  pid: number;
  harness: string;
  model?: string;
}

/**
 * Handles the `agent:started` DaemonEvent.
 *
 * Logs a startup message when an agent process is successfully spawned.
 */
export function onAgentStarted(ctx: DaemonContext, payload: AgentStartedPayload): void {
  const ts = formatTimestamp();
  console.log(
    `[${ts}] 🟢 Agent started: ${payload.role} (PID: ${payload.pid}, harness: ${payload.harness})`
  );
}
