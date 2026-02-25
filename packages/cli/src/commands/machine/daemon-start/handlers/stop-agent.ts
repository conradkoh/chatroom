/**
 * Stop Agent Command Handler — stops a running agent process.
 *
 * Delegates to onAgentShutdown for the actual kill + cleanup sequence,
 * ensuring consistent process-group kills and state cleanup.
 */

import { api } from '../../../../api.js';
import { onAgentShutdown } from '../../events/on-agent-shutdown/index.js';
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
  console.log(`   Stopping agent with PID: ${pidToKill}`);

  // Verify the PID is still alive before attempting shutdown.
  // Any service can check a PID (it's an OS-level check via kill(pid, 0)).
  const anyService = ctx.agentServices.values().next().value;
  const isAlive = anyService ? anyService.isAlive(pidToKill) : false;

  if (!isAlive) {
    console.log(`   ⚠️  PID ${pidToKill} does not appear to belong to the expected agent`);
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

    return {
      result: `PID ${pidToKill} appears stale (process not found or belongs to different program)`,
      failed: true,
    };
  }

  // Delegate to onAgentShutdown for kill + cleanup (process group kill, state cleanup)
  try {
    const shutdownResult = await onAgentShutdown(ctx, {
      chatroomId,
      role,
      pid: pidToKill,
    });

    const msg = shutdownResult.killed
      ? `Agent stopped (PID: ${pidToKill})`
      : `Agent stop attempted (PID: ${pidToKill}) — process may still be running`;

    console.log(`   ${shutdownResult.killed ? '✅' : '⚠️ '} ${msg}`);
    return { result: msg, failed: !shutdownResult.killed };
  } catch (e) {
    const msg = `Failed to stop agent: ${(e as Error).message}`;
    console.log(`   ⚠️  ${msg}`);
    return { result: msg, failed: true };
  }
}
