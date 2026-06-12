/**
 * Daemon Initialization — validates auth, connects to Convex, recovers state.
 */

import { stat } from 'node:fs/promises';

import type { ConvexHttpClient } from 'convex/browser';
import { Effect, Schedule, Duration } from 'effect';

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
export async function discoverModels(
  agentServices: Map<string, RemoteAgentService>
): Promise<Record<string, string[]>> {
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

  const results = await Effect.runPromise(
    Effect.forEach(Array.from(agentServices.entries()), discoverOne, {
      concurrency: 'unbounded',
    })
  );

  const discovered: Record<string, string[]> = {};
  for (const result of results) {
    if (result) {
      discovered[result.harness] = result.models;
    }
  }

  return discovered;
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

/**
 * Wait for authentication credentials to appear.
 * Polls the auth file every 2 seconds until a valid session ID is found
 * or the timeout (5 minutes) is reached.
 */
async function waitForAuthentication(_convexUrl: string): Promise<string> {
  const startTime = Date.now();
  while (Date.now() - startTime < AUTH_WAIT_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, AUTH_POLL_INTERVAL_MS));
    const sessionId = await getSessionId();
    if (sessionId) {
      console.log(`\n✅ Authentication detected. Resuming daemon initialization...`);
      return sessionId;
    }
  }
  // Timeout reached
  console.error(`\n❌ Authentication timeout (5 minutes). Exiting.`);
  releaseLock();
  process.exit(1);
}

/**
 * Validate that the user is authenticated for the current Convex deployment.
 * Returns the session ID if valid, or waits for the user to authenticate.
 */
async function validateAuthentication(convexUrl: string): Promise<string> {
  const sessionId = await getSessionId();
  if (sessionId) {
    return sessionId;
  }

  const otherUrls = await getOtherSessionUrls();
  console.error(`❌ Not authenticated for: ${convexUrl}`);

  if (otherUrls.length > 0) {
    console.error(`\n💡 You have sessions for other environments:`);
    for (const url of otherUrls) {
      console.error(`   • ${url}`);
    }
  }

  console.error(`\nRun: chatroom auth login`);
  console.log(`\n⏳ Waiting for authentication (timeout: 5 minutes)...`);
  return waitForAuthentication(convexUrl);
}

/**
 * Validate the session with the backend to catch expired/revoked tokens early.
 * If the session is invalid, waits for the user to re-authenticate.
 */
async function validateSession(
  client: ConvexHttpClient,
  sessionId: SessionId,
  convexUrl: string
): Promise<SessionId> {
  const validation = await client.query(api.cliAuth.validateSession, { sessionId });
  if (validation.valid) {
    return sessionId;
  }

  console.error(`❌ Session invalid: ${validation.reason}`);
  console.error(`\nRun: chatroom auth login`);
  console.log(`\n⏳ Waiting for re-authentication (timeout: 5 minutes)...`);

  // Wait for new auth credentials, then re-validate
  const newSessionId = await waitForAuthentication(convexUrl);
  const typedNewSession: SessionId = newSessionId;

  // Validate the new session
  const revalidation = await client.query(api.cliAuth.validateSession, {
    sessionId: typedNewSession,
  });
  if (!revalidation.valid) {
    console.error(`❌ New session is also invalid: ${revalidation.reason}`);
    releaseLock();
    process.exit(1);
  }

  return typedNewSession;
}

/**
 * Register machine (or refresh harness detection if already registered).
 * Returns the full machine config (guaranteed non-null).
 */
async function setupMachine(): Promise<MachineConfig> {
  // Daemon bootstrap is the only path that may mint a new machine ID for this endpoint.
  // Mid-session callers use ensureMachineRegistered() without allowCreate so a missing
  // ~/.chatroom config surfaces as an explicit error instead of a silent UUID.
  await ensureMachineRegistered({ allowCreate: true });

  // Load the full machine config (guaranteed non-null after ensureMachineRegistered)
  const config = await loadMachineConfig();
  if (!config) {
    throw new Error(
      'Machine config missing after ensureMachineRegistered — this should not happen'
    );
  }
  return config;
}

/**
 * Register machine capabilities (harnesses and models) with the backend.
 * Returns the discovered models for startup logging.
 * Non-critical: warns on failure but does not exit.
 */
async function registerCapabilities(
  client: ConvexHttpClient,
  sessionId: SessionId,
  config: MachineConfig,
  agentServices: Map<string, RemoteAgentService>
): Promise<Record<string, string[]>> {
  const { machineId } = config;

  // Discover available models from all installed harnesses (dynamic)
  const availableModels = await discoverModels(agentServices);

  // Register/update machine info in backend (includes harnesses and models)
  // This ensures the web UI has current machine capabilities
  try {
    await client.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: config.hostname,
      os: config.os,
      availableHarnesses: config.availableHarnesses,
      harnessVersions: config.harnessVersions,
      availableModels,
    });
  } catch (error) {
    // Registration failure is non-critical — daemon can still work
    console.warn(`⚠️  Machine registration update failed: ${getErrorMessage(error)}`);
  }

  return availableModels;
}

/**
 * Connect the daemon to the backend by updating daemon status.
 * Throws on failure (caller handles retry).
 */
async function connectDaemon(
  client: ConvexHttpClient,
  sessionId: SessionId,
  machineId: string,
  _convexUrl: string
): Promise<void> {
  try {
    await client.mutation(api.machines.updateDaemonStatus, {
      sessionId,
      machineId,
      connected: true,
    });
  } catch (error) {
    if (isNetworkError(error)) {
      // Do NOT log here — the caller (initDaemon retry loop) owns failure logging
      // so it can suppress the verbose block after the first occurrence.
      throw error; // Re-throw for caller retry logic
    } else {
      console.error(`❌ Failed to update daemon status: ${getErrorMessage(error)}`);
      releaseLock();
      process.exit(1);
    }
  }
}

/**
 * Recover agent state from previous daemon session.
 * Non-critical: continues with fresh state on failure.
 */
async function recoverState(init: DaemonSessionInit): Promise<void> {
  console.log(`\n[${formatTimestamp()}] 🔄 Recovering agent state...`);
  try {
    await Effect.runPromise(
      recoverAgentStateEffect.pipe(Effect.provide(daemonSessionToLayers(init)))
    );
  } catch (e) {
    console.log(`   ⚠️  Recovery failed: ${getErrorMessage(e)}`);
    console.log(`   Continuing with fresh state`);
  }

  // Clear all stale spawnedAgentPid values for this machine.
  // Since the daemon just started, no agents are running yet — any PIDs in the
  // backend are stale from before the restart and must be cleared to prevent
  // the UI from showing dead agents as "running" or "starting".
  try {
    const clearedCount = await Effect.runPromise(
      clearStaleSpawnedPidsEffect().pipe(Effect.provide(daemonSessionToLayers(init)))
    );
    if (clearedCount > 0) {
      console.log(`   🧹 Cleared ${clearedCount} stale agent PID(s) from backend`);
    }
  } catch (e) {
    console.log(`   ⚠️  Failed to clear stale PIDs: ${getErrorMessage(e)}`);
  }

  // Reap any pending/running command runs left from before the restart.
  // Since the daemon just started, no command processes are running — any run
  // in 'pending' or 'running' state is an orphan from the previous daemon process
  // and must be marked as 'killed' with terminationReason='daemon-restart' so the
  // UI correctly labels them rather than showing them as 'replaced' when the user
  // next triggers a run for the same command.
  try {
    const reapedCount = await Effect.runPromise(
      reapOrphanCommandRunsEffect().pipe(Effect.provide(daemonSessionToLayers(init)))
    );
    if (reapedCount > 0) {
      console.log(
        `   🧹 Reaped ${reapedCount} command run(s) from previous daemon run (marked as daemon-restart)`
      );
    }
  } catch (e) {
    console.warn(`   ⚠️  Failed to reap orphan command runs: ${getErrorMessage(e)}`);
  }
}

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

// ─── Initialization ─────────────────────────────────────────────────────────

/**
 * Initialize the daemon: validate auth, connect to Convex, recover state.
 * Retries with a fixed 1-second interval on network errors.
 * Returns the DaemonSessionInit if successful, or exits the process on fatal failure.
 */
export async function initDaemon(): Promise<DaemonSessionInit> {
  // Acquire lock (prevents multiple daemons)
  if (!acquireLock()) {
    process.exit(1);
  }

  // Reap any process groups left over from a previous ungraceful exit (SIGKILL/crash).
  // Must run after acquireLock (single daemon guarantee) but before starting subscriptions.
  const { reaped } = await Effect.runPromise(reapOrphanedProcessGroupsEffect);
  if (reaped > 0) {
    console.log(
      `[${formatTimestamp()}] Reaped ${reaped} orphaned process group(s) from previous daemon run`
    );
  }

  // Clean up orphaned temp files from previous daemon runs.
  // Daemon writes command output to os.tmpdir()/chatroom-cli/runs/<runId>.log
  // during execution; on crash/kill, the files aren't cleaned up. Stale temp
  // files are unrecoverable (the process is gone) — acceptable.
  await cleanOrphanTempFiles();

  // Single source of truth for backend URL at daemon boot — same value is passed to
  // AgentProcessManager as convexUrl and forwarded to spawned agents as CHATROOM_CONVEX_URL.
  const convexUrl = getConvexUrl();
  const sessionId = await validateAuthentication(convexUrl);
  const client = await getConvexClient();

  // SessionId is validated above as non-null. Cast once at the boundary
  // between our storage format and Convex's branded type system.
  // ─── Connection retry loop ──────────────────────────────────────────────────
  //
  // Uses Effect.retry + Schedule to handle transient network failures.
  // Only NetworkRetryError instances trigger retries — non-network errors are
  // re-thrown immediately and crash the daemon (fatal path).
  //
  // Schedule: fixed 10-second gap between attempts, retries forever until the
  // backend is reachable. The attempt counter inside each NetworkRetryError
  // drives log-dedup (verbose block on attempt 1, concise line thereafter).
  const retrySec = CONNECTION_RETRY_INTERVAL_MS / 1000;

  let attempt = 0;

  const connectOnce = Effect.gen(function* () {
    attempt++;
    const typedSessionId = yield* Effect.tryPromise({
      try: () => validateSession(client, sessionId as SessionId, convexUrl),
      catch: (e) => e,
    });

    const config = yield* Effect.tryPromise({
      try: () => setupMachine(),
      catch: (e) => e,
    });
    const { machineId } = config;

    // Populate harness registry and build service map from it
    initHarnessRegistry();
    const agentServices = new Map<string, RemoteAgentService>(
      getAllHarnesses().map((s) => [s.id, s])
    );

    const availableModels = yield* Effect.tryPromise({
      try: () => registerCapabilities(client, typedSessionId, config, agentServices),
      catch: (e) => e,
    });

    yield* Effect.tryPromise({
      try: () => connectDaemon(client, typedSessionId, machineId, convexUrl),
      catch: (e) => e,
    });

    return { typedSessionId, config, machineId, agentServices, availableModels };
  }).pipe(
    // Classify failures: network errors → retryable; others → fatal (re-throw)
    Effect.catchAll((error) => {
      if (isNetworkError(error)) {
        return Effect.fail(new NetworkRetryError(error, attempt));
      }
      // Non-network error — propagate as a defect (crashes the daemon)
      return Effect.die(error);
    })
  );

  const retrySchedule = Schedule.fixed(Duration.millis(CONNECTION_RETRY_INTERVAL_MS));

  const connectWithRetry = connectOnce.pipe(
    Effect.tapError((retryErr) =>
      Effect.sync(() => {
        const { cause, attempt: failedAttempt } = retryErr;
        if (failedAttempt === 1) {
          // First failure — emit the full guidance block so the user knows what to check.
          formatConnectivityError(cause, convexUrl);
          console.log(
            `[${formatTimestamp()}] ⏳ Backend not reachable. Retrying every ${retrySec}s...`
          );
        } else {
          // Subsequent failures — a single concise line to avoid log spam.
          console.log(
            `[${formatTimestamp()}] ❌ Backend still unreachable (attempt ${failedAttempt}, retrying in ${retrySec}s)`
          );
        }
      })
    ),
    Effect.retry(retrySchedule)
  );

  const { typedSessionId, config, machineId, agentServices, availableModels } =
    await Effect.runPromise(connectWithRetry);

  // Log recovery if the backend was previously unreachable.
  if (attempt > 1) {
    console.log(`[${formatTimestamp()}] ✅ Backend reachable again at ${convexUrl}`);
  }

  // Create default dependencies and bind the real Convex client
  const deps = createDefaultDeps();
  deps.backend.mutation = (endpoint, args) => client.mutation(endpoint, args);
  deps.backend.query = (endpoint, args) => client.query(endpoint, args);

  // Create the AgentProcessManager with all required dependencies
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

  await Effect.runPromise(
    registerEventListenersEffect().pipe(Effect.provide(daemonSessionToLayers(init)))
  );

  await Effect.runPromise(
    logStartupEffect(availableModels).pipe(Effect.provide(daemonSessionToLayers(init)))
  );
  await recoverState(init);

  return init;
}
