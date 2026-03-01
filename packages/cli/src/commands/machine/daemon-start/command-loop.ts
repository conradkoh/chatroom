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
import type { DaemonContext } from './types.js';
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
  //
  // Cursor semantics (after Phase D / deadline-filter fix):
  // - `lastSeenPingEventId` tracks only daemon.ping events. The `afterId` arg passed
  //   to getCommandEvents only filters ping events — start/stop use deadline-based
  //   filtering on the backend, so they don't need a cursor.
  // - `processedCommandIds` — session-scoped dedup set for agent.requestStart /
  //   agent.requestStop events. Prevents double-processing if the reactive query
  //   re-fires in the same session (deadline filter may return the same event multiple times).
  // - `processedPingIds` — session-scoped dedup set for daemon.ping events.

  // Initialize the ping cursor from persisted state or leave undefined (skip history).
  // Priority 1: persisted cursor from previous daemon run (survives restarts).
  // Priority 2: query latest event ID to initialize the cursor and avoid replaying old pings.
  let lastSeenPingEventId: Id<'chatroom_eventStream'> | undefined = undefined;

  const persistedCursor = ctx.deps.machine.loadEventCursor(ctx.machineId);
  if (persistedCursor !== null) {
    // Resume from where the previous daemon run left off (ping cursor only)
    lastSeenPingEventId = persistedCursor as Id<'chatroom_eventStream'>;
    console.log(`[${formatTimestamp()}] 📌 Resumed ping cursor from persisted state`);
  } else {
    // No persisted cursor — initialize to latest event ID to skip old pings
    try {
      const initialEvents = await ctx.deps.backend.query(api.machines.getCommandEvents, {
        sessionId: ctx.sessionId,
        machineId: ctx.machineId,
        afterId: undefined,
      });
      // Use the last event as the initial ping cursor (start/stop events don't use the cursor)
      const pings = initialEvents.events.filter((e: { type: string }) => e.type === 'daemon.ping');
      if (pings.length > 0) {
        lastSeenPingEventId = pings[pings.length - 1]._id;
      }
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Failed to initialize ping cursor: ${(err as Error).message}`
      );
    }
  }

  // Session-scoped dedup sets — prevent double-processing within a single daemon run.
  // start/stop events: deadline-filtered by backend, but reactive query may re-fire →
  //   use processedCommandIds to ensure each event is only acted on once per session.
  // ping events: cursor-filtered by backend, but guard here too for safety.
  const processedCommandIds = new Set<string>(); // agent.requestStart / agent.requestStop
  const processedPingIds = new Set<string>(); // daemon.ping

  wsClient.onUpdate(
    api.machines.getCommandEvents,
    {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      afterId: lastSeenPingEventId, // Only used by the backend for ping filtering
    },
    async (result: { events: Array<{ _id: string; type: string; [key: string]: unknown }> }) => {
      if (!result.events || result.events.length === 0) return;

      let pingCursorAdvanced = false;

      for (const event of result.events) {
        const eventId = event._id.toString();

        try {
          console.log(`[${formatTimestamp()}] 📡 Stream command event: ${event.type}`);

          if (event.type === 'agent.requestStart') {
            // Deadline-filtered — use processedCommandIds for session dedup
            if (processedCommandIds.has(eventId)) continue;
            processedCommandIds.add(eventId);
            await onRequestStartAgent(ctx, event as unknown as AgentRequestStartEventPayload);
          } else if (event.type === 'agent.requestStop') {
            // Deadline-filtered — use processedCommandIds for session dedup
            if (processedCommandIds.has(eventId)) continue;
            processedCommandIds.add(eventId);
            await onRequestStopAgent(ctx, event as unknown as AgentRequestStopEventPayload);
          } else if (event.type === 'daemon.ping') {
            // Cursor-filtered — use processedPingIds for session dedup
            if (processedPingIds.has(eventId)) continue;
            processedPingIds.add(eventId);

            // Advance ping cursor (only pings update the cursor)
            lastSeenPingEventId = event._id as Id<'chatroom_eventStream'>;
            pingCursorAdvanced = true;

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

      // Persist the ping cursor only when it actually advanced
      if (pingCursorAdvanced && lastSeenPingEventId !== undefined) {
        ctx.deps.machine.persistEventCursor(ctx.machineId, lastSeenPingEventId.toString());
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
