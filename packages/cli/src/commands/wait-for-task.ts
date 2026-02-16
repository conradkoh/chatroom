/**
 * Wait for tasks in a chatroom
 */

import {
  FATAL_ERROR_CODES,
  type BackendError,
  type BackendErrorCode,
} from '@workspace/backend/config/errorCodes.js';
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TTL_MS } from '@workspace/backend/config/reliability.js';
import { getWaitForTaskGuidance } from '@workspace/backend/prompts/base/cli/index.js';
import { waitForTaskCommand } from '@workspace/backend/prompts/base/cli/wait-for-task/command.js';
import { getCliEnvPrefix } from '@workspace/backend/prompts/utils/env.js';
import { ConvexError } from 'convex/values';

import { api, type Id } from '../api.js';
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
import { isNetworkError, formatConnectivityError } from '../utils/error-formatting.js';

/** Discriminated union response from `getPendingTasksForRole` subscription. */
type WaitForTaskResponse =
  | {
      type: 'tasks';
      tasks: {
        task: { _id: Id<'chatroom_tasks'>; status: string };
        message: { _id: Id<'chatroom_messages'> } | null;
      }[];
    }
  | { type: 'no_tasks' }
  | { type: 'grace_period'; taskId: string; remainingMs: number }
  | { type: 'superseded'; newConnectionId: string }
  | { type: 'reconnect'; reason: string }
  | { type: 'error'; code: BackendErrorCode; message: string; fatal: boolean };

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
  let chatroom;
  try {
    chatroom = await client.query(api.chatrooms.get, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
    });
  } catch (error) {
    if (isNetworkError(error)) {
      formatConnectivityError(error, convexUrl);
      process.exit(1);
    }
    throw error;
  }

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

  // Determine agent type ('custom' | 'remote') from team agent config
  let participantAgentType: 'custom' | 'remote' | undefined;
  try {
    const teamConfigs = await client.query(api.machines.getTeamAgentConfigs, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
    });
    const roleConfig = (teamConfigs as { role: string; type: 'custom' | 'remote' }[])?.find(
      (c) => c.role.toLowerCase() === role.toLowerCase()
    );
    participantAgentType = roleConfig?.type;
  } catch {
    // Non-critical — continue without agent type
  }

  // Join the chatroom with connectionId and initial readyUntil (heartbeat-based liveness)
  await client.mutation(api.participants.join, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    role,
    readyUntil: Date.now() + HEARTBEAT_TTL_MS,
    connectionId,
    agentType: participantAgentType,
  });

  // Log initial connection with timestamp
  const connectionTime = new Date().toISOString().replace('T', ' ').substring(0, 19);

  if (!silent) {
    console.log(`[${connectionTime}] ⏳ Connecting to chatroom as "${role}"...`);
  }

  // On first session, fetch and display the full initialization prompt from backend
  try {
    const initPromptResult = await client.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      convexUrl,
    });

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
      .then((result: { status: string } | null | undefined) => {
        // Self-healing: if participant was cleaned up, re-join to restore it (Plan 026)
        if (result?.status === 'rejoin_required') {
          if (!silent) {
            console.warn(`⚠️  Participant record missing — re-joining chatroom`);
          }
          return client.mutation(api.participants.join, {
            sessionId,
            chatroomId: chatroomId as Id<'chatroom_rooms'>,
            role,
            readyUntil: Date.now() + HEARTBEAT_TTL_MS,
            connectionId,
          });
        }
        // A newer wait-for-task process has taken over this role's connection.
        // The heartbeat was rejected (not processed). No action needed here —
        // the connection-superseded subscription handles graceful shutdown.
        if (result?.status === 'superseded') {
          if (!silent) {
            console.warn(`⚠️  Heartbeat superseded — a newer connection owns this role`);
          }
        }
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
  let fatalExitTriggered = false;
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

  /**
   * Handle errors from WebSocket subscription callbacks.
   * - ConvexError with a fatal code → log, cleanup, and exit(1)
   * - ConvexError with a non-fatal code → log a warning, continue
   * - Non-ConvexError (network, transient) → log a warning, continue
   */
  const handleSubscriptionError = (error: Error, source: string) => {
    if (error instanceof ConvexError) {
      const data = error.data as BackendError;
      if (data?.code && FATAL_ERROR_CODES.includes(data.code)) {
        // Guard against duplicate exits
        if (fatalExitTriggered) return;
        fatalExitTriggered = true;

        const errorTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
        console.error(`\n${'─'.repeat(50)}`);
        console.error(`❌ FATAL ERROR — Process must exit\n`);
        console.error(`[${errorTime}] Error: ${data.code}`);
        console.error(`   ${data.message}\n`);
        console.error(`   This is an unrecoverable error. The process will now exit.`);
        console.error(`   To reconnect, run:`);
        console.error(
          `   ${cliEnvPrefix} chatroom wait-for-task --chatroom-id=${chatroomId} --role=${role}`
        );
        console.error(`${'─'.repeat(50)}`);
        cleanup().finally(() => {
          process.exit(1);
        });
        return;
      }
      // Non-fatal ConvexError — warn but continue
      console.warn(
        `⚠️  Non-fatal error in ${source}: [${data?.code}] ${data?.message ?? error.message}`
      );
      return;
    }
    // Non-ConvexError (network, transient) — warn but continue
    console.warn(`⚠️  Transient error in ${source}: ${error.message}`);
  };

  // Track if we've already processed a task (prevent duplicate processing)
  let taskProcessed = false;
  let unsubscribe: (() => void) | null = null;

  // Handle response from the getPendingTasksForRole subscription
  const handleSubscriptionResponse = async (response: WaitForTaskResponse) => {
    // Prevent duplicate processing
    if (taskProcessed) return;

    // Handle discriminated union response types
    if (response.type === 'no_tasks') {
      // No tasks yet, subscription will notify us when there are
      return;
    }

    if (response.type === 'superseded') {
      // Another process has taken over - exit gracefully
      if (unsubscribe) unsubscribe();
      clearInterval(heartbeatTimer);
      cleanedUp = true;
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

    if (response.type === 'grace_period') {
      // Task is in grace period — another agent may still be working on it
      if (!silent) {
        const remainingSec = Math.ceil(response.remainingMs / 1000);
        console.log(
          `🔄 Task ${response.taskId} was recently acknowledged (${remainingSec}s grace remaining). Waiting...`
        );
      }
      return;
    }

    if (response.type === 'error') {
      if (response.fatal) {
        if (fatalExitTriggered) return;
        fatalExitTriggered = true;
        const errorTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
        console.error(`\n${'─'.repeat(50)}`);
        console.error(`❌ FATAL ERROR — Process must exit\n`);
        console.error(`[${errorTime}] Error: ${response.code}`);
        console.error(`   ${response.message}\n`);
        console.error(`   This is an unrecoverable error. The process will now exit.`);
        console.error(`   To reconnect, run:`);
        console.error(
          `   ${cliEnvPrefix} chatroom wait-for-task --chatroom-id=${chatroomId} --role=${role}`
        );
        console.error(`${'─'.repeat(50)}`);
        cleanup().finally(() => {
          process.exit(1);
        });
        return;
      }
      // Non-fatal error — warn but continue waiting
      console.warn(`⚠️  Non-fatal error: [${response.code}] ${response.message}`);
      return;
    }

    if (response.type === 'reconnect') {
      if (!silent) {
        console.log(`🔄 Backend requested reconnect: ${response.reason}`);
      }
      return;
    }

    // response.type === 'tasks' — process the tasks
    const pendingTasks = response.tasks;

    // Get the first task (pending tasks come first, then acknowledged)
    const taskWithMessage = pendingTasks.length > 0 ? pendingTasks[0] : null;

    if (!taskWithMessage) {
      // No tasks in the response array (shouldn't happen with type='tasks', but guard)
      return;
    }

    const { task, message } = taskWithMessage;

    // Handle based on task status
    if (task.status === 'acknowledged') {
      // Stale acknowledged task (past grace period, which backend already checked)
      // No claim needed since task is already acknowledged for this role — recover it
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

    // Unsubscribe and stop heartbeat early — we've claimed the task and are
    // transitioning to delivery. Any error below must still exit the process
    // so the agent regains control (otherwise taskProcessed=true blocks all
    // future subscription updates and the process hangs forever).
    if (unsubscribe) unsubscribe();
    clearInterval(heartbeatTimer);
    cleanedUp = true; // Prevent cleanup() from calling leave on exit

    try {
      // Also claim the message if it exists (for compatibility)
      if (message) {
        await client.mutation(api.messages.claimMessage, {
          sessionId,
          messageId: message._id,
          role,
        });
      }

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
    } catch (deliveryError) {
      // Task was claimed but delivery failed (network error, backend issue, etc.).
      // We MUST exit so the agent regains control — it can recover via context read.
      const errorTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
      console.error(`\n${'─'.repeat(50)}`);
      console.error(`⚠️  TASK CLAIMED BUT DELIVERY FAILED\n`);
      console.error(`[${errorTime}] Error: ${(deliveryError as Error).message}`);
      console.error(`   Task ID: ${task._id}`);
      console.error(`   The task has been claimed for your role.`);
      console.error(`   Use context read to see your current task:\n`);
      console.error(
        `   ${cliEnvPrefix} chatroom context read --chatroom-id=${chatroomId} --role=${role}`
      );
      console.error(`${'─'.repeat(50)}`);
      process.exit(1);
    }
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
      connectionId,
    },
    (response: WaitForTaskResponse) => {
      handleSubscriptionResponse(response).catch((error) => {
        console.error(`❌ Error processing task: ${(error as Error).message}`);
      });
    },
    (error: Error) => {
      handleSubscriptionError(error, 'task subscription');
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
