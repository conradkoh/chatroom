/**
 * Daemon Start Command
 *
 * Start the machine daemon that listens for remote commands.
 */

import { execSync } from 'node:child_process';
import { stat } from 'node:fs/promises';

import { acquireLock, releaseLock } from './pid.js';
import { spawnAgent } from './spawn.js';
import { api, type Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import {
  getConvexUrl,
  getConvexClient,
  getConvexWsClient,
} from '../../infrastructure/convex/client.js';
import {
  getMachineId,
  loadMachineConfig,
  getAgentContext,
} from '../../infrastructure/machine/index.js';

interface MachineCommand {
  _id: Id<'chatroom_machineCommands'>;
  type: 'start-agent' | 'stop-agent' | 'ping' | 'status';
  payload: {
    chatroomId?: Id<'chatroom_rooms'>;
    role?: string;
    agentTool?: 'opencode' | 'claude' | 'cursor';
    model?: string;
  };
  createdAt: number;
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

    // Match common patterns: 'opencode', 'claude', 'cursor', 'node' (for Node-based tools)
    return procLower.includes(toolLower) || procLower.includes('node') || procLower.includes('bun');
  } catch {
    // If we can't check, assume the process is valid (safer than killing an unknown process)
    return true;
  }
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
  let processingCommand = false;

  wsClient.onUpdate(
    api.machines.getPendingCommands,
    {
      sessionId: typedSessionId,
      machineId,
    },
    async (result: { commands: MachineCommand[] }) => {
      // Prevent concurrent command processing
      if (processingCommand) return;
      if (!result.commands || result.commands.length === 0) return;

      processingCommand = true;

      try {
        for (const command of result.commands) {
          await processCommand(client, typedSessionId, machineId, command);
        }
      } finally {
        // IMPORTANT: Always reset the flag, even if processCommand throws.
        // Without this, an unhandled error would permanently stop command processing.
        processingCommand = false;
      }
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
        console.log(`   ↪ start-agent command received`);
        console.log(`      Chatroom: ${command.payload.chatroomId}`);
        console.log(`      Role: ${command.payload.role}`);
        console.log(`      Tool: ${command.payload.agentTool}`);
        if (command.payload.model) {
          console.log(`      Model: ${command.payload.model}`);
        }

        // Validate payload
        if (!command.payload.chatroomId || !command.payload.role || !command.payload.agentTool) {
          result = 'Missing required payload: chatroomId, role, or agentTool';
          break;
        }

        // Get agent context for working directory
        const agentContext = getAgentContext(command.payload.chatroomId, command.payload.role);

        if (!agentContext) {
          result = `No agent context found for ${command.payload.chatroomId}/${command.payload.role}`;
          break;
        }

        // SECURITY: Validate working directory exists on the local filesystem
        // using fs.stat (not a shell command) to prevent path-based attacks.
        // This is defense-in-depth alongside the backend's character validation.
        try {
          const dirStat = await stat(agentContext.workingDir);
          if (!dirStat.isDirectory()) {
            result = `Working directory is not a directory: ${agentContext.workingDir}`;
            break;
          }
        } catch {
          result = `Working directory does not exist: ${agentContext.workingDir}`;
          break;
        }

        // Fetch split init prompt from backend (single source of truth)
        const convexUrl = getConvexUrl();
        const initPromptResult = (await client.query(api.messages.getInitPrompt, {
          sessionId,
          chatroomId: command.payload.chatroomId,
          role: command.payload.role,
          convexUrl,
        })) as { prompt: string; rolePrompt: string; initialMessage: string } | null;

        if (!initPromptResult?.prompt) {
          result = 'Failed to fetch init prompt from backend';
          break;
        }

        console.log(`   Fetched split init prompt from backend`);

        // Get tool version for version-specific spawn logic
        const machineConfig = loadMachineConfig();
        const toolVersion = machineConfig?.toolVersions?.[command.payload.agentTool];

        // Spawn the agent with split prompts (role prompt + initial message)
        const spawnResult = await spawnAgent({
          tool: command.payload.agentTool,
          workingDir: agentContext.workingDir,
          rolePrompt: initPromptResult.rolePrompt,
          initialMessage: initPromptResult.initialMessage,
          toolVersion: toolVersion ?? undefined,
          model: command.payload.model,
        });

        if (spawnResult.success) {
          result = `Agent spawned (PID: ${spawnResult.pid})`;
          console.log(`   ✅ ${result}`);

          // Update backend with spawned agent PID
          if (spawnResult.pid) {
            try {
              await client.mutation(api.machines.updateSpawnedAgent, {
                sessionId,
                machineId,
                chatroomId: command.payload.chatroomId,
                role: command.payload.role,
                pid: spawnResult.pid,
              });
              console.log(`   Updated backend with PID: ${spawnResult.pid}`);
            } catch (e) {
              console.log(`   ⚠️  Failed to update PID in backend: ${(e as Error).message}`);
            }
          }
        } else {
          result = spawnResult.message;
          console.log(`   ⚠️  ${result}`);
        }
        break;
      }

      case 'stop-agent': {
        console.log(`   ↪ stop-agent command received`);
        console.log(`      Chatroom: ${command.payload.chatroomId}`);
        console.log(`      Role: ${command.payload.role}`);

        // Validate payload
        if (!command.payload.chatroomId || !command.payload.role) {
          result = 'Missing required payload: chatroomId or role';
          break;
        }

        // Query the backend for the current PID (single source of truth)
        const configsResult = (await client.query(api.machines.getAgentConfigs, {
          sessionId,
          chatroomId: command.payload.chatroomId,
        })) as {
          configs: {
            machineId: string;
            role: string;
            agentType?: string;
            spawnedAgentPid?: number;
          }[];
        };

        const targetConfig = configsResult.configs.find(
          (c) =>
            c.machineId === machineId &&
            c.role.toLowerCase() === command.payload.role!.toLowerCase()
        );

        if (!targetConfig?.spawnedAgentPid) {
          result = 'No running agent found (no PID recorded)';
          break;
        }

        const pidToKill = targetConfig.spawnedAgentPid;
        console.log(`   Stopping agent with PID: ${pidToKill}`);

        // Verify the PID still belongs to the expected agent process
        // to prevent killing an unrelated process after PID recycling
        if (!verifyPidOwnership(pidToKill, targetConfig.agentType)) {
          console.log(`   ⚠️  PID ${pidToKill} does not appear to belong to the expected agent`);
          result = `PID ${pidToKill} appears stale (process not found or belongs to different program)`;

          // Clear the stale PID in backend
          await client.mutation(api.machines.updateSpawnedAgent, {
            sessionId,
            machineId,
            chatroomId: command.payload.chatroomId,
            role: command.payload.role,
            pid: undefined,
          });
          console.log(`   Cleared stale PID in backend`);
          break;
        }

        try {
          // Send SIGTERM to gracefully stop the process
          process.kill(pidToKill, 'SIGTERM');
          result = `Agent stopped (PID: ${pidToKill})`;
          console.log(`   ✅ ${result}`);

          // Clear the PID in backend
          await client.mutation(api.machines.updateSpawnedAgent, {
            sessionId,
            machineId,
            chatroomId: command.payload.chatroomId,
            role: command.payload.role,
            pid: undefined, // Clear PID
          });
          console.log(`   Cleared PID in backend`);
        } catch (e) {
          const err = e as NodeJS.ErrnoException;
          if (err.code === 'ESRCH') {
            result = 'Process not found (may have already exited)';
            // Clear the stale PID
            await client.mutation(api.machines.updateSpawnedAgent, {
              sessionId,
              machineId,
              chatroomId: command.payload.chatroomId,
              role: command.payload.role,
              pid: undefined,
            });
          } else {
            result = `Failed to stop agent: ${err.message}`;
          }
          console.log(`   ⚠️  ${result}`);
        }
        break;
      }

      default:
        result = `Unknown command type: ${command.type}`;
    }

    // Mark as completed
    await client.mutation(api.machines.ackCommand, {
      sessionId,
      commandId: command._id,
      status: 'completed',
      result,
    });

    console.log(`   ✅ Command completed`);
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
