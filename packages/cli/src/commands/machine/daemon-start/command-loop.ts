/**
 * Command Loop — subscribes to Convex for pending commands, processes them sequentially.
 */

import { DAEMON_HEARTBEAT_INTERVAL_MS } from '@workspace/backend/config/reliability.js';

import { api } from '../../../api.js';
import type { Id } from '../../../api.js';
import { getConvexWsClient } from '../../../infrastructure/convex/client.js';
import { onDaemonShutdown } from '../../../events/lifecycle/on-daemon-shutdown.js';
import {
  onRequestStartAgent,
  type AgentRequestStartEventPayload,
} from '../../../events/daemon/agent/on-request-start-agent.js';
import {
  onRequestStopAgent,
  type AgentRequestStopEventPayload,
} from '../../../events/daemon/agent/on-request-stop-agent.js';
import { releaseLock } from '../pid.js';
import { handlePing } from './handlers/ping.js';
import { handleStartAgent } from './handlers/start-agent.js';
import { handleStatus } from './handlers/status.js';
import { handleStopAgent } from './handlers/stop-agent.js';
import type {
  CommandResult,
  DaemonContext,
  MachineCommand,
  MachineCommandBase,
} from './types.js';
import { formatTimestamp } from './utils.js';

// ─── Model Refresh ──────────────────────────────────────────────────────────

/** Interval for periodic model discovery refresh (5 minutes). */
const MODEL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Re-discover models and update the backend registration.
 * Called periodically to keep the model list fresh.
 */
export async function refreshModels(ctx: DaemonContext): Promise<void> {
  // Collect models from all installed services, keyed by harness.
  // Only query services that are actually installed — mirrors discoverModels() in init.ts.
  // Uninstalled services are excluded entirely so they don't overwrite a previously
  // discovered model list with an empty entry.
  const models: Record<string, string[]> = {};
  for (const [harness, service] of ctx.agentServices) {
    if (!service.isInstalled()) continue;
    try {
      models[harness] = await service.listModels();
    } catch {
      // Non-critical — skip failed service
    }
  }
  if (!ctx.config) return;
  const totalCount = Object.values(models).flat().length;

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
      `[${formatTimestamp()}] 🔄 Model refresh: ${totalCount > 0 ? `${totalCount} models` : 'none discovered'}`
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
export async function processCommand(ctx: DaemonContext, command: MachineCommand): Promise<void> {
  console.log(`[${formatTimestamp()}] 📨 Command received: ${command.type}`);

  try {
    // Mark as processing
    await ctx.deps.backend.mutation(api.machines.ackCommand, {
      sessionId: ctx.sessionId,
      commandId: command._id,
      status: 'processing',
    });

    ctx.events.emit('command:processing', {
      commandId: command._id.toString(),
      type: command.type,
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

    ctx.events.emit('command:completed', {
      commandId: command._id.toString(),
      type: command.type,
      failed: commandResult.failed,
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

    // Stop heartbeat timers
    clearInterval(heartbeatTimer);

    await onDaemonShutdown(ctx);

    releaseLock();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);

  // Open WebSocket connection for event stream subscription
  const wsClient = await getConvexWsClient();

  console.log(`\nListening for commands...`);
  console.log(`Press Ctrl+C to stop\n`);

  // ── Stream command subscription ──────────────────────────────────────────
  // Subscribes to chatroom_eventStream for command events directed at this machine.
  // Uses executeStartAgent/executeStopAgent directly — no synthetic _id needed.

  // Initialize the stream cursor.
  // Priority 1: persisted cursor from previous daemon run (survives restarts).
  // Priority 2: query latest event ID (skip history, only process new events).
  let lastSeenEventId: Id<'chatroom_eventStream'> | undefined = undefined;

  const persistedCursor = ctx.deps.machine.loadEventCursor(ctx.machineId);
  if (persistedCursor !== null) {
    // Resume from where the previous daemon run left off
    lastSeenEventId = persistedCursor as Id<'chatroom_eventStream'>;
    console.log(`[${formatTimestamp()}] 📌 Resumed event stream cursor from persisted state`);
  } else {
    // No persisted cursor — initialize to latest event to avoid replaying history
    try {
      const initialEvents = await ctx.deps.backend.query(api.machines.getCommandEvents, {
        sessionId: ctx.sessionId,
        machineId: ctx.machineId,
        afterId: undefined,
      });
      if (initialEvents.events.length > 0) {
        lastSeenEventId = initialEvents.events[initialEvents.events.length - 1]._id;
      }
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Failed to initialize stream cursor: ${(err as Error).message}`
      );
    }
  }

  // Track processed event IDs to prevent duplicate processing within the same session
  const processedStreamEventIds = new Set<string>();

  wsClient.onUpdate(
    api.machines.getCommandEvents,
    {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      afterId: lastSeenEventId,
    },
    async (result: { events: Array<{ _id: string; type: string; [key: string]: unknown }> }) => {
      if (!result.events || result.events.length === 0) return;

      for (const event of result.events) {
        const eventId = event._id.toString();

        // Idempotency: skip events already processed in this session
        if (processedStreamEventIds.has(eventId)) continue;
        processedStreamEventIds.add(eventId);

        // Advance cursor
        lastSeenEventId = event._id as Id<'chatroom_eventStream'>;

        try {
          console.log(`[${formatTimestamp()}] 📡 Stream command event: ${event.type}`);

          if (event.type === 'agent.requestStart') {
            await onRequestStartAgent(ctx, event as unknown as AgentRequestStartEventPayload);
          } else if (event.type === 'agent.requestStop') {
            await onRequestStopAgent(ctx, event as unknown as AgentRequestStopEventPayload);
          } else if (event.type === 'daemon.ping') {
            // Respond to ping with a pong via mutation
            handlePing();
            await ctx.deps.backend.mutation(api.machines.ackPing, {
              sessionId: ctx.sessionId,
              machineId: ctx.machineId,
              pingEventId: event._id as Id<'chatroom_eventStream'>,
            });
          }
        } catch (err) {
          console.error(
            `[${formatTimestamp()}] ❌ Stream command event failed: ${(err as Error).message}`
          );
        }
      }

      // Persist the cursor after processing each batch (best-effort)
      if (lastSeenEventId !== undefined) {
        ctx.deps.machine.persistEventCursor(ctx.machineId, lastSeenEventId.toString());
      }
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
