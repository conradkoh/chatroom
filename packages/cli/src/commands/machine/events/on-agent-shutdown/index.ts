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

  // Step 1: Kill the process
  let killed = false;
  if (!skipKill) {
    try {
      ctx.deps.processes.kill(pid, 'SIGTERM');
      killed = true;
    } catch {
      // ESRCH — process already dead
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

  return { killed, cleaned: spawnedAgentCleared && participantRemoved };
}
