/**
 * Command Loop — subscribes to Convex for pending commands, processes them sequentially.
 */

import { featureFlags } from '@workspace/backend/config/featureFlags.js';
import {
  AGENT_REQUEST_DEADLINE_MS,
  DAEMON_HEARTBEAT_INTERVAL_MS,
} from '@workspace/backend/config/reliability.js';
import type { FunctionReturnType } from 'convex/server';
import { Effect, Ref, Runtime } from 'effect';

import type { HarnessLifecycleManager } from './direct-harness/harness-lifecycle-manager.js';
import { api } from '../../../api.js';
import type { BoundHarness } from '../../../domain/direct-harness/entities/bound-harness.js';
import type { SessionHandle } from '../../../domain/direct-harness/usecases/open-session.js';
import { onRequestStartAgentEffect } from '../../../events/daemon/agent/on-request-start-agent.js';
import { onRequestStopAgentEffect } from '../../../events/daemon/agent/on-request-stop-agent.js';
import { onDaemonShutdownEffect } from '../../../events/lifecycle/on-daemon-shutdown.js';
import { getConvexWsClient } from '../../../infrastructure/convex/client.js';
import { makeGitStateKey } from '../../../infrastructure/git/types.js';
import { executeLocalAction } from '../../../infrastructure/local-actions/index.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import { releaseLock } from '../pid.js';
import { pushCommandsEffect } from './command-sync-heartbeat.js';
import { syncCommitDetailsEffect } from './commit-detail-sync.js';
import {
  DaemonMutableStateService,
  DaemonSessionService,
  type DaemonAgentProcessManagerService,
} from './daemon-services.js';
import { startDirectHarnessSubscriptions } from './direct-harness/start-subscriptions.js';
import {
  startFileContentSubscriptionEffect,
  type FileContentSubscriptionHandle,
} from './file-content-subscription.js';
import {
  startFileTreeSubscriptionEffect,
  type FileTreeSubscriptionHandle,
} from './file-tree-subscription.js';
import { pushGitStateEffect, pushSingleWorkspaceGitStateEffect } from './git-heartbeat.js';
import {
  startGitRequestSubscriptionEffect,
  type GitSubscriptionHandle,
} from './git-subscription.js';
import {
  forceKillAllCommands,
  onCommandRunEffect,
  onCommandStopEffect,
} from './handlers/command-runner.js';
import { forceKillAllTrackedProcessGroupsEffect } from './handlers/orphan-tracker.js';
import { handlePing } from './handlers/ping.js';
import { startLogObserverSubscription } from './handlers/process/log-observer-sync.js';
import { processManager } from './handlers/process/manager.js';
import { refreshModelsEffect, type RefreshModelsOutcome } from './models-refresh.js';
import { startObservedSyncSubscriptionEffect } from './observed-sync.js';
import { formatTimestamp } from './utils.js';
import { startWorkspaceListSubscriptionEffect } from './workspace-list-subscription.js';

// ─── Derived Types ──────────────────────────────────────────────────────────

/** The inferred return type of the getCommandEvents Convex query. */
type CommandEventsResult = FunctionReturnType<typeof api.machines.getCommandEvents>;

/** A single event from the command event stream. */
type CommandEvent = CommandEventsResult['events'][number];

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
function evictStaleEntries(entries: Map<string, number>, evictBefore: number): void {
  for (const [id, ts] of entries) {
    if (ts < evictBefore) entries.delete(id);
  }
}

function evictStaleDedupEntries(tracker: DedupTracker): void {
  const evictBefore = Date.now() - AGENT_REQUEST_DEADLINE_MS;
  evictStaleEntries(tracker.commandIds, evictBefore);
  evictStaleEntries(tracker.pingIds, evictBefore);
  evictStaleEntries(tracker.gitRefreshIds, evictBefore);
  evictStaleEntries(tracker.capabilitiesRefreshIds, evictBefore);
  evictStaleEntries(tracker.localActionIds, evictBefore);
  evictStaleEntries(tracker.commandRunIds, evictBefore);
  evictStaleEntries(tracker.commandStopIds, evictBefore);

  // Evict stale pending stops from command-runner (stop-before-run race handling)
  processManager.evictStalePendingStops();
}

// ── Effect twins ──────────────────────────────────────────────────────────────

/** Union of services required to dispatch any command event. */
type CommandDispatchDeps =
  | DaemonAgentProcessManagerService
  | DaemonMutableStateService
  | DaemonSessionService;

// ── Per-event Effect helpers (private) ────────────────────────────────────────

function handleRequestStartEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, CommandDispatchDeps> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.commandIds.has(eventId)) return;
    yield* onRequestStartAgentEffect(event as Parameters<typeof onRequestStartAgentEffect>[0]);
    tracker.commandIds.set(eventId, Date.now());
  });
}

function handleRequestStopEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, DaemonAgentProcessManagerService> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.commandIds.has(eventId)) return;
    yield* onRequestStopAgentEffect(event as Parameters<typeof onRequestStopAgentEffect>[0]);
    tracker.commandIds.set(eventId, Date.now());
  });
}

function handlePingCommandEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, DaemonSessionService> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.pingIds.has(eventId)) return;
    handlePing();
    const session = yield* DaemonSessionService;
    yield* Effect.promise(() =>
      session.backend.mutation(api.machines.ackPing, {
        sessionId: session.sessionId,
        machineId: session.machineId,
        pingEventId: event._id,
      })
    );
    tracker.pingIds.set(eventId, Date.now());
  });
}

function handleGitRefreshCommandEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, CommandDispatchDeps> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.gitRefreshIds.has(eventId)) return;
    const session = yield* DaemonSessionService;
    const typedEvent = event as Extract<CommandEvent, { type: 'daemon.gitRefresh' }>;
    const mutable = yield* DaemonMutableStateService;
    const lastPushedGitState = yield* Ref.get(mutable.lastPushedGitState);
    lastPushedGitState.delete(makeGitStateKey(session.machineId, typedEvent.workingDir));
    console.log(`[${formatTimestamp()}] 🔄 Git refresh requested for ${typedEvent.workingDir}`);
    yield* pushGitStateEffect;
    tracker.gitRefreshIds.set(eventId, Date.now());
  });
}

/** Git action types that should trigger a workspace git-state push after completion. */
const GIT_PUSH_ACTIONS = new Set(['git-pull', 'git-push', 'git-sync', 'git-discard-all']);

function handleLocalActionCommandEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, CommandDispatchDeps> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.localActionIds.has(eventId)) return;
    const typedEvent = event as Extract<CommandEvent, { type: 'daemon.localAction' }>;
    console.log(
      `[${formatTimestamp()}] 🖥️  Local action: ${typedEvent.action} → ${typedEvent.workingDir}`
    );
    const result = yield* Effect.promise(() =>
      executeLocalAction(typedEvent.action, typedEvent.workingDir)
    );
    if (!result.success) {
      console.warn(`[${formatTimestamp()}] ⚠️  Local action failed: ${result.error}`);
    } else if (GIT_PUSH_ACTIONS.has(typedEvent.action)) {
      const session = yield* DaemonSessionService;
      const mutable = yield* DaemonMutableStateService;
      const lastPushedGitState = yield* Ref.get(mutable.lastPushedGitState);
      lastPushedGitState.delete(makeGitStateKey(session.machineId, typedEvent.workingDir));
      yield* pushSingleWorkspaceGitStateEffect(typedEvent.workingDir);
    }
    tracker.localActionIds.set(eventId, Date.now());
  });
}

function handleCommandRunEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, DaemonSessionService> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    // command.run: register dedup BEFORE handler (spawning a process is NOT idempotent)
    if (tracker.commandRunIds.has(eventId)) return;
    tracker.commandRunIds.set(eventId, Date.now());
    yield* onCommandRunEffect(event as unknown as Parameters<typeof onCommandRunEffect>[0]);
  });
}

function handleCommandStopEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, DaemonSessionService> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.commandStopIds.has(eventId)) return;
    yield* onCommandStopEffect(event as unknown as Parameters<typeof onCommandStopEffect>[0]);
    tracker.commandStopIds.set(eventId, Date.now());
  });
}

/** Map a RefreshModelsOutcome to the status/errorMessage for reportCapabilitiesRefreshResult. */
function capabilitiesOutcomeToStatus(outcome: RefreshModelsOutcome): {
  status: 'completed' | 'skipped_no_changes' | 'failed';
  errorMessage?: string;
} {
  if (outcome.kind === 'pushed') return { status: 'completed' };
  if (outcome.kind === 'skipped_no_changes') return { status: 'skipped_no_changes' };
  if (outcome.kind === 'failed') return { status: 'failed', errorMessage: outcome.message };
  return { status: 'failed', errorMessage: 'Daemon configuration unavailable' };
}

function handleRefreshCapabilitiesEffect(
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, DaemonSessionService | DaemonMutableStateService> {
  return Effect.gen(function* () {
    const eventId = event._id.toString();
    if (tracker.capabilitiesRefreshIds.has(eventId)) return;
    console.log(`[${formatTimestamp()}] 🔄 Manual capabilities refresh requested`);
    const outcome = yield* refreshModelsEffect;
    tracker.capabilitiesRefreshIds.set(eventId, Date.now());
    const batchId = 'batchId' in event ? (event as any).batchId : undefined;
    if (!batchId) return;
    const session = yield* DaemonSessionService;
    const { status, errorMessage } = capabilitiesOutcomeToStatus(outcome);
    yield* Effect.tryPromise({
      try: () =>
        session.backend.mutation(api.machines.reportCapabilitiesRefreshResult, {
          sessionId: session.sessionId,
          batchId,
          machineId: session.machineId,
          status,
          errorMessage,
        }),
      catch: (error) => error,
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.warn(
            `[${formatTimestamp()}] ⚠️  Capabilities refresh report failed: ${getErrorMessage(error)}`
          );
        })
      )
    );
  });
}

/** Dispatch table: event type string → per-event Effect handler factory. */
const commandEventHandlers: Partial<
  Record<
    string,
    (event: CommandEvent, tracker: DedupTracker) => Effect.Effect<void, never, CommandDispatchDeps>
  >
> = {
  'agent.requestStart': handleRequestStartEffect,
  'agent.requestStop': handleRequestStopEffect,
  'daemon.ping': handlePingCommandEffect,
  'daemon.gitRefresh': handleGitRefreshCommandEffect,
  'daemon.localAction': handleLocalActionCommandEffect,
  'command.run': handleCommandRunEffect,
  'command.stop': handleCommandStopEffect,
  'daemon.refreshCapabilities': handleRefreshCapabilitiesEffect,
};

/**
 * Effect twin for dispatchCommandEvent — uses DaemonSessionService + DaemonAgentProcessManagerService.
 * No bridge service dependency. (Removed in W8-1)
 */
// fallow-ignore-next-line unused-export
export const dispatchCommandEventEffect = (
  event: CommandEvent,
  tracker: DedupTracker
): Effect.Effect<void, never, CommandDispatchDeps> => {
  const factory = commandEventHandlers[event.type as string];
  return factory != null ? factory(event, tracker) : Effect.void;
};

/** Effect twin for startCommandLoop — uses granular services. */
export const startCommandLoopEffect: Effect.Effect<
  never,
  never,
  DaemonSessionService | DaemonAgentProcessManagerService | DaemonMutableStateService
> = Effect.gen(function* () {
  const session = yield* DaemonSessionService;
  const effectContext = yield* Effect.context<
    DaemonSessionService | DaemonAgentProcessManagerService | DaemonMutableStateService
  >();
  const runtime = yield* Effect.runtime<
    DaemonSessionService | DaemonAgentProcessManagerService | DaemonMutableStateService
  >();

  const observedSyncEnabled = featureFlags.observedSyncEnabled ?? false;

  // ── Daemon Heartbeat ──────────────────────────────────────────────────
  let heartbeatCount = 0;
  const heartbeatTimer = setInterval(() => {
    session.backend
      .mutation(api.machines.daemonHeartbeat, {
        sessionId: session.sessionId,
        machineId: session.machineId,
      })
      .then(() => {
        heartbeatCount++;
        console.log(`[${formatTimestamp()}] 💓 Daemon heartbeat #${heartbeatCount} OK`);
        if (!observedSyncEnabled) {
          Runtime.runFork(runtime)(
            Effect.all([pushGitStateEffect, pushCommandsEffect, syncCommitDetailsEffect()], {
              concurrency: 'unbounded',
            }).pipe(
              Effect.provide(effectContext),
              Effect.catchAll((err) =>
                Effect.sync(() =>
                  console.warn(
                    `[${formatTimestamp()}] ⚠️  Heartbeat sync failed: ${getErrorMessage(err)}`
                  )
                )
              )
            )
          );
        }
      })
      .catch((err: unknown) => {
        console.warn(`[${formatTimestamp()}] ⚠️  Daemon heartbeat failed: ${getErrorMessage(err)}`);
      });
  }, DAEMON_HEARTBEAT_INTERVAL_MS);

  heartbeatTimer.unref();

  // ── Subscription handles ──────────────────────────────────────────────
  let gitSubscriptionHandle: GitSubscriptionHandle | null = null;
  let fileContentSubscriptionHandle: FileContentSubscriptionHandle | null = null;
  let fileTreeSubscriptionHandle: FileTreeSubscriptionHandle | null = null;
  let workspaceListSubscriptionHandle: { stop: () => void } | null = null;
  let observedSyncSubscriptionHandle: { stop: () => void } | null = null;
  let logObserverSubscriptionHandle: ReturnType<typeof startLogObserverSubscription> | null = null;
  let pendingPromptSubscriptionHandle: { stop: () => void } | null = null;
  let pendingHarnessSessionSubscriptionHandle: { stop: () => void } | null = null;
  let commandSubscriptionHandle: { stop: () => void } | null = null;
  let lifecycleManager: HarnessLifecycleManager | null = null;
  const activeSessions = new Map<string, SessionHandle>();
  const harnesses = new Map<string, BoundHarness>();

  // Trigger an immediate push on startup
  if (observedSyncEnabled) {
    console.log(`[${formatTimestamp()}] 👁️ Observed-sync enabled, skipping immediate push`);
  } else {
    Runtime.runFork(runtime)(
      Effect.all([pushGitStateEffect, pushCommandsEffect, syncCommitDetailsEffect()], {
        concurrency: 'unbounded',
      }).pipe(
        Effect.provide(effectContext),
        Effect.catchAll((err) =>
          Effect.sync(() =>
            console.warn(`[${formatTimestamp()}] ⚠️ Startup sync failed: ${getErrorMessage(err)}`)
          )
        )
      )
    );
  }

  // ── Shutdown timeouts ──────────────────────────────────────────────────
  const PROCESS_KILL_TIMEOUT_MS = 6_000;
  const CLOSE_TIMEOUT_MS = 3_000;
  const SHUTDOWN_WATCHDOG_MS = 12_000;

  let signalCount = 0;
  let isShuttingDown = false;

  const forceExit = (code: number): never => {
    try {
      forceKillAllCommands();
    } catch {
      // best-effort
    }
    try {
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
    console.log(`\n[${formatTimestamp()}] Shutting down... (press Ctrl+B again to force)`);

    const watchdog = setupShutdownWatchdog();
    clearInterval(heartbeatTimer);
    stopSubscriptions();
    await runDaemonShutdownEffect();
    await closeAllSessionsAndHarnesses();
    clearTimeout(watchdog);
    releaseLock();
    process.exit(0);
  };

  const setupShutdownWatchdog = (): ReturnType<typeof setTimeout> => {
    const watchdog = setTimeout(() => {
      console.error(`[${formatTimestamp()}] Shutdown timed out — forcing exit.`);
      forceExit(1);
    }, SHUTDOWN_WATCHDOG_MS);
    watchdog.unref?.();
    return watchdog;
  };

  const stopSubscriptions = (): void => {
    gitSubscriptionHandle?.stop();
    fileContentSubscriptionHandle?.stop();
    fileTreeSubscriptionHandle?.stop();
    workspaceListSubscriptionHandle?.stop();
    observedSyncSubscriptionHandle?.stop();
    logObserverSubscriptionHandle?.stop();
    pendingPromptSubscriptionHandle?.stop();
    pendingHarnessSessionSubscriptionHandle?.stop();
    commandSubscriptionHandle?.stop();
    lifecycleManager?.stopMonitoring();
  };

  const runDaemonShutdownEffect = async (): Promise<void> => {
    await withTimeout(
      Effect.runPromise(onDaemonShutdownEffect.pipe(Effect.provide(effectContext))),
      PROCESS_KILL_TIMEOUT_MS
    );
  };

  const closeAllSessionsAndHarnesses = async (): Promise<void> => {
    for (const handle of activeSessions.values()) {
      await withTimeout(handle.close(), CLOSE_TIMEOUT_MS);
    }
    for (const harness of harnesses.values()) {
      await withTimeout(harness.close(), CLOSE_TIMEOUT_MS);
    }
  };

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

  const wsClient = yield* Effect.promise(() => getConvexWsClient());

  gitSubscriptionHandle = yield* startGitRequestSubscriptionEffect(wsClient);
  fileContentSubscriptionHandle = yield* startFileContentSubscriptionEffect(wsClient);
  fileTreeSubscriptionHandle = yield* startFileTreeSubscriptionEffect(wsClient);
  workspaceListSubscriptionHandle = yield* startWorkspaceListSubscriptionEffect(wsClient);

  if (observedSyncEnabled) {
    observedSyncSubscriptionHandle = yield* startObservedSyncSubscriptionEffect(wsClient);
  }

  logObserverSubscriptionHandle = startLogObserverSubscription(
    { sessionId: session.sessionId, machineId: session.machineId },
    wsClient
  );

  if (featureFlags.directHarnessWorkers) {
    const handles = startDirectHarnessSubscriptions(
      { sessionId: session.sessionId, machineId: session.machineId, backend: session.backend },
      wsClient,
      activeSessions,
      harnesses
    );
    pendingPromptSubscriptionHandle = handles.pendingPromptSubscriptionHandle;
    pendingHarnessSessionSubscriptionHandle = handles.pendingHarnessSessionSubscriptionHandle;
    commandSubscriptionHandle = handles.commandSubscriptionHandle;
    lifecycleManager = handles.lifecycleManager;
  }

  console.log(`\nListening for commands...`);
  console.log(`Press Ctrl+C to stop\n`);

  const dedupTracker: DedupTracker = {
    commandIds: new Map<string, number>(),
    pingIds: new Map<string, number>(),
    gitRefreshIds: new Map<string, number>(),
    capabilitiesRefreshIds: new Map<string, number>(),
    localActionIds: new Map<string, number>(),
    commandRunIds: new Map<string, number>(),
    commandStopIds: new Map<string, number>(),
  };

  wsClient.onUpdate(
    api.machines.getCommandEvents,
    {
      sessionId: session.sessionId,
      machineId: session.machineId,
    },
    async (result) => {
      if (!result.events || result.events.length === 0) return;

      evictStaleDedupEntries(dedupTracker);

      for (const event of result.events) {
        try {
          console.log(
            `[${formatTimestamp()}] 📡 Stream command event: ${event.type} (id: ${event._id})`
          );
          await Effect.runPromise(
            dispatchCommandEventEffect(event, dedupTracker).pipe(Effect.provide(effectContext))
          );
        } catch (err) {
          console.error(
            `[${formatTimestamp()}] ❌ Stream command event failed: ${getErrorMessage(err)}`
          );
        }
      }
    }
  );

  return yield* Effect.promise<never>(() => new Promise(() => {}));
});
