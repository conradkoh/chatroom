/**
 * Command Loop — subscribes to Convex for pending commands, processes them sequentially.
 */

import {
  AGENT_REQUEST_DEADLINE_MS,
  DAEMON_HEARTBEAT_INTERVAL_MS,
} from '@workspace/backend/config/reliability.js';
import type { FunctionReturnType } from 'convex/server';

import { onRequestStartAgent } from '../../../events/daemon/agent/on-request-start-agent.js';
import { onRequestStopAgent } from '../../../events/daemon/agent/on-request-stop-agent.js';
import { releaseLock } from '../pid.js';
import { pushGitState } from './git-heartbeat.js';
import { pushCommands } from './command-sync-heartbeat.js';
import { startFileContentSubscription } from './file-content-subscription.js';
import { startFileTreeSubscription } from './file-tree-subscription.js';
import { startGitRequestSubscription } from './git-subscription.js';
import { startObservedSyncSubscription } from './observed-sync.js';
import { handlePing } from './handlers/ping.js';
import { onCommandRun, onCommandStop } from './handlers/command-runner.js';
import { discoverModels } from './init.js';
import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { onDaemonShutdown } from '../../../events/lifecycle/on-daemon-shutdown.js';
import { getConvexWsClient } from '../../../infrastructure/convex/client.js';
import { makeGitStateKey } from '../../../infrastructure/git/types.js';
import { executeLocalAction } from '../../../infrastructure/local-actions/index.js';
import { ensureMachineRegistered } from '../../../infrastructure/machine/index.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

// ─── Derived Types ──────────────────────────────────────────────────────────

/** The inferred return type of the getCommandEvents Convex query. */
type CommandEventsResult = FunctionReturnType<typeof api.machines.getCommandEvents>;

/** A single event from the command event stream. */
type CommandEvent = CommandEventsResult['events'][number];

// ─── Model Refresh ──────────────────────────────────────────────────────────

/**
 * Interval for periodic model discovery refresh (10 seconds).
 *
 * The refresh itself is cheap — it only spawns local `which` / `--version`
 * probes per harness. The backend is only called when the discovered model
 * set actually changes (see `refreshModels` for diff logic), so the polling
 * cadence does not translate into network traffic.
 */
const MODEL_REFRESH_INTERVAL_MS = 10 * 1000;

/** Per-harness diff between two model snapshots. */
interface ModelDiff {
  /** Models present in `next` but not in `previous`, grouped by harness. */
  added: Record<string, string[]>;
  /** Models present in `previous` but not in `next`, grouped by harness. */
  removed: Record<string, string[]>;
  /** True when at least one harness has a non-empty added or removed list. */
  hasChanges: boolean;
}

/**
 * Compute the per-harness diff between the previously pushed model snapshot
 * and the freshly discovered set. A `null` previous snapshot is treated as
 * an empty record (everything is "added"), which forces an initial push.
 */
function diffModels(
  previous: Record<string, string[]> | null,
  next: Record<string, string[]>
): ModelDiff {
  const prev = previous ?? {};
  const added: Record<string, string[]> = {};
  const removed: Record<string, string[]> = {};
  const harnesses = new Set([...Object.keys(prev), ...Object.keys(next)]);

  for (const harness of harnesses) {
    const prevSet = new Set(prev[harness] ?? []);
    const nextSet = new Set(next[harness] ?? []);

    const addedForHarness = [...nextSet].filter((m) => !prevSet.has(m));
    const removedForHarness = [...prevSet].filter((m) => !nextSet.has(m));

    if (addedForHarness.length > 0) added[harness] = addedForHarness;
    if (removedForHarness.length > 0) removed[harness] = removedForHarness;
  }

  return {
    added,
    removed,
    hasChanges: Object.keys(added).length > 0 || Object.keys(removed).length > 0,
  };
}

/**
 * Format a per-harness model map as a human-readable list for log output.
 * Returns e.g. `opencode: model-a, model-b; pi: model-c`.
 */
function formatModelMap(map: Record<string, string[]>): string {
  return Object.entries(map)
    .map(([harness, models]) => `${harness}: ${models.join(', ')}`)
    .join('; ');
}

/**
 * Re-discover models and update the backend registration when the set has
 * changed since the last push.
 *
 * The daemon is the source of truth for "what changed since last sync" — the
 * previously pushed snapshot lives on `ctx.lastPushedModels` and is diffed
 * locally each tick. The backend mutation is only invoked when the diff is
 * non-empty, keeping a 10-second poll cadence cheap.
 *
 * On a successful push, `ctx.lastPushedModels` is updated to the freshly
 * discovered set. On failure, the snapshot is left unchanged so the next
 * tick will retry with the same diff.
 */
export async function refreshModels(ctx: DaemonContext): Promise<void> {
  if (!ctx.config) return;

  const models = await discoverModels(ctx.agentServices);

  // Re-detect available harnesses so any newly installed tools are reflected immediately.
  const freshConfig = ensureMachineRegistered();
  ctx.config.availableHarnesses = freshConfig.availableHarnesses;
  ctx.config.harnessVersions = freshConfig.harnessVersions;

  const diff = diffModels(ctx.lastPushedModels, models);
  if (!diff.hasChanges) {
    // Nothing new since last successful push — skip the Convex mutation.
    return;
  }

  const totalCount = Object.values(models).flat().length;

  try {
    await ctx.deps.backend.mutation(api.machines.refreshCapabilities, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      availableHarnesses: ctx.config.availableHarnesses,
      harnessVersions: ctx.config.harnessVersions,
      availableModels: models,
    });
    // Snapshot only after the backend successfully accepts the update — on
    // failure we want the next tick to retry with the same diff.
    ctx.lastPushedModels = models;

    // Log only after a successful sync so transient failures do not re-print
    // the same diff every MODEL_REFRESH_INTERVAL_MS while retrying.
    if (Object.keys(diff.added).length > 0) {
      console.log(`[${formatTimestamp()}] ➕ New models detected — ${formatModelMap(diff.added)}`);
    }
    if (Object.keys(diff.removed).length > 0) {
      console.log(
        `[${formatTimestamp()}] ➖ Models no longer available — ${formatModelMap(diff.removed)}`
      );
    }
    console.log(
      `[${formatTimestamp()}] 🔄 Model refresh pushed: ${totalCount > 0 ? `${totalCount} models` : 'none discovered'}`
    );
  } catch (error) {
    console.warn(`[${formatTimestamp()}] ⚠️  Model refresh failed: ${getErrorMessage(error)}`);
  }
}

// ─── Private Helpers ────────────────────────────────────────────────────────

/** Consolidates the four dedup maps into a single container. */
interface DedupTracker {
  commandIds: Map<string, number>;
  pingIds: Map<string, number>;
  gitRefreshIds: Map<string, number>;
  localActionIds: Map<string, number>;
  commandRunIds: Map<string, number>;
  commandStopIds: Map<string, number>;
}

/**
 * Evict dedup entries older than AGENT_REQUEST_DEADLINE_MS to bound memory growth.
 */
function evictStaleDedupEntries(tracker: DedupTracker): void {
  const evictBefore = Date.now() - AGENT_REQUEST_DEADLINE_MS;
  for (const [id, ts] of tracker.commandIds) {
    if (ts < evictBefore) tracker.commandIds.delete(id);
  }
  for (const [id, ts] of tracker.pingIds) {
    if (ts < evictBefore) tracker.pingIds.delete(id);
  }
  for (const [id, ts] of tracker.gitRefreshIds) {
    if (ts < evictBefore) tracker.gitRefreshIds.delete(id);
  }
  for (const [id, ts] of tracker.localActionIds) {
    if (ts < evictBefore) tracker.localActionIds.delete(id);
  }
  for (const [id, ts] of tracker.commandRunIds) {
    if (ts < evictBefore) tracker.commandRunIds.delete(id);
  }
  for (const [id, ts] of tracker.commandStopIds) {
    if (ts < evictBefore) tracker.commandStopIds.delete(id);
  }
}

/**
 * Dispatch a single command event to the appropriate handler.
 * Handles deduplication and error boundaries per event.
 */
async function dispatchCommandEvent(
  ctx: DaemonContext,
  event: CommandEvent,
  tracker: DedupTracker
): Promise<void> {
  const eventId = event._id.toString();
  // Cast to string for comparison — new event types (command.run, command.stop) may not
  // be reflected in the inferred union until `npx convex dev` regenerates types.
  const eventType = event.type as string;

  if (event.type === 'agent.requestStart') {
    // Deadline-filtered — use commandIds for session dedup
    if (tracker.commandIds.has(eventId)) return;
    tracker.commandIds.set(eventId, Date.now());
    await onRequestStartAgent(ctx, event);
  } else if (event.type === 'agent.requestStop') {
    // Deadline-filtered — use commandIds for session dedup
    if (tracker.commandIds.has(eventId)) return;
    tracker.commandIds.set(eventId, Date.now());
    await onRequestStopAgent(ctx, event);
  } else if (event.type === 'daemon.ping') {
    // Session dedup — prevents re-ponging the same ping twice in one daemon run
    if (tracker.pingIds.has(eventId)) return;
    tracker.pingIds.set(eventId, Date.now());

    // Respond to ping with a pong via mutation
    handlePing();
    await ctx.deps.backend.mutation(api.machines.ackPing, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      pingEventId: event._id,
    });
  } else if (event.type === 'daemon.gitRefresh') {
    // Session dedup — don't re-process same refresh event twice in one daemon run
    if (tracker.gitRefreshIds.has(eventId)) return;
    tracker.gitRefreshIds.set(eventId, Date.now());

    // Clear in-memory state hash to bypass change detection on next push
    const stateKey = makeGitStateKey(ctx.machineId, event.workingDir);
    ctx.lastPushedGitState.delete(stateKey);

    // Push git state immediately (non-blocking from caller perspective)
    console.log(`[${formatTimestamp()}] 🔄 Git refresh requested for ${event.workingDir}`);
    await pushGitState(ctx);
  } else if (event.type === 'daemon.localAction') {
    // Session dedup — don't re-process same local action event twice in one daemon run
    if (tracker.localActionIds.has(eventId)) return;
    tracker.localActionIds.set(eventId, Date.now());

    console.log(`[${formatTimestamp()}] 🖥️  Local action: ${event.action} → ${event.workingDir}`);
    const result = await executeLocalAction(event.action, event.workingDir);
    if (!result.success) {
      console.warn(`[${formatTimestamp()}] ⚠️  Local action failed: ${result.error}`);
    }
  } else if (eventType === 'command.run') {
    // Session dedup — don't re-process same command run event twice
    if (tracker.commandRunIds.has(eventId)) return;
    tracker.commandRunIds.set(eventId, Date.now());
    await onCommandRun(ctx, event as any);
  } else if (eventType === 'command.stop') {
    // Session dedup — don't re-process same command stop event twice
    if (tracker.commandStopIds.has(eventId)) return;
    tracker.commandStopIds.set(eventId, Date.now());
    await onCommandStop(ctx, event as any);
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
        // When observedSyncEnabled is true, skip periodic pushes — handled by observed-sync subscription instead
        if (!ctx.observedSyncEnabled) {
          pushGitState(ctx).catch((err: unknown) => {
            console.warn(
              `[${formatTimestamp()}] ⚠️  Git state push failed: ${getErrorMessage(err)}`
            );
          });
          pushCommands(ctx).catch((err: unknown) => {
            console.warn(`[${formatTimestamp()}] ⚠️  Command sync failed: ${getErrorMessage(err)}`);
          });
        }
        // File content requests are now handled by the reactive subscription
        // (file-content-subscription.ts) for near-instant response times.
      })
      .catch((err: unknown) => {
        console.warn(`[${formatTimestamp()}] ⚠️  Daemon heartbeat failed: ${getErrorMessage(err)}`);
      });
  }, DAEMON_HEARTBEAT_INTERVAL_MS);

  // Don't let the heartbeat timer keep the process alive during shutdown
  heartbeatTimer.unref();

  // ── Git Request Subscription ──────────────────────────────────────
  // Reactive subscription for on-demand workspace git requests.
  // Uses wsClient.onUpdate to react instantly when pending requests appear.
  // Started after wsClient is initialized (see below).
  let gitSubscriptionHandle: ReturnType<typeof startGitRequestSubscription> | null = null;

  // ── File Content Subscription ──────────────────────────────────────
  // Reactive subscription for on-demand file content requests.
  // Replaces the heartbeat-based polling for near-instant file previews.
  let fileContentSubscriptionHandle: ReturnType<typeof startFileContentSubscription> | null = null;

  // ── File Tree Subscription ─────────────────────────────────────────
  // Reactive subscription for on-demand file tree requests.
  // Replaces the heartbeat-based push with request/fulfill pattern.
  let fileTreeSubscriptionHandle: ReturnType<typeof startFileTreeSubscription> | null = null;

  // ── Observed Sync Subscription ─────────────────────────────────────────
  let observedSyncSubscriptionHandle: ReturnType<typeof startObservedSyncSubscription> | null =
    null;

  // Trigger an immediate git state push on startup so the frontend gets
  // data right away without waiting 30s for the first heartbeat.
  if (ctx.observedSyncEnabled) {
    console.log(`[${formatTimestamp()}] 👁️ Observed-sync enabled, skipping immediate push`);
  } else {
    pushGitState(ctx).catch(() => {});
    pushCommands(ctx).catch(() => {});
  }

  const shutdown = async () => {
    console.log(`\n[${formatTimestamp()}] Shutting down...`);

    // Stop heartbeat timers
    clearInterval(heartbeatTimer);

    // Stop git request subscription
    if (gitSubscriptionHandle) gitSubscriptionHandle.stop();

    // Stop file tree subscription
    if (fileContentSubscriptionHandle) fileContentSubscriptionHandle.stop();
    if (fileTreeSubscriptionHandle) fileTreeSubscriptionHandle.stop();
    if (observedSyncSubscriptionHandle) observedSyncSubscriptionHandle.stop();

    await onDaemonShutdown(ctx);

    // Stop the local API server if it was started
    if (ctx.stopLocalApi) {
      await ctx.stopLocalApi().catch(() => {});
    }

    releaseLock();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);

  // Open WebSocket connection for event stream subscription
  const wsClient = await getConvexWsClient();

  // ── Git Request Subscription ──────────────────────────────────────────
  // Now that wsClient is ready, start the reactive git request subscription.
  gitSubscriptionHandle = startGitRequestSubscription(ctx, wsClient);

  // ── File Content Subscription ──────────────────────────────────────
  // Now that wsClient is ready, start the reactive file content subscription.
  fileContentSubscriptionHandle = startFileContentSubscription(ctx, wsClient);

  // Now that wsClient is ready, start the reactive file tree subscription.
  fileTreeSubscriptionHandle = startFileTreeSubscription(ctx, wsClient);

  // ── Observed Sync Subscription ─────────────────────────────────────────
  // When observedSyncEnabled is true, start the event-driven observed-sync subscription
  // to push state only for chatrooms the frontend is actively watching.
  if (ctx.observedSyncEnabled) {
    observedSyncSubscriptionHandle = startObservedSyncSubscription(ctx, wsClient);
  }

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
  const dedupTracker: DedupTracker = {
    commandIds: new Map<string, number>(), // agent.requestStart / agent.requestStop
    pingIds: new Map<string, number>(), // daemon.ping
    gitRefreshIds: new Map<string, number>(), // daemon.gitRefresh
    localActionIds: new Map<string, number>(), // daemon.localAction
    commandRunIds: new Map<string, number>(), // command.run
    commandStopIds: new Map<string, number>(), // command.stop
  };

  wsClient.onUpdate(
    api.machines.getCommandEvents,
    {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    },
    async (result) => {
      if (!result.events || result.events.length === 0) return;

      evictStaleDedupEntries(dedupTracker);

      for (const event of result.events) {
        try {
          console.log(
            `[${formatTimestamp()}] 📡 Stream command event: ${event.type} (id: ${event._id})`
          );
          await dispatchCommandEvent(ctx, event, dedupTracker);
        } catch (err) {
          console.error(
            `[${formatTimestamp()}] ❌ Stream command event failed: ${getErrorMessage(err)}`
          );
        }
      }
    }
  );

  // Periodic model discovery refresh — keeps the model list current
  // in case new providers are configured while the daemon is running
  const modelRefreshTimer = setInterval(() => {
    refreshModels(ctx).catch((err) => {
      console.warn(`[${formatTimestamp()}] ⚠️  Model refresh error: ${getErrorMessage(err)}`);
    });
  }, MODEL_REFRESH_INTERVAL_MS);

  // Unref the timer so it doesn't prevent process exit during shutdown
  modelRefreshTimer.unref();

  // Keep process alive
  return await new Promise(() => {});
}
