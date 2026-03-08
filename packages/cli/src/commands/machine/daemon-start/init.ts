/**
 * Daemon Initialization — validates auth, connects to Convex, recovers state.
 */

import { stat } from 'node:fs/promises';

import { recoverAgentState } from './handlers/state-recovery.js';
import { api } from '../../../api.js';
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
import {
  markIntentionalStop,
  consumeIntentionalStop,
  clearIntentionalStop,
} from '../../../infrastructure/machine/intentional-stops.js';
import { OpenCodeAgentService } from '../../../infrastructure/services/remote-agents/opencode/index.js';
import { PiAgentService } from '../../../infrastructure/services/remote-agents/pi/index.js';
import { CursorAgentService } from '../../../infrastructure/services/remote-agents/cursor/index.js';
import type { RemoteAgentService } from '../../../infrastructure/services/remote-agents/remote-agent-service.js';
import type { AgentHarness } from '../../../infrastructure/machine/types.js';
import { isNetworkError, formatConnectivityError } from '../../../utils/error-formatting.js';
import { getVersion } from '../../../version.js';
import { acquireLock, releaseLock } from '../pid.js';
import type { DaemonDeps } from './deps.js';
import { DaemonEventBus } from '../../../events/daemon/event-bus.js';
import { registerEventListeners } from '../../../events/daemon/register-listeners.js';
import type { DaemonContext, SessionId } from './types.js';
import { formatTimestamp } from './utils.js';
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
    stops: {
      mark: markIntentionalStop,
      consume: consumeIntentionalStop,
      clear: clearIntentionalStop,
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
  };
}

// ─── Private Helpers ────────────────────────────────────────────────────────

import type { ConvexHttpClient } from 'convex/browser';
import type { MachineConfig } from '../../../infrastructure/machine/types.js';

/**
 * Validate that the user is authenticated for the current Convex deployment.
 * Returns the session ID if valid, or exits the process with an error.
 */
function validateAuthentication(convexUrl: string): string {
  const sessionId = getSessionId();
  if (!sessionId) {
    const otherUrls = getOtherSessionUrls();

    console.error(`❌ Not authenticated for: ${convexUrl}`);

    if (otherUrls.length > 0) {
      console.error(`\n💡 You have sessions for other environments:`);
      for (const url of otherUrls) {
        console.error(`   • ${url}`);
      }
    }

    console.error(`\nRun: chatroom auth login`);
    releaseLock();
    process.exit(1);
  }
  return sessionId;
}

/**
 * Validate the session with the backend to catch expired/revoked tokens early.
 * Exits the process if validation fails.
 */
async function validateSession(
  client: ConvexHttpClient,
  sessionId: SessionId,
  convexUrl: string
): Promise<void> {
  const validation = await client.query(api.cliAuth.validateSession, { sessionId });
  if (!validation.valid) {
    console.error(`❌ Session invalid: ${validation.reason}`);
    console.error(`\nRun: chatroom auth login`);
    releaseLock();
    process.exit(1);
  }
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
  agentServices: Map<AgentHarness, RemoteAgentService>
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
    console.warn(`⚠️  Machine registration update failed: ${(error as Error).message}`);
  }

  return availableModels;
}

/**
 * Connect the daemon to the backend by updating daemon status.
 * Exits the process on failure.
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
    } else {
      console.error(`❌ Failed to update daemon status: ${(error as Error).message}`);
    }
    releaseLock();
    process.exit(1);
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
    console.log(`   ⚠️  Recovery failed: ${(e as Error).message}`);
    console.log(`   Continuing with fresh state`);
  }
}

// ─── Initialization ─────────────────────────────────────────────────────────

/**
 * Initialize the daemon: validate auth, connect to Convex, recover state.
 * Returns the DaemonContext if successful, or exits the process on failure.
 */
export async function initDaemon(): Promise<DaemonContext> {
  // Acquire lock (prevents multiple daemons)
  if (!acquireLock()) {
    process.exit(1);
  }

  const convexUrl = getConvexUrl();
  const sessionId = validateAuthentication(convexUrl);
  const client = await getConvexClient();

  // SessionId is validated above as non-null. Cast once at the boundary
  // between our storage format and Convex's branded type system.
  const typedSessionId: SessionId = sessionId;

  await validateSession(client, typedSessionId, convexUrl);

  const config = setupMachine();
  const { machineId } = config;

  // Instantiate remote agent services — one for each supported harness
  const openCodeService = new OpenCodeAgentService();
  const piService = new PiAgentService();
  const cursorService = new CursorAgentService();
  const agentServices = new Map<AgentHarness, RemoteAgentService>([
    ['opencode', openCodeService],
    ['pi', piService],
    ['cursor', cursorService],
  ]);

  const availableModels = await registerCapabilities(client, typedSessionId, config, agentServices);
  await connectDaemon(client, typedSessionId, machineId, convexUrl);

  // Create default dependencies and bind the real Convex client
  const deps = createDefaultDeps();
  deps.backend.mutation = (endpoint, args) => client.mutation(endpoint, args);
  deps.backend.query = (endpoint, args) => client.query(endpoint, args);

  const events = new DaemonEventBus();
  const ctx: DaemonContext = {
    client,
    sessionId: typedSessionId,
    machineId,
    config,
    deps,
    events,
    agentServices,
  };

  registerEventListeners(ctx);

  logStartup(ctx, availableModels);
  await recoverState(ctx);

  return ctx;
}
