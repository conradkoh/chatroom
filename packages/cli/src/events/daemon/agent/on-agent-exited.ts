import type { Id } from '../../../api.js';
import { api } from '../../../api.js';
import type { DaemonContext } from '../../../commands/machine/daemon-start/types.js';
import { formatTimestamp } from '../../../commands/machine/daemon-start/utils.js';
import type { StopReason } from '../../../infrastructure/machine/stop-reason.js';

export interface AgentExitedPayload {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  pid: number;
  code: number | null;
  signal: string | null;
  stopReason: StopReason;
  intentional: boolean;
}

/**
 * Handles the `agent:exited` DaemonEvent.
 *
 * When an agent process exits (crash or intentional), cleans up all state:
 * 1. Report to backend via recordAgentExited (clears PID, removes participant, triggers crash recovery)
 * 2. Clear PID from local machine state
 * 3. Untrack PID in all remote agent services
 */
export function onAgentExited(ctx: DaemonContext, payload: AgentExitedPayload): void {
  const { chatroomId, role, pid, code, signal, stopReason, intentional } = payload;
  const ts = formatTimestamp();

  console.log(`[${ts}] Agent stopped: ${stopReason} (${role})`);

  if (intentional) {
    console.log(
      `[${ts}] ℹ️  Agent process exited after intentional stop ` +
        `(PID: ${pid}, role: ${role}, code: ${code}, signal: ${signal})`
    );
  } else {
    // DESIGN DECISION: intentional=false covers both crashes AND natural completions.
    // A process that exits cleanly (code 0) without a prior stops.mark() call is
    // treated identically to a crash — ensureAgentHandler fires immediately to restart.
    // Known trade-off: if an agent finishes work and exits before its handoff mutation
    // is processed, a restart may be triggered unnecessarily. This is accepted because
    // reliability (never leaving a task stuck) is prioritized over efficiency.
    console.log(
      `[${ts}] ⚠️  Agent process exited ` +
        `(PID: ${pid}, role: ${role}, code: ${code}, signal: ${signal})`
    );
  }

  // Record agent exit event and clear state atomically via recordAgentExited
  ctx.deps.backend
    .mutation(api.machines.recordAgentExited, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      pid,
      intentional,
      stopReason,
      stopSignal: stopReason === 'process_terminated_with_signal' ? (signal ?? undefined) : undefined,
      exitCode: code ?? undefined,
      signal: signal ?? undefined,
    })
    .catch((err: Error) => {
      console.log(`   ⚠️  Failed to record agent exit event: ${err.message}`);
    });

  // Clear PID from local state
  ctx.deps.machine.clearAgentPid(ctx.machineId, chatroomId, role);

  // Stop tracking in all remote agent services (pid tracking is per-service)
  for (const service of ctx.agentServices.values()) {
    service.untrack(pid);
  }
}
