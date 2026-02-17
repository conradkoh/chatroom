/**
 * Command Loop — subscribes to Convex for pending commands, processes them sequentially.
 */

import { DAEMON_HEARTBEAT_INTERVAL_MS } from '@workspace/backend/config/reliability.js';

import { handlePing } from './handlers/ping.js';
import { handleStartAgent } from './handlers/start-agent.js';
import { handleStatus } from './handlers/status.js';
import { handleStopAgent } from './handlers/stop-agent.js';
import { discoverModels } from './init.js';
import { api } from '../../../api.js';
import { getConvexWsClient } from '../../../infrastructure/convex/client.js';
import { releaseLock } from '../pid.js';
import type {
  CommandResult,
  DaemonContext,
  MachineCommand,
  MachineCommandBase,
  RawMachineCommand,
} from './types.js';
import { formatTimestamp, parseMachineCommand } from './utils.js';

// ─── Model Refresh ──────────────────────────────────────────────────────────

/** Interval for periodic model discovery refresh (5 minutes). */
const MODEL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Re-discover models and update the backend registration.
 * Called periodically to keep the model list fresh.
 */
async function refreshModels(ctx: DaemonContext): Promise<void> {
  const models = await discoverModels();
  if (!ctx.config) return;

  try {
    await ctx.deps.backend.mutation(api.machines.register, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      hostname: ctx.config.hostname,
      os: ctx.config.os,
      availableHarnesses: ctx.config.availableHarnesses,
      harnessVersions: ctx.config.harnessVersions,
      availableModels: models,
    });
    console.log(
      `[${formatTimestamp()}] 🔄 Model refresh: ${models.length > 0 ? `${models.length} models` : 'none discovered'}`
    );
  } catch (error) {
    console.warn(`[${formatTimestamp()}] ⚠️  Model refresh failed: ${(error as Error).message}`);
  }
}

// ─── Command Dispatch ───────────────────────────────────────────────────────

/**
 * Process a single command: dispatch to the appropriate handler,
 * then ack the result back to the backend.
 */
async function processCommand(ctx: DaemonContext, command: MachineCommand): Promise<void> {
  console.log(`[${formatTimestamp()}] 📨 Command received: ${command.type}`);

  try {
    // Mark as processing
    await ctx.deps.backend.mutation(api.machines.ackCommand, {
      sessionId: ctx.sessionId,
      commandId: command._id,
      status: 'processing',
    });

    // Dispatch to the appropriate handler
    let commandResult: CommandResult;
    switch (command.type) {
      case 'ping':
        commandResult = handlePing();
        break;
      case 'status':
        commandResult = handleStatus(ctx);
        break;
      case 'start-agent':
        commandResult = await handleStartAgent(ctx, command);
        break;
      case 'stop-agent':
        commandResult = await handleStopAgent(ctx, command);
        break;
      default: {
        // Exhaustiveness check: TypeScript will error if a new command type
        // is added to MachineCommand but not handled above.
        const _exhaustive: never = command;
        commandResult = {
          result: `Unknown command type: ${(_exhaustive as MachineCommandBase & { type: string }).type}`,
          failed: true,
        };
      }
    }

    // Ack result back to backend
    const finalStatus = commandResult.failed ? 'failed' : 'completed';
    await ctx.deps.backend.mutation(api.machines.ackCommand, {
      sessionId: ctx.sessionId,
      commandId: command._id,
      status: finalStatus,
      result: commandResult.result,
    });

    if (commandResult.failed) {
      console.log(`   ❌ Command failed: ${commandResult.result}`);
    } else {
      console.log(`   ✅ Command completed`);
    }
  } catch (error) {
    console.error(`   ❌ Command failed: ${(error as Error).message}`);

    // Mark as failed
    try {
      await ctx.deps.backend.mutation(api.machines.ackCommand, {
        sessionId: ctx.sessionId,
        commandId: command._id,
        status: 'failed',
        result: (error as Error).message,
      });
    } catch {
      // Ignore ack errors
    }
  }
}

// ─── Command Loop ───────────────────────────────────────────────────────────

/**
 * Start the command processing loop: subscribe to Convex for pending commands,
 * enqueue them, and process sequentially.
 */
export async function startCommandLoop(ctx: DaemonContext): Promise<never> {
  // ── Daemon Heartbeat ──────────────────────────────────────────────────
  // Periodically update lastSeenAt so the backend can detect daemon crashes.
  // If the daemon is killed with SIGKILL, heartbeats stop and the backend
  // will mark the daemon as disconnected after DAEMON_HEARTBEAT_TTL_MS.
  let heartbeatCount = 0;
  const heartbeatTimer = setInterval(() => {
    ctx.deps.backend
      .mutation(api.machines.daemonHeartbeat, {
        sessionId: ctx.sessionId,
        machineId: ctx.machineId,
      })
      .then(() => {
        heartbeatCount++;
        console.log(`[${formatTimestamp()}] 💓 Daemon heartbeat #${heartbeatCount} OK`);
      })
      .catch((err: Error) => {
        console.warn(`[${formatTimestamp()}] ⚠️  Daemon heartbeat failed: ${err.message}`);
      });
  }, DAEMON_HEARTBEAT_INTERVAL_MS);

  // Don't let the heartbeat timer keep the process alive during shutdown
  heartbeatTimer.unref();

  const shutdown = async () => {
    console.log(`\n[${formatTimestamp()}] Shutting down...`);

    // Stop heartbeat timer
    clearInterval(heartbeatTimer);

    // ── Graceful Agent Cleanup ──────────────────────────────────────────
    // Stop all tracked agent processes so they don't become orphans.
    const agents = ctx.deps.machine.listAgentEntries(ctx.machineId);
    if (agents.length > 0) {
      console.log(`[${formatTimestamp()}] Stopping ${agents.length} agent(s)...`);

      const AGENT_SHUTDOWN_TIMEOUT_MS = 5_000;

      for (const { chatroomId, role, entry } of agents) {
        // Mark as intentional so crash recovery is skipped
        ctx.deps.stops.mark(chatroomId, role);
        try {
          // Send SIGTERM for graceful shutdown
          ctx.deps.processes.kill(entry.pid, 'SIGTERM');
          console.log(`   Sent SIGTERM to ${role} (PID ${entry.pid})`);
        } catch {
          // Process already dead — nothing to do
          console.log(`   ${role} (PID ${entry.pid}) already exited`);
        }
      }

      // Wait briefly for agents to exit, then force-kill stragglers
      await ctx.deps.clock.delay(AGENT_SHUTDOWN_TIMEOUT_MS);

      for (const { chatroomId, role, entry } of agents) {
        try {
          // Check if still alive (signal 0 = existence check)
          ctx.deps.processes.kill(entry.pid, 0);
          // Still alive after grace period — force kill
          ctx.deps.processes.kill(entry.pid, 'SIGKILL');
          console.log(`   Force-killed ${role} (PID ${entry.pid})`);
        } catch {
          // Process exited cleanly — good
        }

        // Clear PID from local state
        ctx.deps.machine.clearAgentPid(ctx.machineId, chatroomId, role);
      }

      console.log(`[${formatTimestamp()}] All agents stopped`);
    }

    try {
      // Update daemon status to disconnected
      await ctx.deps.backend.mutation(api.machines.updateDaemonStatus, {
        sessionId: ctx.sessionId,
        machineId: ctx.machineId,
        connected: false,
      });
    } catch {
      // Ignore errors during shutdown
    }

    releaseLock();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);

  // Subscribe to pending commands
  const wsClient = await getConvexWsClient();

  // In-memory queue to ensure commands aren't skipped when updates
  // arrive while processing is in progress.
  const commandQueue: MachineCommand[] = [];
  const queuedCommandIds = new Set<string>();
  let drainingQueue = false;

  const enqueueCommands = (commands: MachineCommand[]) => {
    for (const command of commands) {
      const commandId = command._id.toString();
      if (queuedCommandIds.has(commandId)) continue;
      queuedCommandIds.add(commandId);
      commandQueue.push(command);
    }
  };

  const drainQueue = async () => {
    if (drainingQueue) return;
    drainingQueue = true;
    try {
      while (commandQueue.length > 0) {
        const command = commandQueue.shift()!;
        const commandId = command._id.toString();
        queuedCommandIds.delete(commandId);
        try {
          await processCommand(ctx, command);
        } catch (error) {
          console.error(`   ❌ Command processing failed: ${(error as Error).message}`);
        }
      }
    } finally {
      drainingQueue = false;
    }
  };

  console.log(`\nListening for commands...`);
  console.log(`Press Ctrl+C to stop\n`);

  wsClient.onUpdate(
    api.machines.getPendingCommands,
    {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    },
    async (result: { commands: RawMachineCommand[] }) => {
      if (!result.commands || result.commands.length === 0) return;

      // Parse raw commands into type-safe discriminated unions.
      // Invalid commands (missing required fields) are acked as failed
      // to prevent them from accumulating as stale pending commands.
      const parsed: MachineCommand[] = [];
      for (const raw of result.commands) {
        const command = parseMachineCommand(raw);
        if (command !== null) {
          parsed.push(command);
        } else {
          // Ack invalid commands as failed so they don't stay pending forever
          try {
            await ctx.deps.backend.mutation(api.machines.ackCommand, {
              sessionId: ctx.sessionId,
              commandId: raw._id,
              status: 'failed',
              result: `Invalid command: type="${raw.type}" missing required payload fields`,
            });
            console.warn(
              `[${formatTimestamp()}] ⚠️  Acked invalid command ${raw._id} (type=${raw.type}) as failed`
            );
          } catch {
            // Ignore ack errors — will be retried on next poll
          }
        }
      }

      enqueueCommands(parsed);
      await drainQueue();
    }
  );

  // Periodic model discovery refresh — keeps the model list current
  // in case new providers are configured while the daemon is running
  const modelRefreshTimer = setInterval(() => {
    refreshModels(ctx).catch((err) => {
      console.warn(`[${formatTimestamp()}] ⚠️  Model refresh error: ${(err as Error).message}`);
    });
  }, MODEL_REFRESH_INTERVAL_MS);

  // Unref the timer so it doesn't prevent process exit during shutdown
  modelRefreshTimer.unref();

  // Keep process alive
  return await new Promise(() => {});
}
