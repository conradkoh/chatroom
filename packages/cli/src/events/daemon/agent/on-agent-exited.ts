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
  agentHarness?: string;
  model?: string;
  workingDir?: string;
}

/**
 * Handles the `agent:exited` DaemonEvent.
 *
 * Simplified restart model:
 *   - On ANY exit, restart immediately — unless it was an intentional user stop.
 *   - Crash loop protection is handled by SpawnGateService.
 *   - On a clean user stop, clear the crash loop history so a fresh user-initiated
 *     start gets a clean slate.
 *
 * Cleanup always happens regardless of whether a restart is triggered:
 *   1. Report exit to backend via recordAgentExited (clears PID, removes participant)
 *   2. Clear PID from local machine state
 *   3. Untrack PID in all remote agent services
 */
export function onAgentExited(ctx: DaemonContext, payload: AgentExitedPayload): void {
  const { chatroomId, role, pid, code, signal, stopReason } = payload;
  const ts = formatTimestamp();

  console.log(`[${ts}] Agent stopped: ${stopReason} (${role})`);

  // ── Step 1: Determine intent ─────────────────────────────────────────────

  // Intentional user-requested or platform-initiated stops do NOT trigger restart.
  const isIntentionalStop = stopReason === 'user.stop' || stopReason === 'platform.team_switch';

  const isDaemonRespawn = stopReason === 'daemon.respawn';

  if (isDaemonRespawn) {
    console.log(
      `[${ts}] 🔄  Agent process stopped for respawn ` +
        `(PID: ${pid}, role: ${role}, code: ${code}, signal: ${signal})`
    );
  } else if (isIntentionalStop) {
    console.log(
      `[${ts}] ℹ️  Agent process exited after intentional stop ` +
        `(PID: ${pid}, role: ${role}, code: ${code}, signal: ${signal})`
    );
    // Clear crash loop history so a fresh user-initiated start gets a clean slate.
    ctx.deps.spawnGate.clearCrashLoop(chatroomId, role);
  } else {
    console.log(
      `[${ts}] ⚠️  Agent process exited ` +
        `(PID: ${pid}, role: ${role}, code: ${code}, signal: ${signal})`
    );
  }

  // ── Step 2: Cleanup (always) ─────────────────────────────────────────────

  // Report exit to backend — clears PID, removes participant, records event.
  ctx.deps.backend
    .mutation(api.machines.recordAgentExited, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      pid,
      stopReason,
      stopSignal: stopReason === 'agent_process.signal' ? (signal ?? undefined) : undefined,
      exitCode: code ?? undefined,
      signal: signal ?? undefined,
      agentHarness: payload.agentHarness,
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

  // ── Step 3: Restart decision ─────────────────────────────────────────────

  // No restart on intentional stops or daemon respawns (respawn caller handles re-spawn).
  if (isIntentionalStop || isDaemonRespawn) {
    return;
  }

  // We need harness + workingDir + model to restart. If missing, we cannot restart.
  const { agentHarness, workingDir, model } = payload;
  if (!agentHarness || !workingDir) {
    console.log(
      `[${ts}] ⚠️  Cannot restart agent — missing harness or workingDir ` +
        `(role: ${role}, harness: ${agentHarness ?? 'none'}, workingDir: ${workingDir ?? 'none'})`
    );
    return;
  }

  // ── Step 4: Restart via SpawnGateService ─────────────────────────────────

  console.log(`[${ts}] 🔁  Attempting restart (${role})`);

  ctx.deps.spawnGate
    .requestSpawn(ctx, {
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      agentHarness: agentHarness as 'opencode' | 'pi' | 'cursor',
      model,
      workingDir,
      reason: 'platform.crash_recovery',
    })
    .then((result) => {
      if (!result.spawned) {
        console.log(`[${ts}] ⚠️  Spawn rejected: ${result.reason}`);
      }
    })
    .catch((err: Error) => {
      const errMsg = err.message;
      console.log(`   ⚠️  Failed to restart agent: ${errMsg}`);

      // Emit start-failed event so users can observe the failure.
      ctx.deps.backend
        .mutation(api.machines.emitAgentStartFailed, {
          sessionId: ctx.sessionId,
          machineId: ctx.machineId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          error: errMsg,
        })
        .catch((emitErr: Error) => {
          console.log(`   ⚠️  Failed to emit startFailed event: ${emitErr.message}`);
        });
    });
}
