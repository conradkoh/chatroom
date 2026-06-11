/**
 * Command Loop — subscribes to Convex for pending commands, processes them sequentially.
 */

import { featureFlags } from '@workspace/backend/config/featureFlags.js';
import {
  AGENT_REQUEST_DEADLINE_MS,
  DAEMON_HEARTBEAT_INTERVAL_MS,
} from '@workspace/backend/config/reliability.js';
import type { FunctionReturnType } from 'convex/server';
import { Effect } from 'effect';

import { api } from '../../../api.js';
import type { BoundHarness } from '../../../domain/direct-harness/entities/bound-harness.js';
import type { SessionHandle } from '../../../domain/direct-harness/usecases/open-session.js';
import { onRequestStartAgent } from '../../../events/daemon/agent/on-request-start-agent.js';
import { onRequestStopAgent } from '../../../events/daemon/agent/on-request-stop-agent.js';
import { onDaemonShutdown } from '../../../events/lifecycle/on-daemon-shutdown.js';
import { getConvexWsClient } from '../../../infrastructure/convex/client.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import { makeGitStateKey } from '../../../infrastructure/git/types.js';
import { executeLocalAction } from '../../../infrastructure/local-actions/index.js';
import { ensureMachineRegistered } from '../../../infrastructure/machine/index.js';
import type { MachineConfig } from '../../../infrastructure/machine/types.js';
import { ConvexCapabilitiesPublisher } from '../../../infrastructure/repos/convex-capabilities-publisher.js';
import { ConvexOutputRepository } from '../../../infrastructure/repos/convex-output-repository.js';
import { ConvexSessionRepository } from '../../../infrastructure/repos/convex-session-repository.js';
import { BufferedJournalFactory } from '../../../infrastructure/repos/journal-factory.js';
import type { RemoteAgentService } from '../../../infrastructure/services/remote-agents/remote-agent-service.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import { releaseLock } from '../pid.js';
import { harnessCapabilitiesFingerprint } from './capabilities-snapshot.js';
import { pushCommandsEffect } from './command-sync-heartbeat.js';
import { syncCommitDetailsEffect } from './commit-detail-sync.js';
import { DaemonContextService, daemonContextToLayers } from './daemon-context-service.js';
import { DaemonSessionService } from './daemon-services.js';
import { startCommandSubscriber } from './direct-harness/command-subscriber.js';
import { HarnessLifecycleManager } from './direct-harness/harness-lifecycle-manager.js';
import { startMessageSubscriber } from './direct-harness/prompt-subscriber.js';
import { startSessionSubscriber } from './direct-harness/session-subscriber.js';
import {
  startFileContentSubscriptionEffect,
  type FileContentSubscriptionHandle,
} from './file-content-subscription.js';
import {
  startFileTreeSubscriptionEffect,
  type FileTreeSubscriptionHandle,
} from './file-tree-subscription.js';
import { pushGitStateEffect, pushSingleWorkspaceGitState } from './git-heartbeat.js';
import {
  startGitRequestSubscriptionEffect,
  type GitSubscriptionHandle,
} from './git-subscription.js';
import { forceKillAllCommands, onCommandRun, onCommandStop } from './handlers/command-runner.js';
import { forceKillAllTrackedProcessGroupsEffect } from './handlers/orphan-tracker.js';
import { handlePing } from './handlers/ping.js';
import { startLogObserverSubscription } from './handlers/process/log-observer-sync.js';
import { processManager } from './handlers/process/manager.js';
import { discoverModels } from './init.js';
import { startObservedSyncSubscription } from './observed-sync.js';
import type { DaemonContext, SessionId } from './types.js';
import { formatTimestamp } from './utils.js';
import { startWorkspaceListSubscription } from './workspace-list-subscription.js';

// ─── Derived Types ──────────────────────────────────────────────────────────

/** The inferred return type of the getCommandEvents Convex query. */
type CommandEventsResult = FunctionReturnType<typeof api.machines.getCommandEvents>;

/** A single event from the command event stream. */
type CommandEvent = CommandEventsResult['events'][number];

/**
 * Typed payload for `command.run` events.
 * These fields may not be reflected in the Convex-generated union until
 * `npx convex dev` regenerates types, so we define the shape explicitly.
 */
type CommandRunPayload = {
  workingDir: string;
  commandName: string;
  script: string;
  /** Convex Id serialised as a string at the transport layer. */
  runId: string;
};

/**
 * Typed payload for `command.stop` events.
 * Same codegen caveat as CommandRunPayload.
 */
type CommandStopPayload = {
  /** Convex Id serialised as a string at the transport layer. */
  runId: string;
};

// ─── Model Refresh ──────────────────────────────────────────────────────────

/** Outcome of a single `refreshModels` invocation (periodic tick or manual refresh). */
export type RefreshModelsOutcome =
  | { kind: 'noop' }
  | { kind: 'skipped_no_changes' }
  | { kind: 'pushed' }
  | { kind: 'failed'; message: string };

/**
 * Flat identity + ops required by refreshModelsCore.
 * DaemonSessionServiceShape structurally satisfies this type.
 */
type RefreshModelsDeps = {
  sessionId: SessionId;
  machineId: string;
  backend: BackendOps;
  agentServices: Map<string, RemoteAgentService>;
};

/**
 * Mutable state holder required by refreshModelsCore (passed by reference).
 * DaemonSessionServiceShape structurally satisfies this type, so the Effect
 * twin can pass `session` as both deps and stateHolder.
 */
type RefreshModelsStateHolder = {
  config: MachineConfig | null;
  lastPushedModels: Record<string, string[]> | null;
  lastPushedHarnessFingerprint: string | null;
};

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
 * previously pushed model snapshot lives on `stateHolder.lastPushedModels` and
 * is diffed locally each tick, and harness list + versions are compared via a
 * stable fingerprint. The mutation is only invoked when either snapshot differs.
 *
 * On a successful push, `stateHolder.lastPushedModels` and
 * `stateHolder.lastPushedHarnessFingerprint` are updated to the freshly
 * discovered state. On failure, both snapshots are left unchanged so the next
 * tick retries.
 */
// fallow-ignore-next-line unused-export
export async function refreshModelsCore(
  deps: RefreshModelsDeps,
  stateHolder: RefreshModelsStateHolder
): Promise<RefreshModelsOutcome> {
  if (!stateHolder.config) {
    return { kind: 'noop' };
  }
  // Capture non-null config before entering the Effect.gen closure so TypeScript
  // doesn't require repeated non-null assertions inside the lambda.
  const ctxConfig = stateHolder.config;

  return Effect.runPromise(
    Effect.gen(function* () {
      const models = yield* Effect.tryPromise({
        try: async () => discoverModels(deps.agentServices),
        catch: (e) => e,
      });

      // Re-detect available harnesses so any newly installed tools are reflected immediately.
      const freshConfig = yield* Effect.tryPromise({
        try: async () => ensureMachineRegistered(),
        catch: (e) => e,
      });
      ctxConfig.availableHarnesses = freshConfig.availableHarnesses;
      ctxConfig.harnessVersions = freshConfig.harnessVersions;

      const modelDiff = diffModels(stateHolder.lastPushedModels, models);
      const nextHarnessFingerprint = harnessCapabilitiesFingerprint(
        ctxConfig.availableHarnesses,
        ctxConfig.harnessVersions as Record<string, unknown>
      );
      const harnessFingerprintChanged =
        stateHolder.lastPushedHarnessFingerprint !== null &&
        nextHarnessFingerprint !== stateHolder.lastPushedHarnessFingerprint;

      if (!modelDiff.hasChanges && !harnessFingerprintChanged) {
        // Models and harness metadata match last successful push — skip Convex.
        return { kind: 'skipped_no_changes' } satisfies RefreshModelsOutcome;
      }

      const totalCount = Object.values(models).flat().length;

      yield* Effect.tryPromise({
        try: async () =>
          deps.backend.mutation(api.machines.refreshCapabilities, {
            sessionId: deps.sessionId,
            machineId: deps.machineId,
            availableHarnesses: ctxConfig.availableHarnesses,
            harnessVersions: ctxConfig.harnessVersions,
            availableModels: models,
          }),
        catch: (e) => e,
      });

      // Snapshot only after the backend successfully accepts the update — on
      // failure we want the next tick to retry with the same diff.
      stateHolder.lastPushedModels = models;
      stateHolder.lastPushedHarnessFingerprint = nextHarnessFingerprint;

      // Log only after a successful sync so transient failures do not re-print
      // the same diff every MODEL_REFRESH_INTERVAL_MS while retrying.
      if (Object.keys(modelDiff.added).length > 0) {
        console.log(
          `[${formatTimestamp()}] ➕ New models detected — ${formatModelMap(modelDiff.added)}`
        );
      }
      if (Object.keys(modelDiff.removed).length > 0) {
        console.log(
          `[${formatTimestamp()}] ➖ Models no longer available — ${formatModelMap(modelDiff.removed)}`
        );
      }
      console.log(
        `[${formatTimestamp()}] 🔄 Model refresh pushed: ${totalCount > 0 ? `${totalCount} models` : 'none discovered'}`
      );
      return { kind: 'pushed' } satisfies RefreshModelsOutcome;
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          const message = getErrorMessage(error);
          console.warn(`[${formatTimestamp()}] ⚠️  Model refresh failed: ${message}`);
          return { kind: 'failed', message } satisfies RefreshModelsOutcome;
        })
      )
    )
  );
}

/**
 * Re-discover models and update the backend registration when the set has changed.
 * @deprecated Use refreshModelsCore or refreshModelsEffect for new Effect-based code.
 */
// fallow-ignore-next-line unused-export
export async function refreshModels(ctx: DaemonContext): Promise<RefreshModelsOutcome> {
  return refreshModelsCore(
    {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      backend: ctx.deps.backend,
      agentServices: ctx.agentServices,
    },
    ctx
  );
}

// ─── Private Helpers ────────────────────────────────────────────────────────

/** Consolidates dedup maps into a single container. */
interface DedupTracker {
  commandIds: Map<string, number>;
  pingIds: Map<string, number>;
  gitRefreshIds: Map<string, number>;
  capabilitiesRefreshIds: Map<string, number>;
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
  for (const [id, ts] of tracker.capabilitiesRefreshIds) {
    if (ts < evictBefore) tracker.capabilitiesRefreshIds.delete(id);
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

  // Evict stale pending stops from command-runner (stop-before-run race handling)
  processManager.evictStalePendingStops();
}

/**
 * Dispatch a single command event to the appropriate handler.
 * Handles deduplication and error boundaries per event.
 *
 * DEDUP SEMANTICS (dedup-after-handler for most event types):
 * Event IDs are registered AFTER handler completion so that failed handlers
 * can be retried on the next subscription update, rather than being permanently
 * skipped when a transient error occurs (e.g. a backend mutation fails).
 *
 * Trade-off: a handler that throws on every invocation will be retried on every
 * subscription update until the event ages out of the deadline/TTL filter.
 * There is no retry-count cap or backoff — callers must ensure handlers are
 * either idempotent, or only throw on transient/recoverable failures.
 *
 * Per-handler retry-safety analysis:
 *   agent.requestStart         — ensureRunning() is idempotent; retry-safe
 *   agent.requestStop          — stopping an already-stopped agent is harmless; retry-safe
 *   daemon.ping                — ackPing is idempotent; ponging twice is harmless; retry-safe
 *   daemon.gitRefresh          — state-hash clear + push is idempotent; retry-safe
 *   daemon.localAction         — executeLocalAction never throws (returns error obj); retry-safe
 *   command.run                — spawns a process; NOT retry-safe → dedup ID registered BEFORE handler
 *   command.stop               — killing an already-dead process is harmless; retry-safe
 *   daemon.refreshCapabilities — model refresh is idempotent; retry-safe
 */
// fallow-ignore-next-line unused-export
export async function dispatchCommandEvent(
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
    await onRequestStartAgent(ctx, event);
    tracker.commandIds.set(eventId, Date.now());
  } else if (event.type === 'agent.requestStop') {
    // Deadline-filtered — use commandIds for session dedup
    if (tracker.commandIds.has(eventId)) return;
    await onRequestStopAgent(ctx, event);
    tracker.commandIds.set(eventId, Date.now());
  } else if (event.type === 'daemon.ping') {
    // Session dedup — prevents re-ponging the same ping twice in one daemon run
    if (tracker.pingIds.has(eventId)) return;

    // Respond to ping with a pong via mutation
    handlePing();
    await ctx.deps.backend.mutation(api.machines.ackPing, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      pingEventId: event._id,
    });
    tracker.pingIds.set(eventId, Date.now());
  } else if (event.type === 'daemon.gitRefresh') {
    // Session dedup — don't re-process same refresh event twice in one daemon run
    if (tracker.gitRefreshIds.has(eventId)) return;

    // Clear in-memory state hash to bypass change detection on next push
    const stateKey = makeGitStateKey(ctx.machineId, event.workingDir);
    ctx.lastPushedGitState.delete(stateKey);

    // Push git state immediately (non-blocking from caller perspective)
    console.log(`[${formatTimestamp()}] 🔄 Git refresh requested for ${event.workingDir}`);
    await Effect.runPromise(pushGitStateEffect.pipe(Effect.provide(daemonContextToLayers(ctx))));
    tracker.gitRefreshIds.set(eventId, Date.now());
  } else if (event.type === 'daemon.localAction') {
    // Session dedup — don't re-process same local action event twice in one daemon run
    if (tracker.localActionIds.has(eventId)) return;

    console.log(`[${formatTimestamp()}] 🖥️  Local action: ${event.action} → ${event.workingDir}`);
    const result = await executeLocalAction(event.action, event.workingDir);
    if (!result.success) {
      console.warn(`[${formatTimestamp()}] ⚠️  Local action failed: ${result.error}`);
    } else if (
      event.action === 'git-pull' ||
      event.action === 'git-push' ||
      event.action === 'git-sync' ||
      event.action === 'git-discard-all'
    ) {
      ctx.lastPushedGitState.delete(makeGitStateKey(ctx.machineId, event.workingDir));
      await pushSingleWorkspaceGitState(ctx, event.workingDir);
    }
    tracker.localActionIds.set(eventId, Date.now());
  } else if (eventType === 'command.run') {
    // command.run spawns an OS process — NOT idempotent.
    // Register the dedup ID BEFORE the handler so that a retry on the next
    // subscription update cannot spawn a duplicate process. The double-spawn
    // guard inside onCommandRun provides a secondary safety net for the case
    // where the process is still alive in runningProcesses, but it cannot
    // protect against re-spawn after a fast process exit. Dedup-before-handler
    // is the correct primary defence here.
    if (tracker.commandRunIds.has(eventId)) return;
    tracker.commandRunIds.set(eventId, Date.now());
    await onCommandRun(ctx, event as unknown as CommandRunPayload);
  } else if (eventType === 'command.stop') {
    // Session dedup — don't re-process same command stop event twice
    if (tracker.commandStopIds.has(eventId)) return;
    await onCommandStop(ctx, event as unknown as CommandStopPayload);
    tracker.commandStopIds.set(eventId, Date.now());
  } else if (event.type === 'daemon.refreshCapabilities') {
    // Session dedup — don't re-process same refresh event twice
    if (tracker.capabilitiesRefreshIds.has(eventId)) return;
    console.log(`[${formatTimestamp()}] 🔄 Manual capabilities refresh requested`);
    const outcome = await refreshModels(ctx);
    tracker.capabilitiesRefreshIds.set(eventId, Date.now());

    const batchId = 'batchId' in event && event.batchId !== undefined ? event.batchId : undefined;
    if (!batchId) {
      return;
    }

    let status: 'completed' | 'skipped_no_changes' | 'failed';
    let errorMessage: string | undefined;
    if (outcome.kind === 'pushed') {
      status = 'completed';
    } else if (outcome.kind === 'skipped_no_changes') {
      status = 'skipped_no_changes';
    } else if (outcome.kind === 'failed') {
      status = 'failed';
      errorMessage = outcome.message;
    } else {
      status = 'failed';
      errorMessage = 'Daemon configuration unavailable';
    }

    try {
      await ctx.deps.backend.mutation(api.machines.reportCapabilitiesRefreshResult, {
        sessionId: ctx.sessionId,
        batchId,
        machineId: ctx.machineId,
        status,
        errorMessage,
      });
    } catch (error) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Capabilities refresh report failed: ${getErrorMessage(error)}`
      );
    }
  }
}

// ─── Command Loop ───────────────────────────────────────────────────────────

/**
 * Start the command processing loop: subscribe to Convex for pending commands,
 * enqueue them, and process sequentially.
 */
export async function startCommandLoop(ctx: DaemonContext): Promise<never> {
  // Build all Effect service layers once — reused by every twin call in this function.
  const layers = daemonContextToLayers(ctx);

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
          Effect.runPromise(pushGitStateEffect.pipe(Effect.provide(layers))).catch(
            (err: unknown) => {
              console.warn(
                `[${formatTimestamp()}] ⚠️  Git state push failed: ${getErrorMessage(err)}`
              );
            }
          );
          Effect.runPromise(pushCommandsEffect.pipe(Effect.provide(layers))).catch(
            (err: unknown) => {
              console.warn(
                `[${formatTimestamp()}] ⚠️  Command sync failed: ${getErrorMessage(err)}`
              );
            }
          );
          Effect.runPromise(syncCommitDetailsEffect().pipe(Effect.provide(layers))).catch(
            (err: unknown) => {
              console.warn(
                `[${formatTimestamp()}] ⚠️  Commit detail sync failed: ${getErrorMessage(err)}`
              );
            }
          );
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
  let gitSubscriptionHandle: GitSubscriptionHandle | null = null;

  // ── File Content Subscription ──────────────────────────────────────
  // Reactive subscription for on-demand file content requests.
  // Replaces the heartbeat-based polling for near-instant file previews.
  let fileContentSubscriptionHandle: FileContentSubscriptionHandle | null = null;

  // ── File Tree Subscription ─────────────────────────────────────────
  // Reactive subscription for on-demand file tree requests.
  // Replaces the heartbeat-based push with request/fulfill pattern.
  let fileTreeSubscriptionHandle: FileTreeSubscriptionHandle | null = null;

  // ── Workspace List Subscription ────────────────────────────────────────
  let workspaceListSubscriptionHandle: ReturnType<typeof startWorkspaceListSubscription> | null =
    null;

  // ── Observed Sync Subscription ─────────────────────────────────────────
  let observedSyncSubscriptionHandle: ReturnType<typeof startObservedSyncSubscription> | null =
    null;
  let logObserverSubscriptionHandle: ReturnType<typeof startLogObserverSubscription> | null = null;

  // ── V2 Direct-Harness Subscriptions ──────────────────────────────────
  // Gated by directHarnessWorkers flag. All return { stop: () => void }.
  let pendingPromptSubscriptionHandle: { stop: () => void } | null = null;
  let pendingHarnessSessionSubscriptionHandle: { stop: () => void } | null = null;
  let commandSubscriptionHandle: { stop: () => void } | null = null;
  let lifecycleManager: HarnessLifecycleManager | null = null;
  // Shared state for v2 direct-harness subscribers.
  // activeSessions: opened/resumed sessions shared by session-subscriber
  //   and prompt-subscriber so they reuse the same DirectHarnessSession.
  // harnesses: running BoundHarness instances per workspace, lazily spawned
  //   on first use and killed on shutdown.
  const activeSessions = new Map<string, SessionHandle>();
  const harnesses = new Map<string, BoundHarness>();

  // Trigger an immediate git state push on startup so the frontend gets
  // data right away without waiting 30s for the first heartbeat.
  if (ctx.observedSyncEnabled) {
    console.log(`[${formatTimestamp()}] 👁️ Observed-sync enabled, skipping immediate push`);
  } else {
    Effect.runPromise(pushGitStateEffect.pipe(Effect.provide(layers))).catch(() => {});
    Effect.runPromise(pushCommandsEffect.pipe(Effect.provide(layers))).catch(() => {});
    Effect.runPromise(syncCommitDetailsEffect().pipe(Effect.provide(layers))).catch(() => {});
  }

  // ── Shutdown timeouts ───────────────────────────────────────────────────
  // Every awaited step in the graceful path is bounded so a single hung
  // session/harness close (or a dead backend connection) can never wedge the
  // daemon with orphaned children. The watchdog is the final backstop: if the
  // whole sequence exceeds it, we force-kill everything and exit.
  const PROCESS_KILL_TIMEOUT_MS = 6_000; // commands SIGTERM(3s)→SIGKILL + agents
  const CLOSE_TIMEOUT_MS = 3_000; // per session/harness close()
  const SHUTDOWN_WATCHDOG_MS = 12_000; // overall hard deadline

  let signalCount = 0;
  let isShuttingDown = false;

  /** Best-effort, fully synchronous teardown used by the force-exit path. */
  const forceExit = (code: number): never => {
    try {
      forceKillAllCommands();
    } catch {
      // best-effort
    }
    try {
      // Catches detached process groups even if in-memory state is gone.
      Effect.runSync(forceKillAllTrackedProcessGroupsEffect);
    } catch {
      // best-effort
    }
    try {
      releaseLock();
    } catch {
      // best-effort
    }
    process.exit(code);
  };

  /** Await a promise but never wait longer than `ms`; swallows rejections. */
  const withTimeout = async (p: Promise<unknown>, ms: number): Promise<void> => {
    await Promise.race([
      Promise.resolve(p).catch(() => {}),
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        t.unref?.();
      }),
    ]);
  };

  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[${formatTimestamp()}] Shutting down... (press Ctrl+C again to force)`);

    // Hard deadline: regardless of what hangs below, the daemon WILL exit.
    const watchdog = setTimeout(() => {
      console.error(`[${formatTimestamp()}] Shutdown timed out — forcing exit.`);
      forceExit(1);
    }, SHUTDOWN_WATCHDOG_MS);
    watchdog.unref?.();

    // Stop heartbeat timers
    clearInterval(heartbeatTimer);

    // Stop git request subscription
    if (gitSubscriptionHandle) gitSubscriptionHandle.stop();

    // Stop file tree subscription
    if (fileContentSubscriptionHandle) fileContentSubscriptionHandle.stop();
    if (fileTreeSubscriptionHandle) fileTreeSubscriptionHandle.stop();
    if (workspaceListSubscriptionHandle) workspaceListSubscriptionHandle.stop();
    if (observedSyncSubscriptionHandle) observedSyncSubscriptionHandle.stop();
    if (logObserverSubscriptionHandle) logObserverSubscriptionHandle.stop();
    if (pendingPromptSubscriptionHandle) pendingPromptSubscriptionHandle.stop();
    if (pendingHarnessSessionSubscriptionHandle) pendingHarnessSessionSubscriptionHandle.stop();
    if (commandSubscriptionHandle) commandSubscriptionHandle.stop();
    if (lifecycleManager) lifecycleManager.stopMonitoring();

    // Kill child processes FIRST (commands + agents). These hold ports and are
    // the things users actually need dead. A slow/hung direct-harness close
    // must never come before — or block — reaping them.
    await withTimeout(onDaemonShutdown(ctx), PROCESS_KILL_TIMEOUT_MS);

    // Then close all active direct-harness sessions, each guarded by a timeout.
    for (const handle of activeSessions.values()) {
      await withTimeout(handle.close(), CLOSE_TIMEOUT_MS);
    }
    // Kill all running harness processes, each guarded by a timeout.
    for (const harness of harnesses.values()) {
      await withTimeout(harness.close(), CLOSE_TIMEOUT_MS);
    }

    clearTimeout(watchdog);
    releaseLock();
    process.exit(0);
  };

  /**
   * Signal handler. Registering a SIGINT listener disables Node's default
   * Ctrl+C termination, so we must own the escalation ourselves: the first
   * signal starts a graceful shutdown; a second signal forces an immediate
   * SIGKILL of all children and exits. If the graceful path itself throws, we
   * also force-exit so the daemon never lingers.
   */
  const handleSignal = (signal: NodeJS.Signals) => {
    signalCount += 1;
    if (signalCount >= 2) {
      console.error(`\n[${formatTimestamp()}] Received ${signal} again — forcing immediate exit.`);
      forceExit(1);
      return;
    }
    shutdown().catch((err) => {
      console.error(`[${formatTimestamp()}] Shutdown failed: ${getErrorMessage(err)}`);
      forceExit(1);
    });
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGHUP', () => handleSignal('SIGHUP'));

  // Open WebSocket connection for event stream subscription
  const wsClient = await getConvexWsClient();

  // ── Git Request Subscription ──────────────────────────────────────────
  // Now that wsClient is ready, start the reactive git request subscription.
  gitSubscriptionHandle = await Effect.runPromise(
    startGitRequestSubscriptionEffect(wsClient).pipe(Effect.provide(daemonContextToLayers(ctx)))
  );

  // ── File Content Subscription ──────────────────────────────────────
  // Now that wsClient is ready, start the reactive file content subscription.
  fileContentSubscriptionHandle = await Effect.runPromise(
    startFileContentSubscriptionEffect(wsClient).pipe(Effect.provide(daemonContextToLayers(ctx)))
  );

  // Now that wsClient is ready, start the reactive file tree subscription.
  fileTreeSubscriptionHandle = await Effect.runPromise(
    startFileTreeSubscriptionEffect(wsClient).pipe(Effect.provide(daemonContextToLayers(ctx)))
  );

  workspaceListSubscriptionHandle = startWorkspaceListSubscription(ctx, wsClient);

  // ── Observed Sync Subscription ─────────────────────────────────────────
  // When observedSyncEnabled is true, start the event-driven observed-sync subscription
  // to push state only for chatrooms the frontend is actively watching.
  if (ctx.observedSyncEnabled) {
    observedSyncSubscriptionHandle = startObservedSyncSubscription(ctx, wsClient);
  }

  logObserverSubscriptionHandle = startLogObserverSubscription(ctx, wsClient);

  // ── V2 Direct-Harness Subscriptions ──────────────────────────────────
  if (featureFlags.directHarnessWorkers) {
    const sessionRepository = new ConvexSessionRepository({
      backend: ctx.deps.backend,
      sessionId: ctx.sessionId,
    });
    const outputRepository = new ConvexOutputRepository({
      backend: ctx.deps.backend,
      sessionId: ctx.sessionId,
    });
    const journalFactory = new BufferedJournalFactory({
      outputRepository,
    });

    const sharedDeps = {
      activeSessions,
      harnesses,
      sessionRepository,
      journalFactory,
    };

    pendingPromptSubscriptionHandle = startMessageSubscriber(ctx, wsClient, sharedDeps);
    pendingHarnessSessionSubscriptionHandle = startSessionSubscriber(ctx, wsClient, {
      activeSessions,
      harnesses,
      sessionRepository,
      journalFactory,
    });

    lifecycleManager = new HarnessLifecycleManager(harnesses, activeSessions, async (workspaceId) =>
      ctx.deps.backend.query(api.workspaces.getWorkspaceById, {
        sessionId: ctx.sessionId,
        workspaceId,
      })
    );
    lifecycleManager.startMonitoring();

    commandSubscriptionHandle = startCommandSubscriber(ctx, wsClient, {
      lifecycleManager,
      publisher: new ConvexCapabilitiesPublisher({
        backend: ctx.deps.backend,
        sessionId: ctx.sessionId,
      }),
    });
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
    capabilitiesRefreshIds: new Map<string, number>(), // daemon.refreshCapabilities
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

  // Keep process alive
  return await new Promise(() => {});
}

// ── Effect twins ──────────────────────────────────────────────────────────────

/** Effect twin for refreshModels — yields DaemonSessionService; DaemonSessionServiceShape satisfies both RefreshModelsDeps and RefreshModelsStateHolder. */
// fallow-ignore-next-line unused-export
export const refreshModelsEffect: Effect.Effect<RefreshModelsOutcome, never, DaemonSessionService> =
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    return yield* Effect.promise(() => refreshModelsCore(session, session));
  });

/** Effect twin for dispatchCommandEvent — yields DaemonContextService and delegates. */
// fallow-ignore-next-line unused-export
export const dispatchCommandEventEffect = (
  event: Parameters<typeof dispatchCommandEvent>[1],
  tracker: Parameters<typeof dispatchCommandEvent>[2]
): Effect.Effect<void, never, DaemonContextService> =>
  Effect.gen(function* () {
    const ctx = yield* DaemonContextService;
    yield* Effect.promise(() => dispatchCommandEvent(ctx, event, tracker));
  });

/** Effect twin for startCommandLoop — yields DaemonContextService and delegates. */
// fallow-ignore-next-line unused-export
export const startCommandLoopEffect: Effect.Effect<never, never, DaemonContextService> = Effect.gen(
  function* () {
    const ctx = yield* DaemonContextService;
    return yield* Effect.promise<never>(() => startCommandLoop(ctx));
  }
);
