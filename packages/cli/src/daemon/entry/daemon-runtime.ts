/**
 * v2 daemon runtime — heartbeat, worker init, inbound registry handlers, shutdown.
 * Replaces legacy startCommandLoopEffect (G6).
 */

import { featureFlags } from '@workspace/backend/config/featureFlags.js';
import { DAEMON_HEARTBEAT_INTERVAL_MS } from '@workspace/backend/config/reliability.js';
import type { ConvexClient } from 'convex/browser';
import { Effect, type Layer } from 'effect';

import { startAgenticQuerySubscriptions } from './agentic-query/start-subscriptions.js';
import {
  createDedupTracker,
  evictStaleDedupEntries,
  handleInboundCommandEvent,
} from './command-dispatch.js';
import {
  registerCommandInboundHandler,
  unregisterCommandInboundHandler,
} from './command-inbound-registry.js';
import {
  DaemonSessionService,
  type DaemonAgentProcessManagerService,
  type DaemonMutableStateService,
} from './daemon-services.js';
import { formatTimestamp } from './daemon-utils.js';
import { startDirectHarnessSubscriptions } from './direct-harness/start-subscriptions.js';
import { startEnhancerSubscriptions } from './enhancer/start-subscriptions.js';
import {
  registerFileInboundHandler,
  unregisterFileInboundHandler,
} from './file-inbound-registry.js';
import { drainPendingFileContentRequests } from './files/file-content-subscription.js';
import {
  startFileTreeSubscriptionEffect,
  type FileTreeSubscriptionHandle,
} from './files/file-tree-subscription.js';
import { drainPendingFileWriteRequests } from './files/file-write-subscription.js';
import { forceKillAllCommands } from './handlers/command-runner.js';
import { forceKillAllTrackedProcessGroupsEffect } from './handlers/orphan-tracker.js';
import { drainActionableCommandRuns } from './handlers/process/command-run-subscription.js';
import { startLogObserverSubscription } from './handlers/process/log-observer-sync.js';
import { getActiveLogSink } from './init-daemon.js';
import { startTaskInboxEffect } from './task-inbox-runtime.js';
import { drainGitStateSync } from './workspace-git/git-heartbeat.js';
import {
  startGitRequestSubscriptionEffect,
  type GitSubscriptionHandle,
} from './workspace-git/git-subscription.js';
import { api } from '../../api.js';
import {
  startWorkspaceListSubscriptionEffect,
  reconcileWorkspaceList,
} from './workspace-git/workspace-list-subscription.js';
import {
  registerWorkspaceGitInboundHandler,
  unregisterWorkspaceGitInboundHandler,
} from './workspace-git-inbound-registry.js';
import { releaseLock } from '../../commands/machine/pid.js';
import { onDaemonShutdownEffect } from '../../events/lifecycle/on-daemon-shutdown.js';
import { getErrorMessage } from '../../utils/convex-error.js';
import type { BoundHarness } from '../domain/entities/bound-harness.js';
import type { SessionHandle } from '../domain/usecase/open-harness-session.js';
import type { AgentLifecycleOutboxRegistry } from '../infrastructure/outbox/agent-lifecycle-outbox.js';

const PROCESS_KILL_TIMEOUT_MS = 6_000;
const CLOSE_TIMEOUT_MS = 3_000;
const SHUTDOWN_WATCHDOG_MS = 12_000;

export type DaemonRuntimeHandle = {
  run(): Promise<void>;
  shutdown(): Promise<void>;
};

export type DaemonRuntimeDeps = {
  agentLifecycleOutbox?: AgentLifecycleOutboxRegistry;
  wsClient: ConvexClient;
  layers: Layer.Layer<
    DaemonSessionService | DaemonAgentProcessManagerService | DaemonMutableStateService
  >;
};

export function createDaemonRuntime(deps: DaemonRuntimeDeps): DaemonRuntimeHandle {
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let gitSubscriptionHandle: GitSubscriptionHandle | null = null;
  let fileTreeSubscriptionHandle: FileTreeSubscriptionHandle | null = null;
  let workspaceListSubscriptionHandle: { stop: () => void } | null = null;
  let logObserverSubscriptionHandle: ReturnType<typeof startLogObserverSubscription> | null = null;
  let directHarnessWorkerHandle: ReturnType<typeof startDirectHarnessSubscriptions> | null = null;
  let agenticQueryWorkerHandle: ReturnType<typeof startAgenticQuerySubscriptions> | null = null;
  let enhancerWorkerHandle: { stop: () => void } | null = null;
  let taskInboxHandle: { stop: () => void } | null = null;
  const activeSessions = new Map<string, SessionHandle>();
  const harnesses = new Map<string, BoundHarness>();

  let signalCount = 0;
  let isShuttingDown = false;
  let runResolve: (() => void) | null = null;
  let shutdownWatchdog: ReturnType<typeof setTimeout> | null = null;

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

  const stopWorkers = (): void => {
    unregisterCommandInboundHandler();
    unregisterFileInboundHandler();
    unregisterWorkspaceGitInboundHandler();
    gitSubscriptionHandle?.stop();
    fileTreeSubscriptionHandle?.stop();
    workspaceListSubscriptionHandle?.stop();
    taskInboxHandle?.stop();
    logObserverSubscriptionHandle?.stop();
    directHarnessWorkerHandle?.stop();
    agenticQueryWorkerHandle?.stop();
    enhancerWorkerHandle?.stop();
  };

  // fallow-ignore-next-line complexity
  const shutdown = async (): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[${formatTimestamp()}] Shutting down... (press Ctrl+B again to force)`);

    shutdownWatchdog = setTimeout(() => {
      console.error(`[${formatTimestamp()}] Shutdown timed out — forcing exit.`);
      forceExit(1);
    }, SHUTDOWN_WATCHDOG_MS);
    shutdownWatchdog.unref?.();

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    stopWorkers();

    await withTimeout(
      Effect.runPromise(
        Effect.gen(function* () {
          const effectContext = yield* Effect.context<
            DaemonSessionService | DaemonAgentProcessManagerService | DaemonMutableStateService
          >();
          yield* onDaemonShutdownEffect.pipe(Effect.provide(effectContext));
        }).pipe(Effect.provide(deps.layers))
      ),
      PROCESS_KILL_TIMEOUT_MS
    );

    // Shutdown stops enqueue lifecycle facts; keep the outbox alive until that
    // effect has completed so confirmed exits are not silently discarded.
    await deps.agentLifecycleOutbox?.stopAll().catch(() => undefined);

    if (directHarnessWorkerHandle) {
      await withTimeout(
        directHarnessWorkerHandle.closeSessionsOnShutdown(),
        PROCESS_KILL_TIMEOUT_MS
      );
    } else {
      for (const handle of activeSessions.values()) {
        await withTimeout(handle.close(), CLOSE_TIMEOUT_MS);
      }
    }
    for (const harness of harnesses.values()) {
      await withTimeout(harness.close(), CLOSE_TIMEOUT_MS);
    }

    if (shutdownWatchdog) clearTimeout(shutdownWatchdog);
    releaseLock();
    runResolve?.();
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

  const startRuntimeEffect = Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const effectContext = yield* Effect.context<
      DaemonSessionService | DaemonAgentProcessManagerService | DaemonMutableStateService
    >();

    let heartbeatCount = 0;
    heartbeatTimer = setInterval(() => {
      session.backend
        .mutation(api.machines.daemonHeartbeat, {
          sessionId: session.sessionId,
          machineId: session.machineId,
        })
        .then(() => {
          heartbeatCount++;
          console.log(`[${formatTimestamp()}] 💓 Daemon heartbeat #${heartbeatCount} OK`);
        })
        .catch((err: unknown) => {
          console.warn(
            `[${formatTimestamp()}] ⚠️  Daemon heartbeat failed: ${getErrorMessage(err)}`
          );
        });
    }, DAEMON_HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref();

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));
    process.on('SIGHUP', () => handleSignal('SIGHUP'));

    gitSubscriptionHandle = yield* startGitRequestSubscriptionEffect();
    fileTreeSubscriptionHandle = yield* startFileTreeSubscriptionEffect();

    const gitHandle = gitSubscriptionHandle;
    const fileTreeHandle = fileTreeSubscriptionHandle;

    // fallow-ignore-next-line complexity
    registerFileInboundHandler(async (event) => {
      switch (event.type) {
        case 'file-tree.request':
          if (fileTreeHandle) await fileTreeHandle.drainPendingFileTreeRequests();
          break;
        case 'file-tree.release':
          if (fileTreeHandle) await fileTreeHandle.drainPendingFileTreeReleaseRequests();
          break;
        case 'file-content.request':
          await drainPendingFileContentRequests(session);
          break;
        case 'file-write.request':
          await drainPendingFileWriteRequests(session);
          break;
      }
    });

    workspaceListSubscriptionHandle = yield* startWorkspaceListSubscriptionEffect();

    registerWorkspaceGitInboundHandler(async (event) => {
      switch (event.type) {
        case 'workspace.list-changed':
          await reconcileWorkspaceList(session);
          await drainGitStateSync(effectContext);
          break;
        case 'git.request':
          if (gitHandle) await gitHandle.drainPendingGitRequests();
          break;
      }
    });

    taskInboxHandle = yield* startTaskInboxEffect(deps.wsClient);

    logObserverSubscriptionHandle = startLogObserverSubscription(
      { sessionId: session.sessionId, machineId: session.machineId },
      deps.wsClient
    );

    const commandRunRuntime = yield* Effect.runtime<DaemonSessionService>();

    if (featureFlags.directHarnessWorkers) {
      directHarnessWorkerHandle = startDirectHarnessSubscriptions(
        {
          sessionId: session.sessionId,
          machineId: session.machineId,
          backend: session.backend,
          convexUrl: session.convexUrl,
        },
        activeSessions,
        harnesses
      );

      agenticQueryWorkerHandle = startAgenticQuerySubscriptions(
        {
          sessionId: session.sessionId,
          machineId: session.machineId,
          backend: session.backend,
          convexUrl: session.convexUrl,
        },
        activeSessions,
        harnesses
      );

      enhancerWorkerHandle = startEnhancerSubscriptions(
        session.sessionId,
        session.machineId,
        session.convexUrl,
        deps.wsClient,
        session.backend,
        session.agentServices,
        getActiveLogSink()
      );
    }

    console.log(`\nListening for commands...`);
    console.log(`Press Ctrl+C to stop\n`);

    const dedupTracker = createDedupTracker();

    registerCommandInboundHandler(async (event) => {
      evictStaleDedupEntries(dedupTracker);
      if (event.type === 'command.received') {
        await handleInboundCommandEvent(
          event.commandId,
          dedupTracker,
          effectContext,
          session,
          event.claimedCommand
        );
      } else {
        await drainActionableCommandRuns(session, commandRunRuntime);
      }
    });
  });

  return {
    async run(): Promise<void> {
      await Effect.runPromise(
        startRuntimeEffect.pipe(Effect.provide(deps.layers)) as Effect.Effect<void, never, never>
      );
      await new Promise<void>((resolve) => {
        runResolve = resolve;
      });
    },
    shutdown,
  };
}
