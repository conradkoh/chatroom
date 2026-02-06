/**
 * Daemon Start Command
 *
 * Start the machine daemon that listens for remote commands.
 */

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

  // Update daemon status to connected
  try {
    await client.mutation(api.machines.updateDaemonStatus, {
      sessionId: sessionId as any,
      machineId,
      connected: true,
    });
  } catch (error) {
    console.error(`❌ Failed to update daemon status: ${(error as Error).message}`);
    releaseLock();
    process.exit(1);
  }

  const config = loadMachineConfig();
  const startTime = new Date().toISOString().replace('T', ' ').substring(0, 19);

  console.log(`[${startTime}] 🚀 Daemon started`);
  console.log(`   Machine ID: ${machineId}`);
  console.log(`   Hostname: ${config?.hostname ?? 'Unknown'}`);
  console.log(`   Available tools: ${config?.availableTools.join(', ') || 'none'}`);
  console.log(`   PID: ${process.pid}`);
  console.log(`\nListening for commands...`);
  console.log(`Press Ctrl+C to stop\n`);

  // Set up graceful shutdown
  const shutdown = async () => {
    const shutdownTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`\n[${shutdownTime}] Shutting down...`);

    try {
      // Update daemon status to disconnected
      await client.mutation(api.machines.updateDaemonStatus, {
        sessionId: sessionId as any,
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
      sessionId: sessionId as any,
      machineId,
    },
    async (result: { commands: MachineCommand[] }) => {
      // Prevent concurrent command processing
      if (processingCommand) return;
      if (!result.commands || result.commands.length === 0) return;

      processingCommand = true;

      for (const command of result.commands) {
        await processCommand(client, sessionId, command);
      }

      processingCommand = false;
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
  sessionId: string,
  command: MachineCommand
): Promise<void> {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${timestamp}] 📨 Command received: ${command.type}`);

  try {
    // Mark as processing
    await client.mutation(api.machines.ackCommand, {
      sessionId: sessionId as any,
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
                sessionId: sessionId as any,
                machineId: getMachineId()!,
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

        // Get agent context to find the PID from local config
        const stopAgentContext = getAgentContext(command.payload.chatroomId, command.payload.role);

        if (!stopAgentContext) {
          result = `No agent context found for ${command.payload.chatroomId}/${command.payload.role}`;
          break;
        }

        // We need to get the PID from the backend since we store it there
        // For now, we'll use a workaround - the PID will be passed in the payload from the backend
        // Actually, let's query the backend for the current PID
        const configsResult = (await client.query(api.machines.getAgentConfigs, {
          sessionId: sessionId as any,
          chatroomId: command.payload.chatroomId,
        })) as {
          configs: {
            machineId: string;
            role: string;
            spawnedAgentPid?: number;
          }[];
        };

        const targetConfig = configsResult.configs.find(
          (c) =>
            c.machineId === getMachineId() &&
            c.role.toLowerCase() === command.payload.role!.toLowerCase()
        );

        if (!targetConfig?.spawnedAgentPid) {
          result = 'No running agent found (no PID recorded)';
          break;
        }

        const pidToKill = targetConfig.spawnedAgentPid;
        console.log(`   Stopping agent with PID: ${pidToKill}`);

        try {
          // Send SIGTERM to gracefully stop the process
          process.kill(pidToKill, 'SIGTERM');
          result = `Agent stopped (PID: ${pidToKill})`;
          console.log(`   ✅ ${result}`);

          // Clear the PID in backend
          await client.mutation(api.machines.updateSpawnedAgent, {
            sessionId: sessionId as any,
            machineId: getMachineId()!,
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
              sessionId: sessionId as any,
              machineId: getMachineId()!,
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
      sessionId: sessionId as any,
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
        sessionId: sessionId as any,
        commandId: command._id,
        status: 'failed',
        result: (error as Error).message,
      });
    } catch {
      // Ignore ack errors
    }
  }
}
