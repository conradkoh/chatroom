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
  getMachineId,
  listAgentEntries,
  loadMachineConfig,
  persistAgentPid,
} from '../../../infrastructure/machine/index.js';
import {
  markIntentionalStop,
  consumeIntentionalStop,
  clearIntentionalStop,
} from '../../../infrastructure/machine/intentional-stops.js';
import { OpenCodeAgentService } from '../../../infrastructure/services/remote-agents/opencode/index.js';
import type { RemoteAgentService } from '../../../infrastructure/services/remote-agents/remote-agent-service.js';
import { isNetworkError, formatConnectivityError } from '../../../utils/error-formatting.js';
import { getVersion } from '../../../version.js';
import { acquireLock, releaseLock } from '../pid.js';
import type { DaemonDeps } from './deps.js';
import { DaemonEventBus } from './event-bus.js';
import { registerEventListeners } from './event-listeners.js';
import type { DaemonContext, SessionId } from './types.js';
import { formatTimestamp } from './utils.js';
import { AgentOutputStore } from '../../../stores/agent-output.js';

// ─── Model Discovery ────────────────────────────────────────────────────────

/**
 * Discover available models from the remote agent service.
 * Non-critical: returns empty array on failure.
 */
export async function discoverModels(service: RemoteAgentService): Promise<string[]> {
  try {
    return await service.listModels();
  } catch {
    return [];
  }
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
    },
    clock: {
      now: () => Date.now(),
      delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
  };
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

  // Verify authentication
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

  // Get machine ID
  const machineId = getMachineId();
  if (!machineId) {
    console.error(`❌ Machine not registered`);
    console.error(`\nRun any chatroom command first to register this machine,`);
    console.error(`for example: chatroom auth status`);
    releaseLock();
    process.exit(1);
  }

  const client = await getConvexClient();

  // SessionId is validated above as non-null. Cast once at the boundary
  // between our storage format and Convex's branded type system.
  const typedSessionId: SessionId = sessionId;

  // Load and cache machine config (read once, reused by handlers)
  const config = loadMachineConfig();

  // Instantiate remote agent service early — needed for model discovery
  const remoteAgentService = new OpenCodeAgentService();

  // Discover available models from installed harnesses (dynamic)
  // This ensures models are available in the UI as soon as the daemon connects
  const availableModels = await discoverModels(remoteAgentService);

  // Register/update machine info in backend (includes harnesses and models)
  // This ensures the web UI has current machine capabilities
  if (config) {
    try {
      await client.mutation(api.machines.register, {
        sessionId: typedSessionId,
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
  }

  // Update daemon status to connected
  try {
    await client.mutation(api.machines.updateDaemonStatus, {
      sessionId: typedSessionId,
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

  // Create default dependencies and bind the real Convex client
  const deps = createDefaultDeps();
  deps.backend.mutation = (endpoint, args) => client.mutation(endpoint, args);
  deps.backend.query = (endpoint, args) => client.query(endpoint, args);

  const events = new DaemonEventBus();
  const agentOutputStore = new AgentOutputStore();
  const ctx: DaemonContext = {
    client,
    sessionId: typedSessionId,
    machineId,
    config,
    deps,
    events,
    agentOutputStore,
    remoteAgentService,
  };

  // Register centralized event listeners for agent lifecycle side-effects
  registerEventListeners(ctx);

  console.log(`[${formatTimestamp()}] 🚀 Daemon started`);
  console.log(`   CLI version: ${getVersion()}`);
  console.log(`   Machine ID: ${machineId}`);
  console.log(`   Hostname: ${config?.hostname ?? 'Unknown'}`);
  console.log(`   Available harnesses: ${config?.availableHarnesses.join(', ') || 'none'}`);
  console.log(
    `   Available models: ${availableModels.length > 0 ? `${availableModels.length} models` : 'none discovered'}`
  );
  console.log(`   PID: ${process.pid}`);

  // Recover agent state from previous daemon session
  console.log(`\n[${formatTimestamp()}] 🔄 Recovering agent state...`);
  try {
    await recoverAgentState(ctx);
  } catch (e) {
    console.log(`   ⚠️  Recovery failed: ${(e as Error).message}`);
    console.log(`   Continuing with fresh state`);
  }

  return ctx;
}
