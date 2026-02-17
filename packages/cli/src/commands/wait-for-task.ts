/**
 * Wait for tasks in a chatroom
 *
 * This module implements a class-based `WaitForTaskSession` that encapsulates the
 * subscription lifecycle for waiting on tasks. Every event handler funnels through
 * `logAndExit()` to guarantee the process exits with proper logging, event
 * identification, and reconnection guidance.
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
import type { SessionId } from 'convex-helpers/server/sessions';

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
import { sanitizeForTerminal, sanitizeUnknownForTerminal } from '../utils/terminal-safety.js';

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/** Discriminated union response from `getPendingTasksForRole` subscription. */
export type WaitForTaskResponse =
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

/** Parameters passed from the preflight phase to the session. */
export interface SessionParams {
  chatroomId: string;
  role: string;
  silent: boolean;
  sessionId: SessionId;
  connectionId: string;
  cliEnvPrefix: string;
  client: Awaited<ReturnType<typeof getConvexClient>>;
}

// ---------------------------------------------------------------------------
// WaitForTaskSession class
// ---------------------------------------------------------------------------

/**
 * Encapsulates the subscription lifecycle for waiting on tasks.
 *
 * State that was previously scattered as loose `let` variables in the function
 * scope is now held as private instance fields, making the guarantees around
 * cleanup, deduplication, and process exit explicit and auditable.
 */
export class WaitForTaskSession {
  // --- Instance state ---
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private cleanedUp = false;
  private taskProcessed = false;
  private fatalExitTriggered = false;

  // --- Injected dependencies (readonly after construction) ---
  private readonly chatroomId: string;
  private readonly role: string;
  private readonly silent: boolean;
  private readonly sessionId: SessionId;
  private readonly connectionId: string;
  private readonly cliEnvPrefix: string;
  private readonly client: SessionParams['client'];

  constructor(params: SessionParams) {
    this.chatroomId = params.chatroomId;
    this.role = params.role;
    this.silent = params.silent;
    this.sessionId = params.sessionId;
    this.connectionId = params.connectionId;
    this.cliEnvPrefix = params.cliEnvPrefix;
    this.client = params.client;
  }

  // -----------------------------------------------------------------------
  // Public entry point
  // -----------------------------------------------------------------------

  /** Start the subscription, heartbeat, and signal handlers. */
  async start(): Promise<void> {
    this.startHeartbeat();
    this.registerSignalHandlers();
    await this.subscribe();
  }

  // -----------------------------------------------------------------------
  // Core: logAndExit
  // -----------------------------------------------------------------------

  /**
   * Cornerstone exit method — every handler funnels through here.
   *
   * 1. Logs the event type received.
   * 2. Logs the descriptive message.
   * 3. Logs reconnection guidance (the `waitForTaskCommand(...)` output).
   * 4. Fire-and-forget `cleanup()`, then synchronous `process.exit(exitCode)`.
   *
   * Return type is `never` — `process.exit()` is synchronous and truly never returns.
   */
  private logAndExit(exitCode: number, event: string, message: string, guidance: string): never {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const safeEvent = sanitizeForTerminal(event);
    const safeMessage = sanitizeForTerminal(message);
    const safeGuidance = sanitizeForTerminal(guidance);

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`[EVENT: ${safeEvent}]\n`);
    console.log(`[${timestamp}] ${safeMessage}\n`);

    if (safeGuidance) {
      console.log(safeGuidance);
    }

    console.log(`\nTo reconnect, run:`);
    console.log(
      waitForTaskCommand({
        chatroomId: this.chatroomId,
        role: this.role,
        cliEnvPrefix: this.cliEnvPrefix,
      })
    );
    console.log(`${'─'.repeat(50)}`);

    // Fire-and-forget cleanup (idempotent, best-effort — heartbeat TTL handles expiry)
    this.cleanup();

    // Synchronous process termination — truly `never` returns
    process.exit(exitCode);
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Cleanup helper — call on EVERY exit path.
   * Clears the heartbeat interval and tells the backend this participant has left.
   * Safe to call multiple times (idempotent).
   */
  private async cleanup(): Promise<void> {
    if (this.cleanedUp) return;
    this.cleanedUp = true;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    if (this.unsubscribe) {
      this.unsubscribe();
    }

    try {
      await this.client.mutation(api.participants.leave, {
        sessionId: this.sessionId,
        chatroomId: this.chatroomId as Id<'chatroom_rooms'>,
        role: this.role,
      });
    } catch {
      // Best-effort — if the backend is unreachable the heartbeat TTL will expire naturally
    }
  }

  // -----------------------------------------------------------------------
  // Heartbeat
  // -----------------------------------------------------------------------

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.client
        .mutation(api.participants.heartbeat, {
          sessionId: this.sessionId,
          chatroomId: this.chatroomId as Id<'chatroom_rooms'>,
          role: this.role,
          connectionId: this.connectionId,
        })
        .then((result: { status: string } | null | undefined) => {
          if (result?.status === 'rejoin_required') {
            if (!this.silent) {
              console.warn(`⚠️  Participant record missing — re-joining chatroom`);
            }
            return this.client.mutation(api.participants.join, {
              sessionId: this.sessionId,
              chatroomId: this.chatroomId as Id<'chatroom_rooms'>,
              role: this.role,
              readyUntil: Date.now() + HEARTBEAT_TTL_MS,
              connectionId: this.connectionId,
            });
          }
          // Consolidated superseded handling — delegates to shared method
          if (result?.status === 'superseded') {
            this.handleSuperseded();
          }
        })
        .catch((err) => {
          if (!this.silent) {
            console.warn(
              `⚠️  Heartbeat failed: ${sanitizeUnknownForTerminal((err as Error).message)}`
            );
          }
        });
    }, HEARTBEAT_INTERVAL_MS);

    // Ensure the timer doesn't keep the Node process alive when we want to exit
    this.heartbeatTimer.unref();
  }

  // -----------------------------------------------------------------------
  // Subscription
  // -----------------------------------------------------------------------

  private async subscribe(): Promise<void> {
    const wsClient = await getConvexWsClient();
    this.unsubscribe = wsClient.onUpdate(
      api.tasks.getPendingTasksForRole,
      {
        sessionId: this.sessionId,
        chatroomId: this.chatroomId as Id<'chatroom_rooms'>,
        role: this.role,
        connectionId: this.connectionId,
      },
      (response: WaitForTaskResponse) => {
        this.handleSubscriptionResponse(response).catch((error) => {
          console.error(`❌ Error processing task: ${(error as Error).message}`);
        });
      },
      (error: Error) => {
        this.handleSubscriptionError(error, 'task subscription');
      }
    );
  }

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------

  /** Handle the discriminated union response from subscription. */
  private async handleSubscriptionResponse(response: WaitForTaskResponse): Promise<void> {
    if (this.taskProcessed) return;

    switch (response.type) {
      case 'no_tasks':
        // No tasks yet — subscription will notify us when there are.
        // This is the normal idle state; do not exit.
        return;

      case 'superseded':
        this.handleSuperseded();
        return;

      case 'grace_period':
        this.handleGracePeriod(response);
        return;

      case 'error':
        this.handleError(response);
        return;

      case 'reconnect':
        this.handleReconnect(response);
        return;

      case 'tasks':
        await this.handleTasks(response);
        return;
    }
  }

  /**
   * Another process has taken over this role's connection.
   * Exit gracefully so the old agent process terminates cleanly.
   */
  private handleSuperseded(): never {
    this.logAndExit(
      0,
      'superseded',
      'Another wait-for-task process started for this role.',
      'Impact: This process is being replaced by the newer connection.\n' +
        'Action: This is expected if you started a new wait-for-task session.'
    );
  }

  /**
   * Task is in grace period — another agent may still be working on it.
   * Exit with guidance to reconnect.
   */
  private handleGracePeriod(response: { taskId: string; remainingMs: number }): never {
    const remainingSec = Math.ceil(response.remainingMs / 1000);
    this.logAndExit(
      0,
      'grace_period',
      `Task ${response.taskId} was recently acknowledged (${remainingSec}s grace remaining).`,
      'Impact: Another agent may still be processing this task.\n' +
        'Action: Wait for the grace period to expire, then reconnect.'
    );
  }

  /**
   * Backend requested a reconnect.
   * Exit with the reason and reconnection guidance.
   */
  private handleReconnect(response: { reason: string }): never {
    this.logAndExit(
      0,
      'reconnect',
      `Backend requested reconnect: ${response.reason}`,
      'Action: Reconnect to resume listening for tasks.'
    );
  }

  /**
   * Error event from the subscription.
   * Fatal errors exit with code 1; non-fatal errors exit with code 0.
   */
  private handleError(response: { code: BackendErrorCode; message: string; fatal: boolean }): void {
    if (response.fatal) {
      if (this.fatalExitTriggered) return;
      this.fatalExitTriggered = true;
      this.logAndExit(
        1,
        'error (fatal)',
        `❌ FATAL ERROR — [${response.code}] ${response.message}`,
        'This is an unrecoverable error. The process will now exit.'
      );
    }
    // Non-fatal error — exit with code 0 and guidance
    this.logAndExit(
      0,
      'error (non-fatal)',
      `⚠️ Non-fatal error: [${response.code}] ${response.message}`,
      'Action: Reconnect to resume listening for tasks.'
    );
  }

  /**
   * Handle errors from WebSocket subscription callbacks.
   * - ConvexError with a fatal code → logAndExit(1)
   * - ConvexError with a non-fatal code → logAndExit(0)
   * - Non-ConvexError (network, transient) → logAndExit(0)
   */
  private handleSubscriptionError(error: Error, source: string): void {
    if (error instanceof ConvexError) {
      const data = error.data as BackendError;
      if (data?.code && FATAL_ERROR_CODES.includes(data.code)) {
        if (this.fatalExitTriggered) return;
        this.fatalExitTriggered = true;
        this.logAndExit(
          1,
          'subscription_error (fatal)',
          `❌ FATAL ERROR in ${source} — [${data.code}] ${data.message}`,
          'This is an unrecoverable error. The process will now exit.'
        );
        return;
      }
      // Non-fatal ConvexError — exit with guidance
      this.logAndExit(
        0,
        'subscription_error (non-fatal)',
        `⚠️ Non-fatal error in ${source}: [${data?.code}] ${data?.message ?? error.message}`,
        'Action: Reconnect to resume listening for tasks.'
      );
      return;
    }
    // Non-ConvexError (network, transient) — exit with guidance
    this.logAndExit(
      0,
      'subscription_error (transient)',
      `⚠️ Transient error in ${source}: ${error.message}`,
      'Action: Reconnect to resume listening for tasks.'
    );
  }

  /**
   * Process received tasks — claim, deliver, and exit.
   * Exit 0 on success, exit 1 on delivery failure.
   */
  private async handleTasks(response: WaitForTaskResponse & { type: 'tasks' }): Promise<void> {
    const pendingTasks = response.tasks;
    const taskWithMessage = pendingTasks.length > 0 ? pendingTasks[0] : null;

    if (!taskWithMessage) {
      // No tasks in the response array (shouldn't happen with type='tasks', but guard)
      return;
    }

    const { task, message } = taskWithMessage;

    // Handle based on task status
    if (task.status !== 'acknowledged') {
      // Pending task — claim it (transition: pending → acknowledged)
      try {
        await this.client.mutation(api.tasks.claimTask, {
          sessionId: this.sessionId,
          chatroomId: this.chatroomId as Id<'chatroom_rooms'>,
          role: this.role,
          taskId: task._id,
        });
      } catch (_claimError) {
        console.log(`🔄 Task already claimed by another agent, continuing to wait...`);
        return;
      }
    }

    // Mark as processed to prevent duplicate handling
    this.taskProcessed = true;

    // Unsubscribe and stop heartbeat early — we've claimed the task and are
    // transitioning to delivery.
    if (this.unsubscribe) this.unsubscribe();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.cleanedUp = true; // Prevent cleanup() from calling leave on exit

    try {
      // Also claim the message if it exists (for compatibility)
      if (message) {
        await this.client.mutation(api.messages.claimMessage, {
          sessionId: this.sessionId,
          messageId: message._id,
          role: this.role,
        });
      }

      // Update participant status to active with activeUntil timeout
      const activeUntil = Date.now() + DEFAULT_ACTIVE_TIMEOUT_MS;
      await this.client.mutation(api.participants.updateStatus, {
        sessionId: this.sessionId,
        chatroomId: this.chatroomId as Id<'chatroom_rooms'>,
        role: this.role,
        status: 'active',
        expiresAt: activeUntil,
      });

      // Get the complete task delivery prompt from backend
      const taskDeliveryPrompt = await this.client.query(api.messages.getTaskDeliveryPrompt, {
        sessionId: this.sessionId,
        chatroomId: this.chatroomId as Id<'chatroom_rooms'>,
        role: this.role,
        taskId: task._id,
        messageId: message?._id,
        convexUrl: getConvexUrl(),
      });

      // Log task received with timestamp
      const taskReceivedTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
      console.log(`\n[${taskReceivedTime}] 📨 Task received!\n`);

      // Print the complete backend-generated output
      console.log(sanitizeForTerminal(taskDeliveryPrompt.fullCliOutput));

      process.exit(0);
    } catch (deliveryError) {
      // Task was claimed but delivery failed — MUST exit so the agent regains control.
      this.logAndExit(
        1,
        'task_delivery_failed',
        `⚠️ TASK CLAIMED BUT DELIVERY FAILED — ${sanitizeUnknownForTerminal((deliveryError as Error).message)}`,
        `Task ID: ${task._id}\n` +
          `The task has been claimed for your role.\n` +
          `Use context read to see your current task:\n\n` +
          `   ${this.cliEnvPrefix} chatroom context read --chatroom-id=${this.chatroomId} --role=${this.role}`
      );
    }
  }

  // -----------------------------------------------------------------------
  // Signal handlers
  // -----------------------------------------------------------------------

  private registerSignalHandlers(): void {
    const handleSignal = (_signal: string) => {
      this.logAndExit(
        0,
        `signal (${_signal})`,
        `Process interrupted (${_signal}).`,
        'Impact: You are no longer listening for tasks.\n' +
          'Action: Run the reconnect command immediately to resume availability.'
      );
    };

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));
    process.on('SIGHUP', () => handleSignal('SIGHUP'));
  }
}

// ---------------------------------------------------------------------------
// Public API — waitForTask()
// ---------------------------------------------------------------------------

/**
 * Wait for tasks in a chatroom.
 *
 * Handles all pre-flight validation (auth, chatroom access, machine registration,
 * participant join, init prompt) and then delegates to `WaitForTaskSession.start()`.
 */
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
  try {
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
      const workingDir = process.cwd();
      updateAgentContext(chatroomId, role, agentType, workingDir);

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
    if (!silent) {
      console.warn(
        `⚠️  Machine registration failed: ${sanitizeUnknownForTerminal((machineError as Error).message)}`
      );
    }
  }

  // Generate a unique connection ID for this wait-for-task session
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
      const connectedTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
      console.log(`[${connectedTime}] ✅ Connected. Waiting for task...\n`);

      if (!initPromptResult.hasSystemPromptControl) {
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

  // --- Delegate to the session class ---
  const session = new WaitForTaskSession({
    chatroomId,
    role,
    silent: !!silent,
    sessionId,
    connectionId,
    cliEnvPrefix,
    client,
  });

  await session.start();
}
