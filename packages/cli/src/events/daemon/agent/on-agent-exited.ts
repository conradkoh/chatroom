import type { Id } from '../../../api.js';
import type { DaemonContext } from '../../../commands/machine/daemon-start/types.js';
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

/**
 * Handles the `agent:exited` DaemonEvent.
 *
 * Thin passthrough to AgentProcessManager.handleExit().
 * The manager handles all cleanup, backend events, and restart decisions.
 *
 * For agents spawned by the manager (via ensureRunning), the exit is also
 * handled internally via the onExit callback. The manager's handleExit is
 * idempotent — it checks PID match and ignores stale exits.
 */
export function onAgentExited(ctx: DaemonContext, payload: AgentExitedPayload): void {
  ctx.deps.agentProcessManager.handleExit({
    chatroomId: payload.chatroomId,
    role: payload.role,
    pid: payload.pid,
    code: payload.code,
    signal: payload.signal,
  });
}
