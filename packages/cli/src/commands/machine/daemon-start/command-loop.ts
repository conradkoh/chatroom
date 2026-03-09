/**
 * Command Loop — subscribes to Convex for pending commands, processes them sequentially.
 */

import {
  AGENT_REQUEST_DEADLINE_MS,
  DAEMON_HEARTBEAT_INTERVAL_MS,
} from '@workspace/backend/config/reliability.js';

import { api } from '../../../api.js';
import type { Id } from '../../../api.js';
import { getConvexWsClient } from '../../../infrastructure/convex/client.js';
import { ensureMachineRegistered } from '../../../infrastructure/machine/index.js';
import { onDaemonShutdown } from '../../../events/lifecycle/on-daemon-shutdown.js';
import { discoverModels } from './init.js';
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
  if (!ctx.config) return;

  const models = await discoverModels(ctx.agentServices);

  // Re-detect available harnesses so any newly installed tools are reflected immediately.
  const freshConfig = ensureMachineRegistered();
  ctx.config.availableHarnesses = freshConfig.availableHarnesses;
  ctx.config.harnessVersions = freshConfig.harnessVersions;

  const totalCount = Object.values(models).flat().length;

  try {
    await ctx.deps.backend.mutation(api.machines.refreshCapabilities, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
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

// ─── Private Helpers ────────────────────────────────────────────────────────

/**
 * Evict dedup entries older than AGENT_REQUEST_DEADLINE_MS to bound memory growth.
 */
function evictStaleDedupEntries(
  processedCommandIds: Map<string, number>,
  processedPingIds: Map<string, number>
): void {
  const evictBefore = Date.now() - AGENT_REQUEST_DEADLINE_MS;
  for (const [id, ts] of processedCommandIds) {
    if (ts < evictBefore) processedCommandIds.delete(id);
  }
  for (const [id, ts] of processedPingIds) {
    if (ts < evictBefore) processedPingIds.delete(id);
  }
}

/**
 * Dispatch a single command event to the appropriate handler.
 * Handles deduplication and error boundaries per event.
 */
async function dispatchCommandEvent(
  ctx: DaemonContext,
  event: { _id: string; type: string; [key: string]: unknown },
  processedCommandIds: Map<string, number>,
  processedPingIds: Map<string, number>
): Promise<void> {
  const eventId = event._id.toString();

  if (event.type === 'agent.requestStart') {
    // Deadline-filtered — use processedCommandIds for session dedup
    if (processedCommandIds.has(eventId)) return;
    processedCommandIds.set(eventId, Date.now());
    await onRequestStartAgent(ctx, event as unknown as AgentRequestStartEventPayload);
  } else if (event.type === 'agent.requestStop') {
    // Deadline-filtered — use processedCommandIds for session dedup
    if (processedCommandIds.has(eventId)) return;
    processedCommandIds.set(eventId, Date.now());
    await onRequestStopAgent(ctx, event as unknown as AgentRequestStopEventPayload);
  } else if (event.type === 'daemon.ping') {
    // Session dedup — prevents re-ponging the same ping twice in one daemon run
    if (processedPingIds.has(eventId)) return;
    processedPingIds.set(eventId, Date.now());

    // Respond to ping with a pong via mutation
    handlePing();
    await ctx.deps.backend.mutation(api.machines.ackPing, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      pingEventId: event._id as Id<'chatroom_eventStream'>,
    });
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
  // No cursor is needed — event types use their own filtering:
  // - agent.requestStart / agent.requestStop: deadline-filtered on backend (no cursor)
  // - daemon.ping: all ping events are delivered; re-ponging on restart is harmless
  //   because the UI's getDaemonPongEvent looks for a pong AFTER a specific ping ID
  //
  // Session-scoped dedup maps — prevent double-processing within a single daemon run.
  // Map<eventId, processedAt timestamp>. Entries older than AGENT_REQUEST_DEADLINE_MS
  // are evicted at the start of each batch to bound memory growth.
  const processedCommandIds = new Map<string, number>(); // agent.requestStart / agent.requestStop
  const processedPingIds = new Map<string, number>(); // daemon.ping

  wsClient.onUpdate(
    api.machines.getCommandEvents,
    {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    },
    async (result: { events: Array<{ _id: string; type: string; [key: string]: unknown }> }) => {
      if (!result.events || result.events.length === 0) return;

      evictStaleDedupEntries(processedCommandIds, processedPingIds);

      for (const event of result.events) {
        try {
          console.log(`[${formatTimestamp()}] 📡 Stream command event: ${event.type}`);
          await dispatchCommandEvent(ctx, event, processedCommandIds, processedPingIds);
        } catch (err) {
          console.error(
            `[${formatTimestamp()}] ❌ Stream command event failed: ${(err as Error).message}`
          );
        }
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
