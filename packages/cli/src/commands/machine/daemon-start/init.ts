/**
 * Daemon Initialization — validates auth, connects to Convex, recovers state.
 */

import { stat } from 'node:fs/promises';

import type { ConvexHttpClient } from 'convex/browser';

import type { DaemonDeps } from './deps.js';
import { recoverAgentState } from './handlers/state-recovery.js';
import type { DaemonContext, SessionId } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { startLocalApi } from '../../../infrastructure/local-api/index.js';
import { DaemonEventBus } from '../../../events/daemon/event-bus.js';
import { registerEventListeners } from '../../../events/daemon/register-listeners.js';
import { getSessionId, getOtherSessionUrls } from '../../../infrastructure/auth/storage.js';
import { getConvexUrl, getConvexClient } from '../../../infrastructure/convex/client.js';
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
import {
  SpawnRateLimiter,
  HarnessSpawningService,
} from '../../../infrastructure/services/harness-spawning/index.js';
import { CrashLoopTracker } from '../../../infrastructure/machine/crash-loop-tracker.js';
import { AgentProcessManager } from '../../../infrastructure/services/agent-process-manager/agent-process-manager.js';
import {
  initHarnessRegistry,
  getAllHarnesses,
} from '../../../infrastructure/services/remote-agents/index.js';
import type { RemoteAgentService } from '../../../infrastructure/services/remote-agents/remote-agent-service.js';
import { isNetworkError, formatConnectivityError } from '../../../utils/error-formatting.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import { getVersion } from '../../../version.js';
import { acquireLock, releaseLock } from '../pid.js';

// ─── Private Helpers ────────────────────────────────────────────────────────

// ─── Model Discovery ────────────────────────────────────────────────────────

/**
 * Discover available models from all installed remote agent services.
 * Non-critical: returns empty record on failure per harness.
 */
export async function discoverModels(
  agentServices: Map<string, RemoteAgentService>
): Promise<Record<string, string[]>> {
  const results: Record<string, string[]> = {};
  for (const [harness, service] of agentServices) {
    if (service.isInstalled()) {
      try {
        results[harness] = await service.listModels();
      } catch {
        results[harness] = [];
      }
    }
  }
  return results;
}

// ─── Default Dependencies ───────────────────────────────────────────────────

/**
 * Create production dependency implementations wiring to real infrastructure.
 * This factory uses the module-level imports already available in this file.
 */
export function createDefaultDeps(): DaemonDeps {
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
async function waitForAuthentication(convexUrl: string): Promise<string> {
  const startTime = Date.now();
  while (Date.now() - startTime < AUTH_WAIT_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, AUTH_POLL_INTERVAL_MS));
    const sessionId = getSessionId();
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
  const sessionId = getSessionId();
  if (sessionId) {
    return sessionId;
  }

  const otherUrls = getOtherSessionUrls();
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
  const revalidation = await client.query(api.cliAuth.validateSession, { sessionId: typedNewSession });
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
function setupMachine(): MachineConfig {
  // ensureMachineRegistered() creates a new machine ID on first run and always
  // re-detects available harnesses live — so `chatroom machine start` is fully
  // self-contained: no prior `auth status` or `register-agent` step required.
  ensureMachineRegistered();

  // Load the full machine config (guaranteed non-null after ensureMachineRegistered())
  const config = loadMachineConfig()!;
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
  convexUrl: string
): Promise<void> {
  try {
    await client.mutation(api.machines.updateDaemonStatus, {
      sessionId,
      machineId,
      connected: true,
    });
  } catch (error) {
    if (isNetworkError(error)) {
      formatConnectivityError(error, convexUrl);
      throw error; // Re-throw for caller retry logic
    } else {
      console.error(`❌ Failed to update daemon status: ${getErrorMessage(error)}`);
      releaseLock();
      process.exit(1);
    }
  }
}

/**
 * Log startup information including version, machine ID, and capabilities.
 */
function logStartup(ctx: DaemonContext, availableModels: Record<string, string[]>): void {
  console.log(`[${formatTimestamp()}] 🚀 Daemon started`);
  console.log(`   CLI version: ${getVersion()}`);
  console.log(`   Machine ID: ${ctx.machineId}`);
  console.log(`   Hostname: ${ctx.config?.hostname ?? 'unknown'}`);
  console.log(`   Available harnesses: ${ctx.config?.availableHarnesses.join(', ') || 'none'}`);
  console.log(
    `   Available models: ${Object.keys(availableModels).length > 0 ? `${Object.values(availableModels).flat().length} models across ${Object.keys(availableModels).join(', ')}` : 'none discovered'}`
  );
  console.log(`   PID: ${process.pid}`);
}

/**
 * Recover agent state from previous daemon session.
 * Non-critical: continues with fresh state on failure.
 */
async function recoverState(ctx: DaemonContext): Promise<void> {
  console.log(`\n[${formatTimestamp()}] 🔄 Recovering agent state...`);
  try {
    await recoverAgentState(ctx);
  } catch (e) {
    console.log(`   ⚠️  Recovery failed: ${getErrorMessage(e)}`);
    console.log(`   Continuing with fresh state`);
  }

  // Clear all stale spawnedAgentPid values for this machine.
  // Since the daemon just started, no agents are running yet — any PIDs in the
  // backend are stale from before the restart and must be cleared to prevent
  // the UI from showing dead agents as "running" or "starting".
  try {
    const result = await ctx.deps.backend.mutation(api.machines.clearAllSpawnedPids, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    });
    if (result.clearedCount > 0) {
      console.log(`   🧹 Cleared ${result.clearedCount} stale agent PID(s) from backend`);
    }
  } catch (e) {
    console.log(`   ⚠️  Failed to clear stale PIDs: ${getErrorMessage(e)}`);
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Fixed interval (ms) between connection retry attempts when backend is unreachable. */
const CONNECTION_RETRY_INTERVAL_MS = 60_000;

// ─── Initialization ─────────────────────────────────────────────────────────

/**
 * Initialize the daemon: validate auth, connect to Convex, recover state.
 * Retries with a fixed 1-second interval on network errors.
 * Returns the DaemonContext if successful, or exits the process on fatal failure.
 */
export async function initDaemon(): Promise<DaemonContext> {
  // Acquire lock (prevents multiple daemons)
  if (!acquireLock()) {
    process.exit(1);
  }

  const convexUrl = getConvexUrl();
  const sessionId = await validateAuthentication(convexUrl);
  const client = await getConvexClient();

  // SessionId is validated above as non-null. Cast once at the boundary
  // between our storage format and Convex's branded type system.
  let typedSessionId: SessionId = sessionId;

  // Retry loop for network errors — waits 1s between attempts
  while (true) {
    try {
      typedSessionId = await validateSession(client, typedSessionId, convexUrl);

      const config = setupMachine();
      const { machineId } = config;

      // Populate harness registry and build service map from it
      initHarnessRegistry();
      const agentServices = new Map<string, RemoteAgentService>(
        getAllHarnesses().map((s) => [s.id, s])
      );

      const availableModels = await registerCapabilities(
        client,
        typedSessionId,
        config,
        agentServices
      );
      await connectDaemon(client, typedSessionId, machineId, convexUrl);

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
      const ctx: DaemonContext = {
        client,
        sessionId: typedSessionId,
        machineId,
        config,
        deps,
        events,
        agentServices,
        lastPushedGitState: new Map(),
      };

      registerEventListeners(ctx);

      logStartup(ctx, availableModels);
      await recoverState(ctx);

      // Start the local API server after the context is fully assembled.
      // Port conflicts are handled gracefully inside startLocalApi (warns and continues).
      const localApiHandle = await startLocalApi(ctx);
      ctx.stopLocalApi = localApiHandle.stop;

      return ctx;
    } catch (error) {
      if (isNetworkError(error)) {
        const retrySec = CONNECTION_RETRY_INTERVAL_MS / 1000;
        console.log(
          `[${formatTimestamp()}] ⏳ Backend not reachable. Retrying in ${retrySec}s...`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, CONNECTION_RETRY_INTERVAL_MS)
        );
        console.log(`[${formatTimestamp()}] 🔄 Retrying backend connection...`);
        // Continue the loop to retry
      } else {
        // Non-network error — propagate (will crash the process)
        throw error;
      }
    }
  }
}
