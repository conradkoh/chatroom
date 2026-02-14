/**
 * Wait for tasks in a chatroom
 */

import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TTL_MS } from '@workspace/backend/config/reliability.js';
import { getWaitForTaskGuidance } from '@workspace/backend/prompts/base/cli/index.js';
import { waitForTaskCommand } from '@workspace/backend/prompts/base/cli/wait-for-task/command.js';
import { getCliEnvPrefix } from '@workspace/backend/prompts/utils/env.js';

import { api, type Id, type Chatroom, type TaskWithMessage } from '../api.js';
import { DEFAULT_ACTIVE_TIMEOUT_MS } from '../config.js';
import { getDriverRegistry } from '../infrastructure/agent-drivers/index.js';
import { getSessionId, getOtherSessionUrls } from '../infrastructure/auth/storage.js';
import {
  getConvexUrl,
  getConvexClient,
  getConvexWsClient,
} from '../infrastructure/convex/client.js';
import {
  ensureMachineRegistered,
  updateAgentContext,
  type AgentHarness,
} from '../infrastructure/machine/index.js';

interface WaitForTaskOptions {
  role: string;
  silent?: boolean;
  agentType?: AgentHarness;
}

export async function waitForTask(chatroomId: string, options: WaitForTaskOptions): Promise<void> {
  const client = await getConvexClient();
  const { role, silent } = options;

  // Get Convex URL and CLI env prefix for generating commands
  const convexUrl = getConvexUrl();
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    const otherUrls = getOtherSessionUrls();

    console.error(`❌ Not authenticated for: ${convexUrl}`);

    if (otherUrls.length > 0) {
      console.error(`\n💡 You have sessions for other environments:`);
      for (const url of otherUrls) {
        console.error(`   • ${url}`);
      }
      console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
      console.error(`   CHATROOM_CONVEX_URL=${otherUrls[0]} chatroom wait-for-task ...`);
      console.error(`\n   Or to authenticate for the current environment:`);
    }

    console.error(`   chatroom auth login`);
    process.exit(1);
  }

  // Validate chatroom ID format before query
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    console.error(
      `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${chatroomId?.length || 0})`
    );
    process.exit(1);
  }

  if (!/^[a-zA-Z0-9_]+$/.test(chatroomId)) {
    console.error(
      `❌ Invalid chatroom ID format: ID must contain only alphanumeric characters and underscores`
    );
    process.exit(1);
  }

  // Validate chatroom exists and user has access
  const chatroom = (await client.query(api.chatrooms.get, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  })) as Chatroom | null;

  if (!chatroom) {
    console.error(`❌ Chatroom ${chatroomId} not found or access denied`);
    process.exit(1);
  }

  // Register machine and sync config to backend
  // This enables remote agent start from web UI
  try {
    // Ensure local machine config exists (idempotent - creates or refreshes)
    const machineInfo = ensureMachineRegistered();

    // Discover available models from installed harnesses (dynamic)
    let availableModels: string[] = [];
    try {
      const registry = getDriverRegistry();
      for (const driver of registry.all()) {
        if (driver.capabilities.dynamicModelDiscovery) {
          const models = await driver.listModels();
          availableModels = availableModels.concat(models);
        }
      }
    } catch {
      // Model discovery is non-critical — continue with empty list
    }

    // Register/update machine in backend

    await client.mutation(api.machines.register, {
      sessionId,
      machineId: machineInfo.machineId,
      hostname: machineInfo.hostname,
      os: machineInfo.os,
      availableHarnesses: machineInfo.availableHarnesses,
      harnessVersions: machineInfo.harnessVersions,
      availableModels,
    });

    // Determine agent type (from flag or default to first available harness)
    const agentType: AgentHarness | undefined =
      options.agentType ??
      (machineInfo.availableHarnesses.length > 0 ? machineInfo.availableHarnesses[0] : undefined);

    if (agentType) {
      // Store agent config for this chatroom+role (enables remote restart)
      const workingDir = process.cwd();

      // Update local config
      updateAgentContext(chatroomId, role, agentType, workingDir);

      // Sync to backend

      await client.mutation(api.machines.updateAgentConfig, {
        sessionId,
        machineId: machineInfo.machineId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role,
        agentType,
        workingDir,
      });
    }
  } catch (machineError) {
    // Machine registration is non-critical - log warning but continue
    if (!silent) {
      console.warn(`⚠️  Machine registration failed: ${(machineError as Error).message}`);
    }
  }

  // Generate a unique connection ID for this wait-for-task session
  // This allows detection of concurrent wait-for-task processes
  // If another process starts, it will update the connectionId and this process will exit
  const connectionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  // Join the chatroom with connectionId and initial readyUntil (heartbeat-based liveness)
  await client.mutation(api.participants.join, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    role,
    readyUntil: Date.now() + HEARTBEAT_TTL_MS,
    connectionId,
  });

  // Log initial connection with timestamp
  const connectionTime = new Date().toISOString().replace('T', ' ').substring(0, 19);

  if (!silent) {
    console.log(`[${connectionTime}] ⏳ Connecting to chatroom as "${role}"...`);
  }

  // On first session, fetch and display the full initialization prompt from backend
  try {
    const convexUrl = getConvexUrl();
    const initPromptResult = (await client.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      convexUrl,
    })) as { prompt: string; hasSystemPromptControl?: boolean } | null;

    if (initPromptResult?.prompt) {
      // Log successful connection with timestamp
      const connectedTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
      console.log(`[${connectedTime}] ✅ Connected. Waiting for task...\n`);

      // Skip init prompt for agents with system prompt control (e.g. remote agents)
      // These agents already have the instructions in their system prompt
      if (!initPromptResult.hasSystemPromptControl) {
        // Wrap reference content in HTML comments for LLM skimming
        console.log('<!-- REFERENCE: Agent Initialization');
        console.log('');
        console.log('═'.repeat(50));
        console.log('📋 AGENT INITIALIZATION PROMPT');
        console.log('═'.repeat(50));
        console.log('');
        console.log(getWaitForTaskGuidance());
        console.log('');
        console.log('═'.repeat(50));
        console.log('');
        console.log(initPromptResult.prompt);
        console.log('');
        console.log('═'.repeat(50));
        console.log('-->');
        console.log('');
      }
    }
  } catch {
    // Fallback - init prompt not critical, continue without it
  }

  // --- Heartbeat timer ---
  // Periodically refresh readyUntil so the backend knows this process is alive.
  // The interval is cleared on every exit path (task received, signal, error, superseded).
  const heartbeatTimer = setInterval(() => {
    client
      .mutation(api.participants.heartbeat, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role,
        connectionId,
      })
      .catch((err) => {
        // Log but don't crash — a single missed heartbeat is tolerated by the TTL
        if (!silent) {
          console.warn(`⚠️  Heartbeat failed: ${(err as Error).message}`);
        }
      });
  }, HEARTBEAT_INTERVAL_MS);

  // Ensure the timer doesn't keep the Node process alive when we want to exit
  heartbeatTimer.unref();

  /**
   * Cleanup helper — call on EVERY exit path.
   * Clears the heartbeat interval and tells the backend this participant has left.
   * Safe to call multiple times (idempotent).
   */
  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeatTimer);
    try {
      await client.mutation(api.participants.leave, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role,
      });
    } catch {
      // Best-effort — if the backend is unreachable the heartbeat TTL will expire naturally
    }
  };

  // Track if we've already processed a task (prevent duplicate processing)
  let taskProcessed = false;
  let unsubscribe: (() => void) | null = null;

  // Handle task processing when we receive pending tasks via subscription
  const handlePendingTasks = async (pendingTasks: TaskWithMessage[]) => {
    // Prevent duplicate processing
    if (taskProcessed) return;

    // Check if another wait-for-task process has taken over
    // This detects concurrent processes and gracefully exits the old one
    const currentConnectionId = await client.query(api.participants.getConnectionId, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
    });

    if (currentConnectionId && currentConnectionId !== connectionId) {
      // Another process has taken over - exit gracefully
      if (unsubscribe) unsubscribe();
      // Cleanup heartbeat (don't call participants.leave — the new process owns the participant)
      clearInterval(heartbeatTimer);
      cleanedUp = true; // Prevent cleanup() from calling leave
      const takeoverTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`⚠️  CONNECTION SUPERSEDED\n`);
      console.log(`[${takeoverTime}] Why: Another wait-for-task process started for this role`);
      console.log(`Impact: This process is being replaced by the newer connection`);
      console.log(`Action: This is expected if you started a new wait-for-task session\n`);
      console.log(`If you meant to use THIS terminal, run:`);
      console.log(waitForTaskCommand({ chatroomId, role, cliEnvPrefix }));
      console.log(`${'─'.repeat(50)}`);
      process.exit(0);
    }

    // Get the first task (pending tasks come first, then acknowledged)
    const taskWithMessage = pendingTasks.length > 0 ? pendingTasks[0] : null;

    if (!taskWithMessage) {
      // No tasks yet, subscription will notify us when there are
      return;
    }

    const { task, message } = taskWithMessage;

    // Handle based on task status
    if (task.status === 'acknowledged') {
      // This is an acknowledged task that may need recovery
      const acknowledgedAt = task.acknowledgedAt || task.updatedAt;
      const elapsedMs = Date.now() - acknowledgedAt;
      const RECOVERY_GRACE_PERIOD_MS = 60 * 1000; // 1 minute

      if (elapsedMs < RECOVERY_GRACE_PERIOD_MS) {
        // Recently acknowledged — another agent may still be working on it
        const remainingSec = Math.ceil((RECOVERY_GRACE_PERIOD_MS - elapsedMs) / 1000);
        console.log(
          `🔄 Task was recently acknowledged (${remainingSec}s remaining). ` +
            `Re-run wait-for-task in 1 minute to recover it if the other agent is unresponsive.`
        );
        return;
      }

      // Stale acknowledged task (>1 min) — recover it
      // No claim needed since task is already acknowledged for this role
    } else {
      // Pending task — claim it (transition: pending → acknowledged)
      // This is atomic and handles race conditions - only one agent can claim a task
      try {
        await client.mutation(api.tasks.claimTask, {
          sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
        });
      } catch (_claimError) {
        // Task was already claimed by another agent, subscription will update with new state
        console.log(`🔄 Task already claimed by another agent, continuing to wait...`);
        return;
      }
    }

    // Mark as processed to prevent duplicate handling
    taskProcessed = true;

    // Also claim the message if it exists (for compatibility)
    if (message) {
      await client.mutation(api.messages.claimMessage, {
        sessionId,
        messageId: message._id,
        role,
      });
    }

    // SUCCESS: This agent has exclusive claim on the task
    if (unsubscribe) unsubscribe();

    // Stop heartbeat — the agent is transitioning from "waiting" to "active".
    // We do NOT call participants.leave here because the agent is still present,
    // just switching to active work mode.
    clearInterval(heartbeatTimer);
    cleanedUp = true; // Prevent cleanup() from calling leave on exit

    // Update participant status to active with activeUntil timeout
    // This gives the agent ~1 hour to complete the task before being considered crashed
    const activeUntil = Date.now() + DEFAULT_ACTIVE_TIMEOUT_MS;
    await client.mutation(api.participants.updateStatus, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      status: 'active',
      expiresAt: activeUntil,
    });

    // Get the complete task delivery prompt from backend
    const taskDeliveryPrompt = await client.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      taskId: task._id,
      messageId: message?._id,
      convexUrl,
    });

    // Log task received with timestamp
    const taskReceivedTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`\n[${taskReceivedTime}] 📨 Task received!\n`);

    // Print the complete backend-generated output
    // All structural text, commands, context, and process steps are generated server-side
    console.log(taskDeliveryPrompt.fullCliOutput);

    process.exit(0);
  };

  // Use websocket subscription instead of polling
  // This is more efficient - we only receive updates when data changes
  const wsClient = await getConvexWsClient();
  unsubscribe = wsClient.onUpdate(
    api.tasks.getPendingTasksForRole,
    {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
    },
    (pendingTasks: TaskWithMessage[]) => {
      handlePendingTasks(pendingTasks).catch((error) => {
        console.error(`❌ Error processing task: ${(error as Error).message}`);
      });
    }
  );

  // Handle interrupt signals - These are UNEXPECTED terminations that require immediate restart
  const handleSignal = (_signal: string) => {
    if (unsubscribe) unsubscribe();
    // Clean up heartbeat and notify backend that this participant has left
    cleanup().finally(() => {
      const signalTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`⚠️  RECONNECTION REQUIRED\n`);
      console.log(`[${signalTime}] Why: Process interrupted (unexpected termination)`);
      console.log(`Impact: You are no longer listening for tasks`);
      console.log(`Action: Run this command immediately to resume availability\n`);
      console.log(waitForTaskCommand({ chatroomId, role, cliEnvPrefix }));
      console.log(`${'─'.repeat(50)}`);
      process.exit(0);
    });
  };

  // SIGINT: Ctrl+C or interrupt signal
  process.on('SIGINT', () => handleSignal('SIGINT'));

  // SIGTERM: Graceful termination (e.g., container shutdown, timeout)
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  // SIGHUP: Hang up signal (terminal closed)
  process.on('SIGHUP', () => handleSignal('SIGHUP'));
}
