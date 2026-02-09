/**
 * Daemon Start Command
 *
 * Start the machine daemon that listens for remote commands.
 */

import { execSync } from 'node:child_process';
import { stat } from 'node:fs/promises';

import { acquireLock, releaseLock } from './pid.js';
import { api, type Id } from '../../api.js';
import { getDriverRegistry } from '../../infrastructure/agent-drivers/index.js';
import type { AgentHandle } from '../../infrastructure/agent-drivers/types.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import {
  getConvexUrl,
  getConvexClient,
  getConvexWsClient,
} from '../../infrastructure/convex/client.js';
import {
  clearAgentPid,
  getMachineId,
  listAgentEntries,
  loadMachineConfig,
  getAgentContext,
  persistAgentPid,
  updateAgentContext,
} from '../../infrastructure/machine/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Named type alias for the session ID passed to Convex mutations/queries.
 * The Convex SessionIdArg expects a specific branded type, but our sessionId
 * is a plain string from local storage. This alias documents intent and
 * avoids bare `any` in every function signature.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SessionId = any;

/** Convex client type used throughout the daemon. */
type ConvexClient = Awaited<ReturnType<typeof getConvexClient>>;

/** Machine config type returned by loadMachineConfig(). */
type MachineConfig = ReturnType<typeof loadMachineConfig>;

/**
 * Base fields shared across all machine commands.
 */
interface MachineCommandBase {
  _id: Id<'chatroom_machineCommands'>;
  createdAt: number;
}

/**
 * Start an agent process in a chatroom.
 * Requires chatroomId, role, and agentHarness. Model and workingDir are optional.
 */
interface StartAgentCommand extends MachineCommandBase {
  type: 'start-agent';
  payload: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    agentHarness: 'opencode';
    model?: string;
    workingDir?: string;
  };
}

/**
 * Stop a running agent process in a chatroom.
 * Requires chatroomId and role to identify the target agent.
 */
interface StopAgentCommand extends MachineCommandBase {
  type: 'stop-agent';
  payload: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
  };
}

/**
 * Ping the daemon to check connectivity.
 */
interface PingCommand extends MachineCommandBase {
  type: 'ping';
  payload: Record<string, never>;
}

/**
 * Query daemon status (hostname, OS, available harnesses).
 */
interface StatusCommand extends MachineCommandBase {
  type: 'status';
  payload: Record<string, never>;
}

/**
 * Discriminated union of all machine commands.
 * The `type` field determines which payload shape is available,
 * enabling TypeScript to narrow types in switch/case branches.
 */
type MachineCommand = StartAgentCommand | StopAgentCommand | PingCommand | StatusCommand;

/**
 * Raw command shape as received from the Convex backend subscription.
 * All payload fields are optional because Convex uses a single flat schema
 * for all command types.
 */
interface RawMachineCommand {
  _id: Id<'chatroom_machineCommands'>;
  type: 'start-agent' | 'stop-agent' | 'ping' | 'status';
  payload: {
    chatroomId?: Id<'chatroom_rooms'>;
    role?: string;
    agentHarness?: 'opencode';
    model?: string;
    workingDir?: string;
  };
  createdAt: number;
}

/** Result returned by individual command handlers. */
interface CommandResult {
  result: string;
  failed: boolean;
}

/** Shared context passed to all command handlers. */
interface DaemonContext {
  client: ConvexClient;
  sessionId: SessionId;
  machineId: string;
  config: MachineConfig;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Parse a raw command from Convex into the type-safe discriminated union.
 * Validates that required fields are present for each command type.
 * Returns null if the command has invalid/missing payload fields.
 */
function parseMachineCommand(raw: RawMachineCommand): MachineCommand | null {
  switch (raw.type) {
    case 'ping':
      return { _id: raw._id, type: 'ping', payload: {}, createdAt: raw.createdAt };
    case 'status':
      return { _id: raw._id, type: 'status', payload: {}, createdAt: raw.createdAt };
    case 'start-agent': {
      const { chatroomId, role, agentHarness } = raw.payload;
      if (!chatroomId || !role || !agentHarness) {
        console.error(
          `   ⚠️  Invalid start-agent command: missing chatroomId, role, or agentHarness`
        );
        return null;
      }
      return {
        _id: raw._id,
        type: 'start-agent',
        payload: {
          chatroomId,
          role,
          agentHarness,
          model: raw.payload.model,
          workingDir: raw.payload.workingDir,
        },
        createdAt: raw.createdAt,
      };
    }
    case 'stop-agent': {
      const { chatroomId, role } = raw.payload;
      if (!chatroomId || !role) {
        console.error(`   ⚠️  Invalid stop-agent command: missing chatroomId or role`);
        return null;
      }
      return {
        _id: raw._id,
        type: 'stop-agent',
        payload: { chatroomId, role },
        createdAt: raw.createdAt,
      };
    }
    default:
      return null;
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Format timestamp for daemon log output.
 */
function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Verify that a PID belongs to an expected process.
 * Returns true if the process exists and appears to match the expected harness.
 * Returns false if the PID doesn't exist or belongs to a different process.
 */
function verifyPidOwnership(pid: number, expectedHarness?: string): boolean {
  try {
    // First check if process exists
    process.kill(pid, 0);
  } catch {
    // Process doesn't exist
    return false;
  }

  if (!expectedHarness) {
    // No harness to verify against, just confirm process exists
    return true;
  }

  // Try to get process info to verify it's the expected harness
  try {
    const platform = process.platform;
    let processName = '';

    if (platform === 'darwin' || platform === 'linux') {
      processName = execSync(`ps -p ${pid} -o comm= 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
    }

    if (!processName) {
      // Can't determine process name, assume it's valid
      return true;
    }

    // Check if the process name contains the expected harness name
    const harnessLower = expectedHarness.toLowerCase();
    const procLower = processName.toLowerCase();

    // Match common patterns: 'opencode', 'node' (for Node-based harnesses)
    return (
      procLower.includes(harnessLower) || procLower.includes('node') || procLower.includes('bun')
    );
  } catch {
    // If we can't check, assume the process is valid (safer than killing an unknown process)
    return true;
  }
}

/**
 * Clear an agent's PID from both the Convex backend and local state file.
 * Used when stopping agents or cleaning up stale PIDs.
 */
async function clearAgentPidEverywhere(
  ctx: DaemonContext,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<void> {
  try {
    await ctx.client.mutation(api.machines.updateSpawnedAgent, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      chatroomId,
      role,
      pid: undefined,
    });
  } catch (e) {
    console.log(`   ⚠️  Failed to clear PID in backend: ${(e as Error).message}`);
  }
  clearAgentPid(ctx.machineId, chatroomId, role);
}

// ─── State Recovery ──────────────────────────────────────────────────────────

/**
 * Recover agent state on daemon restart.
 *
 * Reads locally persisted PIDs from the per-machine state file
 * (~/.chatroom/machines/state/<machine-id>.json), verifies each is still
 * alive using `verifyPidOwnership()`, and reconciles with Convex:
 * - Alive agents: log as recovered, keep PID in local state and Convex
 * - Dead agents: clear PID from local state and Convex
 *
 * This runs once on daemon startup before command processing begins.
 */
async function recoverAgentState(ctx: DaemonContext): Promise<void> {
  const entries = listAgentEntries(ctx.machineId);

  if (entries.length === 0) {
    console.log(`   No agent entries found — nothing to recover`);
    return;
  }

  let recovered = 0;
  let cleared = 0;

  for (const { chatroomId, role, entry } of entries) {
    const { pid, harness } = entry;
    const alive = verifyPidOwnership(pid, harness);

    if (alive) {
      console.log(`   ✅ Recovered: ${role} (PID ${pid}, harness: ${harness})`);
      recovered++;
    } else {
      console.log(`   🧹 Stale PID ${pid} for ${role} — clearing`);
      await clearAgentPidEverywhere(ctx, chatroomId as Id<'chatroom_rooms'>, role);
      cleared++;
    }
  }

  console.log(`   Recovery complete: ${recovered} alive, ${cleared} stale cleared`);
}

// ─── Command Handlers ────────────────────────────────────────────────────────

/**
 * Handle a ping command — responds with "pong".
 */
function handlePing(): CommandResult {
  console.log(`   ↪ Responding: pong`);
  return { result: 'pong', failed: false };
}

/**
 * Handle a status command — responds with machine info.
 */
function handleStatus(ctx: DaemonContext): CommandResult {
  const result = JSON.stringify({
    hostname: ctx.config?.hostname,
    os: ctx.config?.os,
    availableHarnesses: ctx.config?.availableHarnesses,
    chatroomAgents: Object.keys(ctx.config?.chatroomAgents ?? {}),
  });
  console.log(`   ↪ Responding with status`);
  return { result, failed: false };
}

/**
 * Handle a start-agent command — spawns an agent process for a chatroom role.
 */
async function handleStartAgent(
  ctx: DaemonContext,
  command: StartAgentCommand
): Promise<CommandResult> {
  const { chatroomId, role, agentHarness, model, workingDir } = command.payload;
  console.log(`   ↪ start-agent command received`);
  console.log(`      Chatroom: ${chatroomId}`);
  console.log(`      Role: ${role}`);
  console.log(`      Harness: ${agentHarness}`);
  if (model) {
    console.log(`      Model: ${model}`);
  }

  // Get agent context for working directory.
  // First try local config, then fall back to workingDir from the command payload
  // (which the backend resolves from chatroom_machineAgentConfigs).
  let agentContext = getAgentContext(chatroomId, role);

  if (!agentContext && workingDir) {
    // No local context — use the working directory from the command payload
    // and update the local config so future commands don't need this fallback
    console.log(`   No local agent context, using workingDir from command payload`);
    updateAgentContext(chatroomId, role, agentHarness, workingDir);
    agentContext = getAgentContext(chatroomId, role);
  }

  if (!agentContext) {
    const msg = `No agent context found for ${chatroomId}/${role}`;
    console.log(`   ⚠️  ${msg}`);
    return { result: msg, failed: true };
  }

  console.log(`      Working dir: ${agentContext.workingDir}`);

  // SECURITY: Validate working directory exists on the local filesystem
  // using fs.stat (not a shell command) to prevent path-based attacks.
  // This is defense-in-depth alongside the backend's character validation.
  try {
    const dirStat = await stat(agentContext.workingDir);
    if (!dirStat.isDirectory()) {
      const msg = `Working directory is not a directory: ${agentContext.workingDir}`;
      console.log(`   ⚠️  ${msg}`);
      return { result: msg, failed: true };
    }
  } catch {
    const msg = `Working directory does not exist: ${agentContext.workingDir}`;
    console.log(`   ⚠️  ${msg}`);
    return { result: msg, failed: true };
  }

  // Fetch split init prompt from backend (single source of truth)
  const convexUrl = getConvexUrl();
  const initPromptResult = (await ctx.client.query(api.messages.getInitPrompt, {
    sessionId: ctx.sessionId,
    chatroomId,
    role,
    convexUrl,
  })) as { prompt: string; rolePrompt: string; initialMessage: string } | null;

  if (!initPromptResult?.prompt) {
    const msg = 'Failed to fetch init prompt from backend';
    console.log(`   ⚠️  ${msg}`);
    return { result: msg, failed: true };
  }

  console.log(`   Fetched split init prompt from backend`);

  // Get harness version for version-specific spawn logic (uses cached config)
  const harnessVersion = ctx.config?.harnessVersions?.[agentHarness];

  // Resolve driver from registry and start the agent
  const registry = getDriverRegistry();
  let driver;
  try {
    driver = registry.get(agentHarness);
  } catch {
    const msg = `No driver registered for harness: ${agentHarness}`;
    console.log(`   ⚠️  ${msg}`);
    return { result: msg, failed: true };
  }

  const startResult = await driver.start({
    workingDir: agentContext.workingDir,
    rolePrompt: initPromptResult.rolePrompt,
    initialMessage: initPromptResult.initialMessage,
    harnessVersion: harnessVersion ?? undefined,
    model,
  });

  if (startResult.success && startResult.handle) {
    const msg = `Agent spawned (PID: ${startResult.handle.pid})`;
    console.log(`   ✅ ${msg}`);

    // Update backend with spawned agent PID and persist locally
    if (startResult.handle.pid) {
      try {
        await ctx.client.mutation(api.machines.updateSpawnedAgent, {
          sessionId: ctx.sessionId,
          machineId: ctx.machineId,
          chatroomId,
          role,
          pid: startResult.handle.pid,
        });
        console.log(`   Updated backend with PID: ${startResult.handle.pid}`);

        // Persist PID locally for daemon restart recovery
        persistAgentPid(ctx.machineId, chatroomId, role, startResult.handle.pid, agentHarness);
      } catch (e) {
        console.log(`   ⚠️  Failed to update PID in backend: ${(e as Error).message}`);
      }
    }
    return { result: msg, failed: false };
  }

  console.log(`   ⚠️  ${startResult.message}`);
  return { result: startResult.message, failed: true };
}

/**
 * Handle a stop-agent command — stops a running agent process.
 */
async function handleStopAgent(
  ctx: DaemonContext,
  command: StopAgentCommand
): Promise<CommandResult> {
  const { chatroomId, role } = command.payload;
  console.log(`   ↪ stop-agent command received`);
  console.log(`      Chatroom: ${chatroomId}`);
  console.log(`      Role: ${role}`);

  // Query the backend for the current PID (single source of truth)
  const configsResult = (await ctx.client.query(api.machines.getAgentConfigs, {
    sessionId: ctx.sessionId,
    chatroomId,
  })) as {
    configs: {
      machineId: string;
      role: string;
      agentType?: string;
      spawnedAgentPid?: number;
    }[];
  };

  const targetConfig = configsResult.configs.find(
    (c) => c.machineId === ctx.machineId && c.role.toLowerCase() === role.toLowerCase()
  );

  if (!targetConfig?.spawnedAgentPid) {
    const msg = 'No running agent found (no PID recorded)';
    console.log(`   ⚠️  ${msg}`);
    return { result: msg, failed: true };
  }

  const pidToKill = targetConfig.spawnedAgentPid;
  const agentHarness = (targetConfig.agentType as 'opencode') || undefined;
  console.log(`   Stopping agent with PID: ${pidToKill}`);

  // Build an AgentHandle from the stored PID and harness type
  const stopHandle: AgentHandle = {
    harness: agentHarness || 'opencode', // fallback; harness is needed for handle but stop uses PID
    type: 'process',
    pid: pidToKill,
    workingDir: '', // Not needed for stop
  };

  // Resolve the driver for this harness (for isAlive/stop)
  const registry = getDriverRegistry();
  let stopDriver;
  try {
    stopDriver = agentHarness ? registry.get(agentHarness) : null;
  } catch {
    stopDriver = null;
  }

  // Verify the PID is still alive via the driver (or fallback to verifyPidOwnership)
  const isAlive = stopDriver
    ? await stopDriver.isAlive(stopHandle)
    : verifyPidOwnership(pidToKill, agentHarness);

  if (!isAlive) {
    console.log(`   ⚠️  PID ${pidToKill} does not appear to belong to the expected agent`);
    await clearAgentPidEverywhere(ctx, chatroomId, role);
    console.log(`   Cleared stale PID`);
    return {
      result: `PID ${pidToKill} appears stale (process not found or belongs to different program)`,
      failed: true,
    };
  }

  try {
    // Use the driver to stop the agent (sends SIGTERM for process-based drivers)
    if (stopDriver) {
      await stopDriver.stop(stopHandle);
    } else {
      // Fallback: direct SIGTERM if no driver available
      process.kill(pidToKill, 'SIGTERM');
    }

    const msg = `Agent stopped (PID: ${pidToKill})`;
    console.log(`   ✅ ${msg}`);
    await clearAgentPidEverywhere(ctx, chatroomId, role);
    console.log(`   Cleared PID`);
    return { result: msg, failed: false };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ESRCH') {
      await clearAgentPidEverywhere(ctx, chatroomId, role);
      const msg = 'Process not found (may have already exited)';
      console.log(`   ⚠️  ${msg}`);
      return { result: msg, failed: true };
    }
    const msg = `Failed to stop agent: ${err.message}`;
    console.log(`   ⚠️  ${msg}`);
    return { result: msg, failed: true };
  }
}

// ─── Command Dispatch ────────────────────────────────────────────────────────

/**
 * Process a single command: dispatch to the appropriate handler,
 * then ack the result back to the backend.
 */
async function processCommand(ctx: DaemonContext, command: MachineCommand): Promise<void> {
  console.log(`[${formatTimestamp()}] 📨 Command received: ${command.type}`);

  try {
    // Mark as processing
    await ctx.client.mutation(api.machines.ackCommand, {
      sessionId: ctx.sessionId,
      commandId: command._id,
      status: 'processing',
    });

    // Dispatch to the appropriate handler
    let commandResult: CommandResult;
    switch (command.type) {
      case 'ping':
        commandResult = handlePing();
        break;
      case 'status':
        commandResult = handleStatus(ctx);
        break;
      case 'start-agent':
        commandResult = await handleStartAgent(ctx, command);
        break;
      case 'stop-agent':
        commandResult = await handleStopAgent(ctx, command);
        break;
      default: {
        // Exhaustiveness check: TypeScript will error if a new command type
        // is added to MachineCommand but not handled above.
        const _exhaustive: never = command;
        commandResult = {
          result: `Unknown command type: ${(_exhaustive as MachineCommandBase & { type: string }).type}`,
          failed: true,
        };
      }
    }

    // Ack result back to backend
    const finalStatus = commandResult.failed ? 'failed' : 'completed';
    await ctx.client.mutation(api.machines.ackCommand, {
      sessionId: ctx.sessionId,
      commandId: command._id,
      status: finalStatus,
      result: commandResult.result,
    });

    if (commandResult.failed) {
      console.log(`   ❌ Command failed: ${commandResult.result}`);
    } else {
      console.log(`   ✅ Command completed`);
    }
  } catch (error) {
    console.error(`   ❌ Command failed: ${(error as Error).message}`);

    // Mark as failed
    try {
      await ctx.client.mutation(api.machines.ackCommand, {
        sessionId: ctx.sessionId,
        commandId: command._id,
        status: 'failed',
        result: (error as Error).message,
      });
    } catch {
      // Ignore ack errors
    }
  }
}

// ─── Daemon Initialization ───────────────────────────────────────────────────

/**
 * Initialize the daemon: validate auth, connect to Convex, recover state.
 * Returns the DaemonContext if successful, or exits the process on failure.
 */
async function initDaemon(): Promise<DaemonContext> {
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

  // Update daemon status to connected
  try {
    await client.mutation(api.machines.updateDaemonStatus, {
      sessionId: typedSessionId,
      machineId,
      connected: true,
    });
  } catch (error) {
    console.error(`❌ Failed to update daemon status: ${(error as Error).message}`);
    releaseLock();
    process.exit(1);
  }

  // Load and cache machine config (read once, reused by handlers)
  const config = loadMachineConfig();

  const ctx: DaemonContext = { client, sessionId: typedSessionId, machineId, config };

  console.log(`[${formatTimestamp()}] 🚀 Daemon started`);
  console.log(`   Machine ID: ${machineId}`);
  console.log(`   Hostname: ${config?.hostname ?? 'Unknown'}`);
  console.log(`   Available harnesses: ${config?.availableHarnesses.join(', ') || 'none'}`);
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

// ─── Command Loop ────────────────────────────────────────────────────────────

/**
 * Start the command processing loop: subscribe to Convex for pending commands,
 * enqueue them, and process sequentially.
 */
async function startCommandLoop(ctx: DaemonContext): Promise<never> {
  // Set up graceful shutdown
  const shutdown = async () => {
    console.log(`\n[${formatTimestamp()}] Shutting down...`);

    try {
      // Update daemon status to disconnected
      await ctx.client.mutation(api.machines.updateDaemonStatus, {
        sessionId: ctx.sessionId,
        machineId: ctx.machineId,
        connected: false,
      });
    } catch {
      // Ignore errors during shutdown
    }

    releaseLock();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);

  // Subscribe to pending commands
  const wsClient = await getConvexWsClient();

  // In-memory queue to ensure commands aren't skipped when updates
  // arrive while processing is in progress.
  const commandQueue: MachineCommand[] = [];
  const queuedCommandIds = new Set<string>();
  let drainingQueue = false;

  const enqueueCommands = (commands: MachineCommand[]) => {
    for (const command of commands) {
      const commandId = command._id.toString();
      if (queuedCommandIds.has(commandId)) continue;
      queuedCommandIds.add(commandId);
      commandQueue.push(command);
    }
  };

  const drainQueue = async () => {
    if (drainingQueue) return;
    drainingQueue = true;
    try {
      while (commandQueue.length > 0) {
        const command = commandQueue.shift()!;
        const commandId = command._id.toString();
        queuedCommandIds.delete(commandId);
        try {
          await processCommand(ctx, command);
        } catch (error) {
          console.error(`   ❌ Command processing failed: ${(error as Error).message}`);
        }
      }
    } finally {
      drainingQueue = false;
    }
  };

  console.log(`\nListening for commands...`);
  console.log(`Press Ctrl+C to stop\n`);

  wsClient.onUpdate(
    api.machines.getPendingCommands,
    {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    },
    async (result: { commands: RawMachineCommand[] }) => {
      if (!result.commands || result.commands.length === 0) return;

      // Parse raw commands into type-safe discriminated unions.
      // Invalid commands (missing required fields) are filtered out.
      const parsed = result.commands
        .map(parseMachineCommand)
        .filter((c): c is MachineCommand => c !== null);

      enqueueCommands(parsed);
      await drainQueue();
    }
  );

  // Keep process alive
  return await new Promise(() => {});
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

/**
 * Start the daemon: initialize, then enter the command processing loop.
 */
export async function daemonStart(): Promise<void> {
  const ctx = await initDaemon();
  await startCommandLoop(ctx);
}
