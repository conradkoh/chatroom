/**
 * Stop Agent Command Handler — stops a running agent process.
 *
 * Delegates to onAgentShutdown for the actual kill + cleanup sequence,
 * ensuring consistent process-group kills and state cleanup.
 *
 * PIDs are collected from two sources before stopping:
 *   1. Backend (authoritative DB record via getMachineAgentConfigs)
 *   2. Local daemon state (may diverge if updateSpawnedAgent mutation failed)
 * All unique live PIDs are killed to prevent ghost processes.
 */

import { api } from '../../../../api.js';
import type { Id } from '../../../../api.js';
import { onAgentShutdown } from '../../../../events/lifecycle/on-agent-shutdown.js';
import type { StopReason } from '../../../../infrastructure/machine/stop-reason.js';
import type { CommandResult, DaemonContext, StopAgentCommand, StopAgentReason } from '../types.js';
import { clearAgentPidEverywhere } from './shared.js';

/**
 * Execute the stop-agent logic for a given set of explicit args.
 *
 * This is the canonical implementation — `handleStopAgent` is a thin wrapper
 * that maps a command envelope to these args. Stream-based callers can invoke
 * this directly without constructing a full command object.
 */
export async function executeStopAgent(
  ctx: DaemonContext,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    reason: StopAgentReason;
  }
): Promise<CommandResult> {
  const { chatroomId, role, reason } = args;
  const stopReason: StopReason = reason as StopReason;
  console.log(`   ↪ stop-agent command received`);
  console.log(`      Chatroom: ${chatroomId}`);
  console.log(`      Role: ${role}`);
  console.log(`      Reason: ${reason}`);

  // Query the backend for the current PID (source 1: authoritative DB record)
  const configsResult: {
    configs: {
      machineId: string;
      role: string;
      spawnedAgentPid?: number;
      agentType?: string;
    }[];
  } = await ctx.deps.backend.query(api.machines.getMachineAgentConfigs, {
    sessionId: ctx.sessionId,
    chatroomId,
  });

  const targetConfig = configsResult.configs.find(
    (c) => c.machineId === ctx.machineId && c.role.toLowerCase() === role.toLowerCase()
  );
  const backendPid = targetConfig?.spawnedAgentPid;

  // Source 2: local daemon state — may differ from backend if updateSpawnedAgent failed
  const localEntry = ctx.deps.machine
    .listAgentEntries(ctx.machineId)
    .find((e) => e.chatroomId === chatroomId && e.role.toLowerCase() === role.toLowerCase());
  const localPid = localEntry?.entry.pid;

  // Collect all unique PIDs from both sources
  const allPids = [...new Set([backendPid, localPid].filter((p): p is number => p !== undefined))];

  if (allPids.length === 0) {
    // Idempotent: no process found, but still ensure backend state is clean.
    // Clear any stale PID/spawnedAt in chatroom_teamAgentConfigs and mark participant as exited.
    const msg = 'No running agent found (no PID recorded) — ensuring clean state';
    console.log(`   ⚠️  ${msg}`);
    await clearAgentPidEverywhere(ctx, chatroomId, role);
    try {
      await ctx.deps.backend.mutation(api.participants.leave, {
        sessionId: ctx.sessionId,
        chatroomId,
        role,
      });
      console.log(`   Removed participant record`);
    } catch {
      // Non-critical — participant may already be absent
    }
    return { result: msg, failed: false };
  }

  // Any service can check a PID (it's an OS-level check via kill(pid, 0))
  const anyService = ctx.agentServices.values().next().value;

  let anyKilled = false;
  let lastError: Error | null = null;

  for (const pid of allPids) {
    console.log(`   Stopping agent with PID: ${pid}`);
    const isAlive = anyService ? anyService.isAlive(pid) : false;

    if (!isAlive) {
      console.log(`   ⚠️  PID ${pid} not found — process already exited or was never started`);
      await clearAgentPidEverywhere(ctx, chatroomId, role);
      console.log(`   Cleared stale PID`);

      try {
        await ctx.deps.backend.mutation(api.participants.leave, {
          sessionId: ctx.sessionId,
          chatroomId,
          role,
        });
        console.log(`   Removed participant record`);
      } catch {
        // Non-critical
      }
      continue;
    }

    // Delegate to onAgentShutdown for kill + cleanup (process group kill, state cleanup)
    try {
      const shutdownResult = await onAgentShutdown(ctx, {
        chatroomId,
        role,
        pid,
        stopReason,
      });

      const msg = shutdownResult.killed
        ? `Agent stopped (PID: ${pid})`
        : `Agent stop attempted (PID: ${pid}) — process may still be running`;

      console.log(`   ${shutdownResult.killed ? '✅' : '⚠️ '} ${msg}`);
      if (shutdownResult.killed) {
        anyKilled = true;
      }
    } catch (e) {
      lastError = e as Error;
      console.log(`   ⚠️  Failed to stop agent (PID: ${pid}): ${(e as Error).message}`);
    }
  }

  if (lastError && !anyKilled) {
    const msg = `Failed to stop agent: ${lastError.message}`;
    console.log(`   ⚠️  ${msg}`);
    return { result: msg, failed: true };
  }

  if (!anyKilled) {
    // All PIDs were stale — processes already exited. State was cleaned up in the loop above.
    // This is a success from the user's perspective: the agent is stopped.
    return {
      result: `Agent stopped (all recorded PIDs were stale — processes already exited)`,
      failed: false,
    };
  }

  const killedCount = allPids.length > 1 ? ` (${allPids.length} PIDs)` : ``;
  return { result: `Agent stopped${killedCount}`, failed: false };
}

/**
 * Handle a stop-agent command — thin wrapper around executeStopAgent.
 */
export async function handleStopAgent(
  ctx: DaemonContext,
  command: StopAgentCommand
): Promise<CommandResult> {
  return executeStopAgent(ctx, {
    chatroomId: command.payload.chatroomId,
    role: command.payload.role,
    reason: command.reason,
  });
}
