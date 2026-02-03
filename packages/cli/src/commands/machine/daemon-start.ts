/**
 * Daemon Start Command
 *
 * Start the machine daemon that listens for remote commands.
 */

import { acquireLock, releaseLock } from './pid.js';
import { api, type Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import {
  getConvexUrl,
  getConvexClient,
  getConvexWsClient,
} from '../../infrastructure/convex/client.js';
import { getMachineId, loadMachineConfig } from '../../infrastructure/machine/index.js';

interface MachineCommand {
  _id: Id<'chatroom_machineCommands'>;
  type: 'start-agent' | 'ping' | 'status';
  payload: {
    chatroomId?: Id<'chatroom_rooms'>;
    role?: string;
    agentTool?: 'opencode' | 'claude' | 'cursor';
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

      case 'start-agent':
        // This will be implemented in Phase 5
        console.log(`   ↪ start-agent command received`);
        console.log(`      Chatroom: ${command.payload.chatroomId}`);
        console.log(`      Role: ${command.payload.role}`);
        console.log(`      Tool: ${command.payload.agentTool}`);
        result = 'Agent spawn not yet implemented (Phase 5)';
        break;

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
