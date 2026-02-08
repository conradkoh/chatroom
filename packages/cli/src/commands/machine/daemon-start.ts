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

/**
 * Base fields shared across all machine commands.
 */
interface MachineCommandBase {
  _id: Id<'chatroom_machineCommands'>;
  createdAt: number;
}

/**
 * Start an agent process in a chatroom.
 * Requires chatroomId, role, and agentTool. Model and workingDir are optional.
 */
interface StartAgentCommand extends MachineCommandBase {
  type: 'start-agent';
  payload: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    agentTool: 'opencode';
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
 * Query daemon status (hostname, OS, available tools).
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
    agentTool?: 'opencode';
    model?: string;
    workingDir?: string;
  };
  createdAt: number;
}

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
      const { chatroomId, role, agentTool } = raw.payload;
      if (!chatroomId || !role || !agentTool) {
        console.error(`   ⚠️  Invalid start-agent command: missing chatroomId, role, or agentTool`);
        return null;
      }
      return {
        _id: raw._id,
        type: 'start-agent',
        payload: {
          chatroomId,
          role,
          agentTool,
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

/**
 * Format timestamp for daemon log output.
 */
function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Verify that a PID belongs to an expected process.
 * Returns true if the process exists and appears to match the expected tool.
 * Returns false if the PID doesn't exist or belongs to a different process.
 */
function verifyPidOwnership(pid: number, expectedTool?: string): boolean {
  try {
    // First check if process exists
    process.kill(pid, 0);
  } catch {
    // Process doesn't exist
    return false;
  }

  if (!expectedTool) {
    // No tool to verify against, just confirm process exists
    return true;
  }

  // Try to get process info to verify it's the expected tool
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

    // Check if the process name contains the expected tool name
    const toolLower = expectedTool.toLowerCase();
    const procLower = processName.toLowerCase();

    // Match common patterns: 'opencode', 'node' (for Node-based tools)
    return procLower.includes(toolLower) || procLower.includes('node') || procLower.includes('bun');
  } catch {
    // If we can't check, assume the process is valid (safer than killing an unknown process)
    return true;
  }
}

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
async function recoverAgentState(
  client: Awaited<ReturnType<typeof getConvexClient>>,
  sessionId: any,
  machineId: string
): Promise<void> {
  const entries = listAgentEntries(machineId);

  if (entries.length === 0) {
    console.log(`   No agent entries found — nothing to recover`);
    return;
  }

  let recovered = 0;
  let cleared = 0;

  for (const { chatroomId, role, entry } of entries) {
    const { pid, tool } = entry;
    const alive = verifyPidOwnership(pid, tool);

    if (alive) {
      console.log(`   ✅ Recovered: ${role} (PID ${pid}, tool: ${tool})`);
      recovered++;
    } else {
      console.log(`   🧹 Stale PID ${pid} for ${role} — clearing`);

      // Clear locally
      clearAgentPid(machineId, chatroomId, role);

      // Clear in Convex (best-effort — don't fail startup if this errors)
      try {
        await client.mutation(api.machines.updateSpawnedAgent, {
          sessionId,
          machineId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          pid: undefined,
        });
      } catch (e) {
        console.log(`   ⚠️  Failed to clear stale PID in Convex: ${(e as Error).message}`);
      }

      cleared++;
    }
  }

  console.log(`   Recovery complete: ${recovered} alive, ${cleared} stale cleared`);
}

/**
 * Start the daemon
 */
export async function daemonStart(): Promise<void> {
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

  // SessionId is validated above as non-null. We use a typed reference
  // to avoid repeated `as any` casts throughout the daemon.
  // The Convex SessionIdArg expects a specific branded type, but our
  // sessionId is a plain string from local storage. This single cast
  // is the boundary between our storage format and Convex's type system.
  const typedSessionId = sessionId as any;

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

  const config = loadMachineConfig();

  console.log(`[${formatTimestamp()}] 🚀 Daemon started`);
  console.log(`   Machine ID: ${machineId}`);
  console.log(`   Hostname: ${config?.hostname ?? 'Unknown'}`);
  console.log(`   Available tools: ${config?.availableTools.join(', ') || 'none'}`);
  console.log(`   PID: ${process.pid}`);

  // Recover agent state from previous daemon session
  console.log(`\n[${formatTimestamp()}] 🔄 Recovering agent state...`);
  try {
    await recoverAgentState(client, typedSessionId, machineId);
  } catch (e) {
    console.log(`   ⚠️  Recovery failed: ${(e as Error).message}`);
    console.log(`   Continuing with fresh state`);
  }

  console.log(`\nListening for commands...`);
  console.log(`Press Ctrl+C to stop\n`);

  // Set up graceful shutdown
  const shutdown = async () => {
    console.log(`\n[${formatTimestamp()}] Shutting down...`);

    try {
      // Update daemon status to disconnected
      await client.mutation(api.machines.updateDaemonStatus, {
        sessionId: typedSessionId,
        machineId,
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
          await processCommand(client, typedSessionId, machineId, command);
        } catch (error) {
          console.error(`   ❌ Command processing failed: ${(error as Error).message}`);
        }
      }
    } finally {
      drainingQueue = false;
    }
  };

  wsClient.onUpdate(
    api.machines.getPendingCommands,
    {
      sessionId: typedSessionId,
      machineId,
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
  await new Promise(() => {});
}

/**
 * Process a single command
 */
async function processCommand(
  client: Awaited<ReturnType<typeof getConvexClient>>,
  sessionId: any,
  machineId: string,
  command: MachineCommand
): Promise<void> {
  console.log(`[${formatTimestamp()}] 📨 Command received: ${command.type}`);

  try {
    // Mark as processing
    await client.mutation(api.machines.ackCommand, {
      sessionId,
      commandId: command._id,
      status: 'processing',
    });

    let result: string;
    let commandFailed = false;

    switch (command.type) {
      case 'ping':
        result = 'pong';
        console.log(`   ↪ Responding: pong`);
        break;

      case 'status':
        const config = loadMachineConfig();
        result = JSON.stringify({
          hostname: config?.hostname,
          os: config?.os,
          availableTools: config?.availableTools,
          chatroomAgents: Object.keys(config?.chatroomAgents ?? {}),
        });
        console.log(`   ↪ Responding with status`);
        break;

      case 'start-agent': {
        const { chatroomId, role, agentTool, model, workingDir } = command.payload;
        console.log(`   ↪ start-agent command received`);
        console.log(`      Chatroom: ${chatroomId}`);
        console.log(`      Role: ${role}`);
        console.log(`      Tool: ${agentTool}`);
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
          updateAgentContext(chatroomId, role, agentTool, workingDir);
          agentContext = getAgentContext(chatroomId, role);
        }

        if (!agentContext) {
          result = `No agent context found for ${chatroomId}/${role}`;
          commandFailed = true;
          console.log(`   ⚠️  ${result}`);
          break;
        }

        console.log(`      Working dir: ${agentContext.workingDir}`);

        // SECURITY: Validate working directory exists on the local filesystem
        // using fs.stat (not a shell command) to prevent path-based attacks.
        // This is defense-in-depth alongside the backend's character validation.
        try {
          const dirStat = await stat(agentContext.workingDir);
          if (!dirStat.isDirectory()) {
            result = `Working directory is not a directory: ${agentContext.workingDir}`;
            commandFailed = true;
            console.log(`   ⚠️  ${result}`);
            break;
          }
        } catch {
          result = `Working directory does not exist: ${agentContext.workingDir}`;
          commandFailed = true;
          console.log(`   ⚠️  ${result}`);
          break;
        }

        // Fetch split init prompt from backend (single source of truth)
        const convexUrl = getConvexUrl();
        const initPromptResult = (await client.query(api.messages.getInitPrompt, {
          sessionId,
          chatroomId,
          role,
          convexUrl,
        })) as { prompt: string; rolePrompt: string; initialMessage: string } | null;

        if (!initPromptResult?.prompt) {
          result = 'Failed to fetch init prompt from backend';
          commandFailed = true;
          console.log(`   ⚠️  ${result}`);
          break;
        }

        console.log(`   Fetched split init prompt from backend`);

        // Get tool version for version-specific spawn logic
        const machineConfig = loadMachineConfig();
        const toolVersion = machineConfig?.toolVersions?.[agentTool];

        // Resolve driver from registry and start the agent
        const registry = getDriverRegistry();
        let driver;
        try {
          driver = registry.get(agentTool);
        } catch {
          result = `No driver registered for tool: ${agentTool}`;
          commandFailed = true;
          console.log(`   ⚠️  ${result}`);
          break;
        }

        const startResult = await driver.start({
          workingDir: agentContext.workingDir,
          rolePrompt: initPromptResult.rolePrompt,
          initialMessage: initPromptResult.initialMessage,
          toolVersion: toolVersion ?? undefined,
          model,
        });

        if (startResult.success && startResult.handle) {
          result = `Agent spawned (PID: ${startResult.handle.pid})`;
          console.log(`   ✅ ${result}`);

          // Update backend with spawned agent PID
          if (startResult.handle.pid) {
            try {
              await client.mutation(api.machines.updateSpawnedAgent, {
                sessionId,
                machineId,
                chatroomId,
                role,
                pid: startResult.handle.pid,
              });
              console.log(`   Updated backend with PID: ${startResult.handle.pid}`);

              // Persist PID locally for daemon restart recovery
              persistAgentPid(machineId, chatroomId, role, startResult.handle.pid, agentTool);
            } catch (e) {
              console.log(`   ⚠️  Failed to update PID in backend: ${(e as Error).message}`);
            }
          }
        } else {
          result = startResult.message;
          commandFailed = true;
          console.log(`   ⚠️  ${result}`);
        }
        break;
      }

      case 'stop-agent': {
        const { chatroomId: stopChatroomId, role: stopRole } = command.payload;
        console.log(`   ↪ stop-agent command received`);
        console.log(`      Chatroom: ${stopChatroomId}`);
        console.log(`      Role: ${stopRole}`);

        // Query the backend for the current PID (single source of truth)
        const configsResult = (await client.query(api.machines.getAgentConfigs, {
          sessionId,
          chatroomId: stopChatroomId,
        })) as {
          configs: {
            machineId: string;
            role: string;
            agentType?: string;
            spawnedAgentPid?: number;
          }[];
        };

        const targetConfig = configsResult.configs.find(
          (c) => c.machineId === machineId && c.role.toLowerCase() === stopRole.toLowerCase()
        );

        if (!targetConfig?.spawnedAgentPid) {
          result = 'No running agent found (no PID recorded)';
          commandFailed = true;
          console.log(`   ⚠️  ${result}`);
          break;
        }

        const pidToKill = targetConfig.spawnedAgentPid;
        const agentTool = (targetConfig.agentType as 'opencode') || undefined;
        console.log(`   Stopping agent with PID: ${pidToKill}`);

        // Build an AgentHandle from the stored PID and tool type
        const stopHandle: AgentHandle = {
          tool: agentTool || 'opencode', // fallback; tool is needed for handle but stop uses PID
          type: 'process',
          pid: pidToKill,
          workingDir: '', // Not needed for stop
        };

        // Resolve the driver for this tool (for isAlive/stop)
        const stopRegistry = getDriverRegistry();
        let stopDriver;
        try {
          stopDriver = agentTool ? stopRegistry.get(agentTool) : null;
        } catch {
          stopDriver = null;
        }

        // Verify the PID is still alive via the driver (or fallback to verifyPidOwnership)
        const isAlive = stopDriver
          ? await stopDriver.isAlive(stopHandle)
          : verifyPidOwnership(pidToKill, agentTool);

        if (!isAlive) {
          console.log(`   ⚠️  PID ${pidToKill} does not appear to belong to the expected agent`);
          result = `PID ${pidToKill} appears stale (process not found or belongs to different program)`;
          commandFailed = true;

          // Clear the stale PID in backend
          await client.mutation(api.machines.updateSpawnedAgent, {
            sessionId,
            machineId,
            chatroomId: stopChatroomId,
            role: stopRole,
            pid: undefined,
          });
          console.log(`   Cleared stale PID in backend`);
          // Also clear locally for restart recovery
          clearAgentPid(machineId, stopChatroomId, stopRole);
          break;
        }

        try {
          // Use the driver to stop the agent (sends SIGTERM for process-based drivers)
          if (stopDriver) {
            await stopDriver.stop(stopHandle);
          } else {
            // Fallback: direct SIGTERM if no driver available
            process.kill(pidToKill, 'SIGTERM');
          }
          result = `Agent stopped (PID: ${pidToKill})`;
          console.log(`   ✅ ${result}`);

          // Clear the PID in backend
          await client.mutation(api.machines.updateSpawnedAgent, {
            sessionId,
            machineId,
            chatroomId: stopChatroomId,
            role: stopRole,
            pid: undefined, // Clear PID
          });
          console.log(`   Cleared PID in backend`);
          // Also clear locally for restart recovery
          clearAgentPid(machineId, stopChatroomId, stopRole);
        } catch (e) {
          const err = e as NodeJS.ErrnoException;
          if (err.code === 'ESRCH') {
            result = 'Process not found (may have already exited)';
            commandFailed = true;
            // Clear the stale PID
            await client.mutation(api.machines.updateSpawnedAgent, {
              sessionId,
              machineId,
              chatroomId: stopChatroomId,
              role: stopRole,
              pid: undefined,
            });
            // Also clear locally
            clearAgentPid(machineId, stopChatroomId, stopRole);
          } else {
            result = `Failed to stop agent: ${err.message}`;
            commandFailed = true;
          }
          console.log(`   ⚠️  ${result}`);
        }
        break;
      }

      default: {
        // Exhaustiveness check: this should never be reached.
        // If a new command type is added to MachineCommand but not handled above,
        // TypeScript will report a compile error here.
        const _exhaustive: never = command;
        result = `Unknown command type: ${(_exhaustive as MachineCommandBase & { type: string }).type}`;
      }
    }

    // Mark as completed or failed based on whether an error occurred
    const finalStatus = commandFailed ? 'failed' : 'completed';
    await client.mutation(api.machines.ackCommand, {
      sessionId,
      commandId: command._id,
      status: finalStatus,
      result,
    });

    if (commandFailed) {
      console.log(`   ❌ Command failed: ${result}`);
    } else {
      console.log(`   ✅ Command completed`);
    }
  } catch (error) {
    console.error(`   ❌ Command failed: ${(error as Error).message}`);

    // Mark as failed
    try {
      await client.mutation(api.machines.ackCommand, {
        sessionId,
        commandId: command._id,
        status: 'failed',
        result: (error as Error).message,
      });
    } catch {
      // Ignore ack errors
    }
  }
}
