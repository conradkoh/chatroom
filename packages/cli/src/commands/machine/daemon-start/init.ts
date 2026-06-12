/**
 * Daemon Initialization — validates auth, connects to Convex, recovers state.
 */

import { stat } from 'node:fs/promises';

import type { ConvexHttpClient } from 'convex/browser';
import { Cause, Effect, Ref, Schedule, Duration } from 'effect';

import { harnessCapabilitiesFingerprint } from './capabilities-snapshot.js';
import { daemonSessionToLayers } from './daemon-layers.js';
import type { DaemonDeps } from './deps.js';
import {
  clearStaleSpawnedPidsEffect,
  reapOrphanCommandRunsEffect,
} from './handlers/daemon-restart-cleanup.js';
import { recoverAgentStateEffect } from './handlers/state-recovery.js';
import type { DaemonSessionInit, SessionId } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { DaemonEventBus } from '../../../events/daemon/event-bus.js';
import { registerEventListenersEffect } from '../../../events/daemon/register-listeners.js';
import { getSessionId, getOtherSessionUrls } from '../../../infrastructure/auth/storage.js';
import { getConvexUrl, getConvexClient } from '../../../infrastructure/convex/client.js';
import { CrashLoopTracker } from '../../../infrastructure/machine/crash-loop-tracker.js';
import {
  clearAgentPid,
  ensureMachineRegistered,
  listAgentEntries,
  loadMachineConfig,
  persistAgentPid,
  persistEventCursor,
  loadEventCursor,
} from '../../../infrastructure/machine/index.js';
import type { MachineConfig } from '../../../infrastructure/machine/types.js';
import { AgentProcessManager } from '../../../infrastructure/services/agent-process-manager/agent-process-manager.js';
import {
  SpawnRateLimiter,
  HarnessSpawningService,
} from '../../../infrastructure/services/harness-spawning/index.js';
import {
  initHarnessRegistry,
  getAllHarnesses,
} from '../../../infrastructure/services/remote-agents/index.js';
import type { RemoteAgentService } from '../../../infrastructure/services/remote-agents/remote-agent-service.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import { isNetworkError, formatConnectivityError } from '../../../utils/error-formatting.js';
import { acquireLock, releaseLock } from '../pid.js';
import { logStartupEffect } from './handlers/daemon-startup-log.js';
import { reapOrphanedProcessGroupsEffect } from './handlers/orphan-tracker.js';
import { cleanOrphanTempFiles } from './handlers/process/output-store.js';

// ─── Private Helpers ────────────────────────────────────────────────────────

// ─── Model Discovery ────────────────────────────────────────────────────────

/**
 * Discover available models from all installed remote agent services.
 * Non-critical: returns empty record on failure per harness.
 */
const discoverModelsEffect = (
  agentServices: Map<string, RemoteAgentService>
): Effect.Effect<Record<string, string[]>, never, never> =>
  Effect.gen(function* () {
    const discoverOne = ([harness, service]: [string, RemoteAgentService]) =>
      Effect.promise(() => service.isInstalled()).pipe(
        Effect.flatMap((installed) => {
          if (!installed) {
            return Effect.succeed(undefined);
          }

          return Effect.tryPromise({
            try: () => service.listModels(),
            catch: (reason) => reason,
          }).pipe(
            Effect.map((models) => ({ harness, models })),
            Effect.catchAll((reason) => {
              console.warn(
                JSON.stringify({
                  event: 'discover-models-error',
                  harness,
                  reason: getErrorMessage(reason),
                })
              );
              return Effect.succeed({ harness, models: [] as string[] });
            })
          );
        })
      );

    const results = yield* Effect.forEach(Array.from(agentServices.entries()), discoverOne, {
      concurrency: 'unbounded',
    });

    const discovered: Record<string, string[]> = {};
    for (const result of results) {
      if (result) {
        discovered[result.harness] = result.models;
      }
    }
    return discovered;
  });

/** Thin wrapper — tests and models-refresh.ts still import this. */
export async function discoverModels(
  agentServices: Map<string, RemoteAgentService>
): Promise<Record<string, string[]>> {
  return Effect.runPromise(discoverModelsEffect(agentServices));
}

// ─── Default Dependencies ───────────────────────────────────────────────────

/**
 * Create production dependency implementations wiring to real infrastructure.
 * This factory uses the module-level imports already available in this file.
 */
function createDefaultDeps(): DaemonDeps {
  return {
    backend: {
      // Placeholder — initDaemon() binds the real client after connecting.
      mutation: async () => {
        throw new Error('Backend not initialized');
      },
      query: async () => {
        throw new Error('Backend not initialized');
      },
    },
    processes: {
      kill: (pid, signal) => process.kill(pid, signal),
    },
    fs: {
      stat,
    },
    machine: {
      clearAgentPid,
      persistAgentPid,
      listAgentEntries,
      persistEventCursor,
      loadEventCursor,
    },
    clock: {
      now: () => Date.now(),
      delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
    spawning: new HarnessSpawningService({ rateLimiter: new SpawnRateLimiter() }),
    // Placeholder — initDaemon() creates the real instance after context is assembled.
    agentProcessManager: null as unknown as AgentProcessManager,
  };
}

/** How often (ms) to poll for auth file changes when waiting for login. */
const AUTH_POLL_INTERVAL_MS = 2000;
/** Maximum time (ms) to wait for authentication before giving up. */
const AUTH_WAIT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const waitForAuthenticationEffect = (_convexUrl: string): Effect.Effect<string, unknown, never> =>
  Effect.gen(function* () {
    const startTime = Date.now();
    while (Date.now() - startTime < AUTH_WAIT_TIMEOUT_MS) {
      yield* Effect.sleep(Duration.millis(AUTH_POLL_INTERVAL_MS));
      const sessionId = yield* Effect.tryPromise({
        try: () => getSessionId(),
        catch: (e) => e,
      });
      if (sessionId) {
        console.log(`\n✅ Authentication detected. Resuming daemon initialization...`);
        return sessionId;
      }
    }
    return yield* Effect.sync(() => {
      console.error(`\n❌ Authentication timeout (5 minutes). Exiting.`);
      releaseLock();
      process.exit(1);
    });
  });

const validateAuthenticationEffect = (convexUrl: string): Effect.Effect<string, unknown, never> =>
  Effect.gen(function* () {
    const sessionId = yield* Effect.tryPromise({
      try: () => getSessionId(),
      catch: (e) => e,
    });
    if (sessionId) {
      return sessionId;
    }

    const otherUrls = yield* Effect.tryPromise({
      try: () => getOtherSessionUrls(),
      catch: (e) => e,
    });
    console.error(`❌ Not authenticated for: ${convexUrl}`);

    if (otherUrls.length > 0) {
      console.error(`\n💡 You have sessions for other environments:`);
      for (const url of otherUrls) {
        console.error(`   • ${url}`);
      }
    }

    console.error(`\nRun: chatroom auth login`);
    console.log(`\n⏳ Waiting for authentication (timeout: 5 minutes)...`);
    return yield* waitForAuthenticationEffect(convexUrl);
  });

const validateSessionEffect = (
  client: ConvexHttpClient,
  sessionId: SessionId,
  convexUrl: string
): Effect.Effect<SessionId, unknown, never> =>
  Effect.gen(function* () {
    const validation = yield* Effect.tryPromise({
      try: () => client.query(api.cliAuth.validateSession, { sessionId }),
      catch: (e) => e,
    });

    if (validation.valid) {
      return sessionId;
    }

    console.error(`❌ Session invalid: ${validation.reason}`);
    console.error(`\nRun: chatroom auth login`);
    console.log(`\n⏳ Waiting for re-authentication (timeout: 5 minutes)...`);

    const newSessionId = yield* waitForAuthenticationEffect(convexUrl);
    const typedNewSession = newSessionId as SessionId;

    const revalidation = yield* Effect.tryPromise({
      try: () => client.query(api.cliAuth.validateSession, { sessionId: typedNewSession }),
      catch: (e) => e,
    });

    if (!revalidation.valid) {
      return yield* Effect.sync(() => {
        console.error(`❌ New session is also invalid: ${revalidation.reason}`);
        releaseLock();
        process.exit(1);
      });
    }

    return typedNewSession;
  });

const setupMachineEffect = (): Effect.Effect<MachineConfig, unknown, never> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => ensureMachineRegistered({ allowCreate: true }),
      catch: (e) => e,
    });

    const config = yield* Effect.tryPromise({
      try: () => loadMachineConfig(),
      catch: (e) => e,
    });

    if (!config) {
      return yield* Effect.die(
        new Error('Machine config missing after ensureMachineRegistered — this should not happen')
      );
    }

    return config;
  });

/** Register capabilities with the backend — non-critical, warns on failure. */
const registerCapabilitiesEffect = (
  client: ConvexHttpClient,
  sessionId: SessionId,
  config: MachineConfig,
  agentServices: Map<string, RemoteAgentService>
): Effect.Effect<Record<string, string[]>, never, never> =>
  Effect.gen(function* () {
    const { machineId } = config;

    const availableModels = yield* discoverModelsEffect(agentServices);

    yield* Effect.catchAll(
      Effect.tryPromise(() =>
        client.mutation(api.machines.register, {
          sessionId,
          machineId,
          hostname: config.hostname,
          os: config.os,
          availableHarnesses: config.availableHarnesses,
          harnessVersions: config.harnessVersions,
          availableModels,
        })
      ),
      (error) =>
        Effect.sync(() => {
          console.warn(`⚠️  Machine registration update failed: ${getErrorMessage(error)}`);
        })
    );

    return availableModels;
  });

/** Connect the daemon to the backend by updating daemon status. */
const connectDaemonEffect = (
  client: ConvexHttpClient,
  sessionId: SessionId,
  machineId: string
): Effect.Effect<void, unknown, never> =>
  Effect.tryPromise({
    try: () =>
      client.mutation(api.machines.updateDaemonStatus, {
        sessionId,
        machineId,
        connected: true,
      }),
    catch: (e) => e,
  }).pipe(
    Effect.catchAll((error) => {
      if (isNetworkError(error)) {
        // Do NOT log — connectOnce retry loop owns failure logging
        return Effect.fail(error);
      }
      return Effect.sync(() => {
        console.error(`❌ Failed to update daemon status: ${getErrorMessage(error)}`);
        releaseLock();
        process.exit(1);
      });
    })
  );

const recoverStateEffect = (init: DaemonSessionInit): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    console.log(`\n[${formatTimestamp()}] 🔄 Recovering agent state...`);

    yield* Effect.catchAllCause(
      recoverAgentStateEffect.pipe(Effect.provide(daemonSessionToLayers(init))),
      (cause) =>
        Effect.sync(() => {
          console.log(`   ⚠️  Recovery failed: ${getErrorMessage(Cause.squash(cause))}`);
          console.log(`   Continuing with fresh state`);
        })
    );

    yield* Effect.catchAllCause(
      Effect.gen(function* () {
        const clearedCount = yield* clearStaleSpawnedPidsEffect().pipe(
          Effect.provide(daemonSessionToLayers(init))
        );
        if (clearedCount > 0) {
          console.log(`   🧹 Cleared ${clearedCount} stale agent PID(s) from backend`);
        }
      }),
      (cause) =>
        Effect.sync(() => {
          console.log(`   ⚠️  Failed to clear stale PIDs: ${getErrorMessage(Cause.squash(cause))}`);
        })
    );

    yield* Effect.catchAllCause(
      Effect.gen(function* () {
        const reapedCount = yield* reapOrphanCommandRunsEffect().pipe(
          Effect.provide(daemonSessionToLayers(init))
        );
        if (reapedCount > 0) {
          console.log(
            `   🧹 Reaped ${reapedCount} command run(s) from previous daemon run (marked as daemon-restart)`
          );
        }
      }),
      (cause) =>
        Effect.sync(() => {
          console.warn(
            `   ⚠️  Failed to reap orphan command runs: ${getErrorMessage(Cause.squash(cause))}`
          );
        })
    );
  });

// ─── Constants ──────────────────────────────────────────────────────────────

/** Fixed interval (ms) between connection retry attempts when backend is unreachable. */
// fallow-ignore-next-line unused-export
export const CONNECTION_RETRY_INTERVAL_MS = 10_000;

// ─── Tagged error for network retries ───────────────────────────────────────

/**
 * Wraps a network error so Effect.retry can distinguish it from fatal errors.
 * Only instances of this type trigger the retry loop in initDaemon.
 */
class NetworkRetryError {
  readonly _tag = 'NetworkRetryError' as const;
  constructor(
    readonly cause: unknown,
    readonly attempt: number
  ) {}
}

// ─── Connection Retry ────────────────────────────────────────────────────────

type ConnectResult = {
  typedSessionId: SessionId;
  config: MachineConfig;
  machineId: string;
  agentServices: Map<string, RemoteAgentService>;
  availableModels: Record<string, string[]>;
  attempt: number;
};

const connectWithRetryEffect = (
  client: ConvexHttpClient,
  sessionId: string,
  convexUrl: string
): Effect.Effect<ConnectResult, never, never> =>
  Effect.gen(function* () {
    const retrySec = CONNECTION_RETRY_INTERVAL_MS / 1000;
    const attemptRef = yield* Ref.make(0);

    const connectOnce = Effect.gen(function* () {
      yield* Ref.update(attemptRef, (n) => n + 1);
      const typedSessionId = yield* validateSessionEffect(
        client,
        sessionId as SessionId,
        convexUrl
      );

      const config = yield* setupMachineEffect();
      const { machineId } = config;

      initHarnessRegistry();
      const agentServices = new Map<string, RemoteAgentService>(
        getAllHarnesses().map((s) => [s.id, s])
      );

      const availableModels = yield* registerCapabilitiesEffect(
        client,
        typedSessionId,
        config,
        agentServices
      );

      yield* connectDaemonEffect(client, typedSessionId, machineId);

      return { typedSessionId, config, machineId, agentServices, availableModels };
    }).pipe(
      Effect.catchAll((error) =>
        Effect.flatMap(Ref.get(attemptRef), (currentAttempt) =>
          isNetworkError(error)
            ? Effect.fail(new NetworkRetryError(error, currentAttempt))
            : Effect.die(error)
        )
      )
    );

    const retrySchedule = Schedule.fixed(Duration.millis(CONNECTION_RETRY_INTERVAL_MS));

    const connectWithRetry = connectOnce.pipe(
      Effect.tapError((retryErr) =>
        Effect.gen(function* () {
          const { cause, attempt: failedAttempt } = retryErr;
          if (failedAttempt === 1) {
            formatConnectivityError(cause, convexUrl);
            console.log(
              `[${formatTimestamp()}] ⏳ Backend not reachable. Retrying every ${retrySec}s...`
            );
          } else {
            console.log(
              `[${formatTimestamp()}] ❌ Backend still unreachable (attempt ${failedAttempt}, retrying in ${retrySec}s)`
            );
          }
        })
      ),
      Effect.retry(retrySchedule)
    );

    const result = yield* connectWithRetry.pipe(Effect.catchAll((e) => Effect.die(e)));
    const attempt = yield* Ref.get(attemptRef);

    if (attempt > 1) {
      console.log(`[${formatTimestamp()}] ✅ Backend reachable again at ${convexUrl}`);
    }

    return { ...result, attempt };
  });

// ─── Initialization ─────────────────────────────────────────────────────────

/**
 * Initialize the daemon: validate auth, connect to Convex, recover state.
 * Retries with a fixed 1-second interval on network errors.
 * Returns the DaemonSessionInit if successful, or exits the process on fatal failure.
 */
export const initDaemonEffect: Effect.Effect<DaemonSessionInit, unknown, never> = Effect.gen(
  function* () {
    if (!acquireLock()) {
      return yield* Effect.sync(() => {
        process.exit(1);
      });
    }

    const { reaped } = yield* reapOrphanedProcessGroupsEffect;
    if (reaped > 0) {
      console.log(
        `[${formatTimestamp()}] Reaped ${reaped} orphaned process group(s) from previous daemon run`
      );
    }

    yield* Effect.tryPromise({
      try: () => cleanOrphanTempFiles(),
      catch: (e) => e,
    });

    const convexUrl = getConvexUrl();
    const sessionId = yield* validateAuthenticationEffect(convexUrl);
    const client = yield* Effect.tryPromise({
      try: () => getConvexClient(),
      catch: (e) => e,
    });

    const { typedSessionId, config, machineId, agentServices, availableModels } =
      yield* connectWithRetryEffect(client, sessionId, convexUrl);

    const deps = createDefaultDeps();
    deps.backend.mutation = (endpoint, args) => client.mutation(endpoint, args);
    deps.backend.query = (endpoint, args) => client.query(endpoint, args);

    deps.agentProcessManager = new AgentProcessManager({
      agentServices,
      backend: deps.backend,
      sessionId: typedSessionId,
      machineId,
      processes: deps.processes,
      clock: deps.clock,
      fs: deps.fs,
      persistence: deps.machine,
      spawning: deps.spawning,
      crashLoop: new CrashLoopTracker(),
      convexUrl,
    });

    const events = new DaemonEventBus();
    const init: DaemonSessionInit = {
      client,
      sessionId: typedSessionId,
      machineId,
      config,
      backend: deps.backend,
      fs: deps.fs,
      machine: deps.machine,
      spawning: deps.spawning,
      agentProcessManager: deps.agentProcessManager,
      events,
      agentServices,
      lastPushedGitState: new Map(),
      lastPushedModels: availableModels,
      lastPushedHarnessFingerprint: harnessCapabilitiesFingerprint(
        config.availableHarnesses,
        config.harnessVersions as Record<string, unknown>
      ),
      logger: console,
    };

    yield* registerEventListenersEffect().pipe(Effect.provide(daemonSessionToLayers(init)));
    yield* logStartupEffect(availableModels).pipe(Effect.provide(daemonSessionToLayers(init)));
    yield* recoverStateEffect(init);

    return init;
  }
);

/** Thin wrapper — daemon-start/index.ts and tests still import this. */
export async function initDaemon(): Promise<DaemonSessionInit> {
  return Effect.runPromise(initDaemonEffect);
}
