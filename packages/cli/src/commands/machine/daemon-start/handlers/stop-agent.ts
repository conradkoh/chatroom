/**
 * Stop Agent Command Handler — stops a running agent process.
 */

import { api } from '../../../../api.js';
import type { AgentHandle } from '../../../../infrastructure/agent-drivers/types.js';
import type { CommandResult, DaemonContext, StopAgentCommand } from '../types.js';
import { clearAgentPidEverywhere } from './shared.js';

/**
 * Handle a stop-agent command — stops a running agent process.
 */
export async function handleStopAgent(
  ctx: DaemonContext,
  command: StopAgentCommand
): Promise<CommandResult> {
  const { chatroomId, role } = command.payload;
  console.log(`   ↪ stop-agent command received`);
  console.log(`      Chatroom: ${chatroomId}`);
  console.log(`      Role: ${role}`);

  // Query the backend for the current PID (single source of truth)
  const configsResult: {
    configs: {
      machineId: string;
      role: string;
      spawnedAgentPid?: number;
      agentType?: string;
    }[];
  } = await ctx.deps.backend.query(api.machines.getAgentConfigs, {
    sessionId: ctx.sessionId,
    chatroomId,
  });

  const targetConfig = configsResult.configs.find(
    (c) => c.machineId === ctx.machineId && c.role.toLowerCase() === role.toLowerCase()
  );

  if (!targetConfig?.spawnedAgentPid) {
    const msg = 'No running agent found (no PID recorded)';
    console.log(`   ⚠️  ${msg}`);
    return { result: msg, failed: true };
  }

  const pidToKill = targetConfig.spawnedAgentPid;
  const agentHarness = (targetConfig.agentType as 'opencode') || undefined;
  console.log(`   Stopping agent with PID: ${pidToKill}`);

  // Build an AgentHandle from the stored PID and harness type
  const stopHandle: AgentHandle = {
    harness: agentHarness || 'opencode',
    type: 'process',
    pid: pidToKill,
    workingDir: '',
  };

  // Resolve the driver for this harness (for isAlive/stop)
  let stopDriver;
  try {
    stopDriver = agentHarness ? ctx.deps.drivers.get(agentHarness) : null;
  } catch {
    stopDriver = null;
  }

  // Verify the PID is still alive via the driver (or fallback to verifyPidOwnership)
  const isAlive = stopDriver
    ? await stopDriver.isAlive(stopHandle)
    : ctx.deps.processes.verifyPidOwnership(pidToKill, agentHarness);

  if (!isAlive) {
    console.log(`   ⚠️  PID ${pidToKill} does not appear to belong to the expected agent`);
    await clearAgentPidEverywhere(ctx, chatroomId, role);
    console.log(`   Cleared stale PID`);

    // Remove the participant so the UI no longer shows "Ready"
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

    return {
      result: `PID ${pidToKill} appears stale (process not found or belongs to different program)`,
      failed: true,
    };
  }

  try {
    // Mark this stop as intentional so the onExit handler skips crash recovery
    ctx.deps.stops.mark(chatroomId, role);

    // Use the driver to stop the agent (sends SIGTERM for process-based drivers)
    if (stopDriver) {
      await stopDriver.stop(stopHandle);
    } else {
      // Fallback: direct SIGTERM if no driver available
      ctx.deps.processes.kill(pidToKill, 'SIGTERM');
    }

    const msg = `Agent stopped (PID: ${pidToKill})`;
    console.log(`   ✅ ${msg}`);
    await clearAgentPidEverywhere(ctx, chatroomId, role);
    console.log(`   Cleared PID`);

    // Remove the participant so the UI no longer shows "Ready"
    try {
      await ctx.deps.backend.mutation(api.participants.leave, {
        sessionId: ctx.sessionId,
        chatroomId,
        role,
      });
      console.log(`   Removed participant record`);
    } catch (leaveErr) {
      // Non-critical: participant will eventually expire via readyUntil
      console.log(`   ⚠️  Could not remove participant: ${(leaveErr as Error).message}`);
    }

    return { result: msg, failed: false };
  } catch (e) {
    // Clean up intentional stop marker on failure — the onExit handler
    // may not fire (ESRCH) or the stop failed for another reason
    ctx.deps.stops.clear(chatroomId, role);

    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ESRCH') {
      await clearAgentPidEverywhere(ctx, chatroomId, role);
      // Remove the participant so the UI no longer shows "Ready"
      try {
        await ctx.deps.backend.mutation(api.participants.leave, {
          sessionId: ctx.sessionId,
          chatroomId,
          role,
        });
      } catch {
        // Non-critical
      }
      const msg = 'Process not found (may have already exited)';
      console.log(`   ⚠️  ${msg}`);
      return { result: msg, failed: true };
    }
    const msg = `Failed to stop agent: ${err.message}`;
    console.log(`   ⚠️  ${msg}`);
    return { result: msg, failed: true };
  }
}
