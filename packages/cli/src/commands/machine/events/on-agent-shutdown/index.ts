import { api, type Id } from '../../../../api.js';
import type { DaemonContext } from '../../daemon-start/types.js';

export interface OnAgentShutdownOptions {
  chatroomId: string;
  role: string;
  pid: number;
  /** If true, skip the kill step (process already dead) */
  skipKill?: boolean;
}

export interface OnAgentShutdownResult {
  killed: boolean;
  cleaned: boolean;
}

/**
 * Handle a single agent's shutdown: kill process, clear all state.
 * All cleanup steps are best-effort — errors are logged, never thrown.
 */
export async function onAgentShutdown(
  ctx: DaemonContext,
  options: OnAgentShutdownOptions
): Promise<OnAgentShutdownResult> {
  const { chatroomId, role, pid, skipKill } = options;

  // Step 1: Kill the process with verified shutdown
  let killed = false;
  if (!skipKill) {
    // 1a. Send SIGTERM to entire process group (negative PID)
    try {
      ctx.deps.processes.kill(-pid, 'SIGTERM');
    } catch {
      killed = true; // ESRCH — process already dead
    }

    if (!killed) {
      // 1b. Wait up to 10s for graceful exit (check parent via positive PID)
      const SIGTERM_TIMEOUT_MS = 10_000;
      const POLL_INTERVAL_MS = 500;
      const deadline = Date.now() + SIGTERM_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await ctx.deps.clock.delay(POLL_INTERVAL_MS);
        try {
          ctx.deps.processes.kill(pid, 0);
        } catch {
          killed = true;
          break;
        }
      }
    }

    // 1c. If still alive after SIGTERM timeout, SIGKILL entire process group
    if (!killed) {
      try {
        ctx.deps.processes.kill(-pid, 'SIGKILL');
      } catch {
        killed = true; // Already dead between check and kill
      }
    }

    // 1d. Final check — wait 5s and log if still alive (check parent via positive PID)
    if (!killed) {
      await ctx.deps.clock.delay(5_000);
      try {
        ctx.deps.processes.kill(pid, 0);
        console.log(`   ⚠️  Process ${pid} (${role}) still alive after SIGKILL — possible zombie`);
      } catch {
        killed = true;
      }
    }
  }

  // Step 2: Mark as intentional stop (so onExit callback skips cleanup)
  ctx.deps.stops.mark(chatroomId, role);

  // Step 3: Clear local PID state
  ctx.deps.machine.clearAgentPid(ctx.machineId, chatroomId, role);

  // Step 4: Clear backend spawnedAgent
  let spawnedAgentCleared = false;
  try {
    await ctx.deps.backend.mutation(api.machines.updateSpawnedAgent, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      pid: undefined,
    });
    spawnedAgentCleared = true;
  } catch (e) {
    console.log(`   ⚠️  Failed to clear spawnedAgent for ${role}: ${(e as Error).message}`);
  }

  // Step 5: Remove participant record
  let participantRemoved = false;
  try {
    await ctx.deps.backend.mutation(api.participants.leave, {
      sessionId: ctx.sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
    });
    participantRemoved = true;
  } catch (e) {
    console.log(`   ⚠️  Failed to remove participant for ${role}: ${(e as Error).message}`);
  }

  // Step 6: Dual-write lifecycle table → offline (Phase 4)
  try {
    await ctx.deps.backend.mutation(api.machineAgentLifecycle.transition, {
      sessionId: ctx.sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      targetState: 'offline',
    });
  } catch (e) {
    console.log(`   ⚠️  Lifecycle transition (offline) failed for ${role}: ${(e as Error).message}`);
  }

  return { killed, cleaned: spawnedAgentCleared && participantRemoved };
}
